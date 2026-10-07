// IR → 計算量。入口(main / モジュール / 個別の関数)から文を歩き、ループの積・逐次の和・
// 呼び出しの代入・再帰の推定・領域の合計をまとめる。
//
// 2回歩く: 1回目でコンテナの成長の総数(g への辺の追加、set への挿入の回数)を集め、
// 別名(|a| ≡ N、|pq| ≡ 辺の数 など)を決めてから、2回目で本番の式を作る。
import type { AnalysisWarning, Analysis, BreakdownItem, Confidence, ContainerKind, Expr, IrNode, Program, SExpr, Variable } from "./ir.ts";
import { add, constValue, format, formatO, isConst, lit, logOfExpr, mul, normalize, ONE, rename, simplify, singleSym, sym, vars } from "./expr.ts";
import { boundOf, inferLoop, iterCount } from "./bounds.ts";
import type { BoundEnv, LoopNode, LoopScope, Special } from "./bounds.ts";
import { lookupFree, lookupMethod } from "./builtins.ts";
import type { BuiltinRule, CallCtx } from "./builtins.ts";
import { estimateRecursion } from "./recursion.ts";
import type { SelfCall } from "./recursion.ts";
import { allocOf, countOf, rangeOf, targetNames, walk } from "./semantics.ts";
import type { Consts } from "./semantics.ts";
import { sexprText } from "./sexpr.ts";
import { READ_FUNCS } from "./lowerStmt.ts";
import type { LangSpec } from "./spec.ts";

type FuncNode = Extract<IrNode, { kind: "func" }>;
type DeclNode = Extract<IrNode, { kind: "decl" }>;

const Q: Expr = [{ coef: 1, factors: [{ v: "?", pow: 1, log: 0, exp: 0, fact: 0 }] }];

interface SpecialCost {
  sp: Special;
  /** 1回あたりの本体の時間 */
  body: Expr;
  /** 合成できなかったときの時間(親の1回あたり) */
  fallback: Expr;
  /** 本体での成長(合成できたとき: 合計。できなかったとき: 親の1回あたり) */
  grow: Map<string, Expr>;
}

interface Cost {
  time: Expr;
  alloc: Expr;
  grow: Map<string, Expr>;
  specials: SpecialCost[];
}

const empty = (): Cost => ({ time: ONE, alloc: ONE, grow: new Map(), specials: [] });

function addGrow(a: Map<string, Expr>, b: Map<string, Expr>): Map<string, Expr> {
  const out = new Map(a);
  for (const [k, v] of b) out.set(k, out.has(k) ? add(out.get(k)!, v) : v);
  return out;
}

function mulGrow(g: Map<string, Expr>, f: Expr): Map<string, Expr> {
  const out = new Map<string, Expr>();
  for (const [k, v] of g) out.set(k, mul(v, f));
  return out;
}

function plus(a: Cost, b: Cost): Cost {
  return { time: add(a.time, b.time), alloc: add(a.alloc, b.alloc), grow: addGrow(a.grow, b.grow), specials: [...a.specials, ...b.specials] };
}

interface Frame {
  list: readonly IrNode[];
  upto: number;
}

interface WalkEnv {
  outer: LoopScope[];
  params: Set<string>;
  func: FuncNode | null;
  selfNames: Set<string>;
  selfCalls: SelfCall[] | null;
  before: Frame[];
  /** 自己呼び出しを見つけたときの文脈 */
  inAdjacency: boolean;
  /** いま歩いている分岐の経路(分岐の番号:枝の番号)。別の枝の自己呼び出しは同時には起きない */
  path?: string[];
}

/** 名前空間とみなす受け手(std::sort / Arrays.sort / heapq.heappush / math.gcd …) */
const NAMESPACES = new Set(["std", "ranges", "views", "atcoder", "heapq", "bisect", "math", "itertools", "collections", "functools", "sys", "operator", "string", "Arrays", "Collections", "Math", "Integer", "Long", "String", "System", "Objects", "Character", "Double", "Stream", "IntStream", "Enumerable", "Console", "Convert", "Array", "Object", "Number", "JSON", "BigInt", "strings", "sort", "strconv", "fmt", "slices", "maps", "os", "bufio", "io", "table", "utf8", "Base", "Iterators", "DataStructures", "sequtils", "algorithm", "strutils", "std::cmp", "cmp", "mem", "iter", "Vec", "HashMap", "HashSet", "BTreeMap", "BTreeSet", "VecDeque", "BinaryHeap", "Set", "Hash", "List", "Util", "Data", "M", "S", "V", "IM", "IS", "SplFixedArray"]);

/** 未知でも黙って O(1) にしてよい呼び出し(出力・変換など) */
const QUIET = new Set(["print", "println", "printf", "puts", "p", "echo", "say", "write", "writeln", "writefln", "Println", "Printf", "Print", "WriteLine", "Write", "log", "cout", "endl", "flush", "format", "sprintf", "String", "str", "int", "float", "parseInt", "Number", "chr", "ord", "abs", "min", "max", "exit", "assert", "eprintln", "dbg!", "println!", "print!", "write!", "writeln!", "format!", "vec!", "assert!", "assert_eq!", "panic!", "unreachable!", "debug_assert!", "to_string", "toString", "valueOf", "toFixed", "parse", "unwrap", "expect", "ok", "clone", "into", "from", "new", "as_str", "setrecursionlimit", "Some", "Ok", "Err", "None", "chomp", "die", "require", "local", "defined", "ref", "bless", "sprintf", "sizeof", "alignof", "decltype", "typeid", "stack_size", "start", "setDaemon", "daemon", "Thread", "sync_with_stdio", "tie", "to_i", "to_s", "to_f", "to_sym", "to_r", "chr", "ord", "even?", "odd?", "zero?", "nil?", "positive?", "negative?", "succ", "pred", "freeze", "frozen?", "is_a?", "kind_of?", "respond_to?", "inspect", "object_id", "tap", "then", "divmod", "fdiv", "floor", "ceil", "round", "truncate", "between?", "clamp", "class", "if", "unless", "case", "while", "switch", "lambda", "proc", "rand", "srand", "exit!", "abort", "sleep", "Integer", "Float", "Rational", "Complex", "chomp", "chop", "strip", "empty?", "to_a", "eof?", "eof", "combination", "permutation", "repeated_permutation", "repeated_combination", "each_slice", "each_cons", "lazy", "each_entry", "inc", "dec", "discard", "echo", "parseInt", "parseFloat", "newSeq", "newSeqWith", "newSeqOfCap", "newString", "initHashSet", "initTable", "initCountTable", "initDeque", "initHeapQueue", "toHashSet", "toTable", "high", "low", "succ", "pred", "quit"]);

/** 受け手の要素数を保つ(以下にする)メソッド: a.keys() / a.map(f) / a.iter().rev() */
const SIZE_KEEPING_MEMBERS = new Set(["keys", "values", "items", "iter", "chars", "bytes", "entries", "to_a", "clone", "copy", "dup", "rev", "reverse", "sorted", "into_iter", "begin", "end", "rbegin", "map", "filter", "select", "reject", "collect", "to_vec", "cloned", "copied", "enumerate", "sort_by", "uniq", "compact", "each_with_index", "with_index", "filter_map", "iter_mut", "Select", "Where", "ToList", "ToArray", "toList", "toSeq", "mapIt", "filterIt", "reversed", "slice", "to_owned", "as_slice", "values_mut", "keySet", "entrySet", "stream", "boxed"]);

const VISIT_NAMES = /^(vis|visited|seen|used|dist|dis|depth|color|col|visit|reached|done|checked|check|lv|level|d|par|parent|prev|pre|cost|ok|flag|memo)$/i;

export class Analyzer {
  readonly prog: Program;
  readonly spec: LangSpec;
  readonly lang: string;
  readonly consts: Consts;
  funcs = new Map<string, FuncNode>();
  decls = new Map<string, DeclNode[]>();
  aliases = new Map<string, Expr>();
  /** 仮引数の長さ |a| を値に持つ別名(n = a.size())。呼び出し側で置き換えるので、同名の大域の a の大きさで解かない */
  private paramAliases = new Set<string>();
  /** 1回目の走査で辺の数がまだ分からず Σ|g[]| のまま使った隣接リスト */
  private edgePlaceholders = new Set<string>();
  growTotals = new Map<string, Expr>();
  symbolOrder: string[] = [];
  symCount = new Map<string, number>();
  origins = new Map<string, { origin: string; line: number }>();
  inputs = new Map<string, { line: number; via: string; array: boolean }>();
  warnings: AnalysisWarning[] = [];
  items: BreakdownItem[] = [];
  called = new Set<string>();
  unknownCalls = new Set<string>();
  funcCache = new Map<FuncNode, { time: Expr; alloc: Expr; grow: Map<string, Expr>; conf: Confidence }>();
  inProgress: FuncNode[] = [];
  pass: 1 | 2 = 1;
  /** 1回目で集めた成長(ローカルのコンテナが関数やループを抜ける前の値) */
  private growRecord = new Map<string, Expr>();
  private seenWarn = new Set<string>();
  /** 要素そのものを足したコンテナ(s.add(x) / v.push_back(x) / d[k] = v)。g[u].append(v) の g は含めない */
  private directGrowth = new Set<string>();
  private branchIds = new WeakMap<object, number>();
  private nextBranch = 0;
  branchId(n: object): number {
    let id = this.branchIds.get(n);
    if (id === undefined) {
      id = this.nextBranch++;
      this.branchIds.set(n, id);
    }
    return id;
  }
  /** 1回目に記録した記号の由来(2回目に別名経由でしか出てこない記号に使う) */
  private pass1Origins = new Map<string, { origin: string; line: number }>();
  private stringConcatWarned = false;

  constructor(prog: Program, spec: LangSpec) {
    this.prog = prog;
    this.spec = spec;
    this.lang = prog.lang;
    this.consts = prog.consts;
    const visit = (nodes: readonly IrNode[], top: boolean) => {
      for (const n of nodes) {
        if (n.kind === "func") {
          if (!this.funcs.has(n.name)) this.funcs.set(n.name, n);
          visit(n.body, false);
        } else if (n.kind === "decl") {
          const list = this.decls.get(n.name) ?? [];
          list.push(n);
          this.decls.set(n.name, list);
        } else if (n.kind === "loop") visit(n.body, false);
        else if (n.kind === "branch") n.branches.forEach((b) => visit(b, false));
        else if (n.kind === "input") {
          for (const s of n.scalars) if (!this.inputs.has(s)) this.inputs.set(s, { line: n.loc.line, via: n.via, array: false });
          for (const a of n.arrays) if (!this.inputs.has(a)) this.inputs.set(a, { line: n.loc.line, via: n.via, array: true });
        }
        void top;
      }
    };
    visit(prog.nodes, true);
  }

  // ---- 記号 -------------------------------------------------------------------

  symbolOf(name: string): string {
    const n = name.replace(/^[$@%&]+/, "");
    return /^[a-z]\d*$/.test(n) ? n.toUpperCase() : n;
  }

  /** 由来を記録して記号を作る */
  named(symbol: string, origin: string, line: number): Expr {
    if (!this.symbolOrder.includes(symbol)) this.symbolOrder.push(symbol);
    this.symCount.set(symbol, (this.symCount.get(symbol) ?? 0) + 1);
    if (!this.origins.has(symbol)) this.origins.set(symbol, { origin, line });
    const a = this.aliases.get(symbol);
    return a ? this.useAlias(a) : sym(symbol);
  }

  /** 別名の式を使う。中の記号を初出の順に登録する(由来は1回目に記録したものを使う) */
  useAlias(e: Expr): Expr {
    for (const v of vars(e)) {
      if (!this.symbolOrder.includes(v)) this.symbolOrder.push(v);
      this.symCount.set(v, (this.symCount.get(v) ?? 0) + 1);
      const o = this.pass1Origins.get(v);
      if (o && !this.origins.has(v)) this.origins.set(v, o);
    }
    return e;
  }

  symFor(name: string, env: WalkEnv | null): Expr {
    const s = this.symbolOf(name);
    const inp = this.inputs.get(name);
    const origin = inp ? `入力(${inp.line}行目 ${inp.via.slice(0, 30)})` : env && env.params.has(name) && env.func ? `関数 ${env.func.name} の引数 ${name}` : `変数 ${name}`;
    return this.named(s, origin, inp?.line ?? 0);
  }

  sizeSym(name: string): Expr {
    const a = this.aliases.get(`|${name}|`);
    if (a) return this.useAlias(a);
    const inp = this.inputs.get(name);
    return this.named(`|${name}|`, inp ? `入力の配列 ${name} の長さ(${inp.line}行目)` : `${name} の要素数`, inp?.line ?? 0);
  }

  warn(message: string, level: "info" | "warn" = "warn", line?: number): void {
    if (this.pass === 1) return;
    const key = `${level}:${message}`;
    if (this.seenWarn.has(key)) return;
    this.seenWarn.add(key);
    this.warnings.push({ message, level, line });
  }

  /** 内訳に足す(2回目だけ)。text は run() で式から作る */
  item(it: BreakdownItem): void {
    if (this.pass === 2) this.items.push(it);
  }

  // ---- コンテナの種類と大きさ -----------------------------------------------------

  declOf(name: string): DeclNode | null {
    const list = this.decls.get(name);
    if (!list) return null;
    return list.find((d) => d.container !== "scalar" && d.container !== "unknown" && d.dims.length > 0) ?? list.find((d) => d.container !== "scalar" && d.container !== "unknown") ?? list[0];
  }

  kindOf(e: SExpr): ContainerKind {
    if (e.kind === "sym") {
      if (e.sigil === "@") return "array";
      if (e.sigil === "%") return "hmap";
      const d = this.declOf(e.name);
      if (d && d.container !== "unknown") return d.container;
      if (this.inputs.get(e.name)?.array) return "array";
      return "unknown";
    }
    if (e.kind === "index") {
      // vector<set<int>> の要素 / dp[i] の要素
      if (e.of.kind === "sym") {
        const d = this.declOf(e.of.name);
        if (d) {
          if (d.elem && d.elem !== "unknown" && d.elem !== "scalar") return d.elem;
          const inner = [...d.typeName.matchAll(/([A-Za-z_]\w*)\s*</g)].map((m) => m[1]).slice(1);
          for (const t of inner) if (this.spec.typeKind[t]) return this.spec.typeKind[t];
          if (d.dims.length >= 2) return "array";
          if (d.container === "hmap" || d.container === "omap") return "unknown";
        }
      }
      return "unknown";
    }
    if (e.kind === "str") return "string";
    if (e.kind === "list" || e.kind === "comp") return e.brace === "hash" ? "hmap" : e.brace === "set" ? "hset" : "array";
    if (e.kind === "member" && e.args === null && e.of.kind === "sym" && (e.of.name === "this" || e.of.name === "self")) return this.kindOf({ kind: "sym", name: e.name });
    const al = allocOf(e, this.spec.typeKind);
    if (al) return al.container;
    return "unknown";
  }

  /**
   * スライスの長さが元の長さより短いと分かるとき、その長さ。a[:3] / a[-3:] は定数、先頭からの a[:k] は K。
   * それ以外(a[l:r] / a[1:])は null(元の長さを上界にする)
   */
  sliceLen(e: Extract<SExpr, { kind: "slice" }>, benv: BoundEnv): Expr | null {
    const k = constSliceLen(e);
    if (k !== null) return lit(Math.max(1, k));
    const fromZero = !e.from || (e.from.kind === "num" && e.from.value === 0);
    if (!fromZero || !e.to || e.to.kind === "un" || (e.to.kind === "num" && e.to.value < 0)) return null;
    return boundOf(e.to, benv)?.expr ?? null;
  }

  sizeOf(e: SExpr | null, env: WalkEnv | null): Expr {
    if (!e) return Q;
    switch (e.kind) {
      case "sym":
        if (this.spec.inputMarkers.has(e.name) && !this.decls.has(e.name)) return this.named("N", "入力の要素数", 0);
        // 仮引数の長さは呼び出し側で実引数の長さに置き換える(同名の大域変数の大きさは使わない)
        if (env && env.params.has(e.name) && env.func && !env.func.isLambda) return this.named(`|${e.name}|`, `関数 ${env.func.name} の引数 ${e.name} の要素数`, 0);
        return this.sizeSym(e.name);
      case "index": {
        if (e.of.kind === "sym") {
          const g = this.growTotals.get(e.of.name);
          if (g) return g;
          const d = this.declOf(e.of.name);
          if (d && d.dims.length >= 2) return boundOf(d.dims[1], this.boundEnv(env))?.expr ?? Q;
          return this.sizeSym(`${e.of.name}[]`);
        }
        return Q;
      }
      case "str":
        return lit(Math.max(1, e.value.length));
      case "list":
        return lit(Math.max(1, e.items.length));
      case "slice":
        return this.sliceLen(e, this.boundEnv(env)) ?? this.sizeOf(e.of, env);
      case "size":
        return this.sizeOf(e.of, env);
      case "member":
        if (e.of.kind === "sym" && (e.of.name === "this" || e.of.name === "self") && e.args === null) return this.sizeSym(e.name);
        if (SIZE_KEEPING_MEMBERS.has(e.name)) return this.sizeOf(e.of, env);
        if (convolutionArgs(e)) return add(this.sizeOf(convolutionArgs(e)![0] ?? null, env), this.sizeOf(convolutionArgs(e)![1] ?? null, env));
        // ACL の scc() / groups() は頂点数以下の個数のグループ
        if ((e.name === "scc" || e.name === "groups") && this.kindOf(e.of) === "acl") return this.sizeOf(e.of, env);
        if (this.isInputExpr(e, env)) return this.named("N", "入力の要素数", 0);
        return this.named(`|${sexprText(e, 24)}|`, `${sexprText(e, 24)} の要素数`, 0);
      case "call": {
        const r = rangeOf(e);
        if (r) return boundOf(r.to, this.boundEnv(env))?.expr ?? Q;
        if (["sorted", "list", "reversed", "set", "enumerate", "tuple", "zip", "deque", "frozenset", "Counter", "sort", "scan_words", "keys", "values", "reverse", "uniq", "shuffle"].includes(e.name) && e.args.length) return this.sizeOf(e.args[e.args.length - 1], env);
        if (e.name === "head" && this.lang === "bash") return ONE;
        const conv = convolutionArgs(e);
        if (conv) return add(this.sizeOf(conv[0] ?? null, env), this.sizeOf(conv[1] ?? null, env));
        // map(f, a) / filter(f, a) / Julia の parse.(Int, xs) / PHP の array_map(f, $a) は最後の引数の要素数(以下)
        if ((e.name === "map" || e.name === "filter" || e.name === "array_map") && e.args.length >= 2) return this.sizeOf(e.args[e.args.length - 1], env);
        // PHP の配列関数は第1引数の要素数(以下)
        if (["array_filter", "array_values", "array_keys", "array_reverse", "array_unique", "array_slice", "array_merge", "str_split", "explode"].includes(e.name) && e.args[0]) return this.sizeOf(e.args[e.name === "explode" ? 1 : 0] ?? e.args[0], env);
        if (this.isInputExpr(e, env)) return this.named("N", "入力の要素数", 0);
        return this.named(`|${sexprText(e, 24)}|`, `${sexprText(e, 24)} の要素数`, 0);
      }
      case "bin":
        if (e.op === "+") return add(this.sizeOf(e.l, env), this.sizeOf(e.r, env));
        return this.sizeOf(e.l, env);
      case "comp": {
        // [e | x <- xs, y <- ys, 条件] の要素数は生成の積(条件は上界として無視)
        let v: Expr = ONE;
        for (const g of e.gens) {
          const r = rangeOf(g.iter);
          v = mul(v, r ? (boundOf(r.to, this.boundEnv(env))?.expr ?? Q) : this.sizeOf(g.iter, env));
        }
        return v;
      }
      default: {
        const al = allocOf(e, this.spec.typeKind);
        if (al && al.dims.length) return boundOf(al.dims[0], this.boundEnv(env))?.expr ?? Q;
        return this.named(`|${sexprText(e, 24)}|`, `${sexprText(e, 24)} の要素数`, 0);
      }
    }
  }

  /** begin/end の組・ポインタの組・範囲から長さ */
  rangeSize(args: SExpr[], env: WalkEnv | null): Expr {
    const a = args[0];
    const b = args[1];
    if (!a) return Q;
    const begins = ["begin", "cbegin", "rbegin", "crbegin"];
    if (a.kind === "member" && begins.includes(a.name)) {
      if (b && b.kind === "bin" && b.op === "+") return boundOf(b.r, this.boundEnv(env))?.expr ?? this.sizeOf(a.of, env);
      return this.sizeOf(a.of, env);
    }
    if (a.kind === "call" && (a.name === "begin" || a.name === "all") && a.args[0]) return this.sizeOf(a.args[0], env);
    if (b && b.kind === "bin" && b.op === "+" && a.kind === "sym" && b.l.kind === "sym" && b.l.name === a.name) return boundOf(b.r, this.boundEnv(env))?.expr ?? Q;
    if (b && b.kind === "bin" && b.op === "+" && a.kind === "bin" && a.op === "+") return boundOf(b.r, this.boundEnv(env))?.expr ?? Q;
    return this.sizeOf(a, env);
  }

  isInputExpr(e: SExpr | null, env: WalkEnv | null): boolean {
    void env;
    let found = false;
    const m = this.spec.inputMarkers;
    walk(e, (x) => {
      if (found) return false;
      if (x.kind === "sym" && m.has(x.name)) found = true;
      else if (x.kind === "call" && m.has(x.name)) found = true;
      else if (x.kind === "member" && (m.has(x.name) || (x.of.kind === "sym" && m.has(`${x.of.name}.${x.name}`)))) found = true;
      else if (x.kind === "sym" && this.inputs.has(x.name) && !this.inputs.get(x.name)!.array && env === null) found = true;
      return !found;
    });
    return found;
  }

  // ---- bounds.ts に渡す環境 ------------------------------------------------------

  boundEnv(env: WalkEnv | null): BoundEnv {
    const e = env ?? { outer: [], params: new Set<string>(), func: null, selfNames: new Set<string>(), selfCalls: null, before: [], inAdjacency: false };
    return {
      consts: this.consts,
      outer: e.outer,
      params: e.params,
      sym: (name) => this.symFor(name, e),
      named: (s, origin, line) => this.named(s, origin, line),
      sizeOf: (x) => this.sizeOf(x, e),
      kindOf: (x) => this.kindOf(x),
      initialValue: (name, loop) => this.initialValue(name, loop, e),
      persistsAcross: (name, outer, inner) => this.persistsAcross(name, outer, inner),
      isInput: (x) => this.isInputExpr(x, e),
      isInputVar: (name) => this.inputs.get(name)?.array === false,
      // 1回目はまだ辺の数が分からないので Σ|g[]| にしておき、別名を解くときに g への追加の総数に置き換える
      // (仮に M とすると、入力の M と同じ記号になってキューの大きさなどを取り違える)
      edgesOf: (g) => {
        const t = this.growTotals.get(g);
        if (t) return t;
        if (this.pass === 1) {
          this.edgePlaceholders.add(g);
          return sym(`Σ|${g}[]|`);
        }
        return this.named("M", `辺の数(${g} への追加が見つからないので記号にしました)`, 0);
      },
      vertices: () => this.vertices(e),
      declDims: (name) => this.declOf(name)?.dims ?? null,
    };
  }

  initialValue(name: string, loop: LoopNode, env: WalkEnv): SExpr | null {
    for (let f = env.before.length - 1; f >= 0; f--) {
      const fr = env.before[f];
      for (let k = fr.upto - 1; k >= 0; k--) {
        const n = fr.list[k];
        if (n === loop) continue;
        if (n.kind === "assign" && n.op === "=" && n.value) {
          if (n.target.kind === "sym" && n.target.name === name) return n.value;
          if (n.target.kind === "list" && n.value.kind === "list") {
            const i = n.target.items.findIndex((x) => x.kind === "sym" && x.name === name);
            if (i >= 0 && n.value.items[i]) return n.value.items[i];
          }
        }
        if (n.kind === "decl" && n.name === name && n.init) return n.init;
      }
    }
    // for (int l = 0, r = 0; …) の初期化
    for (const o of [...env.outer].reverse()) {
      const b = o.node.bound;
      if (b.form === "for-c" && b.init) {
        let v: SExpr | null = null;
        walk(b.init, (x) => {
          if (x.kind === "assign" && x.target.kind === "sym" && x.target.name === name && x.value) v = x.value;
        });
        if (v) return v;
      }
    }
    return null;
  }

  /** name が外側のループの中で振り出しに戻されない(宣言・= 代入・clear が無い)か */
  persistsAcross(name: string, outer: LoopScope, inner: LoopNode): boolean {
    let reset = false;
    const visit = (nodes: readonly IrNode[]) => {
      for (const n of nodes) {
        if (reset) return;
        if (n === inner) continue;
        if (n.kind === "decl" && n.name === name) reset = true;
        else if (n.kind === "assign" && n.op === "=" && targetNames(n.target).includes(name) && n.target.kind !== "index" && !monotoneUpdate(n.value, name)) reset = true;
        else if (n.kind === "expr") {
          walk(n.e, (x) => {
            if (x.kind === "member" && x.name === "clear" && x.of.kind === "sym" && x.of.name === name) reset = true;
          });
        } else if (n.kind === "branch") n.branches.forEach(visit);
        else if (n.kind === "loop") visit(n.body);
      }
    };
    visit(outer.node.body);
    return !reset;
  }

  vertices(env: WalkEnv | null): Expr {
    for (const [name, list] of this.decls) {
      if (!VISIT_NAMES.test(name)) continue;
      const d = list.find((x) => x.dims.length > 0);
      if (!d) continue;
      let v: Expr = ONE;
      for (const dim of d.dims) v = mul(v, boundOf(dim, this.boundEnv(env))?.expr ?? Q);
      return v;
    }
    // 隣接リストの大きさ
    for (const [name] of this.growTotals) {
      const d = this.declOf(name);
      if (d && d.dims.length === 1) return boundOf(d.dims[0], this.boundEnv(env))?.expr ?? Q;
    }
    return Q;
  }

  // ---- 文 ---------------------------------------------------------------------

  walkNodes(nodes: readonly IrNode[], env: WalkEnv): Cost {
    let cost = empty();
    for (let k = 0; k < nodes.length; k++) {
      const e2: WalkEnv = { ...env, before: [...env.before, { list: nodes, upto: k }] };
      cost = plus(cost, this.nodeCost(nodes[k], e2));
    }
    return cost;
  }

  nodeCost(n: IrNode, env: WalkEnv): Cost {
    switch (n.kind) {
      case "func":
      case "stmt":
        return empty();
      case "input": {
        // 読んだ順に記号を並べる(n, m, e: [(…); m] なら N, M の順。配列の長さの別名より先に)
        for (const s of n.scalars) {
          const sy = this.symbolOf(s);
          if (this.pass === 2 && !this.symbolOrder.includes(sy)) this.symbolOrder.push(sy);
        }
        // 入力で読んだ配列の領域
        let alloc: Expr = ONE;
        for (const a of n.arrays) if (!this.declOf(a)?.dims.length) alloc = add(alloc, this.sizeSym(a));
        return { ...empty(), alloc };
      }
      case "expr":
        return this.exprCost(n.e, env, !!n.reading, n.loc.line);
      case "return":
        return n.value ? this.exprCost(n.value, env, false, n.loc.line) : empty();
      case "assign": {
        const c = n.value ? this.exprCost(n.value, env, !!n.reading, n.loc.line) : empty();
        return plus(c, this.targetCost(n.target, n.op, n.value, env, n.loc.line));
      }
      case "decl":
        return this.declCost(n, env);
      case "branch": {
        let c = empty();
        for (const cond of n.conds) if (cond) c = plus(c, this.exprCost(cond, env, false, n.loc.line));
        let br = empty();
        const id = this.branchId(n);
        n.branches.forEach((b, k) => {
          br = plus(br, this.walkNodes(b, { ...env, path: [...(env.path ?? []), `${id}:${k}`] }));
        });
        return plus(c, br);
      }
      case "loop":
        return this.loopCost(n, env);
    }
  }

  dimsProduct(dims: SExpr[], env: WalkEnv): Expr {
    let v: Expr = ONE;
    for (const d of dims) v = mul(v, boundOf(d, this.boundEnv(env))?.expr ?? this.sizeOf(d, env));
    return v;
  }

  declCost(n: DeclNode, env: WalkEnv): Cost {
    const c = n.init ? this.exprCost(n.init, env, !!n.reading, n.loc.line) : empty();
    if (n.dims.length === 0) {
      // b = a / b = sorted(a) のような写しは |a| の時間と領域
      if (n.init && n.init.kind === "sym" && ["array", "string", "deque"].includes(this.kindOf(n.init)) && this.lang !== "python" && this.lang !== "pypy" && this.lang !== "ruby" && this.lang !== "js" && this.lang !== "ts") {
        const s = this.sizeOf(n.init, env);
        return plus(c, { time: s, alloc: s, grow: new Map(), specials: [] });
      }
      return c;
    }
    const size = this.dimsProduct(n.dims, env);
    this.item({ axis: "space", kind: "alloc", loc: n.loc, label: n.name, expr: size, text: "", reason: n.costsTime ? "確保して初期化" : "確保", conf: "high" });
    return plus(c, { time: n.costsTime ? size : ONE, alloc: size, grow: new Map(), specials: [] });
  }

  /** 代入先のコスト: map への m[k] = v は挿入(成長)、確保の無いコンテナへの a[i] = x も成長(S4') */
  targetCost(target: SExpr, op: string, value: SExpr | null, env: WalkEnv, line: number): Cost {
    const c = empty();
    if (target.kind === "index") {
      let base: SExpr = target;
      while (base.kind === "index") base = base.of;
      // $this->g[] = … / self.memo[k] = … はフィールド g / memo
      if (base.kind === "member" && base.args === null && base.of.kind === "sym" && ["this", "self"].includes(base.of.name)) base = { kind: "sym", name: base.name };
      const idxCost = target.idx.reduce((acc, x) => plus(acc, this.exprCost(x, env, false, line)), empty());
      if (base.kind !== "sym") return idxCost;
      const name = base.name;
      const kind = this.kindOf(base);
      const d = this.declOf(name);
      const g = new Map<string, Expr>();
      let time: Expr = ONE;
      if (kind === "omap" || kind === "oset") time = logOfExpr(this.sizeSym(name));
      const sized = d && d.dims.length > 0;
      if (!sized && (kind === "hmap" || kind === "omap" || kind === "unknown" || (kind === "array" && (this.lang === "lua" || this.lang === "perl" || this.lang === "php" || this.lang === "bash" || this.lang === "js" || this.lang === "ts" || this.lang === "ruby" || this.lang === "julia")))) {
        // $g[] = str_split($line) のように配列を足すなら、足した配列の大きさぶん増える(S4')
        const pushArr = target.idx.length === 0 && value && (allocOf(value, this.spec.typeKind) !== null || (value.kind === "call" && ["str_split", "explode", "preg_split", "array_fill", "range", "array_map"].includes(value.name)));
        g.set(name, pushArr && value ? this.sizeOf(value, env) : ONE);
        if (target.of.kind === "sym") this.directGrowth.add(name);
      }
      return plus(idxCost, { time, alloc: ONE, grow: g, specials: [] });
    }
    // Python / Java の文字列の += はコピーになりうる
    if (op === "+=" && target.kind === "sym" && (this.lang === "python" || this.lang === "pypy" || this.lang === "java") && value && (value.kind === "str" || this.kindOf(target) === "string") && env.outer.length > 0 && !this.stringConcatWarned) {
      this.stringConcatWarned = true;
      this.warn(`${line}行目: 文字列の += は長さぶんのコピーになりえます(ここでは1回 O(1) で数えています)`, "info", line);
    }
    return c;
  }

  // ---- 式 ---------------------------------------------------------------------

  exprCost(e: SExpr | null, env: WalkEnv, reading: boolean, line: number): Cost {
    if (!e) return empty();
    const sub = (x: SExpr | null) => this.exprCost(x, env, reading, line);
    switch (e.kind) {
      case "call": {
        const args = e.args.filter((a) => a.kind !== "lambda").reduce((acc, a) => plus(acc, sub(a)), empty());
        return plus(args, this.callCost(e.name, e.ns, null, e.args, env, reading, line));
      }
      case "member": {
        let c = sub(e.of);
        if (e.args) c = e.args.filter((a) => a.kind !== "lambda").reduce((acc, a) => plus(acc, sub(a)), c);
        return plus(c, this.callCost(e.name, null, e.of, e.args, env, reading, line));
      }
      case "cmp": {
        const c = plus(sub(e.l), sub(e.r));
        if (e.op === "in" || e.op === "notin") return plus(c, this.membership(e.r, env, line));
        return c;
      }
      case "index": {
        const c = e.idx.reduce((acc, x) => plus(acc, sub(x)), sub(e.of));
        if (e.of.kind === "sym") {
          const k = this.kindOf(e.of);
          if (k === "omap" || k === "oset") return plus(c, { ...empty(), time: logOfExpr(this.sizeSym(e.of.name)) });
        }
        return c;
      }
      case "comp":
        return this.compCost(e, env, reading, line);
      case "lambda":
        return empty();
      case "new": {
        const c = [...e.dims, ...e.args].reduce((acc, x) => plus(acc, sub(x)), empty());
        if (e.dims.length) return plus(c, { ...empty(), time: this.dimsProduct(e.dims, env) });
        return c;
      }
      case "slice": {
        const c = plus(sub(e.of), plus(sub(e.from), sub(e.to)));
        if (this.lang === "python" || this.lang === "pypy") return plus(c, { ...empty(), time: this.sizeOf(e, env) });
        return c;
      }
      case "bin": {
        const c = plus(sub(e.l), sub(e.r));
        // Ruby の a << x / adj[u] << v / s << c は末尾への追加(1 << n のような数のシフトは除く)
        if (e.op === "<<" && this.lang === "ruby" && e.l.kind !== "num" && e.r.kind !== "num" && this.kindOf(e.l) !== "scalar") {
          return plus(c, this.callCost("<<", null, e.l, [e.r], env, reading, line));
        }
        if (e.op === "+" && (this.lang === "python" || this.lang === "pypy") && (this.kindOf(e.l) === "array" || this.kindOf(e.r) === "array") && !reading) {
          return plus(c, { ...empty(), time: add(this.sizeOf(e.l, env), this.sizeOf(e.r, env)) });
        }
        return c;
      }
      case "size":
        return sub(e.of);
      case "un":
      case "not":
        return sub(e.e);
      case "logic":
        return plus(sub(e.l), sub(e.r));
      case "assign": {
        const c = plus(sub(e.value), this.targetCost(e.target, e.op, e.value, env, line));
        return c;
      }
      case "cond": {
        // c ? f(l, m) : f(m, r) の2つの枝は同時には通らない
        const id = this.branchId(e);
        const arm = (x: SExpr, k: number) => this.exprCost(x, { ...env, path: [...(env.path ?? []), `${id}:${k}`] }, reading, line);
        return plus(sub(e.c), plus(arm(e.a, 0), arm(e.b, 1)));
      }
      case "list":
        return e.items.reduce((acc, x) => plus(acc, sub(x)), empty());
      case "range":
        return plus(sub(e.from), sub(e.to));
      default:
        return empty();
    }
  }

  membership(coll: SExpr, env: WalkEnv, line: number): Cost {
    const r = rangeOf(coll);
    if (r || coll.kind === "list" || coll.kind === "str") return empty();
    const k = this.kindOf(coll);
    let time: Expr;
    if (k === "hset" || k === "hmap") time = ONE;
    else if (k === "oset" || k === "omap") time = logOfExpr(this.sizeOf(coll, env));
    else time = this.sizeOf(coll, env);
    if (!isConst(time)) this.item({ axis: "time", kind: "builtin", loc: { line, endLine: line }, label: `in ${sexprText(coll, 20)}`, expr: time, text: "", reason: k === "unknown" || k === "array" || k === "string" ? "リストの in は先頭から探す" : "集合の in", conf: k === "unknown" ? "medium" : "high" });
    return { ...empty(), time };
  }

  compCost(e: Extract<SExpr, { kind: "comp" }>, env: WalkEnv, reading: boolean, line: number): Cost {
    let factor: Expr = ONE;
    let pre = empty();
    const outer = [...env.outer];
    for (const g of e.gens) {
      pre = plus(pre, this.exprCost(g.iter, { ...env, outer }, reading, line));
      const benv = this.boundEnv({ ...env, outer });
      const fake: LoopNode = { kind: "loop", bound: { form: "for-in", var: g.vars[0] ?? null, coll: g.iter }, body: [], hasBreak: false, loc: { line, endLine: line }, src: "" };
      const it = iterCount(g.iter, benv, fake);
      factor = mul(factor, it.expr);
      outer.push({ var: g.vars[0] ?? null, bound: it.expr, node: fake, popped: [] });
    }
    const inner = { ...env, outer };
    let body = this.exprCost(e.elem, inner, reading, line);
    for (const c of e.conds) body = plus(body, this.exprCost(c, inner, reading, line));
    const total = mul(factor, body.time);
    if (!reading) this.item({ axis: "time", kind: "loop", loc: { line, endLine: line }, label: "内包表記", expr: factor, text: "", reason: "内包表記のループ", conf: "high" });
    // Haskell のリストは遅延なので、length [ … ] のように作ったそばから消費するなら領域はとらない
    const alloc = this.lang === "haskell" ? pre.alloc : add(pre.alloc, factor);
    return { time: add(pre.time, total), alloc, grow: addGrow(pre.grow, mulGrow(body.grow, factor)), specials: [] };
  }

  // ---- 呼び出し -----------------------------------------------------------------

  callCost(name: string, ns: string | null, recv: SExpr | null, args: SExpr[] | null, env: WalkEnv, reading: boolean, line: number): Cost {
    // 受け手が名前空間(std:: / Math. / heapq.)なら自由関数
    if (recv && recv.kind === "sym" && (NAMESPACES.has(recv.name) || (/^[A-Z]/.test(recv.name) && !this.decls.has(recv.name) && !this.inputs.has(recv.name)))) {
      return this.callCost(name, recv.name, null, args ?? [], env, reading, line);
    }
    const argv = args ?? [];
    // 自己呼び出し(再帰)
    const selfRecv = !recv || (recv.kind === "sym" && ["this", "self", "$this", "Self"].includes(recv.name));
    if (selfRecv && env.selfNames.has(name) && env.selfCalls) {
      env.selfCalls.push({ args: argv, line, insideLoop: env.outer.length > 0, insideAdjacency: env.inAdjacency, path: env.path ?? [] });
      return empty();
    }
    // ユーザー定義の関数・メソッド(組み込みより優先)
    const user = this.funcs.get(name);
    if (user && (selfRecv || this.kindOf(recv!) === "user" || this.kindOf(recv!) === "unknown") && !(recv && ["array", "oset", "omap", "hset", "hmap", "pq", "deque", "string"].includes(this.kindOf(recv)))) {
      if (args !== null || !recv) return this.userCall(user, argv, env, line);
    }
    // 組み込み
    // 入力の読み取り(cin / input() / sc.nextInt() / fmt.Scan …)とその変換は数えない(I1)
    if (this.spec.inputMarkers.has(name) || (reading && READ_FUNCS.has(name))) return empty();
    let rule: BuiltinRule | null = null;
    let kind: ContainerKind = "unknown";
    let target: SExpr | null = recv;
    if (recv) {
      kind = this.kindOf(recv);
      rule = lookupMethod(kind, name);
      if (!rule && args === null) return empty(); // ただのフィールド参照
    } else {
      rule = lookupFree(this.lang, name);
      target = argv[0] ?? null;
      // UFCS(D / Nim / Julia の a.sort と sort(a))。Nim / D は型が分からなくてもメソッドの既定で引く
      if (!rule && argv[0] && argv[0].kind !== "lambda") {
        const k = this.kindOf(argv[0]);
        if ((k !== "unknown" && k !== "scalar") || (k === "unknown" && (this.lang === "nim" || this.lang === "d"))) {
          rule = lookupMethod(k, name);
          kind = k;
          if (rule) return this.applyRule(rule, name, argv[0], argv.slice(1), kind, env, line);
        }
      }
    }
    if (!rule) {
      if (!QUIET.has(name) && name && !/^[A-Z]/.test(name)) this.unknownCalls.add(ns ? `${ns}.${name}` : name);
      // ラムダや関数名の引数(Thread(target=main) / setTimeout(f))は1回ぶん数える
      return argv.reduce((acc, a) => plus(acc, this.callbackCost(a, env, line) ?? empty()), empty());
    }
    return this.applyRule(rule, name, target, recv ? argv : argv, kind, env, line);
  }

  applyRule(rule: BuiltinRule, name: string, recv: SExpr | null, args: SExpr[], kind: ContainerKind, env: WalkEnv, line: number): Cost {
    const ctx: CallCtx = {
      args,
      recv,
      recvKind: kind,
      size: (x) => this.sizeOf(x, env),
      bound: (x) => boundOf(x, this.boundEnv(env))?.expr ?? Q,
      rangeSize: (a) => this.rangeSize(a, env),
    };
    let time = rule.cost(ctx);
    const lambdas: Cost[] = [];
    for (const a of args) {
      const lc = this.callbackCost(a, env, line);
      if (lc) lambdas.push(lc);
    }
    let lamTime: Expr = ONE;
    let lamGrow = new Map<string, Expr>();
    for (const lc of lambdas) {
      lamTime = add(lamTime, lc.time);
      lamGrow = addGrow(lamGrow, lc.grow);
    }
    let grow = new Map<string, Expr>();
    if (lambdas.length > 0 && (rule.loopArg !== undefined || rule.cmpArg !== undefined)) {
      grow = mulGrow(lamGrow, time);
      time = mul(time, lamTime);
    } else if (lambdas.length > 0) {
      time = add(time, lamTime);
      grow = lamGrow;
    }
    if (rule.grows && recv) {
      let base: SExpr = recv;
      while (base.kind === "index" || base.kind === "member") base = base.kind === "index" ? base.of : base.of.kind === "sym" && ["this", "self"].includes(base.of.name) ? { kind: "sym", name: base.name } : base.of;
      if (base.kind === "sym") grow.set(base.name, add(grow.get(base.name) ?? ONE, ONE));
      if (base.kind === "sym" && recv.kind === "sym") this.directGrowth.add(base.name);
    }
    if (rule.warn) this.warn(`${line}行目: ${rule.warn}`, "warn", line);
    if (name === "lower_bound" || name === "upper_bound") {
      const a0 = args[0];
      if (!recv || (a0 && a0.kind === "member")) {
        const k = a0 && a0.kind === "member" ? this.kindOf(a0.of) : "unknown";
        if (k === "oset" || k === "omap") this.warn(`${line}行目: std::lower_bound を set / map に使うと O(N) です。s.lower_bound(x) を使ってください`, "warn", line);
      }
    }
    const label = `${recv ? `${sexprText(recv, 16)}.` : ""}${name}(…)`;
    if (!isConst(time)) {
      this.item({ axis: "time", kind: "builtin", loc: { line, endLine: line }, label, expr: time, text: "", reason: rule.note ?? "既知の関数", conf: rule.conf ?? "high" });
    }
    // resize(n) / assign(n, x) / reserve(n) は大きさぶんの領域
    const alloc = rule.alloc ? rule.alloc(ctx) : ONE;
    if (!isConst(alloc)) this.item({ axis: "space", kind: "alloc", loc: { line, endLine: line }, label, expr: alloc, text: "", reason: "大きさを変える", conf: "high" });
    return { time, alloc, grow, specials: [] };
  }

  /** コールバックの引数(ラムダ、ユーザー定義の関数名、key=f / target=main)を1回呼ぶコスト。コールバックでなければ null */
  callbackCost(a: SExpr, env: WalkEnv, line: number): Cost | null {
    const v = a.kind === "assign" && a.op === "=" && a.value ? a.value : a;
    if (v.kind === "lambda") return this.lambdaCost(v, env, line);
    if (v.kind === "sym" && !env.params.has(v.name) && !this.decls.has(v.name) && !this.inputs.has(v.name)) {
      const fn = this.funcs.get(v.name);
      if (fn && !env.selfNames.has(v.name)) return this.userCall(fn, [], env, line);
    }
    return null;
  }

  lambdaCost(l: SExpr, env: WalkEnv, line: number): Cost {
    if (l.kind !== "lambda") return empty();
    const inner: WalkEnv = { ...env, params: new Set([...env.params, ...l.params]), before: [...env.before] };
    const c = l.body.length ? this.walkNodes(l.body, inner) : this.exprCost(l.expr, inner, false, line);
    return { ...c, specials: [] };
  }

  userCall(fn: FuncNode, args: SExpr[], env: WalkEnv, line: number): Cost {
    this.called.add(fn.name);
    if (this.inProgress.includes(fn)) {
      // 相互再帰(R11)
      this.warn(`${fn.name} が相互再帰しています。合計 N 回の呼び出しとみなしました`, "warn", line);
      return { ...empty(), time: Q };
    }
    const res = this.funcResult(fn);
    let time = res.time;
    let alloc = res.alloc;
    let grow = res.grow;
    const benv = this.boundEnv(env);
    fn.params.forEach((p, i) => {
      const a = args[i];
      if (!a) return;
      const pSym = this.symbolOf(p);
      const b = boundOf(a, benv);
      if (b && vars(time).includes(pSym)) time = rename(time, pSym, b.expr);
      if (b && vars(alloc).includes(pSym)) alloc = rename(alloc, pSym, b.expr);
      const pSize = `|${p}|`;
      if (vars(time).includes(pSize) || vars(alloc).includes(pSize)) {
        const s = this.sizeOf(a, env);
        time = rename(time, pSize, s);
        alloc = rename(alloc, pSize, s);
      }
      if (b) {
        const g2 = new Map<string, Expr>();
        for (const [k, v] of grow) g2.set(k, vars(v).includes(pSym) ? rename(v, pSym, b.expr) : v);
        grow = g2;
      }
    });
    if (!isConst(time)) this.item({ axis: "time", kind: "call", loc: { line, endLine: line }, label: `${fn.name}(…)`, expr: time, text: "", reason: `関数 ${fn.name} の計算量`, conf: res.conf });
    return { time, alloc, grow, specials: [] };
  }

  funcResult(fn: FuncNode): { time: Expr; alloc: Expr; grow: Map<string, Expr>; conf: Confidence } {
    const cached = this.funcCache.get(fn);
    if (cached) return cached;
    const env: WalkEnv = { outer: [], params: new Set(fn.params), func: fn, selfNames: new Set([fn.name, ...(fn.selfParam ? [fn.selfParam] : [])]), selfCalls: [], before: [], inAdjacency: false };
    this.inProgress.push(fn);
    const cost = this.walkNodes(fn.body, env);
    this.inProgress.pop();
    let time = cost.time;
    let alloc = cost.alloc;
    let grow = cost.grow;
    let conf: Confidence = "high";
    // 関数の直下の、仮引数の頂点を起点にした隣接リストの走査
    const adjs = cost.specials.filter((s) => s.sp.kind === "adjacency" && env.params.has(s.sp.anchor));
    const others = cost.specials.filter((s) => !adjs.includes(s));
    for (const s of others) {
      time = add(time, s.fallback);
      grow = addGrow(grow, s.grow);
    }
    const selfCalls = env.selfCalls ?? [];
    if (selfCalls.length > 0) {
      const adjacency = adjs.length ? { edges: adjs.reduce((acc, s) => add(acc, s.sp.total), ONE), body: adjs.reduce((acc, s) => add(acc, s.body), ONE) } : null;
      const est = estimateRecursion({ fn, selfCalls, body: time, adjacency, env: this.boundEnv(env) });
      time = est.time;
      alloc = add(alloc, est.depth);
      if (est.memo) {
        alloc = add(alloc, est.memo);
        this.item({ axis: "space", kind: "alloc", loc: fn.loc, label: `${fn.name} のメモ`, expr: est.memo, text: "", reason: "メモ化した状態の数", conf: est.conf });
      }
      grow = mulGrow(grow, est.calls);
      for (const s of adjs) grow = addGrow(grow, s.grow);
      conf = est.conf;
      if (est.warn) this.warn(est.warn, "warn", fn.loc.line);
      this.item({ axis: "time", kind: "recursion", loc: fn.loc, label: `${fn.name} の再帰`, expr: time, text: "", reason: est.reason, conf: est.conf });
      this.item({ axis: "space", kind: "recursion", loc: fn.loc, label: `${fn.name} の再帰の深さ`, expr: est.depth, text: "", reason: "呼び出しのスタック", conf: est.conf });
    } else {
      for (const s of adjs) {
        time = add(time, mul(s.sp.total, s.body));
        grow = addGrow(grow, s.grow);
      }
    }
    // 関数の中で宣言したコンテナの成長は、関数を抜けたら領域(max)に回す
    const local = new Set<string>();
    const visit = (nodes: readonly IrNode[]) => {
      for (const n of nodes) {
        if (n.kind === "decl" && !n.isGlobal) local.add(n.name);
        else if (n.kind === "loop") visit(n.body);
        else if (n.kind === "branch") n.branches.forEach(visit);
        else if (n.kind === "assign" && n.op === "=" && n.target.kind === "sym" && n.value && allocOf(n.value, this.spec.typeKind)) local.add(n.target.name);
      }
    };
    visit(fn.body);
    const kept = new Map<string, Expr>();
    for (const [k, v] of grow) {
      this.recordGrow(k, v);
      if (local.has(k) && fn.name !== "<module>") alloc = add(alloc, v);
      else kept.set(k, v);
    }
    const res = { time, alloc, grow: kept, conf };
    this.funcCache.set(fn, res);
    return res;
  }

  recordGrow(name: string, v: Expr): void {
    if (this.pass !== 1) return;
    this.growRecord.set(name, this.growRecord.has(name) ? add(this.growRecord.get(name)!, v) : v);
  }

  // ---- ループ -------------------------------------------------------------------

  /**
   * for x in c: … の後に同じ繰り返しの中で c を空にする形(c.clear() / c = [])なら、外側のループ全体で
   * c に入った要素の数(最初の大きさ + 追加の回数)しか回らない(償却)。そのときの全体の回数。
   * 外側のループの中で c に空でない値を入れ直す(c = list(range(n)))なら償却にしない
   */
  drainTotal(loop: LoopNode, env: WalkEnv): { name: string; total: Expr } | null {
    const b = loop.bound;
    if (b.form !== "for-in" || env.outer.length === 0) return null;
    let c = b.coll;
    if (c.kind === "member" && ["items", "keys", "values", "iter"].includes(c.name) && (c.args === null || c.args.length === 0)) c = c.of;
    if (c.kind !== "sym") return null;
    const name = c.name;
    const frame = env.before[env.before.length - 1];
    if (!frame || !frame.list.slice(frame.upto + 1).some((n) => emptiesNode(n, name))) return null;
    const outer = env.outer[env.outer.length - 1].node;
    if (refills(outer.body, name)) return null;
    return { name, total: this.sizeOf(c, env) };
  }

  /**
   * ループを回しても大きさが増え続けないコンテナと、ループ全体でのその増え方。
   * - 1回の中で足した数以上を取り除く(s.append(x); s.sort(); s.pop())なら、増えるのは1回ぶんまで
   * - 大きさが上限を超えたら取り除く(if len(h) > k: heappop(h) / while (pq.size() > k) pq.pop())なら、上限まで
   * 取り除くのは、ループの本体の直下の文(上限の形は直下の if / while の中)に限る。
   * if で1つ取り除くだけなら、1回に足す数がそれ以下のときに限る(2つ足して1つ取り除くと増え続ける)
   */
  boundedGrowth(loop: LoopNode, grow: Map<string, Expr>, env: WalkEnv): Map<string, Expr> {
    const out = new Map<string, Expr>();
    for (const [name, g] of grow) {
      if (constValue(g) === null) continue;
      const pushes = this.pushesIn(loop.body, name);
      if (pushes === 0 || pushes === Infinity) continue;
      const pops = loop.body.reduce((acc, n) => acc + popsIn(n, name), 0);
      if (pops >= pushes) {
        out.set(name, g);
        continue;
      }
      const cap = this.capOf(loop.body, name, pushes, env);
      if (cap) out.set(name, cap);
    }
    return out;
  }

  /** 本体(条件の中も含む。内側のループは数えきれないので Infinity)で name に要素を足す呼び出しの数 */
  pushesIn(nodes: readonly IrNode[], name: string): number {
    let c = 0;
    for (const n of nodes) {
      if (n.kind === "loop" || n.kind === "func") {
        if (this.pushesIn(n.body, name) > 0) return Infinity;
        continue;
      }
      if (n.kind === "branch") {
        for (const b of n.branches) c += this.pushesIn(b, name);
        continue;
      }
      for (const e of stmtExprs(n)) {
        walk(e, (x) => {
          if (x.kind === "lambda") return false;
          if (x.kind === "member" && x.args !== null && x.of.kind === "sym") {
            // heapq.heappush(h, x) のような名前空間つきの関数
            if (NAMESPACES.has(x.of.name) && x.args[0]?.kind === "sym" && x.args[0].name === name && lookupFree(this.lang, x.name)?.grows) c++;
            else if (x.of.name === name && (PUSH_METHODS.has(x.name) || lookupMethod(this.kindOf(x.of), x.name)?.grows)) c++;
          } else if (x.kind === "call" && x.args[0]?.kind === "sym" && x.args[0].name === name && lookupFree(this.lang, x.name)?.grows) c++;
          else if (x.kind === "bin" && x.op === "<<" && this.lang === "ruby" && x.l.kind === "sym" && x.l.name === name) c++;
          else if (x.kind === "assign" && x.target.kind === "index" && x.target.of.kind === "sym" && x.target.of.name === name) c++;
        });
      }
    }
    return c;
  }

  /** 本体の直下の if / while で「name の大きさが E を超えたら取り除く」なら E の上界(1回に足す数は pushes) */
  capOf(nodes: readonly IrNode[], name: string, pushes: number, env: WalkEnv): Expr | null {
    for (const n of nodes) {
      let cond: SExpr | null = null;
      let need = 1;
      let arm: readonly IrNode[] = [];
      if (n.kind === "branch" && n.conds[0]) {
        cond = n.conds[0];
        arm = n.branches[0] ?? [];
        need = pushes;
      } else if (n.kind === "loop" && n.bound.form === "while" && n.bound.cond) {
        cond = n.bound.cond;
        arm = n.body;
      }
      if (!cond || arm.reduce((acc, x) => acc + popsIn(x, name), 0) < need) continue;
      const lim = sizeLimit(cond, name);
      const b = lim ? boundOf(lim, this.boundEnv(env)) : null;
      if (b) return b.expr;
    }
    return null;
  }

  loopCost(loop: LoopNode, env: WalkEnv): Cost {
    const benv = this.boundEnv(env);
    let F = inferLoop(loop, benv);
    if (!F.special) {
      const d = this.drainTotal(loop, env);
      if (d) {
        const outerVar = env.outer[env.outer.length - 1].var ?? "";
        F = { ...F, expr: d.total, conf: "medium", reason: `${d.name} を回したあと空にするので、全体で ${d.name} に入った要素の数(償却)`, special: { kind: "amortized", anchor: outerVar, total: d.total }, info: `${loop.loc.line}行目: ${d.name} を回したあとで空にしているので、外側のループ全体で ${d.name} に入った要素の数だけ回るとみなしました(償却)` };
      }
    }
    const b = loop.bound;
    const line = loop.loc.line;
    let once = empty();
    let head = empty();
    if (b.form === "for-c") {
      once = this.exprCost(b.init, env, false, line);
      head = plus(this.exprCost(b.cond, env, false, line), this.exprCost(b.update, env, false, line));
    } else if (b.form === "for-range") once = plus(this.exprCost(b.to, env, false, line), this.exprCost(b.from, env, false, line));
    else if (b.form === "for-in") once = this.exprCost(b.coll, env, false, line);
    else if (b.form === "count") once = this.exprCost(b.count, env, false, line);
    else if (b.form === "while") head = this.exprCost(b.cond, env, false, line);
    const loopVar = b.form === "while" ? null : b.var;
    const scope: LoopScope = { var: loopVar, bound: F.expr, node: loop, popped: F.popped ?? [] };
    const inner: WalkEnv = { ...env, outer: [...env.outer, scope], inAdjacency: env.inAdjacency || F.special?.kind === "adjacency" };
    const body = this.walkNodes(loop.body, inner);
    const perIter = add(body.time, head.time);
    let total = mul(F.expr, perIter);
    // 大きさが増え続けないコンテナは、ループの回数を掛けずに1回ぶん(または上限)だけ増えるとみなす
    const bounded = this.boundedGrowth(loop, body.grow, env);
    const bodyGrow = new Map([...body.grow].filter(([k]) => !bounded.has(k)));
    let grow = addGrow(mulGrow(addGrow(bodyGrow, head.grow), F.expr), bounded);
    const up: SpecialCost[] = [];
    for (const sc of body.specials) {
      const sp = sc.sp;
      if (sp.kind === "harmonic" && sp.anchor === loopVar) {
        total = add(total, mul(mul(sp.total, logOfExpr(sp.total)), sc.body));
        grow = addGrow(grow, mulGrow(sc.grow, logOfExpr(sp.total)));
        continue;
      }
      if (sp.kind === "amortized") {
        total = add(total, mul(sp.total, sc.body));
        grow = addGrow(grow, sc.grow);
        continue;
      }
      if (sp.kind === "adjacency" && (sp.anchor === loopVar || scope.popped.includes(sp.anchor))) {
        total = add(total, mul(sp.total, sc.body));
        grow = addGrow(grow, sc.grow);
        continue;
      }
      total = add(total, mul(F.expr, sc.fallback));
      grow = addGrow(grow, mulGrow(sc.grow, F.expr));
    }
    // ループの中で宣言した(d = deque() / diff = [] のように作り直した)コンテナの成長は毎回捨てられる(S11)。
    // 大きさは1回の反復で足した数まで(テストケースごとに作り直すなら T·N ではなく N)
    let alloc = body.alloc;
    const declared = new Set<string>();
    const visit = (nodes: readonly IrNode[]) => {
      for (const n of nodes) {
        if (n.kind === "decl") declared.add(n.name);
        else if (n.kind === "assign" && n.op === "=" && n.target.kind === "sym" && n.value && allocOf(n.value, this.spec.typeKind)) declared.add(n.target.name);
        else if (n.kind === "branch") n.branches.forEach(visit);
      }
    };
    visit(loop.body);
    for (const [k, v] of [...grow]) {
      if (declared.has(k)) {
        const per = body.grow.get(k) ?? v;
        this.recordGrow(k, per);
        alloc = add(alloc, per);
        grow.delete(k);
      }
    }
    if (F.warn) this.warn(F.warn, "warn", line);
    if (F.info) this.warn(F.info, "info", line);
    this.item({ axis: "time", kind: "loop", loc: loop.loc, label: loop.src || "ループ", expr: F.expr, text: "", reason: `${F.reason}${loop.hasBreak ? "(break / return あり。最悪は変わらない)" : ""}`, conf: F.conf });
    if (F.special) {
      const specialGrow = mulGrow(addGrow(bodyGrow, head.grow), F.special.total);
      return { time: once.time, alloc: add(once.alloc, alloc), grow: addGrow(once.grow, bounded), specials: [...up, { sp: F.special, body: perIter, fallback: total, grow: specialGrow }] };
    }
    return { time: add(once.time, total), alloc: add(once.alloc, alloc), grow: addGrow(once.grow, grow), specials: up };
  }

  // ---- 別名(1回目と2回目の間) ---------------------------------------------------

  computeAliases(): void {
    const benv = this.boundEnv(null);
    const setAlias = (name: string, e: Expr) => {
      if (!this.aliases.has(`|${name}|`)) this.aliases.set(`|${name}|`, e);
    };
    // (a) 大きさを指定した確保
    for (const [name, list] of this.decls) {
      const d = list.find((x) => x.costsTime && x.dims.length > 0);
      if (d) {
        const b = boundOf(d.dims[0], benv);
        // 最初の大きさ + 後から足した回数(s = set(…) の後に s.add(x) / vector<int> v(n) の後に push_back)
        const g = this.directGrowth.has(name) ? this.growRecord.get(name) : undefined;
        if (b && !(isConst(b.expr) && this.growRecord.has(name))) setAlias(name, g ? add(b.expr, g) : b.expr);
      }
    }
    // resize(n) / assign(n, x) で大きさを決めたコンテナ
    walkIr(this.prog.nodes, (x) => {
      if (x.kind === "member" && (x.name === "resize" || x.name === "assign") && x.args && x.args[0]) {
        const name = x.of.kind === "sym" ? x.of.name : x.of.kind === "index" && x.of.of.kind === "sym" ? `${x.of.of.name}[]` : null;
        const b = name ? boundOf(x.args[0], benv) : null;
        if (name && b) setAlias(name, b.expr);
      }
    });
    // Rust の input! の長さ
    const inputNodes: Extract<IrNode, { kind: "input" }>[] = [];
    const collect = (nodes: readonly IrNode[]) => {
      for (const n of nodes) {
        if (n.kind === "input") inputNodes.push(n);
        else if (n.kind === "func") collect(n.body);
        else if (n.kind === "loop") collect(n.body);
        else if (n.kind === "branch") n.branches.forEach(collect);
      }
    };
    collect(this.prog.nodes);
    for (const n of inputNodes) for (const [a, len] of Object.entries(n.lens)) {
      const b = boundOf(len, benv);
      if (b) setAlias(a, b.expr);
    }
    // (d) 定数の添字でしか使われない入力配列
    const constOnly = this.constIndexOnly();
    for (const [a, k] of constOnly) if (this.inputs.get(a)?.array) setAlias(a, lit(k));
    // (e) 入力配列の長さは、同じブロックで先に読んだスカラ入力
    const perBlock = (nodes: readonly IrNode[]) => {
      const pending: string[] = [];
      for (const n of nodes) {
        if (n.kind === "input") {
          // b = line.split() の line は b の中身そのもの(長さではない)
          if (n.refs) for (const r of n.refs) {
            const k = pending.indexOf(r);
            if (k >= 0) pending.splice(k, 1);
          }
          for (const a of n.arrays) {
            if (this.aliases.has(`|${a}|`) || n.lens[a]) continue;
            const s = pending.shift();
            if (s) {
              setAlias(a, this.symFor(s, null));
              this.warn(`${a} の長さを ${this.symbolOf(s)} とみなしました`, "info", n.loc.line);
            }
          }
          pending.push(...n.scalars.filter((s) => !this.consts[s]));
          continue;
        }
        // 確保の大きさやループの回数に使った入力は、別の役割(グリッドの H・W など)なので配列の長さの候補から外す
        const used = new Set<string>();
        if (n.kind === "decl") n.dims.forEach((d) => walk(d, (x) => void (x.kind === "sym" && used.add(x.name))));
        if (n.kind === "assign" && n.value) {
          const al = allocOf(n.value, this.spec.typeKind);
          al?.dims.forEach((d) => walk(d, (x) => void (x.kind === "sym" && used.add(x.name))));
        }
        if (n.kind === "loop") {
          const b = n.bound;
          walk(b.form === "for-range" ? b.to : b.form === "for-c" ? b.cond : b.form === "count" ? b.count : null, (x) => void (x.kind === "sym" && used.add(x.name)));
        }
        for (const u of used) {
          const k = pending.indexOf(u);
          if (k >= 0) pending.splice(k, 1);
        }
        if (n.kind === "func") perBlock(n.body);
        else if (n.kind === "loop") perBlock(n.body);
        else if (n.kind === "branch") n.branches.forEach(perBlock);
      }
    };
    perBlock(this.prog.nodes);
    // (c) 写しと長さの代入
    const singles = this.singleDefs();
    const copies = (nodes: readonly IrNode[], params: ReadonlySet<string>) => {
      for (const n of nodes) {
        const target = n.kind === "assign" && n.op === "=" && n.target.kind === "sym" ? n.target.name : n.kind === "decl" ? n.name : null;
        const value = n.kind === "assign" ? n.value : n.kind === "decl" ? n.init : null;
        if (target && value) {
          // 後から要素を足したなら、最初の大きさ + 足した回数(s = a[:3] の後に s.append(x))
          const g = this.directGrowth.has(target) ? this.growRecord.get(target) : undefined;
          const withGrowth = (x: Expr) => (g ? add(x, g) : x);
          const len = value.kind === "slice" ? this.sliceLen(value, benv) : null;
          if (len) setAlias(target, withGrowth(len));
          // p = convolution(a, b) の長さは |a| + |b|
          if (convolutionArgs(value)) setAlias(target, withGrowth(this.sizeOf(value, null)));
          const src = len ? null : copySource(value);
          if (src && src !== target) {
            const s = this.aliases.get(`|${src}|`);
            setAlias(target, withGrowth(s ?? sym(`|${src}|`)));
          }
          if (value.kind === "size" && value.of.kind === "sym") {
            const of = value.of.name;
            // 関数の中の n = a.size()(a は仮引数)は n を |a| にして、呼び出し側で実引数の長さに置き換える。
            // dl = d.size() で d の大きさが確保や追加の回数で決まるなら、dl はその大きさ
            const known = params.has(of) || this.growRecord.has(of) || !!this.declOf(of)?.dims.length;
            if (known && singles.get(target) === value && !this.sharesSymbol(target)) {
              this.aliases.set(this.symbolOf(target), sym(`|${of}|`));
              if (params.has(of)) this.paramAliases.add(this.symbolOf(target));
            }
            else setAlias(of, this.named(this.symbolOf(target), `変数 ${target}(${of} の長さ)`, n.loc.line));
          }
        }
        if (n.kind === "func") copies(n.body, new Set(n.params));
        else if (n.kind === "loop") copies(n.body, params);
        else if (n.kind === "branch") n.branches.forEach((b) => copies(b, params));
      }
    };
    copies(this.prog.nodes, new Set());
    // (h) 一度だけ代入され、入力のスカラと定数だけで決まる変数(m = n - 1 / k = min(n, 20) / x = n if c else 1)
    for (const [name, value] of this.singleDefs()) {
      const s = this.symbolOf(name);
      if (this.aliases.has(s)) continue;
      let ok = true;
      walk(value, (x) => {
        if (!ok) return false;
        if (x.kind === "size" || x.kind === "index" || x.kind === "comp" || x.kind === "lambda") ok = false;
        else if (x.kind === "sym" && !(this.inputs.get(x.name)?.array === false || this.consts[x.name] !== undefined)) ok = false;
        return ok;
      });
      if (!ok) continue;
      const b = boundOf(value, benv);
      if (b && !vars(b.expr).includes(s)) this.aliases.set(s, b.expr);
    }
    // (b) 成長だけでサイズが決まるコンテナ
    for (const [name, g] of this.growRecord) setAlias(name, g);
    // 1回目に Σ|g[]| で置いた辺の数は g への追加の総数。追加が見つからなければ記号 M
    for (const g of this.edgePlaceholders) {
      const key = `Σ|${g}[]|`;
      if (!this.aliases.has(key)) this.aliases.set(key, this.growRecord.get(g) ?? this.named("M", `辺の数(${g} への追加が見つからないので記号にしました)`, 0));
    }
    // 別名の中の別名を解く
    for (let it = 0; it < 3; it++) {
      for (const [k, v] of this.aliases) if (!this.paramAliases.has(k)) this.aliases.set(k, this.resolveAliases(v, k));
    }
    // 成長の合計(辺の数など)も別名を解いた形で持つ
    this.growTotals = new Map([...this.growRecord].map(([k, v]) => [k, this.resolveAliases(v, `|${k}|`)]));
  }

  /** name と同じ記号になる別の変数(関数内の h と main の入力 H)があるか */
  sharesSymbol(name: string): boolean {
    const s = this.symbolOf(name);
    const names = new Set<string>([...this.inputs.keys(), ...this.decls.keys()]);
    for (const f of this.funcs.values()) f.params.forEach((p) => names.add(p));
    for (const x of names) if (x !== name && this.symbolOf(x) === s) return true;
    return false;
  }

  /** 式の中の別名のある記号を置き換える(self は自分自身の別名で置き換えない) */
  resolveAliases(e: Expr, self: string): Expr {
    let out = e;
    for (let it = 0; it < 3; it++) {
      let changed = false;
      for (const x of vars(out)) {
        const a = this.aliases.get(x);
        if (a && x !== self) {
          out = rename(out, x, a);
          changed = true;
        }
      }
      if (!changed) break;
    }
    return out;
  }

  /** ちょうど1回だけ = で値を決める変数と、その値(ループ変数・引数・入力・複合代入・++ は除く) */
  singleDefs(): Map<string, SExpr> {
    const defs = new Map<string, SExpr[]>();
    const bad = new Set<string>();
    const def = (name: string, v: SExpr) => {
      const list = defs.get(name);
      if (list) list.push(v);
      else defs.set(name, [v]);
    };
    // 式の中の代入(x = y = 0 の y、i++、while ((x = f()) …))は値が決まらないものとして除く
    const inner = (e: SExpr | null) =>
      walk(e, (x) => {
        if (x.kind === "assign") targetNames(x.target).forEach((n) => bad.add(n));
        if (x.kind === "lambda") return false;
      });
    const visit = (nodes: readonly IrNode[]) => {
      for (const [i, n] of nodes.entries()) {
        if (n.kind === "assign") {
          // C++ の ll n = a.size(); は宣言と代入の2つになる。同じ値の代入は宣言と合わせて1回と数える
          const prev = nodes[i - 1];
          if (prev && prev.kind === "decl" && n.target.kind === "sym" && prev.name === n.target.name && prev.init === n.value) continue;
          if (n.op === "=" && n.value && n.target.kind === "sym") def(n.target.name, n.value);
          else if (n.op === "=" && n.value && n.target.kind === "list" && n.value.kind === "list" && n.target.items.length === n.value.items.length) {
            n.target.items.forEach((t, i) => {
              if (t.kind === "sym") def(t.name, (n.value as Extract<SExpr, { kind: "list" }>).items[i]);
              else targetNames(t).forEach((x) => bad.add(x));
            });
          } else if (n.target.kind !== "index" && n.target.kind !== "member") targetNames(n.target).forEach((x) => bad.add(x));
          inner(n.value);
        } else if (n.kind === "decl") {
          if (n.init) def(n.name, n.init);
          inner(n.init);
        } else if (n.kind === "expr") inner(n.e);
        else if (n.kind === "return") inner(n.value);
        else if (n.kind === "input") [...n.scalars, ...n.arrays].forEach((x) => bad.add(x));
        else if (n.kind === "branch") {
          n.conds.forEach(inner);
          n.branches.forEach(visit);
        } else if (n.kind === "loop") {
          const b = n.bound;
          if (b.form !== "while" && b.form !== "count" && b.var) bad.add(b.var);
          if (b.form === "for-c") {
            inner(b.init);
            inner(b.update);
            inner(b.cond);
          } else if (b.form === "for-in") inner(b.coll);
          else if (b.form === "while") {
            inner(b.cond);
            b.bind?.forEach((x) => bad.add(x));
          }
          visit(n.body);
        } else if (n.kind === "func") {
          n.params.forEach((x) => bad.add(x));
          visit(n.body);
        }
      }
    };
    visit(this.prog.nodes);
    const out = new Map<string, SExpr>();
    for (const [name, vs] of defs) if (vs.length === 1 && !bad.has(name) && !this.inputs.has(name)) out.set(name, vs[0]);
    return out;
  }

  /** 定数の添字(v[0] + v[1])でしか参照されない名前と、その添字の数 */
  constIndexOnly(): Map<string, number> {
    const ok = new Map<string, number>();
    const bad = new Set<string>();
    const scan = (e: SExpr | null, parentConstIndex: boolean) => {
      if (!e) return;
      if (e.kind === "sym") {
        if (!parentConstIndex) bad.add(e.name);
        return;
      }
      if (e.kind === "index" && e.of.kind === "sym") {
        const allConst = e.idx.every((x) => x.kind === "num");
        if (allConst) {
          const k = Math.max(...e.idx.map((x) => (x.kind === "num" ? x.value : 0))) + 1;
          ok.set(e.of.name, Math.max(ok.get(e.of.name) ?? 0, k));
          e.idx.forEach((x) => scan(x, false));
          return;
        }
      }
      walkChildren(e, (c) => scan(c, false));
    };
    const visitNodes = (nodes: readonly IrNode[]) => {
      for (const n of nodes) {
        if (n.kind === "expr") scan(n.e, false);
        else if (n.kind === "assign") {
          if (n.target.kind !== "sym" && n.target.kind !== "list") scan(n.target, false);
          scan(n.value, false);
        } else if (n.kind === "decl") scan(n.init, false);
        else if (n.kind === "return") scan(n.value, false);
        else if (n.kind === "branch") {
          n.conds.forEach((c) => scan(c, false));
          n.branches.forEach(visitNodes);
        } else if (n.kind === "loop") {
          const b = n.bound;
          if (b.form === "for-in") scan(b.coll, false);
          else if (b.form === "for-range") scan(b.to, false);
          else if (b.form === "for-c") {
            scan(b.cond, false);
            scan(b.init, false);
          } else if (b.form === "while") scan(b.cond, false);
          visitNodes(n.body);
        } else if (n.kind === "func") visitNodes(n.body);
      }
    };
    visitNodes(this.prog.nodes);
    for (const b of bad) ok.delete(b);
    return ok;
  }

  // ---- 全体 ---------------------------------------------------------------------

  entryCost(): { cost: Cost; entries: string[] } {
    const env: WalkEnv = { outer: [], params: new Set(), func: null, selfNames: new Set(), selfCalls: null, before: [], inAdjacency: false };
    const moduleNodes = this.prog.nodes.filter((n) => n.kind !== "func");
    const hasWork = moduleNodes.some((n) => n.kind !== "decl" && n.kind !== "stmt" && n.kind !== "input");
    const main = this.funcs.get("main") ?? this.funcs.get("Main");
    const module: FuncNode = { kind: "func", name: "<module>", params: [], decorators: [], body: moduleNodes, loc: { line: 1, endLine: this.prog.lineCount }, isLambda: false, selfParam: null };
    let cost = this.walkNodes(module.body, env);
    for (const s of cost.specials) {
      cost.time = add(cost.time, s.fallback);
      cost.grow = addGrow(cost.grow, s.grow);
    }
    cost.specials = [];
    for (const [k, v] of cost.grow) this.recordGrow(k, v);
    const entries: string[] = [];
    if (hasWork || moduleNodes.length > 0) entries.push("<module>");
    if (this.spec.implicitMain && main) {
      entries.push(main.name);
      cost = plus(cost, this.userCall(main, [], env, main.loc.line));
    } else if (!hasWork || (this.spec.implicitMain && !main)) {
      // 関数だけが貼られている: それぞれを個別の入口として評価する
      const tops = this.prog.nodes.filter((n): n is FuncNode => n.kind === "func" && !n.isLambda);
      const callees = new Set<string>();
      for (const f of tops) walkIr(f.body, (e) => {
        if (e.kind === "call") callees.add(e.name);
        if (e.kind === "member") callees.add(e.name);
      });
      const roots = tops.filter((f) => !callees.has(f.name) || tops.length === 1);
      if (roots.length > 0) {
        for (const f of roots) {
          entries.push(f.name);
          cost = plus(cost, this.userCall(f, [], env, f.loc.line));
        }
        this.warn(this.spec.implicitMain ? "main が無いので、各関数を個別に評価しました" : "トップレベルの処理が無いので、各関数を個別に評価しました", "info");
      }
    }
    return { cost, entries };
  }

  run(): Analysis {
    // 1回目: 成長の総数を集める
    this.pass = 1;
    this.entryCost();
    for (const f of this.funcs.values()) this.funcResult(f);
    this.computeAliases();
    // 2回目
    this.pass = 2;
    this.funcCache.clear();
    this.called.clear();
    this.symbolOrder = [];
    this.symCount.clear();
    this.pass1Origins = new Map(this.origins);
    this.origins.clear();
    const { cost, entries } = this.entryCost();
    // 使われない関数
    const unused = [...this.funcs.values()].filter((f) => !this.called.has(f.name) && !entries.includes(f.name));
    for (const f of unused) {
      const r = this.funcResult(f);
      this.item({ axis: "time", kind: "func", loc: f.loc, label: `${f.name}(使われていない)`, expr: r.time, text: "", reason: "入口から呼ばれない関数", conf: "high", unused: true });
    }
    if (unused.length > 0) this.warn(`使われていない関数 ${unused.length} 個を無視しました`, "info");
    if (this.unknownCalls.size > 0) {
      const names = [...this.unknownCalls].slice(0, 6).join(", ");
      this.warn(`未知の関数 ${names}${this.unknownCalls.size > 6 ? " など" : ""} を O(1) とみなしました`, "info");
    }
    let space: Expr = cost.alloc;
    for (const [, g] of cost.grow) space = add(space, g);
    let time = cost.time;
    // 主記号("?" の置き場): 最も多く出た記号。N があれば N
    const counts = [...this.symCount.entries()].filter(([s]) => s !== "?" && !s.startsWith("|") && !s.includes("(") && !s.includes("^"));
    counts.sort((a, b) => b[1] - a[1]);
    const main = this.symCount.has("N") || counts.length === 0 ? "N" : counts[0][0];
    const fix = (e: Expr) => normalize(rename(e, "?", sym(main)));
    if ([...vars(time), ...vars(space)].includes("?") || this.items.some((i) => vars(i.expr).includes("?"))) {
      if (!this.symbolOrder.includes(main)) this.symbolOrder.push(main);
      if (!this.origins.has(main)) this.origins.set(main, { origin: "推定できなかった回数の目安", line: 0 });
    }
    time = fix(time);
    space = fix(space);
    const plain = (s: string) => /^[A-Za-z_]\w*$/.test(s);
    const order = [...this.symbolOrder.filter((s) => s !== "?" && plain(s)), ...this.symbolOrder.filter((s) => s !== "?" && !plain(s))];
    const items = this.items.map((it) => {
      const expr = fix(it.expr);
      // 表示は総計と同じく支配される項を落とす(main(…) が O(N² + N) ではなく O(N²) になる)
      const shown = simplify(expr);
      return { ...it, expr, text: it.kind === "loop" ? `×${format(shown, order)}` : formatO(shown, order) };
    });
    const tExpr = simplify(time);
    const sExpr = simplify(space);
    const variables: Variable[] = [];
    const seen = new Set<string>();
    for (const v of [...vars(time), ...vars(space)]) {
      if (seen.has(v)) continue;
      seen.add(v);
      const o = this.origins.get(v);
      variables.push({ name: v, origin: o?.origin ?? `記号 ${v}`, line: o?.line ?? 0 });
    }
    variables.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
    // 確からしさ: 支配項に効いた内訳の最小
    const tv = new Set(vars(tExpr));
    let confidence: Confidence = "high";
    const rank = { high: 2, medium: 1, low: 0 } as const;
    for (const it of items) {
      if (it.axis !== "time" || it.unused) continue;
      if (!vars(it.expr).some((v) => tv.has(v))) continue;
      if (rank[it.conf] < rank[confidence]) confidence = it.conf;
    }
    if (this.spec.key === "haskell") confidence = "low";
    for (const w of this.prog.warnings) this.warnings.unshift({ line: w.line, message: `${w.line}行目: ${w.message}`, level: w.code === "macro-fallback" ? "info" : "warn" });
    return {
      lang: this.lang,
      status: "ok",
      time: { expr: tExpr, full: time, text: formatO(tExpr, order) },
      space: { expr: sExpr, full: space, text: formatO(sExpr, order) },
      variables,
      breakdown: items.sort((a, b) => a.loc.line - b.loc.line || (a.axis === b.axis ? 0 : a.axis === "time" ? -1 : 1)),
      warnings: this.warnings,
      confidence,
      entries,
      symbolOrder: order,
    };
  }
}

/** a[:3] / a[2:5] / a[-3:] のように長さが定数のスライスの長さ(分からなければ null) */
function constSliceLen(e: Extract<SExpr, { kind: "slice" }>): number | null {
  const num = (x: SExpr): number | null => (x.kind === "num" ? x.value : x.kind === "un" && x.op === "-" && x.e.kind === "num" ? -x.e.value : null);
  const from = e.from ? num(e.from) : 0;
  if (from === null) return null;
  if (!e.to) return from < 0 ? -from : null;
  const to = num(e.to);
  if (to === null || to < 0 || from < 0) return null;
  return Math.max(0, to - from);
}

/** 要素を足すメソッド(組み込みの表の grows に加えて見る) */
const PUSH_METHODS = new Set(["append", "push", "push_back", "emplace_back", "emplace", "push_front", "appendleft", "insert", "add", "offer", "unshift", "Add", "Enqueue", "Push", "addFirst", "addLast", "offerFirst", "offerLast", "incl", "push!", "pushfirst!"]);
/** 要素を1つ取り除くメソッド(s.pop() / q.popleft() / pq.poll())と関数(heappop(h) / pop @a / array_pop($a)) */
const POP_METHODS = new Set(["pop", "pop_back", "pop_front", "popleft", "popFirst", "popLast", "popFront", "popBack", "poll", "pollFirst", "pollLast", "removeFirst", "removeLast", "shift", "dequeue", "Dequeue", "Pop", "RemoveAt", "pop!", "popfirst!", "extract"]);
const POP_FUNCS = new Set(["heappop", "pop", "shift", "array_pop", "array_shift", "pop!", "popfirst!", "popFirst", "popLast"]);

/** 文が持つ式 */
function stmtExprs(n: IrNode): SExpr[] {
  if (n.kind === "expr") return [n.e];
  if (n.kind === "assign") return n.value ? [n.target, n.value] : [n.target];
  if (n.kind === "decl") return n.init ? [n.init] : [];
  if (n.kind === "return") return n.value ? [n.value] : [];
  return [];
}

/** この文(条件やループの中は見ない)で name から要素を取り除く回数 */
function popsIn(n: IrNode, name: string): number {
  const isName = (x: SExpr | undefined) => !!x && x.kind === "sym" && x.name === name;
  let c = 0;
  for (const e of stmtExprs(n)) {
    walk(e, (x) => {
      if (x.kind === "lambda") return false;
      if (x.kind === "member" && x.args !== null && POP_METHODS.has(x.name) && isName(x.of)) c++;
      // heapq.heappop(h) / table.remove(t)
      else if (x.kind === "member" && x.args !== null && (POP_FUNCS.has(x.name) || (x.name === "remove" && x.of.kind === "sym" && x.of.name === "table")) && isName(x.args[0])) c++;
      else if (x.kind === "call" && (POP_FUNCS.has(x.name) || (x.name === "remove" && x.ns === "table")) && isName(x.args[0])) c++;
    });
  }
  return c;
}

/** 条件が「name の大きさが E を超えた」(len(h) > k / pq.size() >= k / k < len(h))なら E */
function sizeLimit(cond: SExpr, name: string): SExpr | null {
  const isSize = (x: SExpr) => x.kind === "size" && x.of.kind === "sym" && x.of.name === name;
  if (cond.kind !== "cmp") return null;
  if ([">", ">=", "=="].includes(cond.op) && isSize(cond.l)) return cond.r;
  if (["<", "<=", "=="].includes(cond.op) && isSize(cond.r)) return cond.l;
  return null;
}

/** 空のコンテナの値(set() / [] / {} / new Set() / dict())か */
function isEmptyValue(e: SExpr | null): boolean {
  if (!e) return false;
  if (e.kind === "list") return e.items.length === 0;
  if (e.kind === "call") return e.args.length === 0 && ["set", "list", "dict", "deque", "Set", "Map", "Array", "defaultdict", "Counter", "frozenset", "vector", "HashSet", "HashMap"].includes(e.name);
  if (e.kind === "new") return e.args.length === 0 && e.dims.length === 0;
  if (e.kind === "member") return (e.name === "new" || e.name === "default") && (e.args?.length ?? 0) === 0;
  if (e.kind === "slice") return !!e.to && e.to.kind === "num" && e.to.value === 0 && !e.from;
  if (e.kind === "sym") return e.name === "nil";
  return false;
}

/** この文が name を空にするか(name.clear() / name = [] / name = set() / name.length = 0) */
function emptiesNode(n: IrNode, name: string): boolean {
  if (n.kind === "expr") {
    const e = n.e;
    return e.kind === "member" && ["clear", "Clear", "removeAll"].includes(e.name) && e.of.kind === "sym" && e.of.name === name && (e.args?.length ?? 0) === 0;
  }
  if (n.kind === "assign" && n.op === "=") {
    if (n.target.kind === "sym" && n.target.name === name) return isEmptyValue(n.value);
    // JS の a.length = 0
    if (n.target.kind === "member" && n.target.name === "length" && n.target.of.kind === "sym" && n.target.of.name === name && n.value?.kind === "num" && n.value.value === 0) return true;
  }
  return false;
}

/** ループの本体(入れ子を含む)で name に空でない値を入れ直すか */
function refills(nodes: readonly IrNode[], name: string): boolean {
  for (const n of nodes) {
    if (n.kind === "assign" && n.op === "=" && n.target.kind === "sym" && n.target.name === name && !isEmptyValue(n.value)) return true;
    if (n.kind === "decl" && n.name === name && n.dims.length > 0) return true;
    if (n.kind === "loop" && refills(n.body, name)) return true;
    if (n.kind === "branch" && n.branches.some((b) => refills(b, name))) return true;
  }
  return false;
}

/** b = a / b = sorted(a) / b = a[:] / b = a.copy() の写し元 */
function copySource(e: SExpr): string | null {
  if (e.kind === "sym") return e.name;
  // sort { … } @a / reverse @a のようにブロックが先に来る形もあるので、最後の名前の引数を写し元にする
  if (e.kind === "call" && ["sorted", "list", "reversed", "copy", "deepcopy", "tuple", "sort", "scan_words", "reverse", "grep", "uniq", "shuffle"].includes(e.name)) {
    const src = [...e.args].reverse().find((a) => a.kind === "sym");
    if (src && src.kind === "sym") return src.name;
  }
  if (e.kind === "member" && ["copy", "clone", "dup", "to_vec", "to_owned", "sorted", "reversed", "slice", "concat", "to_a", "sortedByIt", "sortedBy", "mapIt", "deduplicate", "toSeq", "map", "sort_by", "sort"].includes(e.name) && e.of.kind === "sym") return e.of.name;
  if (e.kind === "slice" && e.of.kind === "sym" && constSliceLen(e) === null) return e.of.name;
  return null;
}

function walkChildren(e: SExpr, f: (c: SExpr) => void): void {
  let first = true;
  walk(e, (x) => {
    if (first) {
      first = false;
      return true;
    }
    f(x);
    return false;
  });
}

/** IR の中の式を全部歩く */
function walkIr(nodes: readonly IrNode[], f: (e: SExpr) => void): void {
  const w = (e: SExpr | null) => walk(e, (x) => {
    f(x);
  });
  for (const n of nodes) {
    if (n.kind === "expr") w(n.e);
    else if (n.kind === "assign") {
      w(n.target);
      w(n.value);
    } else if (n.kind === "decl") w(n.init);
    else if (n.kind === "return") w(n.value);
    else if (n.kind === "branch") {
      n.conds.forEach(w);
      n.branches.forEach((b) => walkIr(b, f));
    } else if (n.kind === "loop") walkIr(n.body, f);
    else if (n.kind === "func") walkIr(n.body, f);
  }
}

export function analyze(prog: Program, spec: LangSpec): Analysis {
  return new Analyzer(prog, spec).run();
}

export const __internal = { countOf, constValue, singleSym };

/** r = max(r, l + 1) / r = min(r, x) のように自分を含む max / min で更新する(振り出しに戻さない) */
function monotoneUpdate(value: SExpr | null, name: string): boolean {
  if (!value || value.kind !== "call" || (value.name !== "max" && value.name !== "min")) return false;
  return value.args.some((a) => a.kind === "sym" && a.name === name);
}

/** convolution(a, b) / atcoder::convolution(a, b) の (a, b)(convolution<mod> の数の引数は除く)。違えば null */
function convolutionArgs(e: SExpr): SExpr[] | null {
  const names = ["convolution", "convolution_ll", "convolution_int"];
  if (e.kind === "call" && names.includes(e.name)) return e.args.filter((a) => a.kind !== "num");
  if (e.kind === "member" && e.args && e.of.kind === "sym" && e.of.name === "atcoder" && names.includes(e.name)) return e.args.filter((a) => a.kind !== "num");
  return null;
}
