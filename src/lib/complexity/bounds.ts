// ループの回数の推論(§5.1)。
//  - boundOf: 上限の式(n*m / n/i / 1<<n / sqrt(n) …)を計算量の式にする
//  - iterCount: for x in … の対象の要素数(enumerate / zip / sorted の中身、g[v] の隣接走査、順列・組合せ)
//  - inferLoop: ループ1つの回数と、親と合成する特殊な形(調和級数・償却・隣接走査)
import type { Confidence, ContainerKind, Expr, IrNode, SExpr } from "./ir.ts";
import { add, constValue, exp2Of, factOf, format, lit, logOfExpr, mul, ONE, powExpr, singleSym, sym } from "./expr.ts";
import { evalConst, isCast, rangeOf, targetNames, walk } from "./semantics.ts";
import type { Consts } from "./semantics.ts";
import { sexprText } from "./sexpr.ts";

export type LoopNode = Extract<IrNode, { kind: "loop" }>;

export interface LoopScope {
  var: string | null;
  bound: Expr;
  node: LoopNode;
  /** BFS の while で、キューから取り出して束縛した名前 */
  popped: string[];
}

/** 解析器が bounds.ts に提供するもの */
export interface BoundEnv {
  consts: Consts;
  outer: LoopScope[];
  params: ReadonlySet<string>;
  /** 変数名 → 記号(初出を記録する) */
  sym(name: string): Expr;
  /** 由来の説明つきで記号を作る(max(a)、入力の要素数など) */
  named(symbol: string, origin: string, line: number): Expr;
  sizeOf(e: SExpr | null): Expr;
  kindOf(e: SExpr): ContainerKind;
  /** ループの手前での最後の代入の値 */
  initialValue(name: string, loop: LoopNode): SExpr | null;
  /** name が外側のループより前(または外側の for の初期化)で決まり、外側のループの中で振り出しに戻されないか */
  persistsAcross(name: string, outer: LoopScope, inner: LoopNode): boolean;
  isInput(e: SExpr): boolean;
  /** 入力で読んだスカラ変数か(while (t--) のマルチテストの判定) */
  isInputVar(name: string): boolean;
  /** 隣接リスト g への辺の追加の総数(無ければ記号 M) */
  edgesOf(g: string): Expr;
  /** 頂点数(visited / dist の大きさ。無ければ主記号) */
  vertices(): Expr;
  /** 配列の宣言の次元(メモ化の表の大きさ) */
  declDims(name: string): SExpr[] | null;
}

export interface Special {
  kind: "harmonic" | "amortized" | "adjacency";
  /** 合成する相手: 調和級数は外側のループ変数、隣接走査は頂点の変数 */
  anchor: string;
  /** 調和級数は上限 E、償却は全体の回数、隣接走査は辺の数 */
  total: Expr;
}

export interface LoopFactor {
  expr: Expr;
  conf: Confidence;
  reason: string;
  warn?: string;
  info?: string;
  special?: Special;
  popped?: string[];
}

const Q: Expr = [{ coef: 1, factors: [{ v: "?", pow: 1, log: 0, exp: 0, fact: 0 }] }];

export interface Bound {
  expr: Expr;
  /** n / i の形なら i(調和級数の手がかり) */
  dividedBy?: string;
}

const NULLISH = new Set(["true", "false", "null", "nullptr", "None", "nil", "undefined", "True", "False", "Inf", "inf", "INF"]);
const TRANSPARENT = new Set(["int", "ll", "long", "float", "double", "Number", "abs", "ceil", "floor", "round", "Int", "Int64", "parseInt", "parse", "static_cast", "i64", "u64", "usize", "to_i", "toInt", "trunc", "ceil_div", "cast", "BigInt", "llabs", "fabs", "tonumber", "tointeger", "intval", "Integer", "isqrt_floor"]);
/** 名前空間つきの呼び出し math.floor(x) / Math.sqrt(x) は関数として見る */
const MATH_NS = new Set(["math", "Math", "std", "np", "numpy", "Base"]);

export function boundOf(e: SExpr | null, env: BoundEnv, depth = 0): Bound | null {
  if (!e || depth > 16) return null;
  const c = evalConst(e, env.consts);
  if (c !== null && Number.isFinite(c)) return { expr: lit(Math.abs(c)) };
  const b = (x: SExpr | null) => boundOf(x, env, depth + 1);
  switch (e.kind) {
    case "sym": {
      if (e.sigil === "@") return { expr: env.sizeOf({ kind: "sym", name: e.name }) };
      const o = [...env.outer].reverse().find((s) => s.var === e.name);
      if (o) return { expr: o.bound };
      if (NULLISH.has(e.name)) return { expr: ONE };
      return { expr: env.sym(e.name) };
    }
    case "size":
      return { expr: env.sizeOf(e.of) };
    case "un":
      return b(e.e);
    case "bin": {
      const l = b(e.l);
      const r = b(e.r);
      switch (e.op) {
        case "+":
        case "|":
        case "^":
          if (!l) return r;
          if (!r) return l;
          return { expr: add(l.expr, r.expr) };
        case "-":
          return l;
        case "*":
          return l && r ? { expr: mul(l.expr, r.expr) } : null;
        case "/":
        case "//":
        case ">>":
        case "div":
          if (!l) return null;
          if (e.r.kind === "sym" && env.outer.some((s) => s.var === (e.r as { name: string }).name)) return { expr: l.expr, dividedBy: e.r.name };
          return l;
        case "%":
        case "mod":
          return r;
        case "&":
          return l ?? r;
        case "**":
          return pow(e.l, e.r, l, r);
        case "<<": {
          if (!r) return null;
          const s = singleSym(r.expr);
          if (s) return { expr: exp2Of(s) };
          const k = constValue(r.expr);
          if (k !== null) return { expr: lit(Math.pow(2, Math.min(k, 1023))) };
          return { expr: sym(`2^(${sexprText(e.r)})`) };
        }
        default:
          return null;
      }
    }
    case "call": {
      const n = e.name;
      const a = e.args;
      if ((TRANSPARENT.has(n) || isCast(n)) && a.length >= 1) return b(a[a.length - 1]);
      if (n === "min" && a.length >= 1) {
        const bs = a.map(b).filter((x): x is Bound => x !== null);
        const cst = bs.find((x) => constValue(x.expr) !== null);
        return cst ?? bs[0] ?? null;
      }
      if (n === "max" && a.length >= 1) {
        const bs = a.map(b).filter((x): x is Bound => x !== null);
        return bs.length ? { expr: bs.reduce((acc, x) => add(acc, x.expr), bs[0].expr) } : null;
      }
      if (["sqrt", "isqrt", "sqrtl", "cbrt", "integer_sqrt"].includes(n) && a.length >= 1) {
        const x = b(a[a.length - 1]);
        return x ? { expr: powExpr(x.expr, 0.5) } : null;
      }
      if (["log2", "__lg", "log", "log10", "bit_length", "ilog2", "floor_log2"].includes(n) && a.length >= 1) {
        const x = b(a[0]);
        return x ? { expr: logOfExpr(x.expr) } : null;
      }
      if (n === "sizeof" && a.length >= 1) {
        const x = a[0];
        const dims = x.kind === "sym" ? env.declDims(x.name) : null;
        if (dims && dims.length) return { expr: dims.reduce((acc, d) => mul(acc, boundOf(d, env, depth + 1)?.expr ?? env.sizeOf(x)), ONE) };
        // sizeof(int) / sizeof(x)(スカラ)は定数
        if (x.kind === "sym" && (env.kindOf(x) === "unknown" || env.kindOf(x) === "scalar")) return { expr: ONE };
        return { expr: env.sizeOf(x) };
      }
      if (["len", "size", "strlen", "length", "count", "scalar", "lastindex", "high", "ssize"].includes(n) && a.length >= 1) {
        return { expr: env.sizeOf(a[0]) };
      }
      if (n === "pow" && a.length >= 2) return pow(a[0], a[1], b(a[0]), b(a[1]));
      return null;
    }
    case "member": {
      const n = e.name;
      if (e.args && e.of.kind === "sym" && MATH_NS.has(e.of.name)) return boundOf({ kind: "call", name: n, ns: e.of.name, args: e.args }, env, depth + 1);
      if ((isCast(n) || TRANSPARENT.has(n) || ["to_i", "to_f", "floor", "ceil", "round", "int", "float", "toInt", "unwrap", "abs", "trunc", "as_usize", "as_i64"].includes(n)) && (e.args === null || e.args.length === 0)) {
        return b(e.of);
      }
      if (n === "bit_length" || n === "bit_count") {
        const x = b(e.of);
        return x ? { expr: logOfExpr(x.expr) } : null;
      }
      if ((n === "sqrt" || n === "isqrt") && (e.args === null || e.args.length === 0)) {
        const x = b(e.of);
        return x ? { expr: powExpr(x.expr, 0.5) } : null;
      }
      if (n === "pow" && e.args && e.args.length >= 1) return pow(e.of, e.args[0], b(e.of), b(e.args[0]));
      return null;
    }
    case "cond": {
      const x = b(e.a);
      const y = b(e.b);
      if (!x) return y;
      if (!y) return x;
      return { expr: add(x.expr, y.expr) };
    }
    case "index":
      // 配列の要素の値(a[i] 回まわす)は、要素の値の上限 max(a)
      if (e.of.kind === "sym") return { expr: env.named(`max(${e.of.name})`, `配列 ${e.of.name} の要素の値の上限`, 0) };
      return null;
    case "list":
      return e.items.length === 1 ? b(e.items[0]) : null;
    default:
      return null;
  }
}

function pow(base: SExpr, ex: SExpr, l: Bound | null, r: Bound | null): Bound | null {
  const k = r ? constValue(r.expr) : null;
  if (l && k !== null) return { expr: powExpr(l.expr, k) };
  const bv = l ? constValue(l.expr) : null;
  if (bv === 2 && r) {
    const s = singleSym(r.expr);
    return { expr: s ? exp2Of(s) : sym(`2^(${sexprText(ex)})`) };
  }
  void base;
  return null;
}

// ---------------------------------------------------------------------------
// for x in … の要素数

export interface IterCount {
  expr: Expr;
  conf: Confidence;
  reason: string;
  warn?: string;
  special?: Special;
}

const WRAP_CALLS = new Set(["axes", "enumerate", "reversed", "sorted", "set", "list", "tuple", "iter", "frozenset", "deque", "zip", "Counter", "sorted_by", "each_with_index", "pairs", "ipairs", "keys", "values", "eachindex", "collect", "items", "reverse", "rev", "Reverse", "chain", "sort", "uniq", "unique", "withIndex", "entries", "Object.entries", "Object.keys", "Object.values"]);
const WRAP_MEMBERS = new Set(["items", "keys", "values", "iter", "into_iter", "iter_mut", "chars", "bytes", "rev", "reverse", "reversed", "enumerate", "each", "each_with_index", "entries", "copied", "cloned", "to_a", "with_index", "each_char", "each_key", "each_value", "pairs", "mpairs", "mitems", "items", "keySet", "entrySet", "AsEnumerable", "Keys", "Values", "sorted", "uniq", "zip", "windows", "chunks", "to_vec", "toList", "toSeq", "lines", "split", "split_whitespace", "Split", "sort", "values_mut", "enumerated"]);

export function iterCount(coll: SExpr, env: BoundEnv, loop: LoopNode): IterCount {
  let e = coll;
  // 包み(enumerate(a) / a.items() / reversed(a) / a[::-1] / &a)を剥がす
  for (let guard = 0; guard < 8; guard++) {
    if (e.kind === "call" && WRAP_CALLS.has(e.name) && e.args.length >= 1) e = e.args[0];
    else if (e.kind === "member" && WRAP_MEMBERS.has(e.name) && (e.args === null || e.args.length <= 1) && !(e.name === "split" && env.isInput(e))) e = e.of;
    else if (e.kind === "slice") e = e.of;
    else if (e.kind === "un") e = e.e;
    else break;
  }
  const r = rangeOf(e);
  // 'a':'z' / 'a'..'z' のような文字の範囲は文字数
  if (r && r.from && r.from.kind === "str" && r.to.kind === "str" && r.from.value.length === 1 && r.to.value.length === 1) {
    const n = r.to.value.charCodeAt(0) - r.from.value.charCodeAt(0) + (r.inclusive ? 1 : 0);
    return { expr: lit(Math.max(1, n)), conf: "high", reason: `文字 ${r.from.value} から ${r.to.value} まで` };
  }
  if (r) {
    const b = boundOf(r.to, env);
    if (b) return { expr: b.expr, conf: "high", reason: `範囲 ${sexprText(r.to)} まで` };
  }
  switch (e.kind) {
    case "list":
      return { expr: lit(Math.max(1, e.items.length)), conf: "high", reason: `${e.items.length} 要素の並び` };
    case "str":
      return { expr: lit(Math.max(1, e.value.length)), conf: "high", reason: `${e.value.length} 文字` };
    case "index": {
      // 隣接リスト g[v] の走査。v が取り出した頂点・関数の引数・外側のループ変数なら、合計は辺の数
      const g = e.of.kind === "sym" ? e.of.name : e.of.kind === "member" ? e.of.name : null;
      const v = e.idx[0];
      if (g && v && v.kind === "sym") {
        const edges = env.edgesOf(g);
        const anchor = v.name;
        const anchored = env.params.has(anchor) || env.outer.some((s) => s.var === anchor || s.popped.includes(anchor));
        if (anchored) return { expr: edges, conf: "medium", reason: `隣接リスト ${g}[${anchor}] の走査(全体で辺の数)`, special: { kind: "adjacency", anchor, total: edges } };
        return { expr: edges, conf: "medium", reason: `${g}[${anchor}] の要素(最大で全体の要素数)` };
      }
      return { expr: env.sizeOf(e), conf: "medium", reason: `${sexprText(e)} の要素` };
    }
    case "call": {
      const a = e.args;
      if (e.name === "permutations" && a.length >= 1) {
        const n = countExpr(a[0], env);
        const k = a[1] ? evalConst(a[1], env.consts) : null;
        return k !== null ? { expr: powN(n, k), conf: "high", reason: `${k} 個の順列` } : { expr: factE(n), conf: "high", reason: "全順列" };
      }
      if ((e.name === "combinations" || e.name === "combinations_with_replacement") && a.length >= 2) {
        const n = countExpr(a[0], env);
        const k = evalConst(a[1], env.consts);
        return k !== null ? { expr: powN(n, k), conf: "high", reason: `${k} 個の組合せ` } : { expr: exp2E(n), conf: "medium", reason: "組合せ" };
      }
      if (e.name === "product" && a.length >= 1) {
        const rep = a.find((x) => x.kind === "assign" && x.target.kind === "sym" && x.target.name === "repeat");
        if (rep && rep.kind === "assign" && rep.value) {
          const E = boundOf(rep.value, env);
          const s = E ? singleSym(E.expr) : null;
          const width = a[0].kind === "list" ? a[0].items.length : a[0].kind === "str" ? a[0].value.length : 2;
          const expr = s ? exp2Of(s) : E ? exp2E(E.expr) : Q;
          return { expr, conf: width <= 2 ? "high" : "medium", reason: "直積(repeat)", warn: width > 2 ? `実際は ${width}^${sexprText(rep.value)} 通りです(表示は 2^… の形)` : undefined };
        }
        return { expr: a.reduce((acc, x) => mul(acc, countExpr(x, env)), ONE), conf: "high", reason: "直積" };
      }
      if (env.isInput(e)) return { expr: env.named("N", "入力の要素数", loop.loc.line), conf: "low", reason: "入力の要素" };
      return { expr: Q, conf: "low", reason: `${sexprText(e)} の要素`, warn: `${sexprText(e)} の要素数を推定できません。N 個とみなしました` };
    }
    case "member": {
      const a = e.args ?? [];
      if ((e.name === "permutation" || e.name === "repeated_permutation") && a.length >= 1) {
        const k = evalConst(a[0], env.consts);
        const n = env.sizeOf(e.of);
        return k !== null ? { expr: powN(n, k), conf: "high", reason: `${k} 個の順列` } : { expr: factE(n), conf: "high", reason: "全順列" };
      }
      if (e.name === "permutation" && a.length === 0) return { expr: factE(env.sizeOf(e.of)), conf: "high", reason: "全順列" };
      if (e.name === "combination" && a.length >= 1) {
        const k = evalConst(a[0], env.consts);
        return { expr: k !== null ? powN(env.sizeOf(e.of), k) : exp2E(env.sizeOf(e.of)), conf: "high", reason: "組合せ" };
      }
      if (e.name === "product" && a.length >= 1) return { expr: mul(env.sizeOf(e.of), env.sizeOf(a[0])), conf: "high", reason: "直積" };
      if (env.isInput(e)) return { expr: env.named("N", "入力の要素数", loop.loc.line), conf: "low", reason: "入力の要素" };
      return { expr: env.sizeOf(e), conf: "medium", reason: `${sexprText(e)} の要素` };
    }
    case "sym":
      if (env.isInput(e) && env.kindOf(e) === "unknown") return { expr: env.sizeOf(e), conf: "medium", reason: `入力 ${e.name} の要素` };
      return { expr: env.sizeOf(e), conf: "high", reason: `${e.name} の要素` };
    default:
      return { expr: env.sizeOf(e), conf: "medium", reason: `${sexprText(e)} の要素` };
  }
}

function countExpr(e: SExpr, env: BoundEnv): Expr {
  const r = rangeOf(e);
  if (r) return boundOf(r.to, env)?.expr ?? Q;
  if (e.kind === "list") return lit(e.items.length);
  const c = evalConst(e, env.consts);
  if (c !== null) return lit(c);
  if (e.kind === "sym" && env.kindOf(e) === "scalar") return env.sym(e.name);
  return env.sizeOf(e);
}

function powN(n: Expr, k: number): Expr {
  return powExpr(n, Math.max(1, k));
}
function factE(n: Expr): Expr {
  const s = singleSym(n);
  return s ? factOf(s) : sym(`(${format(n, [])})!`);
}
function exp2E(n: Expr): Expr {
  const s = singleSym(n);
  return s ? exp2Of(s) : n;
}

// ---------------------------------------------------------------------------
// ループ1つの回数

/** 代入の形 x op= v / x = x op v を (op, v) にする */
function updateOf(e: SExpr, v: string): { op: string; by: SExpr | null } | null {
  if (e.kind === "list") {
    for (const it of e.items) {
      const u = updateOf(it, v);
      if (u) return u;
    }
    return null;
  }
  if (e.kind !== "assign" || e.target.kind !== "sym" || e.target.name !== v) return null;
  if (e.value === null) return { op: e.op === "++" ? "+=" : "-=", by: { kind: "num", value: 1 } };
  if (e.op !== "=") return { op: e.op, by: e.value };
  const val = e.value;
  if (val.kind === "bin" && val.l.kind === "sym" && val.l.name === v) return { op: `${val.op}=`, by: val.r };
  if (val.kind === "bin" && val.op === "+" && val.r.kind === "sym" && val.r.name === v) return { op: "+=", by: val.l };
  if (val.kind === "bin" && val.op === "&") return { op: "&=", by: val.r };
  // PHP の $k = intdiv($k, 2)
  if (val.kind === "call" && val.name === "intdiv" && val.args[0]?.kind === "sym" && val.args[0].name === v && val.args[1]) return { op: "/=", by: val.args[1] };
  // Nim の x = x div 10 / Ruby の x = x / 10 は上で拾える。それ以外は不明
  return { op: "=", by: val };
}

/** 条件の中の、ループ変数 v と上限 E の比較 */
function limitOf(cond: SExpr, v: string): { E: SExpr; kind: "lt" | "gt" | "sqrt" | "end" } | null {
  const conj: SExpr[] = [];
  const INVERT: Record<string, string> = { "<": ">=", "<=": ">", ">": "<=", ">=": "<", "==": "!=", "!=": "==" };
  const split = (x: SExpr) => {
    if (x.kind === "logic" && x.op === "&&") {
      split(x.l);
      split(x.r);
    } else if (x.kind === "not" && x.e.kind === "cmp" && INVERT[x.e.op]) {
      // until i >= n / repeat … until i >= n は while i < n
      conj.push({ ...x.e, op: INVERT[x.e.op] as typeof x.e.op });
    } else conj.push(x);
  };
  split(cond);
  const isV = (x: SExpr) => x.kind === "sym" && x.name === v;
  const hasV = (x: SExpr) => {
    let f = false;
    walk(x, (y) => {
      if (y.kind === "sym" && y.name === v) f = true;
    });
    return f;
  };
  for (const c of conj) {
    if (c.kind !== "cmp") continue;
    let { l, r } = c;
    let op = c.op;
    if (!hasV(l) && hasV(r)) {
      [l, r] = [r, l];
      op = op === "<" ? ">" : op === "<=" ? ">=" : op === ">" ? "<" : op === ">=" ? "<=" : op;
    }
    if (!hasV(l)) continue;
    if (op === "!=" && (r.kind === "member" || r.kind === "call") && ["end", "cend", "rend", "End"].includes(r.kind === "member" ? r.name : r.name)) {
      return { E: r.kind === "member" ? { kind: "size", of: r.of } : { kind: "size", of: r.args[0] ?? r }, kind: "end" };
    }
    // i*i <= n / i <= sqrt(n)
    if (l.kind === "bin" && l.op === "*" && isV(l.l) && isV(l.r) && (op === "<" || op === "<=")) return { E: r, kind: "sqrt" };
    if (l.kind === "bin" && l.op === "**" && isV(l.l) && l.r.kind === "num" && l.r.value === 2) return { E: r, kind: "sqrt" };
    if (op === "<" || op === "<=" || op === "!=") return { E: r, kind: "lt" };
    if (op === ">" || op === ">=") return { E: r, kind: "gt" };
  }
  return null;
}

function outerVarNamed(env: BoundEnv, e: SExpr | null): string | null {
  if (!e) return null;
  if (e.kind === "sym" && env.outer.some((s) => s.var === e.name)) return e.name;
  // j += i のほかに j += 2 * i も調和級数
  if (e.kind === "bin" && e.op === "*") return outerVarNamed(env, e.r) ?? outerVarNamed(env, e.l);
  return null;
}

export function inferLoop(loop: LoopNode, env: BoundEnv): LoopFactor {
  const b = loop.bound;
  const line = loop.loc.line;
  if (b.form === "count") {
    const x = boundOf(b.count, env);
    if (!x) return { expr: Q, conf: "low", reason: `${sexprText(b.count)} 回`, warn: `${line}行目: 回数 ${sexprText(b.count)} を評価できません。N 回とみなしました` };
    return { expr: x.expr, conf: "high", reason: `${sexprText(b.count)} 回` };
  }
  if (b.form === "for-range") {
    // 'a':'z' / 'a'..'z' のような文字の範囲は文字数
    if (b.from && b.from.kind === "str" && b.to.kind === "str" && b.from.value.length === 1 && b.to.value.length === 1) {
      const n = b.to.value.charCodeAt(0) - b.from.value.charCodeAt(0) + (b.inclusive ? 1 : 0);
      return { expr: lit(Math.max(1, n)), conf: "high", reason: `文字 ${b.from.value} から ${b.to.value} まで` };
    }
    if (env.isInput(b.to)) {
      return { expr: env.named("T", `入力で読む回数(${line}行目)`, line), conf: "medium", reason: "入力で読んだ回数", info: "マルチテストです。範囲指定の N は1ケースあたりの値にしてください" };
    }
    const to = boundOf(b.to, env);
    if (!to) return { expr: Q, conf: "low", reason: `上限 ${sexprText(b.to)}`, warn: `${line}行目: 上限 ${sexprText(b.to)} を評価できません。N 回とみなしました` };
    const stepVar = outerVarNamed(env, b.step);
    if (stepVar) return { expr: to.expr, conf: "high", reason: `刻み ${stepVar} の調和級数`, special: { kind: "harmonic", anchor: stepVar, total: to.expr }, info: b.from && b.from.kind === "bin" && b.from.op === "*" ? "篩なら実際は N log log N です" : undefined };
    if (to.dividedBy) return { expr: to.expr, conf: "high", reason: `上限 ${sexprText(b.to)} の調和級数`, special: { kind: "harmonic", anchor: to.dividedBy, total: to.expr } };
    const from = b.from;
    const fromOuter = from && outerVarNamed(env, from);
    return { expr: to.expr, conf: "high", reason: fromOuter ? `${fromOuter} から ${sexprText(b.to)} まで(最悪 ${sexprText(b.to)} 回)` : `${sexprText(b.to)} まで` };
  }
  if (b.form === "for-in") {
    const it = iterCount(b.coll, env, loop);
    return { expr: it.expr, conf: it.conf, reason: it.reason, warn: it.warn ? `${line}行目: ${it.warn}` : undefined, special: it.special };
  }
  if (b.form === "for-c") return forC(loop, b, env);
  return whileLoop(loop, env);
}

function forC(loop: LoopNode, b: Extract<LoopNode["bound"], { form: "for-c" }>, env: BoundEnv): LoopFactor {
  const line = loop.loc.line;
  const v = b.var;
  const unknownQ = (why: string): LoopFactor => ({ expr: Q, conf: "low", reason: why, warn: `${line}行目: for の反復回数を推定できません。N 回とみなしました` });
  if (!v || !b.cond) {
    if (!b.cond) return { expr: Q, conf: "low", reason: "終了条件なし", warn: `${line}行目: 終了条件の無い for です。N 回とみなしました` };
    return unknownQ("ループ変数が分からない");
  }
  const u = b.update ? updateOf(b.update, v) : null;
  const lim = limitOf(b.cond, v);
  const initVal = b.init ? findInit(b.init, v) : null;
  // 部分集合の列挙 for (s = mask; s > 0; s = (s - 1) & mask)
  if (u && u.op === "&=") {
    return { expr: [{ coef: 1, factors: [{ v: "?", pow: 0, log: 0, exp: 1, fact: 0 }] }], conf: "low", reason: "部分集合の列挙", warn: `${line}行目: 部分集合の列挙の正確な合計は 3^N です(表示は上界)` };
  }
  if (!lim) return unknownQ("条件の形が分からない");
  if (lim.kind === "end") return { expr: boundOf(lim.E, env)?.expr ?? Q, conf: "high", reason: `${sexprText(lim.E)} の要素` };
  const E = boundOf(lim.E, env);
  if (lim.kind === "sqrt") {
    return E ? { expr: powExpr(E.expr, 0.5), conf: "high", reason: `${v}² ≤ ${sexprText(lim.E)}` } : unknownQ("上限が分からない");
  }
  const op = u?.op ?? "";
  if (op === "*=" || op === "<<=") return E ? { expr: logOfExpr(E.expr), conf: "high", reason: `${v} を倍々にして ${sexprText(lim.E)} まで` } : unknownQ("上限が分からない");
  if (op === "/=" || op === ">>=" || op === "//=") {
    const start = initVal ? boundOf(initVal, env) : E;
    return start ? { expr: logOfExpr(start.expr), conf: "high", reason: `${v} を半分ずつにする` } : unknownQ("初期値が分からない");
  }
  if (lim.kind === "gt" || op === "-=") {
    // 減っていくループは初期値が上限(for (i = n - 1; i >= 0; i--))
    const start = initVal ? boundOf(initVal, env) : null;
    if (start) return { expr: start.expr, conf: "high", reason: `${sexprText(initVal)} から減らす` };
    return E ? { expr: E.expr, conf: "medium", reason: `${sexprText(lim.E)} まで` } : unknownQ("初期値が分からない");
  }
  if (!E) return { expr: Q, conf: "low", reason: `上限 ${sexprText(lim.E)}`, warn: `${line}行目: 上限 ${sexprText(lim.E)} を評価できません。N 回とみなしました` };
  // 刻みが外側のループ変数(j += i)なら調和級数
  if (op === "+=" && u && u.by) {
    const stepVar = outerVarNamed(env, u.by);
    if (stepVar) {
      return { expr: E.expr, conf: "high", reason: `刻み ${stepVar} の調和級数`, special: { kind: "harmonic", anchor: stepVar, total: E.expr }, info: initVal && initVal.kind === "bin" && initVal.op === "*" ? "篩なら実際は N log log N です" : undefined };
    }
    if (u.by.kind !== "num" && evalConst(u.by, env.consts) === null) {
      return { expr: E.expr, conf: "medium", reason: `刻み ${sexprText(u.by)} で ${sexprText(lim.E)} まで`, warn: `${line}行目: 刻み ${sexprText(u.by)} が変数なので、反復回数を ${sexprText(lim.E)} とみなしました` };
    }
  }
  if (E.dividedBy) return { expr: E.expr, conf: "high", reason: `上限 ${sexprText(lim.E)} の調和級数`, special: { kind: "harmonic", anchor: E.dividedBy, total: E.expr } };
  const from = initVal && outerVarNamed(env, initVal);
  return { expr: E.expr, conf: u && (op === "+=" || op === "-=") ? "high" : "medium", reason: from ? `${from} から ${sexprText(lim.E)} まで(最悪 ${sexprText(lim.E)} 回)` : `${v} < ${sexprText(lim.E)}` };
}

function findInit(init: SExpr, v: string): SExpr | null {
  let out: SExpr | null = null;
  walk(init, (x) => {
    if (out) return false;
    if (x.kind === "assign" && x.target.kind === "sym" && x.target.name === v && x.value) out = x.value;
  });
  return out;
}

// ---------------------------------------------------------------------------
// while

/** 本体の直下(分岐の中を含み、子のループと関数は含まない)の代入と式 */
function flatBody(nodes: readonly IrNode[]): SExpr[] {
  const out: SExpr[] = [];
  for (const n of nodes) {
    if (n.kind === "assign") out.push({ kind: "assign", op: n.op, target: n.target, value: n.value });
    else if (n.kind === "expr") out.push(n.e);
    else if (n.kind === "decl" && n.init) out.push({ kind: "assign", op: "=", target: { kind: "sym", name: n.name }, value: n.init });
    else if (n.kind === "return" && n.value) out.push(n.value);
    else if (n.kind === "branch") {
      n.conds.forEach((c) => c && out.push(c));
      n.branches.forEach((br) => out.push(...flatBody(br)));
    }
  }
  return out;
}

function allAssigns(xs: readonly SExpr[]): Extract<SExpr, { kind: "assign" }>[] {
  const out: Extract<SExpr, { kind: "assign" }>[] = [];
  for (const x of xs) {
    walk(x, (y) => {
      if (y.kind === "assign") out.push(y);
    });
  }
  return out;
}

/** 条件の中の変数(比較の片側に出るもの) */
function condVars(cond: SExpr): string[] {
  const out: string[] = [];
  walk(cond, (x) => {
    if (x.kind === "sym") out.push(x.name);
    if (x.kind === "index" || x.kind === "call" || x.kind === "member") {
      if (x.kind === "index" && x.idx[0]?.kind === "sym") out.push(x.idx[0].name);
      return x.kind !== "index";
    }
  });
  return out;
}

const POP_METHODS = new Set(["front", "top", "popleft", "pop", "pop_front", "pop_back", "shift", "poll", "remove", "dequeue", "Dequeue", "pollFirst", "popFirst", "popLast", "peek", "first", "last", "Peek", "removeFirst", "extract", "get"]);

/** キューの空判定の形から、キューの名前 */
function queueOf(cond: SExpr): string | null {
  let c = cond;
  if (c.kind === "logic" && c.op === "&&") return queueOf(c.l) ?? queueOf(c.r);
  if (c.kind === "not" && c.e.kind === "member" && ["empty", "isEmpty", "is_empty", "IsEmpty"].includes(c.e.name) && c.e.of.kind === "sym") return c.e.of.name;
  if (c.kind === "not" && c.e.kind === "call" && ["empty", "isEmpty"].includes(c.e.name) && c.e.args[0]?.kind === "sym") return (c.e.args[0] as { name: string }).name;
  if (c.kind === "cmp" && (c.op === ">" || c.op === "!=" || c.op === ">=")) c = c.l;
  if (c.kind === "size" && c.of.kind === "sym") return c.of.name;
  if (c.kind === "sym") return c.name;
  if (c.kind === "member" && POP_METHODS.has(c.name) && c.of.kind === "sym") return c.of.name; // while let Some(v) = q.pop_front()
  return freePop(c);
}

const FREE_POPS = new Set(["heappop", "array_shift", "array_pop", "popleft", "heappushpop"]);

/** heappop(q) / heapq.heappop(q) / array_shift($q) の q */
function freePop(e: SExpr): string | null {
  const args = e.kind === "call" && FREE_POPS.has(e.name) ? e.args : e.kind === "member" && FREE_POPS.has(e.name) && e.of.kind === "sym" && e.args ? e.args : null;
  return args && args[0]?.kind === "sym" ? args[0].name : null;
}

/** 刻みが定数か */
function constStep(by: SExpr | null, env: BoundEnv): boolean {
  return !!by && (by.kind === "num" || evalConst(by, env.consts) !== null);
}

function whileLoop(loop: LoopNode, env: BoundEnv): LoopFactor {
  const b = loop.bound as Extract<LoopNode["bound"], { form: "while" }>;
  const line = loop.loc.line;
  const cond = b.cond;
  const fallback = (reason: string): LoopFactor => ({ expr: Q, conf: "low", reason, warn: `${line}行目: while の反復回数を推定できません。N 回とみなしました。範囲指定で N に上限を与えるか、内訳を確認してください` });
  if (!cond) return fallback("終了条件なし");
  const body = flatBody(loop.body);
  const assigns = allAssigns(body);
  const outer = env.outer[env.outer.length - 1];
  const amortize = (name: string, total: Expr, reason: string): LoopFactor | null => {
    if (!outer || !env.persistsAcross(name, outer, loop)) return null;
    return { expr: total, conf: "medium", reason: `${reason}(償却)`, special: { kind: "amortized", anchor: outer.var ?? "", total }, info: `${line}行目: ${name} が外側のループで振り出しに戻らないので、償却で全体 ${reason} としました` };
  };

  // L16 next_permutation
  let perm: SExpr | null = null;
  walk(cond, (x) => {
    if (x.kind === "call" && ["next_permutation", "prev_permutation", "nextPermutation"].includes(x.name)) perm = x;
    if (x.kind === "member" && ["next_permutation", "nextPermutation"].includes(x.name)) perm = x;
  });
  if (perm) {
    const p = perm as SExpr;
    const n = p.kind === "call" ? env.sizeOf(p.args[0] && p.args[0].kind === "member" ? p.args[0].of : (p.args[0] ?? null)) : p.kind === "member" ? env.sizeOf(p.of) : Q;
    return { expr: factE(n), conf: "high", reason: "全順列(next_permutation)" };
  }

  // L11 二分探索: 本体で mid を作り、端を mid で置き換える
  const midNames = assigns.filter((a) => a.value && a.target.kind === "sym" && isMidExpr(a.value)).map((a) => (a.target as { name: string }).name);
  if (midNames.length > 0) {
    const ends = new Set(assigns.filter((a) => a.target.kind === "sym" && a.value && refersTo(a.value, midNames)).map((a) => (a.target as { name: string }).name));
    const vs = condVars(cond).filter((x) => ends.has(x));
    if (vs.length > 0) {
      let hi: Expr | null = null;
      for (const vName of vs) {
        const init = env.initialValue(vName, loop);
        const bb = init ? boundOf(init, env) : null;
        if (bb && (!hi || (constValue(bb.expr) ?? 0) > (constValue(hi) ?? 0) || constValue(bb.expr) === null)) hi = bb.expr;
      }
      if (hi) return { expr: logOfExpr(hi), conf: "high", reason: "二分探索" };
      return { expr: logOfExpr(Q), conf: "medium", reason: "二分探索", warn: `${line}行目: 二分探索の範囲の上限が分かりません。log N とみなしました` };
    }
  }

  // L13'' while (t--) / while (t-- > 0)
  const dec = cond.kind === "assign" ? cond : cond.kind === "cmp" && cond.l.kind === "assign" ? cond.l : null;
  if (dec && dec.kind === "assign" && dec.op === "--" && dec.target.kind === "sym") {
    const t = dec.target.name;
    return { expr: env.sym(t), conf: "high", reason: `${t} 回(マルチテスト)`, info: env.isInputVar(t) ? "マルチテストです。範囲指定の N は1ケースあたりの値にしてください" : undefined };
  }

  // L12'' Union-Find の根をたどる while (par[x] != x) x = par[x]
  for (const a of assigns) {
    if (a.target.kind === "sym" && a.value && a.value.kind === "index" && a.value.of.kind === "sym" && a.value.idx[0]?.kind === "sym" && a.value.idx[0].name === a.target.name) {
      const arr = a.value.of.name;
      let uses = false;
      walk(cond, (x) => {
        if (x.kind === "index" && x.of.kind === "sym" && x.of.name === arr) uses = true;
      });
      if (uses) return { expr: logOfExpr(env.sizeOf({ kind: "sym", name: arr })), conf: "medium", reason: "Union-Find の根をたどる(経路圧縮前提)" };
    }
  }

  // L12 / L12' 割っていく・余りを取る(ユークリッドの互除法)
  const cv = condVars(cond);
  for (const a of assigns) {
    if (a.target.kind !== "sym") continue;
    const x = a.target.name;
    if (!cv.includes(x)) continue;
    const u = updateOf(a, x);
    if (!u) continue;
    const small = (k: number) => !!u.by && u.by.kind === "num" && u.by.value < k;
    const divides = (["/=", "//=", "div="].includes(u.op) && !small(2)) || ([">>=", "shr="].includes(u.op) && !small(1));
    const mods = u.op === "%=" || (u.op === "=" && u.by && u.by.kind === "bin" && u.by.op === "%");
    // 倍々にして上限まで(i *= 2 / i <<= 1)
    if ((u.op === "*=" && !small(2)) || ((u.op === "<<=" || u.op === "shl=") && !small(1))) {
      const lim = limitOf(cond, x);
      const E = lim && lim.kind === "lt" ? boundOf(lim.E, env) : null;
      if (E) {
        const f = logOfExpr(E.expr);
        return amortize(x, f, `log ${sexprText(lim!.E)}`) ?? { expr: f, conf: "high", reason: `${x} を倍々にして ${sexprText(lim!.E)} まで` };
      }
      continue;
    }
    if (divides || mods) {
      const init = env.initialValue(x, loop);
      const X = (init ? boundOf(init, env)?.expr : null) ?? env.sym(x);
      const f = logOfExpr(X);
      return amortize(x, f, `log ${sexprText({ kind: "sym", name: x })}`) ?? { expr: f, conf: mods ? "medium" : "high", reason: mods ? "ユークリッドの互除法" : `${x} を割っていく` };
    }
  }
  // 条件の変数で割った余りを取る互除法(a %= b; swap(a, b) / t = a % b; a = b; b = t)
  const startOf = (name: string): Expr => {
    const init = env.initialValue(name, loop);
    return (init ? boundOf(init, env)?.expr : null) ?? env.sym(name);
  };
  for (const a of assigns) {
    if (a.target.kind !== "sym") continue;
    const u = updateOf(a, a.target.name);
    if (!u || !u.by) continue;
    const mod = u.op === "%=" ? { l: a.target.name, r: u.by } : u.op === "=" && u.by.kind === "bin" && u.by.op === "%" ? { l: u.by.l.kind === "sym" ? u.by.l.name : null, r: u.by.r } : null;
    if (mod && mod.l && mod.r.kind === "sym" && cv.includes(mod.r.name)) {
      return { expr: logOfExpr(startOf(mod.l)), conf: "medium", reason: "ユークリッドの互除法" };
    }
  }
  // (a, b) = (b, a % b) の形の互除法
  for (const a of assigns) {
    if (a.target.kind === "list" && a.value && a.value.kind === "list" && a.value.items.some((y) => y.kind === "bin" && y.op === "%")) {
      const first = a.target.items[0];
      const X = first && first.kind === "sym" ? startOf(first.name) : Q;
      return { expr: logOfExpr(X), conf: "medium", reason: "ユークリッドの互除法" };
    }
  }

  // 条件の変数を ±k で動かす代入。刻みが定数のもの(r += 1)を、和を足していくもの(s += a[r])より先に見る
  const steppers = assigns
    .flatMap((a) => {
      if (a.target.kind !== "sym" || !cv.includes(a.target.name)) return [];
      const u = updateOf(a, a.target.name);
      return u && (u.op === "+=" || u.op === "-=") ? [{ x: a.target.name, u }] : [];
    })
    .sort((p, q) => Number(constStep(q.u.by, env)) - Number(constStep(p.u.by, env)));

  // L15 償却(尺取り・単調スタック): 外で宣言したポインタやスタックを単調に進めるだけ
  if (outer) {
    const q = queueOf(cond);
    const popsOnly = q && body.every((x) => isPopOf(x, q) || !mutates(x, q));
    if (q && popsOnly && body.some((x) => isPopOf(x, q))) {
      const res = amortize(q, outer.bound, `${q} の要素数`);
      if (res) return res;
    }
    for (const { x } of steppers) {
      const lim = limitOf(cond, x);
      const E = lim ? boundOf(lim.E, env) : null;
      const total = E?.expr ?? outer.bound;
      const res = amortize(x, total, `${sexprText(lim?.E ?? null) || x} まで`);
      if (res) return res;
    }
  }

  // L13 / L13' x を1ずつ動かす(償却でない)
  for (const { x } of steppers) {
    const lim = limitOf(cond, x);
    if (lim && lim.kind === "lt") {
      const E = boundOf(lim.E, env);
      if (E) return { expr: E.expr, conf: "high", reason: `${x} を ${sexprText(lim.E)} まで進める` };
    }
    const init = env.initialValue(x, loop);
    const X = init ? boundOf(init, env) : null;
    if (X) return { expr: X.expr, conf: "high", reason: `${x} を減らしていく` };
    return { expr: env.sym(x), conf: "medium", reason: `${x} を減らしていく` };
  }

  // L14 BFS / Dijkstra: キューが空になるまで
  const q = queueOf(cond);
  if (q && ["deque", "pq", "stack", "array", "unknown", "linkedlist"].includes(env.kindOf({ kind: "sym", name: q }))) {
    const popped = new Set<string>();
    for (const a of assigns) {
      if (!a.value) continue;
      let fromQ = false;
      walk(a.value, (y) => {
        if (y.kind === "member" && POP_METHODS.has(y.name) && y.of.kind === "sym" && y.of.name === q) fromQ = true;
        if (freePop(y) === q) fromQ = true;
        if (y.kind === "index" && y.of.kind === "sym" && y.of.name === q) fromQ = true;
      });
      if (fromQ) targetNames(a.target).forEach((n) => popped.add(n));
    }
    // while let Some((d, v)) = q.pop() の束縛
    if (b.bind) b.bind.forEach((n) => popped.add(n));
    const V = env.vertices();
    const isQ = singleSym(V) === "?";
    return { expr: V, conf: "medium", reason: `キュー ${q} が空になるまで(頂点数)`, popped: [...popped], warn: isQ ? `${line}行目: キューに入る回数を推定できないので N 回とみなしました` : undefined };
  }

  // L19' 入力を読み切るまで
  if (env.isInput(cond)) return { expr: env.named("N", `入力の行数(${line}行目)`, line), conf: "medium", reason: "入力を読み切るまで" };

  return fallback("条件の形が分からない");
}

function isMidExpr(e: SExpr): boolean {
  // (l + r) / 2 / (l + r) >> 1 / l + (r - l) / 2 / (lo + hi) // 2 / (l + r).div(2)
  let has = false;
  walk(e, (x) => {
    if (x.kind === "bin" && ["/", "//", ">>", "div"].includes(x.op) && ((x.r.kind === "num" && (x.r.value === 2 || x.r.value === 1)) || x.op === ">>")) has = true;
    if (x.kind === "call" && ["midpoint", "intdiv"].includes(x.name)) has = true;
  });
  return has;
}

function refersTo(e: SExpr, names: string[]): boolean {
  let f = false;
  walk(e, (x) => {
    if (x.kind === "sym" && names.includes(x.name)) f = true;
  });
  return f;
}

function isPopOf(e: SExpr, q: string): boolean {
  let f = false;
  walk(e, (x) => {
    if (x.kind === "member" && ["pop", "pop_back", "pop_front", "popleft", "shift", "poll", "removeLast", "removeFirst", "pollLast", "pollFirst", "popLast", "popFirst", "Pop", "Dequeue"].includes(x.name) && x.of.kind === "sym" && x.of.name === q) f = true;
    if (x.kind === "call" && x.name === "pop" && x.args[0]?.kind === "sym" && x.args[0].name === q) f = true;
    if (freePop(x) === q) f = true;
  });
  return f;
}

function mutates(e: SExpr, q: string): boolean {
  let f = false;
  walk(e, (x) => {
    if (x.kind === "member" && x.of.kind === "sym" && x.of.name === q && ["push", "push_back", "append", "add", "insert", "emplace", "emplace_back", "clear", "appendleft", "push_front"].includes(x.name)) f = true;
    if (x.kind === "assign" && x.target.kind === "sym" && x.target.name === q) f = true;
  });
  return f;
}
