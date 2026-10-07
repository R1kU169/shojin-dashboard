// フロントエンドと解析コアの両方で使う、構文式(SExpr)の意味付けの小道具。
//  - evalConst: 定数式の評価(10**9+7 / 2e5+5 / 1<<20)
//  - allocOf: 確保の形(vector<int>(n) / [0]*n / vec![0; n] / make([]int, n) …)の要素数
//  - rangeOf: ループの範囲の形(range(n) / 0..n / 1:n / countup(a, b) …)
import type { ContainerKind, SExpr } from "./ir.ts";

export type Consts = Record<string, { value: number; line: number }>;

/** 定数式なら値。読めなければ null */
export function evalConst(e: SExpr, consts: Consts, depth = 0): number | null {
  if (depth > 16) return null;
  const ev = (x: SExpr) => evalConst(x, consts, depth + 1);
  switch (e.kind) {
    case "num":
      return e.value;
    case "sym":
      return consts[e.name]?.value ?? null;
    case "un": {
      const v = ev(e.e);
      if (v === null) return null;
      return e.op === "-" ? -v : v;
    }
    case "bin": {
      const a = ev(e.l);
      const b = ev(e.r);
      if (a === null || b === null) return null;
      switch (e.op) {
        case "+":
          return a + b;
        case "-":
          return a - b;
        case "*":
          return a * b;
        case "/":
        case "//":
          return b === 0 ? null : a / b;
        case "%":
          return b === 0 ? null : a % b;
        case "**":
          return Math.pow(a, b);
        case "<<":
          return a * Math.pow(2, b);
        case ">>":
          return Math.floor(a / Math.pow(2, b));
        default:
          return null;
      }
    }
    case "call": {
      // キャストと pow(a, b)
      if (e.args.length === 1 && CASTS.has(e.name)) return ev(e.args[0]);
      if (e.name === "pow" && e.args.length === 2) {
        const a = ev(e.args[0]);
        const b = ev(e.args[1]);
        return a === null || b === null ? null : Math.pow(a, b);
      }
      return null;
    }
    case "member":
      // Nim の 1e5.int / Rust の 10_i64 は値そのまま
      return e.args === null && CASTS.has(e.name) ? ev(e.of) : null;
    default:
      return null;
  }
}

const CASTS = new Set(["int", "ll", "long", "i64", "u64", "usize", "float", "double", "Int", "Int64", "Number", "BigInt", "intval", "to_i", "toInt", "lint", "ull", "uint"]);

/** 変換・キャストの呼び出しか(境界の評価で中身だけを見る) */
export const isCast = (name: string): boolean => CASTS.has(name) || name === "static_cast" || name === "parseInt" || name === "parse";

export interface AllocInfo {
  container: ContainerKind;
  /** 次元ごとの要素数。空なら大きさの分からない(成長させて使う)コンテナ */
  dims: SExpr[];
  /** 確保と同時に全要素を初期化する(要素数ぶんの時間がかかる) */
  costsTime: boolean;
  /** 要素もコンテナなら、その種類 */
  elem?: ContainerKind;
}

const size = (of: SExpr): SExpr => ({ kind: "size", of });

/** 要素数を表す式にする(range(n) → n、それ以外は |x|) */
export function countOf(e: SExpr): SExpr {
  const r = rangeOf(e);
  if (r) return r.to;
  if (e.kind === "list") return { kind: "num", value: e.items.length };
  return size(e);
}

/** 確保に使う名前 → コンテナの種類(言語共通の既定。言語の typeKind が優先) */
const CTOR_KIND: Record<string, ContainerKind> = {
  list: "array",
  Array: "array",
  Vec: "array",
  ArrayList: "array",
  vector: "array",
  bytearray: "array",
  deque: "deque",
  VecDeque: "deque",
  ArrayDeque: "deque",
  SplQueue: "deque",
  initDeque: "deque",
  dict: "hmap",
  defaultdict: "hmap",
  Counter: "hmap",
  OrderedDict: "hmap",
  HashMap: "hmap",
  Map: "hmap",
  Dict: "hmap",
  Hash: "hmap",
  initTable: "hmap",
  newTable: "hmap",
  initCountTable: "hmap",
  Dictionary: "hmap",
  HashSet: "hset",
  Set: "hset",
  initHashSet: "hset",
  frozenset: "hset",
  BTreeMap: "omap",
  TreeMap: "omap",
  SortedDictionary: "omap",
  BTreeSet: "oset",
  TreeSet: "oset",
  SortedSet: "oset",
  SortedList: "oset",
  BinaryHeap: "pq",
  PriorityQueue: "pq",
  SplPriorityQueue: "pq",
  SplMinHeap: "pq",
  SplMaxHeap: "pq",
  initHeapQueue: "pq",
  Stack: "stack",
  SplStack: "stack",
  StringBuilder: "string",
  LinkedList: "linkedlist",
};

function kindOf(name: string, typeKind: Readonly<Record<string, ContainerKind>>): ContainerKind | null {
  return typeKind[name] ?? CTOR_KIND[name] ?? null;
}

/** 要素を初期化して並べる形か(リテラル・None・入れ子の確保) */
function pureElem(e: SExpr, typeKind: Readonly<Record<string, ContainerKind>>): boolean {
  if (e.kind === "num" || e.kind === "str") return true;
  if (e.kind === "sym") return ["None", "nil", "null", "true", "false", "True", "False", "undefined", "INF", "inf", "Inf"].includes(e.name) || /^[A-Z_][A-Z0-9_]*$/.test(e.name);
  if (e.kind === "un") return pureElem(e.e, typeKind);
  if (e.kind === "list") return e.items.every((x) => pureElem(x, typeKind));
  return allocOf(e, typeKind) !== null;
}

/** 最後の文の式(Ruby のブロック { Array.new(m, 0) } の値など) */
function lambdaValue(e: SExpr): SExpr | null {
  if (e.kind !== "lambda") return null;
  if (e.expr) return e.expr;
  const last = e.body[e.body.length - 1];
  if (!last) return null;
  if (last.kind === "expr") return last.e;
  if (last.kind === "return") return last.value;
  return null;
}

/** 確保の式なら要素数と種類。それ以外は null */
export function allocOf(e: SExpr, typeKind: Readonly<Record<string, ContainerKind>>): AllocInfo | null {
  const nested = (x: SExpr | null): SExpr[] => {
    if (!x) return [];
    const a = allocOf(x, typeKind);
    return a ? a.dims : [];
  };
  switch (e.kind) {
    case "list": {
      if (e.brace) return { container: e.brace === "hash" ? "hmap" : "hset", dims: [], costsTime: false };
      // [[-1] * (n + 1), [0] * (n + 1)] のように確保を並べたなら、中の確保の大きさも数える
      const inner = e.items.length > 0 && e.items.every((x) => allocOf(x, typeKind)) ? allocOf(e.items[0], typeKind)! : null;
      return { container: "array", dims: e.items.length > 0 ? [{ kind: "num", value: e.items.length }, ...(inner ? inner.dims : [])] : [], costsTime: e.items.length > 0, elem: inner?.container };
    }
    case "bin": {
      // [0] * n(Python)/ (0) x $n(Perl。(0) は括弧を剥がすと数になる)/ "a" * n(Ruby の文字列)
      if ((e.op === "*" && (e.l.kind === "list" || e.l.kind === "str")) || e.op === "x") {
        const inner = e.l.kind === "list" && e.l.items.length === 1 ? nested(e.l.items[0]) : [];
        const elem = e.l.kind === "list" && e.l.items.length === 1 ? allocOf(e.l.items[0], typeKind)?.container : undefined;
        return { container: e.l.kind === "str" ? "string" : "array", dims: [e.r, ...inner], costsTime: true, elem };
      }
      return null;
    }
    case "comp": {
      // {k: v for …} / {x for …} は要素数ぶんのハッシュ・集合
      if (e.brace) return { container: e.brace === "hash" ? "hmap" : "hset", dims: [countOf(e.gens[0]?.iter ?? e.elem)], costsTime: true };
      if (!pureElem(e.elem, typeKind) || e.conds.length > 0) return null;
      return { container: "array", dims: [...e.gens.map((g) => countOf(g.iter)), ...nested(e.elem)], costsTime: true, elem: allocOf(e.elem, typeKind)?.container };
    }
    case "new": {
      const kind = kindOf(e.type, typeKind);
      if (e.dims.length > 0) return { container: "array", dims: e.dims, costsTime: true };
      if (e.type === "Array" || e.type === "Int32Array" || e.type === "Float64Array" || e.type === "BigInt64Array" || e.type === "Uint8Array" || e.type === "SplFixedArray") {
        return { container: "array", dims: e.args.length === 1 ? [e.args[0]] : [], costsTime: e.args.length === 1 };
      }
      if (e.type === "vector" && e.args.length >= 1) return { container: "array", dims: [e.args[0], ...nested(e.args[1] ?? null)], costsTime: true };
      if (kind) return { container: kind, dims: [], costsTime: false };
      return null;
    }
    case "call": {
      const n = e.name;
      const a = e.args;
      if (n === "vec!" && a.length === 2) return { container: "array", dims: [a[1], ...nested(a[0])], costsTime: true };
      if ((n === "vector" || n === "basic_string" || n === "string") && a.length >= 1) {
        return { container: n === "vector" ? "array" : "string", dims: [a[0], ...nested(a[1] ?? null)], costsTime: true };
      }
      if (n === "make" && a.length >= 2) return { container: "array", dims: [a[1]], costsTime: true };
      if (n === "make" && a.length === 1) return { container: a[0].kind === "list" ? "array" : "hmap", dims: [], costsTime: false };
      if (n === "Array" && a.length === 1) return { container: "array", dims: [a[0]], costsTime: true };
      if (n === "array_fill" && a.length === 3) return { container: "array", dims: [a[1], ...nested(a[2])], costsTime: true };
      if (n === "array_fill_keys" && a.length === 2) return { container: "hmap", dims: [countOf(a[0])], costsTime: true };
      if ((n === "str_repeat" || n === "repeat") && a.length === 2) return { container: "array", dims: [a[1]], costsTime: true };
      if (n === "rep" && e.ns === "string" && a.length >= 2) return { container: "string", dims: [a[1]], costsTime: true };
      if (n === "bytearray" && a.length === 1) return { container: "array", dims: [a[0]], costsTime: true };
      if ((n === "list" || n === "collect" || n === "toSeq" || n === "tuple") && a.length === 1) {
        const r = rangeOf(a[0]);
        return { container: "array", dims: [r ? r.to : size(a[0])], costsTime: true };
      }
      // Python の range は遅延(確保しない)。PHP の range(a, b) は配列を作る(言語の typeKind に range があるとき)
      if ((n === "range" || n === "iota") && a.length >= 1) return typeKind.range === "array" ? { container: "array", dims: [a[a.length >= 2 ? 1 : 0]], costsTime: true } : null;
      if ((n === "zeros" || n === "ones" || n === "trues" || n === "falses" || n === "fill" || n === "Vector" || n === "Matrix" || n === "Array" || n === "similar") && a.length >= 1) {
        // Julia: zeros(Int, n, m) / fill(x, n, m) / Vector{Int}(undef, n) / Array{Int}(undef, n, m)
        const sizes = a.filter((x, i) => !(n === "fill" && i === 0) && !(x.kind === "sym" && (/^[A-Z]/.test(x.name) || x.name === "undef")));
        if (sizes.length === 0) return null;
        return { container: "array", dims: sizes, costsTime: true };
      }
      if ((n === "newSeq" || n === "newSeqOfCap" || n === "newString" || n === "newSeqUninit") && a.length >= 1) {
        return { container: "array", dims: n === "newSeqOfCap" ? [] : [a[0]], costsTime: n !== "newSeqOfCap" };
      }
      if (n === "newSeqWith" && a.length === 2) return { container: "array", dims: [a[0], ...nested(a[1])], costsTime: true };
      if (n === "Repeat" && e.ns === "Enumerable" && a.length === 2) return { container: "array", dims: [a[1]], costsTime: true };
      const kind = kindOf(n, typeKind);
      // Python の ACL: FenwickTree(n) / DSU(n) / MFGraph(n) / SegTree(op, e, n か v) / LazySegTree(…, v) の大きさは最後の引数
      if (kind === "acl" && a.length >= 1) {
        const last = a[a.length - 1];
        // 数(n / q + 1)ならその値、配列(v / [x] * m)ならその要素数(boundOf は配列の変数を要素数にする)
        const dim = allocOf(last, typeKind)?.dims[0] ?? (last.kind === "lambda" ? null : last);
        return { container: "acl", dims: dim ? [dim] : [], costsTime: true };
      }
      // set(xs) / deque(xs) / Counter(xs) / frozenset(xs) は xs の要素数から始まる
      if (kind && ["hset", "hmap", "deque", "oset", "omap", "pq", "array"].includes(kind) && a.length === 1 && a[0].kind !== "num" && a[0].kind !== "lambda" && ["set", "frozenset", "deque", "Counter", "SortedList", "SortedSet", "heapify"].includes(n)) {
        return { container: kind, dims: [countOf(a[0])], costsTime: true };
      }
      if (kind && kind !== "scalar" && kind !== "user" && kind !== "unknown") return { container: kind, dims: [], costsTime: false };
      return null;
    }
    case "member": {
      const n = e.name;
      const a = e.args ?? [];
      // Array.new(n) / Array.new(n, x) / Array.new(n) { Array.new(m, 0) }(Ruby)
      if (e.of.kind === "sym" && e.of.name === "Array" && n === "new" && a.length >= 1 && a[0].kind !== "lambda") {
        const blockVal = a.find((x) => x.kind === "lambda");
        const second = a[1] && a[1].kind !== "lambda" ? a[1] : null;
        return { container: "array", dims: [a[0], ...nested(blockVal ? lambdaValue(blockVal) : second)], costsTime: true };
      }
      // Array.from({length: n}, () => …)(JS)
      if (e.of.kind === "sym" && e.of.name === "Array" && n === "from" && a.length >= 1) {
        const len = a[0].kind === "list" ? a[0].items.find((x) => x.kind === "assign" && x.target.kind === "sym" && x.target.name === "length") : null;
        const cnt = len && len.kind === "assign" && len.value ? len.value : countOf(a[0]);
        const f = a[1] && a[1].kind === "lambda" ? lambdaValue(a[1]) : null;
        return { container: "array", dims: [cnt, ...nested(f)], costsTime: true };
      }
      // Array(n).fill(0) / new Array(n).fill(0).map(() => Array(m).fill(0))
      if ((n === "fill" || n === "map") && a.length >= 1) {
        const base = allocOf(e.of, typeKind);
        if (base && base.dims.length > 0) {
          const f = n === "map" && a[0].kind === "lambda" ? lambdaValue(a[0]) : null;
          return { container: "array", dims: [...base.dims, ...nested(f)], costsTime: true };
        }
      }
      // (1..n).to_a / 0..<n.toSeq / a.to_a
      if ((n === "to_a" || n === "toSeq" || n === "collect" || n === "to_vec" || n === "ToArray" || n === "ToList" || n === "array") && a.length === 0) {
        const r = rangeOf(e.of);
        if (r) return { container: "array", dims: [r.to], costsTime: true };
      }
      // Vec::new() / HashMap::new() / Set.new / Hash.new(0) / new ArrayList<>()
      if ((n === "new" || n === "with_capacity" || n === "default") && e.of.kind === "sym") {
        const kind = kindOf(e.of.name, typeKind);
        if (kind) return { container: kind, dims: [], costsTime: false };
      }
      if (n === "rep" && e.of.kind === "sym" && e.of.name === "string" && a.length >= 2) return { container: "string", dims: [a[1]], costsTime: true };
      return null;
    }
    default:
      return null;
  }
}

/** ループの範囲の形なら from / to / step。to は上端(含むかどうかは計算量に効かないので問わない) */
export function rangeOf(e: SExpr): { from: SExpr | null; to: SExpr; step: SExpr | null; inclusive: boolean } | null {
  if (e.kind === "range") return e.to.kind === "unknown" ? null : { from: e.from, to: e.to, step: e.step, inclusive: e.inclusive };
  if (e.kind === "call") {
    const a = e.args;
    if ((e.name === "range" || e.name === "xrange" || e.name === "iota") && a.length >= 1 && a.length <= 3) {
      if (a.length === 1) return { from: null, to: a[0], step: null, inclusive: false };
      const step = a[2] ?? null;
      // range(n - 1, -1, -1) のような負の刻みは上端と下端を入れ替える
      if (step && ((step.kind === "un" && step.op === "-") || (step.kind === "num" && step.value < 0))) {
        const abs: SExpr = step.kind === "un" ? step.e : { kind: "num", value: -(step as { value: number }).value };
        return { from: a[1], to: a[0], step: abs, inclusive: true };
      }
      return { from: a[0], to: a[1], step, inclusive: e.name === "range" && e.ns !== null };
    }
    if (e.name === "countup" && a.length >= 2) return { from: a[0], to: a[1], step: a[2] ?? null, inclusive: true };
    if (e.name === "countdown" && a.length >= 2) return { from: a[1], to: a[0], step: a[2] ?? null, inclusive: true };
    if ((e.name === "reversed" || e.name === "reverse" || e.name === "rev" || e.name === "enumerate") && a.length === 1) return rangeOf(a[0]);
    if (e.name === "seq" && a.length >= 1) return a.length === 1 ? { from: null, to: a[0], step: null, inclusive: true } : { from: a[0], to: a[a.length - 1], step: a.length === 3 ? a[1] : null, inclusive: true };
    if (e.name === "eachindex" && a.length === 1) return { from: null, to: size(a[0]), step: null, inclusive: true };
    return null;
  }
  if (e.kind === "member") {
    if ((e.name === "rev" || e.name === "reverse" || e.name === "reversed" || e.name === "iter" || e.name === "into_iter" || e.name === "enumerate" || e.name === "each") && (e.args === null || e.args.length === 0)) {
      return rangeOf(e.of);
    }
    if (e.name === "step_by" || e.name === "step") {
      const r = rangeOf(e.of);
      return r ? { ...r, step: e.args?.[0] ?? null } : null;
    }
    if ((e.name === "upto" || e.name === "downto") && e.args && e.args.length === 1) {
      return e.name === "upto" ? { from: e.of, to: e.args[0], step: null, inclusive: true } : { from: e.args[0], to: e.of, step: null, inclusive: true };
    }
    if (e.name === "indices" && (e.args === null || e.args.length === 0)) return { from: null, to: size(e.of), step: null, inclusive: false };
    // views::iota(a, b) / ranges::iota(a, b)(C++20)
    if (e.name === "iota" && e.of.kind === "sym" && ["views", "ranges", "std"].includes(e.of.name) && e.args && e.args.length >= 1) {
      return e.args.length === 1 ? { from: e.args[0], to: { kind: "unknown", text: "∞" }, step: null, inclusive: false } : { from: e.args[0], to: e.args[1], step: null, inclusive: false };
    }
  }
  return null;
}

/** 前順で式を歩く。f が false を返したらその下は見ない */
export function walk(e: SExpr | null, f: (x: SExpr) => boolean | void): void {
  if (!e) return;
  if (f(e) === false) return;
  switch (e.kind) {
    case "size":
      walk(e.of, f);
      break;
    case "index":
      walk(e.of, f);
      e.idx.forEach((x) => walk(x, f));
      break;
    case "slice":
      walk(e.of, f);
      walk(e.from, f);
      walk(e.to, f);
      break;
    case "member":
      walk(e.of, f);
      e.args?.forEach((x) => walk(x, f));
      break;
    case "call":
      e.args.forEach((x) => walk(x, f));
      break;
    case "bin":
    case "cmp":
    case "logic":
      walk(e.l, f);
      walk(e.r, f);
      break;
    case "un":
    case "not":
      walk(e.e, f);
      break;
    case "assign":
      walk(e.target, f);
      walk(e.value, f);
      break;
    case "cond":
      walk(e.c, f);
      walk(e.a, f);
      walk(e.b, f);
      break;
    case "list":
      e.items.forEach((x) => walk(x, f));
      break;
    case "range":
      walk(e.from, f);
      walk(e.to, f);
      walk(e.step, f);
      break;
    case "comp":
      walk(e.elem, f);
      e.gens.forEach((g) => walk(g.iter, f));
      e.conds.forEach((x) => walk(x, f));
      break;
    case "lambda":
      walk(e.expr, f);
      break;
    case "new":
      e.dims.forEach((x) => walk(x, f));
      e.args.forEach((x) => walk(x, f));
      break;
    default:
      break;
  }
}

/** 式に出てくる名前(記号)の集合 */
export function symbolsIn(e: SExpr | null): Set<string> {
  const s = new Set<string>();
  walk(e, (x) => {
    if (x.kind === "sym") s.add(x.name);
  });
  return s;
}

/** 代入先の名前(a / a[i] / a.b → a、(a, b) → a と b) */
export function targetNames(e: SExpr): string[] {
  switch (e.kind) {
    case "sym":
      return [e.name];
    case "index":
    case "slice":
    case "member":
      return targetNames(e.of);
    case "list":
      return e.items.flatMap(targetNames);
    case "un":
      return targetNames(e.e);
    case "assign":
      return targetNames(e.target);
    default:
      return [];
  }
}
