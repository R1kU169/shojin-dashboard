// 単純な文 → IR。宣言(C 系の「型 名前」、let / var / my などの語)・入力の読み取り・
// 代入・式の文を見分けて IrNode にする。ブロックの入れ子は lower.ts が扱う。
import type { ContainerKind, FrontWarning, IrNode, Loc, LoopBound, SExpr, Tok } from "./ir.ts";
import { paramNames, parseStatement, parseTokens, splitTop } from "./sexpr.ts";
import type { Dialect } from "./sexpr.ts";
import { allocOf, evalConst, isCast, rangeOf, symbolsIn, targetNames, walk } from "./semantics.ts";
import type { Consts } from "./semantics.ts";
import { findTop, isOp, isWord, lastLine, matchClose, tokText } from "./spec.ts";
import type { LangSpec } from "./spec.ts";

export interface LowerCtx {
  spec: LangSpec;
  d: Dialect;
  consts: Consts;
  warn: (w: FrontWarning) => void;
  /** 入力から読んだ値を持つ変数(右辺にこれを含む代入の左辺も入力になる) */
  inputNames: Set<string>;
  /** トップレベル(グローバル)を読んでいるか */
  top: boolean;
  /** 今読んでいるクラスのフィールドの種類(コンストラクタの初期化子リスト用) */
  fields: Map<string, ContainerKind>;
}

/** 読み捨てる文の先頭の語 */
const SKIP_WORDS = new Set(["import", "using", "package", "use", "require", "require_relative", "include", "extern", "global", "nonlocal", "pass", "typedef", "library", "mod", "from", "export", "declare", "module", "open", "private", "public", "protected", "internal", "friend"]);
const JUMP_WORDS = new Set(["break", "continue", "next", "last", "redo", "goto", "throw", "raise", "exit", "die", "abort", "fallthrough", "panic"]);
const KEYWORDS = new Set(["return", "delete", "throw", "goto", "new", "case", "default", "break", "continue", "else", "do", "sizeof", "yield", "await", "echo", "print", "not", "and", "or", "in", "is", "typeof", "instanceof", "operator", "true", "false", "null", "nullptr", "this", "self", "super"]);
/** 宣言の前に付いてよい語(C 系) */
const DECL_MODS = new Set(["static", "const", "constexpr", "consteval", "constinit", "final", "public", "private", "protected", "volatile", "register", "extern", "inline", "mutable", "thread_local", "readonly", "unsigned", "signed", "struct", "class", "enum", "typename", "override", "virtual", "scope", "immutable", "shared", "__gshared", "internal", "sealed", "unsafe", "transient", "synchronized", "abstract", "fixed"]);
/** 1行の分割・数値変換として時間に数えない呼び出し(I1) */
export const READ_FUNCS = new Set(["split", "split_whitespace", "splitlines", "words", "lines", "map", "Select", "int", "float", "parse", "parseInt", "parseFloat", "Number", "BigInt", "to_i", "to_f", "list", "tuple", "collect", "ToArray", "ToList", "toList", "read", "readInt", "strip", "rstrip", "lstrip", "trim", "chomp", "chop", "unwrap", "expect", "trim_end", "Parse", "atoi", "stoi", "stoll", "intval", "explode", "preg_split", "str_split", "array_map", "fromJust", "chars", "bytes", "to_vec", "to_string", "String", "as_bytes", "Split", "Trim", "ReadLine", "readLine", "readline", "input", "next", "nextInt", "nextLong", "nextDouble", "nextLine", "Scan", "Scanln", "Fscan", "scanf", "fscanf", "fgets", "gets", "getline", "readln", "readf", "to", "text", "decode", "buffer", "stdin", "iter", "unpack", "filter", "join", "toInt", "match", "tonumber", "shift", "splice", "lower", "upper", "casefold", "swapcase"]);

export const loc = (toks: readonly Tok[], line?: number): Loc => ({ line: toks[0]?.line ?? line ?? 1, endLine: lastLine(toks, toks[0]?.line ?? line ?? 1) });

// ---------------------------------------------------------------------------
// 入力の読み取り(§5.6)

/**
 * 式が入力を読んでいるか。入力の印(input() / cin / STDIN …)を含むか、
 * 入力から読んだ変数をそのまま変換しただけ(int(line) / line.split() / v[0])なら true(I3 の1段伝播)。
 * 入力変数を使って表を作る・関数に渡す式(dp = [[0] * m for …] / [f(x) for x in a])は読み取りではない
 */
export function readsInput(e: SExpr | null, ctx: LowerCtx): boolean {
  let marker = false;
  let named = false;
  const m = ctx.spec.inputMarkers;
  walk(e, (x) => {
    if (marker) return false;
    if (x.kind === "sym" && m.has(x.name)) marker = true;
    else if (x.kind === "sym" && ctx.inputNames.has(x.name)) named = true;
    else if (x.kind === "call" && (m.has(x.name) || (x.ns !== null && m.has(`${x.ns}.${x.name}`)))) marker = true;
    else if (x.kind === "member" && (m.has(x.name) || (x.of.kind === "sym" && m.has(`${x.of.name}.${x.name}`)))) marker = true;
    return !marker;
  });
  return marker || (named && pureConversion(e));
}

const CONVERSION_KINDS = new Set<SExpr["kind"]>(["sym", "num", "str", "index", "list", "un", "slice", "comp"]);
/** map(f, …) / a.map(f) の f として許す変換(ユーザー定義の関数を渡すのは読み取りではない) */
const CONVERT_NAMES = new Set(["int", "float", "str", "Number", "BigInt", "String", "parseInt", "parseFloat", "to_i", "to_f", "to_s", "ord", "chr", "abs", "intval", "floatval", "strval", "trim", "tonumber", "parse", "Parse", "atoi", "stoi", "stoll", "list", "tuple", "Int", "Float64"]);
const HIGHER_ORDER = new Set(["map", "filter", "Select", "array_map", "mapIt"]);

/** 分割・数値変換・取り出しだけでできた式か */
function pureConversion(e: SExpr | null): boolean {
  let ok = true;
  walk(e, (x) => {
    if (!ok) return false;
    if (x.kind === "lambda") return false;
    if (x.kind === "call" || (x.kind === "member" && x.args !== null)) {
      ok = READ_FUNCS.has(x.name) || isCast(x.name);
      const args = x.kind === "call" ? x.args : (x.args ?? []);
      const fn = args[0];
      if (ok && HIGHER_ORDER.has(x.name) && fn && (fn.kind === "sym" || fn.kind === "str")) {
        const name = fn.kind === "sym" ? fn.name : fn.value;
        ok = CONVERT_NAMES.has(name) || READ_FUNCS.has(name) || isCast(name);
      }
    } else if (x.kind === "member") ok = /^\d+$/.test(x.name) || READ_FUNCS.has(x.name);
    else ok = CONVERSION_KINDS.has(x.kind);
    return ok;
  });
  return ok;
}

/** 行を語に分ける呼び出し(分けた元の変数は、できた配列の長さではなく中身) */
const SPLIT_FUNCS = new Set(["split", "split_whitespace", "splitWhitespace", "Split", "explode", "preg_split", "str_split", "words", "chars", "each_char", "lines", "Fields"]);

/** 読み取りの元になった入力の名前(split(line) / s.split() / explode(" ", $s) の line / s)。回数(range(n) の n)は含めない */
function sourceRefs(e: SExpr | null, ctx: LowerCtx): string[] {
  const out = new Set<string>();
  const add = (x: SExpr | undefined) => {
    if (x && x.kind === "sym" && ctx.inputNames.has(x.name)) out.add(x.name);
  };
  walk(e, (x) => {
    if (x.kind === "call" && SPLIT_FUNCS.has(x.name)) x.args.forEach(add);
    if (x.kind === "member" && SPLIT_FUNCS.has(x.name)) add(x.of);
  });
  return [...out];
}

/** 右辺が配列を作る形か(split / map / collect / ToArray …) */
function looksArray(e: SExpr): boolean {
  let arr = false;
  walk(e, (x) => {
    if (x.kind === "call" && ["split", "map", "list", "collect", "words", "lines", "explode", "preg_split", "str_split", "array_map", "readlines", "split_whitespace", "Split", "ToArray", "ToList", "tuple", "sorted", "readLines", "mapIt", "readarray", "read_all"].includes(x.name)) arr = true;
    if (x.kind === "member" && ["split", "map", "collect", "split_whitespace", "Split", "ToArray", "ToList", "readlines", "chars", "bytes", "to_vec", "each_char", "lines", "toList", "readLines", "mapIt", "splitWhitespace"].includes(x.name)) arr = true;
    if (x.kind === "comp") arr = true;
    return !arr;
  });
  return arr;
}

interface InputFound {
  scalars: string[];
  arrays: string[];
  lens: Record<string, SExpr>;
}

/** 文の式から入力の読み取りを拾う。無ければ null */
function inputOf(e: SExpr, ctx: LowerCtx): InputFound | null {
  const out: InputFound = { scalars: [], arrays: [], lens: {} };
  const addTarget = (t: SExpr, value: SExpr) => {
    if (t.kind === "list") {
      for (const it of t.items) {
        if (it.kind === "un" && it.op === "*") out.arrays.push(...targetNames(it.e));
        else if (it.kind === "sym") out.scalars.push(it.name);
      }
    } else if (t.kind === "sym") {
      if (t.sigil === "@" || looksArray(value)) out.arrays.push(t.name);
      else out.scalars.push(t.name);
    } else if (t.kind === "un" && t.op === "*") out.arrays.push(...targetNames(t.e));
  };
  walk(e, (x) => {
    // input = sys.stdin.readline は読み取りの関数に名前を付けるだけ(読み取りではない)
    if (x.kind === "assign" && x.target.kind === "sym" && ctx.spec.inputMarkers.has(x.target.name)) return false;
    // x = <入力> / (a, b) = <入力>
    if (x.kind === "assign" && x.value && x.op !== ":" && readsInput(x.value, ctx)) {
      addTarget(x.target, x.value);
      return false;
    }
    // cin >> a >> b
    if (x.kind === "bin" && x.op === ">>") {
      const ops: SExpr[] = [];
      let cur: SExpr = x;
      while (cur.kind === "bin" && cur.op === ">>") {
        ops.unshift(cur.r);
        cur = cur.l;
      }
      const src = cur.kind === "sym" ? cur.name : cur.kind === "member" ? cur.name : "";
      if (ctx.spec.inputMarkers.has(src)) {
        for (const o of ops) if (o.kind === "sym") out.scalars.push(o.name);
        return false;
      }
    }
    // scanf("%d", &n) / fmt.Scan(&n, &m) / fscanf(STDIN, "%d", $n) / readf(" %d", &n) / stdin().read_line(&mut s)
    if ((x.kind === "call" || x.kind === "member") && ["scanf", "Scan", "Scanln", "Fscan", "Fscanln", "readf", "fscanf", "Scanf", "Fscanf", "sscanf", "read_line", "read_to_string"].includes(x.name)) {
      const args = x.kind === "call" ? x.args : (x.args ?? []);
      for (const a of args) {
        const t = a.kind === "un" ? a.e : a;
        if (t.kind === "sym" && !ctx.spec.inputMarkers.has(t.name)) out.scalars.push(t.name);
      }
      return false;
    }
    // Rust の input! { n: usize, a: [i64; n] }
    if (x.kind === "call" && x.name === "input!") {
      for (const a of x.args) {
        if (a.kind !== "assign" || a.target.kind !== "sym") continue;
        const ty = a.value;
        if (ty && ty.kind === "call" && ty.name === "vec!" && ty.args.length === 2) {
          out.arrays.push(a.target.name);
          out.lens[a.target.name] = ty.args[1];
        } else if (ty && ty.kind === "sym" && (ty.name === "Chars" || ty.name === "Bytes" || ty.name === "String")) {
          out.arrays.push(a.target.name);
        } else out.scalars.push(a.target.name);
      }
      return false;
    }
    return true;
  });
  if (out.scalars.length === 0 && out.arrays.length === 0) return null;
  return out;
}

// ---------------------------------------------------------------------------
// 宣言

/** 型の並びを読み飛ばした位置。型として読めなければ -1 */
function skipType(toks: readonly Tok[], i: number, spec: LangSpec): number {
  const t = toks[i];
  if (!t || t.k !== "ident" || KEYWORDS.has(t.v) || spec.ifWords.has(t.v) || spec.loopWords.has(t.v)) return -1;
  i++;
  // std::vector / java.util.List / long long / unsigned int
  for (;;) {
    if ((isOp(toks[i], "::") || isOp(toks[i], ".")) && toks[i + 1]?.k === "ident") {
      i += 2;
      continue;
    }
    if (toks[i]?.k === "ident" && toks[i + 1]?.k === "ident" && ["long", "short", "int", "double", "char", "unsigned", "signed"].includes(toks[i - 1].v)) {
      i++;
      continue;
    }
    break;
  }
  // 型引数 <…>
  if (isOp(toks[i], "<")) {
    let depth = 0;
    for (; i < toks.length; i++) {
      const x = toks[i];
      if (isOp(x, "<")) depth++;
      else if (isOp(x, ">")) depth--;
      else if (isOp(x, ">>")) depth -= 2;
      else if (isOp(x, ">>>")) depth -= 3;
      else if (x.k === "op" && [";", "{", "="].includes(x.v)) return -1;
      if (depth <= 0) {
        i++;
        break;
      }
    }
    if (depth > 0) return -1;
  }
  // ポインタ・参照・配列 [] / [,]
  while (i < toks.length) {
    const x = toks[i];
    if (x.k === "op" && ["*", "&", "&&", "?"].includes(x.v)) i++;
    else if (isOp(x, "[") && (isOp(toks[i + 1], "]") || isOp(toks[i + 1], ","))) i = matchClose(toks, i) + 1;
    else break;
  }
  return i;
}

function containerFromType(typeName: string, spec: LangSpec, hasDims: boolean): ContainerKind {
  const k = spec.typeKind[typeName];
  if (k) return k;
  if (hasDims) return "array";
  return /^[A-Z]/.test(typeName) ? "user" : "scalar";
}

/** C 系の「型 名前 …」の宣言。宣言でなければ null */
function typedDecl(toks: readonly Tok[], ctx: LowerCtx): IrNode[] | null {
  const spec = ctx.spec;
  let i = 0;
  while (toks[i]?.k === "ident" && DECL_MODS.has(toks[i].v)) i++;
  // unsigned p = 0; / unsigned p{i - 1}; の unsigned / signed は修飾ではなく型そのもの
  if (i > 0 && (toks[i - 1].v === "unsigned" || toks[i - 1].v === "signed") && toks[i]?.k === "ident" && toks[i + 1]?.k === "op" && ["=", "{", "(", ";", ",", "["].includes(toks[i + 1].v)) i--;
  const typeStart = i;
  const after = skipType(toks, i, spec);
  if (after < 0) return null;
  // 構造化束縛 auto [a, b] = …
  if (isOp(toks[after], "[") && toks[typeStart].v === "auto") {
    const c = matchClose(toks, after);
    const names = toks.slice(after + 1, c).filter((x) => x.k === "ident").map((x) => x.v);
    const rest = toks.slice(c + 1);
    // auto [d, v] = pq.top() / const auto [d, v]{pq.top()} / auto [d, v](f())
    let e: SExpr | null = null;
    if (rest.length && isOp(rest[0], "=")) e = parseTokens(rest.slice(1), ctx.d);
    else if (rest.length && (isOp(rest[0], "{") || isOp(rest[0], "("))) {
      const close = matchClose(rest, 0);
      e = parseTokens(rest.slice(1, close < 0 ? rest.length : close), ctx.d);
    }
    return finishAssign({ kind: "assign", op: "=", target: { kind: "list", items: names.map((n) => ({ kind: "sym", name: n }) as SExpr) }, value: e }, toks, ctx);
  }
  const nameTok = toks[after];
  if (!nameTok || nameTok.k !== "ident" || KEYWORDS.has(nameTok.v)) return null;
  const next = toks[after + 1];
  if (next && !(next.k === "op" && ["=", "(", "[", "{", ";", ",", ":"].includes(next.v))) return null;
  // 型名(テンプレートの外側の名前と、中の要素の型)
  const typeToks = toks.slice(typeStart, after);
  const baseName = typeToks.filter((x) => x.k === "ident").map((x) => x.v).find((v) => spec.typeKind[v]) ?? typeToks.find((x) => x.k === "ident")?.v ?? "";
  const arrayType = typeToks.some((x) => isOp(x, "["));
  const out: IrNode[] = [];
  for (const part of splitTop(toks.slice(after), ",")) {
    const n = part[0];
    if (!n || n.k !== "ident") continue;
    let j = 1;
    const dims: SExpr[] = [];
    let init: SExpr | null = null;
    let ctorArgs: SExpr[] | null = null;
    while (isOp(part[j], "[")) {
      const c = matchClose(part, j);
      const inner = part.slice(j + 1, c < 0 ? part.length : c);
      if (inner.length) dims.push(parseTokens(inner, ctx.d));
      j = c < 0 ? part.length : c + 1;
    }
    if (isOp(part[j], "(")) {
      const c = matchClose(part, j);
      ctorArgs = splitTop(part.slice(j + 1, c < 0 ? part.length : c), ",").filter((x) => x.length).map((x) => parseTokens(x, ctx.d));
      j = c < 0 ? part.length : c + 1;
    } else if (isOp(part[j], "{")) {
      const c = matchClose(part, j);
      init = { kind: "list", items: splitTop(part.slice(j + 1, c < 0 ? part.length : c), ",").filter((x) => x.length).map((x) => parseTokens(x, ctx.d)) };
      j = c < 0 ? part.length : c + 1;
    }
    if (isOp(part[j], "=")) init = parseTokens(part.slice(j + 1), ctx.d);
    // 関数の宣言(プロトタイプ)int f(int x); は読み捨てる
    if (ctorArgs && ctorArgs.some((a) => a.kind === "unknown")) continue;
    let container = containerFromType(baseName, spec, dims.length > 0 || arrayType);
    let allDims = dims;
    let costsTime = false;
    if (ctorArgs && ctorArgs.length > 0 && (container === "array" || container === "string" || container === "acl" || container === "deque")) {
      // vector<T> a(n, x) → [n] + x の要素数
      const al = allocOf({ kind: "call", name: container === "string" ? "string" : "vector", ns: null, args: ctorArgs }, spec.typeKind);
      if (al) {
        allDims = al.dims;
        costsTime = true;
      }
    }
    if (init) {
      const al = allocOf(init, spec.typeKind);
      if (al) {
        if (al.dims.length) allDims = al.dims;
        if (container === "scalar" || container === "user" || container === "unknown") container = al.container;
        costsTime = al.costsTime;
      }
    }
    const isGlobal = ctx.top;
    // vector<ll> g[n] / set<int> s[n] は要素がコンテナの配列
    const baseKind = spec.typeKind[baseName];
    const elem = dims.length > 0 && baseKind && baseKind !== "scalar" && baseKind !== "unknown" && baseKind !== "user" ? baseKind : undefined;
    out.push({ kind: "decl", name: n.v, typeName: tokText(typeToks, 80), container, dims: allDims, init, isGlobal, costsTime: costsTime || (dims.length > 0 && init !== null), elem, loc: loc(toks) });
    if (init) out.push(...finishAssign({ kind: "assign", op: "=", target: { kind: "sym", name: n.v }, value: init }, toks, ctx, true));
    else if (ctorArgs && ctorArgs.length) {
      // コンストラクタ引数に呼び出しがあれば評価する(vector<int> b(a.begin(), a.end()) など)
      out.push({ kind: "expr", e: { kind: "list", items: ctorArgs }, loc: loc(toks), src: tokText(toks) });
    } else trackConst(n.v, null, ctx);
  }
  return out.length ? out : null;
}

/** let / const / var / my / local などの語で始まる宣言 */
function keywordDecl(toks: readonly Tok[], ctx: LowerCtx): IrNode[] {
  let i = 0;
  while (toks[i]?.k === "ident" && (ctx.spec.declWords.has(toks[i].v) || toks[i].v === "mut" || DECL_MODS.has(toks[i].v))) i++;
  const rest = toks.slice(i);
  // 型注釈 name: Type と Go の var a, b int / var a [100]int を剥がす
  const eq = findTop(rest, (x) => x.k === "op" && (x.v === "=" || x.v === ":="));
  const lhs = eq < 0 ? rest : rest.slice(0, eq);
  const rhs = eq < 0 ? [] : rest.slice(eq + 1);
  const names: Tok[] = [];
  const goArrayDims: SExpr[] = [];
  let pattern: Tok[] | null = null;
  if (lhs.length && (isOp(lhs[0], "[") || isOp(lhs[0], "(") || isOp(lhs[0], "{"))) pattern = lhs;
  else {
    for (const part of splitTop(lhs, ",")) {
      const colon = findTop(part, (x) => isOp(x, ":"));
      const nameTok = part[0];
      if (nameTok && nameTok.k === "ident") names.push(nameTok);
      // Go の配列型 [N]T / Rust・TS の型注釈の中の配列 [T; N]
      const typePart = colon >= 0 ? part.slice(colon + 1) : part.slice(1);
      // Nim の array[N, T] / array[0..N-1, T]
      if (isWord(typePart[0], "array") && isOp(typePart[1], "[")) {
        const c = matchClose(typePart, 1);
        const size = splitTop(typePart.slice(2, c < 0 ? typePart.length : c), ",")[0] ?? [];
        if (size.length) {
          const e = parseTokens(size, ctx.d);
          goArrayDims.push(e.kind === "range" ? e.to : e);
        }
      } else if (isOp(typePart[0], "[") && !isOp(typePart[1], "]")) {
        const c = matchClose(typePart, 0);
        const inner = typePart.slice(1, c);
        const semi = splitTop(inner, ";");
        const dimToks = semi.length === 2 ? semi[1] : inner;
        if (dimToks.length) goArrayDims.push(parseTokens(dimToks, ctx.d));
      }
    }
  }
  const target: SExpr = pattern ? parseTokens(pattern, ctx.d) : names.length === 1 ? { kind: "sym", name: names[0].v, sigil: names[0].sigil } : { kind: "list", items: names.map((n) => ({ kind: "sym", name: n.v, sigil: n.sigil }) as SExpr) };
  if (rhs.length === 0) {
    // 値の無い宣言(var a [100]int / let mut v; / my @a; / local t = nil)
    const out: IrNode[] = [];
    for (const n of names) {
      const kind: ContainerKind = n.sigil === "@" ? "array" : n.sigil === "%" ? "hmap" : goArrayDims.length ? "array" : "scalar";
      out.push({ kind: "decl", name: n.v, typeName: "", container: kind, dims: goArrayDims, init: null, isGlobal: ctx.top, costsTime: false, loc: loc(toks) });
      trackConst(n.v, null, ctx);
    }
    return out;
  }
  const value = parseStatement(rhs, ctx.d);
  return finishAssign({ kind: "assign", op: "=", target, value }, toks, ctx);
}

/** 定数の記録。定数式で代入されたら記録し、それ以外で代入されたら消す(後勝ち) */
function trackConst(name: string, value: SExpr | null, ctx: LowerCtx, line = 0): void {
  const v = value ? evalConst(value, ctx.consts) : null;
  if (v !== null && Number.isFinite(v)) ctx.consts[name] = { value: v, line };
  else delete ctx.consts[name];
}

/**
 * 代入を IR にする。入力の読み取り・ラムダの代入(関数として扱う)・確保(宣言として扱う)・
 * 定数の記録をまとめて行う。declared は typedDecl から来た(宣言は出力済み)か
 */
function finishAssign(e0: SExpr & { kind: "assign" }, toks: readonly Tok[], ctx: LowerCtx, declared = false): IrNode[] {
  // Go の x := … は宣言つきの代入。以降は = と同じに扱う
  const e: SExpr & { kind: "assign" } = e0.op === ":=" && e0.target.kind !== "index" ? { ...e0, op: "=" } : e0;
  const out: IrNode[] = [];
  const l = loc(toks);
  const src = tokText(toks);
  const value = e.value;
  // ラムダの代入は関数(F2)
  if (value && value.kind === "lambda" && e.target.kind === "sym") {
    out.push(lambdaFunc(e.target.name, value));
    return out;
  }
  const inp = inputOf(e, ctx);
  if (inp) {
    const refs = sourceRefs(value, ctx);
    out.push({ kind: "input", scalars: inp.scalars, arrays: inp.arrays, lens: inp.lens, loc: l, via: src, refs: refs.length ? refs : undefined });
    for (const n of [...inp.scalars, ...inp.arrays]) {
      ctx.inputNames.add(n);
      delete ctx.consts[n];
    }
  }
  // 入力で読んだ配列は input の側で領域を数える(長さは §5.4 の (d)(e) で決める)
  if (!declared && value && e.target.kind === "sym" && e.op === "=" && !(inp && inp.arrays.includes(e.target.name))) {
    const al = allocOf(value, ctx.spec.typeKind);
    if (al) {
      out.push({ kind: "decl", name: e.target.name, typeName: "", container: al.container, dims: al.dims, init: null, isGlobal: ctx.top, costsTime: al.costsTime, elem: al.elem, loc: l });
    } else if (e.target.sigil === "@" || e.target.sigil === "%") {
      out.push({ kind: "decl", name: e.target.name, typeName: "", container: e.target.sigil === "@" ? "array" : "hmap", dims: [], init: null, isGlobal: ctx.top, costsTime: false, loc: l });
    }
  }
  // a, b = [], [] のように並べて確保するなら、それぞれの宣言
  if (!declared && value && e.op === "=" && e.target.kind === "list" && value.kind === "list" && e.target.items.length === value.items.length) {
    e.target.items.forEach((t, i) => {
      const al = t.kind === "sym" ? allocOf((value as Extract<SExpr, { kind: "list" }>).items[i], ctx.spec.typeKind) : null;
      if (al && t.kind === "sym") out.push({ kind: "decl", name: t.name, typeName: "", container: al.container, dims: al.dims, init: null, isGlobal: ctx.top, costsTime: al.costsTime, elem: al.elem, loc: l });
    });
  }
  // 定数(入力で読んだものは定数にしない)
  for (const n of targetNames(e.target)) {
    if (inp && (inp.scalars.includes(n) || inp.arrays.includes(n))) continue;
    if (e.target.kind === "sym" && e.op === "=") trackConst(n, value, ctx, l.line);
    else if (e.target.kind === "sym" || e.target.kind === "list") delete ctx.consts[n];
  }
  // 読み取りの値を配列の要素やフィールドに入れる形($this->g[] = str_split(fgets(STDIN)))も読み取りの文
  out.push({ kind: "assign", target: e.target, op: e.op, value, loc: l, src, reading: !!inp || readsInput(value, ctx) || undefined });
  return out;
}

/** ラムダの式 → 関数(auto&& self や this auto&& self は自分自身を受け取る仮引数) */
export function lambdaFunc(name: string, lam: SExpr & { kind: "lambda" }): IrNode {
  // auto&& self / this auto self は仮引数の一覧から外れるので、本体で self(…) を呼んでいれば self を自分自身とみなす
  const selfParam = lam.params.length > 0 && (lam.params[0] === "self" || lam.params[0] === name) ? lam.params[0] : callsSelf(lam) ? "self" : null;
  const body: IrNode[] = lam.body.length ? lam.body : lam.expr ? [{ kind: "return", value: lam.expr, loc: lam.loc }] : [];
  return { kind: "func", name, params: selfParam && lam.params[0] === selfParam ? lam.params.slice(1) : lam.params, decorators: [], body, loc: lam.loc, isLambda: true, selfParam };
}

// ---------------------------------------------------------------------------
// 文

/** 値の終わりになれるトークン(文末の修飾 x if c の判定用) */
const valueEnd = (t: Tok | undefined) => !!t && (t.k === "ident" || t.k === "num" || t.k === "str" || (t.k === "op" && [")", "]", "}", "++", "--"].includes(t.v)));

export function lowerStmt(toks: readonly Tok[], ctx: LowerCtx): IrNode[] {
  if (toks.length === 0) return [];
  const spec = ctx.spec;
  const first = toks[0];
  const l = loc(toks);
  if (first.k === "pp") return [];
  if (first.k === "ident" && !first.sigil) {
    if (SKIP_WORDS.has(first.v) && !isOp(toks[1], "=") && !isOp(toks[1], "(") && !isOp(toks[1], ".")) return [];
    if (JUMP_WORDS.has(first.v) && !isOp(toks[1], "=") && !isOp(toks[1], ".") && !(spec.postfixModifiers && findTop(toks, (x, i) => i > 0 && (isWord(x, "if") || isWord(x, "unless"))) > 0)) {
      return [{ kind: "stmt", loc: l, jump: first.v }];
    }
  }
  // 文末の修飾: x += 1 if c / n /= 10 while n > 0 / print for @a
  if (spec.postfixModifiers) {
    const m = findTop(toks, (x, i) => i > 0 && x.k === "ident" && !x.sigil && ["if", "unless", "while", "until", "for", "foreach"].includes(x.v) && valueEnd(toks[i - 1]));
    if (m > 0) {
      const body = lowerStmt(toks.slice(0, m), ctx);
      const kw = toks[m].v;
      const cond = parseTokens(toks.slice(m + 1), ctx.d);
      if (kw === "if" || kw === "unless") return [{ kind: "branch", conds: [kw === "unless" ? { kind: "not", e: cond } : cond], branches: [body], loc: l }];
      if (kw === "while" || kw === "until") return [{ kind: "loop", bound: { form: "while", cond: kw === "until" ? { kind: "not", e: cond } : cond, doWhile: false }, body, hasBreak: false, loc: l, src: tokText(toks) }];
      return [{ kind: "loop", bound: { form: "for-in", var: "_", coll: cond }, body, hasBreak: false, loc: l, src: tokText(toks) }];
    }
  }
  if (first.k === "ident" && !first.sigil && (first.v === "return" || first.v === "yield")) {
    const value = toks.length > 1 ? parseStatement(toks.slice(1), ctx.d) : null;
    return [{ kind: "return", value, loc: l }];
  }
  // let (a, b) = … / my ($a, $b) = … の ( は分割代入の宣言(Go の var ( … ) はまとめた宣言なので除く)
  if (first.k === "ident" && !first.sigil && spec.declWords.has(first.v) && (!isOp(toks[1], "(") || spec.key !== "go") && !isOp(toks[1], ".")) {
    return keywordDecl(toks, ctx);
  }
  if (spec.typedDecls) {
    const d = typedDecl(toks, ctx);
    if (d) return d;
  }
  let use = toks;
  // 括弧なしの呼び出し文: puts x / echo x / dfs u / inc cnt
  if (spec.commandCalls && first.k === "ident" && !first.sigil && toks.length > 1 && !KEYWORDS.has(first.v)) {
    const t1 = toks[1];
    if (t1.sp && t1.line === first.line && (t1.k !== "op" || (["-", "[", "*", "@", "$", "\\", "!", "&", ":", "("].includes(t1.v) && !(t1.v === "(" && !t1.sp))) && !(t1.k === "op" && ["-", "*", "&"].includes(t1.v) && toks[2]?.sp) && !(t1.k === "ident" && (ctx.d.wordOps[t1.v] !== undefined || ["if", "unless", "while", "until", "and", "or", "in", "do", "then"].includes(t1.v)))) {
      const open: Tok = { ...first, k: "op", v: "(", sp: false, nl: false };
      const close: Tok = { ...toks[toks.length - 1], k: "op", v: ")", sp: false, nl: false };
      use = [first, open, ...toks.slice(1), close];
    }
  }
  const e = parseStatement(use, ctx.d);
  if (e.kind === "assign") return finishAssign(e, toks, ctx);
  // ラベルはブロックの手前まで(n.times { |i| … } → n.times)
  const brace = findTop(toks, (x, i) => i > 0 && isOp(x, "{"));
  const bl = blockLoop(e, l, tokText(brace > 0 ? toks.slice(0, brace) : toks, 50));
  if (bl) return [bl];
  const out: IrNode[] = [];
  const inp = inputOf(e, ctx);
  if (inp) {
    out.push({ kind: "input", scalars: inp.scalars, arrays: inp.arrays, lens: inp.lens, loc: l, via: tokText(toks) });
    for (const n of [...inp.scalars, ...inp.arrays]) {
      ctx.inputNames.add(n);
      delete ctx.consts[n];
    }
  }
  // 式の中の代入(chomp(my $n = <STDIN>) / while の外の x = y = 0)も定数の記録から外す
  walk(e, (x) => {
    if (x.kind === "assign") for (const n of targetNames(x.target)) delete ctx.consts[n];
  });
  if (e.kind === "unknown" && e.text === "") return out;
  // その場で呼ぶ再帰ラムダ [&](this auto self, int v) { … self(…) … }(0) は、名前の付いた関数とその呼び出しにする
  if (e.kind === "call" && e.name === "" && e.args[0]?.kind === "lambda" && callsSelf(e.args[0])) {
    const name = `lambda@${l.line}`;
    out.push(lambdaFunc(name, e.args[0]));
    out.push({ kind: "expr", e: { kind: "call", name, ns: null, args: e.args.slice(1) }, loc: l, src: tokText(toks) });
    return out;
  }
  out.push({ kind: "expr", e, loc: l, src: tokText(toks), reading: !!inp || readsInput(e, ctx) || undefined });
  return out;
}

/** 文として書いたブロック付きの反復は、そのままループとして読むメソッド */
const BLOCK_ITER = new Set(["each", "each_with_index", "each_char", "each_byte", "each_line", "each_key", "each_value", "each_pair", "each_slice", "each_cons", "each_entry", "each_index", "reverse_each", "map", "map!", "flat_map", "collect", "select", "select!", "filter", "filter!", "reject", "reject!", "filter_map", "sum", "count", "find", "detect", "any?", "all?", "none?", "one?", "min_by", "max_by", "sort_by", "sort_by!", "group_by", "partition", "each_with_object", "inject", "reduce", "tally_by", "find_index", "combination", "permutation", "repeated_permutation", "repeated_combination", "product", "forEach", "for_each", "each_char_with_index"]);
/** 反復の数が受け手と引数で決まるもの(a.combination(2) は |a|² 通り) */
const COUNTED_ITER = new Set(["combination", "permutation", "repeated_permutation", "repeated_combination", "product"]);

/**
 * n.times do |i| … end / a.each { |x| … } / 1.upto(n) { |i| … } / loop do … end / a.forEach(x => { … }) のように、
 * ブロック(コールバック)付きの反復を文として書いたものはループにする。ループにしておくと、
 * 隣接リストの走査や償却(尺取り)の規則がそのまま効く。値を使う形(b = a.map { … })は式のまま(コールバックとして数える)
 */
function blockLoop(e: SExpr, l: Loc, src: string): IrNode | null {
  let recv: SExpr | null = null;
  let name = "";
  let args: SExpr[] = [];
  if (e.kind === "member" && e.args && e.args.length > 0) {
    recv = e.of;
    name = e.name;
    args = e.args;
  } else if (e.kind === "call" && e.name === "loop" && e.args.length > 0) {
    name = "loop";
    args = e.args;
  } else return null;
  const lam = args[args.length - 1];
  if (lam.kind !== "lambda") return null;
  const rest = args.slice(0, -1);
  const v = lam.params[0] ?? null;
  let bound: LoopBound | null = null;
  if (!recv) bound = { form: "while", cond: null, doWhile: false };
  else if (name === "times") bound = { form: "for-range", var: v, from: null, to: recv, step: null, inclusive: false };
  else if (name === "upto" && rest[0]) bound = { form: "for-range", var: v, from: recv, to: rest[0], step: null, inclusive: true };
  else if (name === "downto" && rest[0]) bound = { form: "for-range", var: v, from: rest[0], to: recv, step: null, inclusive: true };
  else if (name === "step" && rest[0]) bound = { form: "for-range", var: v, from: recv, to: rest[0], step: rest[1] ?? null, inclusive: true };
  else if (BLOCK_ITER.has(name)) {
    const coll: SExpr = COUNTED_ITER.has(name) && rest.length ? { kind: "member", of: recv, name, args: rest } : recv;
    const r = rangeOf(coll);
    bound = r ? { form: "for-range", var: v, from: r.from, to: r.to, step: r.step, inclusive: r.inclusive } : { form: "for-in", var: v, coll };
  } else return null;
  const body: IrNode[] = lam.body.length ? lam.body : lam.expr ? [{ kind: "expr", e: lam.expr, loc: lam.loc, src: "" }] : [];
  return { kind: "loop", bound, body, hasBreak: false, loc: { line: l.line, endLine: Math.max(l.endLine, lam.loc.endLine) }, src };
}

/** 仮引数のトークンから名前を取る(Perl は本体の my ($a, $b) = @_ / shift から) */
export function paramsFrom(toks: readonly Tok[]): string[] {
  return paramNames(toks);
}

/** 式に含まれる名前(入力の伝播の判定に使う) */
export function namesIn(e: SExpr | null): Set<string> {
  return symbolsIn(e);
}

/** ラムダの本体が self(…) を呼ぶか(auto&& self / this auto self の再帰) */
function callsSelf(lam: SExpr & { kind: "lambda" }): boolean {
  let found = false;
  const visitExpr = (e: SExpr | null) =>
    walk(e, (x) => {
      if (x.kind === "call" && x.name === "self") found = true;
      return !found;
    });
  const visit = (nodes: readonly IrNode[]) => {
    for (const n of nodes) {
      if (found) return;
      if (n.kind === "expr") visitExpr(n.e);
      else if (n.kind === "assign") visitExpr(n.value);
      else if (n.kind === "return") visitExpr(n.value);
      else if (n.kind === "decl") visitExpr(n.init);
      else if (n.kind === "loop") visit(n.body);
      else if (n.kind === "branch") {
        n.conds.forEach(visitExpr);
        n.branches.forEach(visit);
      }
    }
  };
  visit(lam.body);
  visitExpr(lam.expr);
  return found;
}
