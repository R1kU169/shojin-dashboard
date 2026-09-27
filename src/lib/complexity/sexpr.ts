// トークン列 → 構文式(SExpr)の Pratt パーサ。19言語の式の文法はほぼ共通なので1つで読み、
// 言語ごとの違い(^ が累乗か、.. が範囲か連結か、ラムダの書き方など)は Dialect の表で切り替える。
//
// 目的は計算量に効く形(呼び出し・サイズ・範囲・算術・比較・代入・内包表記・ラムダ・確保)を
// 取り出すことなので、型注釈やジェネリクスなど効かないものは読み飛ばす。
// 読めない字句は unknown にして必ず前に進む(例外は投げない。深すぎる入れ子も unknown)。
import type { IrNode, SExpr, Tok } from "./ir.ts";

export type LambdaStyle =
  | "arrow" // JS/TS/C#: (a, b) => …、x => …
  | "thinArrow" // Java/Julia: (a, b) -> …、x -> …
  | "cpp" // C++: [&](int x) { … }
  | "pipe" // Rust: |x| …
  | "function" // JS/PHP: function (x) { … }
  | "go" // Go: func(x int) int { … }
  | "phpFn" // PHP: fn($x) => …
  | "pylambda" // Python: lambda x: …
  | "sub" // Perl: sub { … }
  | "stabby"; // Ruby: ->(x) { … }

export interface Dialect {
  /** サイズを表すメンバ(a.size() / a.length / a.len / a.count / a.Count) */
  sizeMembers: ReadonlySet<string>;
  /** サイズを返す関数(len(a) / strlen(s) / count($a) / scalar(@a)) */
  sizeFuncs: ReadonlySet<string>;
  /** (int)x のようなキャストに使う型名。計算量には関係ないので剥がす */
  castWords: ReadonlySet<string>;
  /** 直後の <...> を型引数として読み飛ばす名前(vector<int> / static_cast<int>) */
  typeWords: ReadonlySet<string>;
  /** 大文字で始まる名前の直後の <...> も型引数とみなす(Java / C# / TS / Rust) */
  genericCaps: boolean;
  /** 語の演算子(and → &&、div → /、mod → %、shl → << など) */
  wordOps: Readonly<Record<string, string>>;
  /** ^ が累乗(Lua / Julia / Nim) */
  caretPow: boolean;
  /** 文字列の連結演算子(php/perl の .、lua の ..、d の ~) */
  concatOps: ReadonlySet<string>;
  /** -> がメンバ参照(C++ / PHP / Perl) */
  arrowMember: boolean;
  /** 範囲演算子 → 終端を含むか(rust の .. は含まない、..= は含む など) */
  ranges: Readonly<Record<string, boolean>>;
  /** Julia の 1:n */
  colonRange: boolean;
  /** Python の a if c else b */
  pyTernary: boolean;
  /** c ? a : b */
  cTernary: boolean;
  lambdas: ReadonlySet<LambdaStyle>;
  /** Rust の vec![…] / println!(…) */
  macroBang: boolean;
  /** D の to!int / to!(int[]) */
  dTemplate: boolean;
  /** Lua の obj:method(…) */
  colonMethod: boolean;
  /** 括弧なしで引数を取る語(Perl の push / Ruby の puts / Nim の echo) */
  listOps: ReadonlySet<string>;
  /** Ruby の a.map { |x| … } のように呼び出しの後ろに付くブロック */
  blockArgs: boolean;
  /** a.push x のような括弧なしのメソッド呼び出し(Ruby / Nim) */
  commandMembers: boolean;
  /** [x for x in a] の内包表記(Python / Julia) */
  comprehension: boolean;
  /** Python の a[1:] のようなスライス */
  pySlice: boolean;
  /** Julia の Vector{Int} のような波括弧の型引数 */
  curlyGenerics: boolean;
  /** Nim の newSeq[int](n) のような角括弧の型引数付き呼び出し */
  bracketGenerics: boolean;
  /** 式の中の { } はハッシュ・集合のリテラル(Python / Ruby / JS)。C 系の初期化子リストとは区別する */
  braceHash?: boolean;
  /** ラムダの本体(文の並び)をブロック木にする。フロントエンドが与える */
  parseBody?: (toks: Tok[]) => IrNode[];
}

export const EMPTY: ReadonlySet<string> = new Set();

/** C 系の既定値。各言語はこれを上書きする */
export const BASE_DIALECT: Dialect = {
  sizeMembers: new Set(["size", "length", "len", "Count", "Length"]),
  sizeFuncs: new Set(["len", "strlen", "size", "ssize", "sz"]),
  castWords: new Set(["int", "long", "ll", "short", "char", "double", "float", "unsigned", "signed", "size_t", "bool", "i64", "u64", "lint", "uint", "ull"]),
  typeWords: new Set(["static_cast", "dynamic_cast", "reinterpret_cast", "const_cast", "vector", "set", "map", "multiset", "multimap", "unordered_map", "unordered_set", "priority_queue", "queue", "deque", "stack", "pair", "tuple", "array", "bitset", "function", "greater", "less", "make_pair", "list", "basic_string", "segtree", "lazy_segtree", "fenwick_tree", "modint", "static_modint", "dynamic_modint"]),
  genericCaps: false,
  wordOps: {},
  caretPow: false,
  concatOps: EMPTY,
  arrowMember: false,
  ranges: {},
  colonRange: false,
  pyTernary: false,
  cTernary: true,
  lambdas: new Set(),
  macroBang: false,
  dTemplate: false,
  colonMethod: false,
  listOps: EMPTY,
  blockArgs: false,
  commandMembers: false,
  comprehension: false,
  pySlice: false,
  curlyGenerics: false,
  bracketGenerics: false,
};

const ASSIGN_OPS = new Set(["=", "+=", "-=", "*=", "/=", "%=", "//=", "**=", "<<=", ">>=", ">>>=", "&=", "|=", "^=", ":=", "||=", "&&=", ".=", "??=", "~="]);
const CMP_OPS = new Set(["==", "!=", "<", ">", "<=", ">=", "===", "!==", "<=>", "=~", "!~", "in", "notin", "is", "instanceof", "~="]);
const MAX_DEPTH = 200;
/** いま読んでいる式の入れ子の深さ。splitArgs が作る子の Parser とも共有する */
let depth = 0;

export const num = (value: number): SExpr => ({ kind: "num", value });
export const symE = (name: string): SExpr => ({ kind: "sym", name });
const unknown = (text: string): SExpr => ({ kind: "unknown", text });

/**
 * トークン列の括弧の対応表(開き括弧の位置 → 閉じ括弧の位置。対応しなければ -1)。
 * 括弧の種類を区別せずに深さを数え、深さが戻った位置の種類が合うときだけ対応とする。
 * 入れ子の引数を読むたびに閉じ括弧を探し直すと、深い入れ子で2乗の時間になるので、列ごとに1回だけ作る
 */
const MATCHES = new WeakMap<readonly Tok[], Int32Array>();
function matches(toks: readonly Tok[]): Int32Array {
  let m = MATCHES.get(toks);
  if (m) return m;
  m = new Int32Array(toks.length).fill(-1);
  const stack: number[] = [];
  for (let j = 0; j < toks.length; j++) {
    const x = toks[j];
    if (x.k !== "op") continue;
    if (x.v === "(" || x.v === "[" || x.v === "{") stack.push(j);
    else if (x.v === ")" || x.v === "]" || x.v === "}") {
      const o = stack.pop();
      if (o === undefined) continue;
      const open = toks[o].v;
      if ((open === "(" && x.v === ")") || (open === "[" && x.v === "]") || (open === "{" && x.v === "}")) m[o] = j;
    }
  }
  MATCHES.set(toks, m);
  return m;
}

/** 数値の文脈で @a をサイズにする(Perl) */
function numeric(e: SExpr): SExpr {
  return e.kind === "sym" && e.sigil === "@" ? { kind: "size", of: { kind: "sym", name: e.name } } : e;
}

class Parser {
  readonly t: readonly Tok[];
  readonly d: Dialect;
  readonly end: number;
  i: number;
  constructor(t: readonly Tok[], d: Dialect, start: number, end: number) {
    this.t = t;
    this.d = d;
    this.i = start;
    this.end = end;
  }

  peek(k = 0): Tok | undefined {
    const j = this.i + k;
    return j < this.end ? this.t[j] : undefined;
  }
  isOp(v: string, k = 0): boolean {
    const x = this.peek(k);
    return !!x && x.k === "op" && x.v === v;
  }
  isWord(v: string, k = 0): boolean {
    const x = this.peek(k);
    return !!x && x.k === "ident" && x.v === v;
  }
  eat(v: string): boolean {
    if (this.isOp(v)) {
      this.i++;
      return true;
    }
    return false;
  }
  done(): boolean {
    return this.i >= this.end;
  }

  /** from の位置の開き括弧に対応する閉じ括弧の位置(この Parser の範囲に無ければ -1) */
  close(from: number): number {
    const c = matches(this.t)[from];
    return c >= 0 && c < this.end ? c : -1;
  }

  /** 開き括弧の位置から対応する閉じ括弧の次へ進み、中身の範囲 [start, end) を返す */
  groupRange(): [number, number] {
    const c = this.close(this.i);
    const range: [number, number] = [this.i + 1, c < 0 ? this.end : c];
    this.i = c < 0 ? this.end : c + 1;
    return range;
  }

  /** 開き括弧の位置から対応する閉じ括弧の次へ進み、中身のトークンを返す */
  skipGroup(): Tok[] {
    const [a, b] = this.groupRange();
    return this.t.slice(a, b);
  }

  /** 括弧の中身をカンマで区切って読む(トークン列を切り出さずに範囲で読む) */
  groupArgs(): SExpr[] {
    const [a, b] = this.groupRange();
    return splitArgs(this.t, this.d, a, b);
  }

  /** 型引数 <...> を読み飛ばせるなら飛ばす */
  trySkipGenerics(): boolean {
    if (!this.isOp("<")) return false;
    let depth = 0;
    for (let j = this.i; j < this.end && j < this.i + 64; j++) {
      const x = this.t[j];
      if (x.k === "op") {
        if (x.v === "<") depth++;
        else if (x.v === ">") depth--;
        else if (x.v === ">>") depth -= 2;
        else if (x.v === ">>>") depth -= 3;
        else if ([";", "{", "}", "==", "&&", "||", "=", "+", "-", "!=", "<<"].includes(x.v)) return false;
        if (depth <= 0) {
          const after = this.t[j + 1];
          if (depth < 0 && !(x.v === ">>" || x.v === ">>>")) return false;
          if (!after || (after.k === "op" && ["(", "{", "::", ".", ")", ",", ">", ";", "[", "]", "}", "="].includes(after.v)) || after.k === "ident") {
            this.i = j + 1;
            return true;
          }
          return false;
        }
      }
    }
    return false;
  }

  // ---- 式 --------------------------------------------------------------------

  expr(minBp = 0): SExpr {
    if (this.done()) return unknown("");
    if (depth >= MAX_DEPTH) {
      this.i = this.end;
      return unknown("深すぎる入れ子");
    }
    depth++;
    try {
      let left = this.prefix();
      for (;;) {
        const t = this.peek();
        if (!t) break;
        const next = this.infix(left, minBp);
        if (!next) break;
        left = next;
      }
      return left;
    } finally {
      depth--;
    }
  }

  /** 中置・後置。適用できなければ null(呼び出し側がループを抜ける) */
  infix(left: SExpr, minBp: number): SExpr | null {
    const t = this.peek()!;
    const d = this.d;
    const word = t.k === "ident" && !t.sigil;
    const v = t.k === "op" ? t.v : word ? (d.wordOps[t.v] ?? t.v) : "";
    const isOpTok = t.k === "op" || (word && (t.v in d.wordOps || (t.v === "if" && d.pyTernary)));

    // 後置(結合力 30)
    if (minBp < 30) {
      if (t.k === "op" && t.v === "(") return this.callPostfix(left);
      if (t.k === "op" && t.v === "[" && !t.sp) return this.indexPostfix(left);
      // PHP / Perl の . は文字列の連結(二項演算子として後で読む)
      if (t.k === "op" && ((t.v === "." && !d.concatOps.has(".")) || t.v === "?." || t.v === "&." || (t.v === "->" && d.arrowMember) || t.v === "::")) {
        return this.memberPostfix(left);
      }
      if (t.k === "op" && t.v === ":" && d.colonMethod && this.peek(1)?.k === "ident" && (this.isOp("(", 2) || this.peek(2)?.k === "str")) {
        return this.memberPostfix(left);
      }
      if (t.k === "op" && t.v === "{" && !t.sp && left.kind === "sym" && left.sigil) return this.indexPostfix(left); // Perl の $h{key}
      if (t.k === "op" && (t.v === "++" || t.v === "--") && !t.nl) {
        this.i++;
        return { kind: "assign", op: t.v, target: left, value: null };
      }
      if (t.k === "op" && t.v === "!" && (d.macroBang || d.dTemplate) && !t.sp) {
        if (d.dTemplate) {
          this.i++;
          if (this.isOp("(")) this.skipGroup();
          else this.i++;
          return left;
        }
      }
      if (t.k === "op" && t.v === "?" && !d.cTernary) {
        this.i++; // Rust の ? 演算子
        return left;
      }
      if (t.k === "op" && t.v === "'" && !t.sp) {
        this.i++; // Julia の転置
        return left;
      }
      if (t.k === "ident" && t.v === "as" && !t.sigil && !(t.v in d.wordOps)) {
        this.i++;
        this.skipType();
        return left;
      }
      if (t.k === "op" && t.v === "<" && left.kind === "sym" && (d.typeWords.has(left.name) || (d.genericCaps && /^[A-Z]/.test(left.name)))) {
        if (this.trySkipGenerics()) return left;
      }
      if (t.k === "op" && t.v === "{" && d.curlyGenerics && !t.sp && left.kind === "sym") {
        this.skipGroup();
        return left;
      }
      if (t.k === "op" && t.v === "{" && d.blockArgs && isCallish(left)) return this.blockArg(left);
      if (d.commandMembers && left.kind === "member" && left.args === null && t.sp && !t.nl && startsOperand(t) && t.k !== "op") {
        const args = this.commaList(8);
        return { ...left, args };
      }
    }
    // ラムダ x => … / x -> …
    if (t.k === "op" && t.v === "=>" && d.lambdas.has("arrow") && left.kind === "sym") {
      this.i++;
      return this.lambdaBody([left.name]);
    }
    if (t.k === "op" && t.v === "->" && d.lambdas.has("thinArrow") && (left.kind === "sym" || left.kind === "list")) {
      this.i++;
      const params = left.kind === "sym" ? [left.name] : left.items.flatMap((x) => (x.kind === "sym" ? [x.name] : []));
      return this.lambdaBody(params);
    }
    // Python の not in / is not
    if (t.k === "ident" && t.v === "not" && this.isWord("in", 1) && minBp < 12) {
      this.i += 2;
      return { kind: "cmp", op: "notin", l: numeric(left), r: numeric(this.expr(12)) };
    }
    if (t.k === "ident" && t.v === "is" && this.isWord("not", 1) && minBp < 12) {
      this.i += 2;
      return { kind: "cmp", op: "!=", l: left, r: this.expr(12) };
    }
    if (!isOpTok) return null;

    if (ASSIGN_OPS.has(v) && minBp < 2) {
      this.i++;
      const value = this.expr(1);
      return { kind: "assign", op: v, target: left, value };
    }
    if (v === "?" && d.cTernary && minBp < 4) {
      this.i++;
      const a = this.expr(3);
      this.eat(":");
      const b = this.expr(3);
      return { kind: "cond", c: left, a, b };
    }
    if (v === "if" && d.pyTernary && minBp < 4) {
      this.i++;
      const c = this.expr(4);
      if (this.isWord("else")) this.i++;
      const b = this.expr(3);
      return { kind: "cond", c, a: left, b };
    }
    if ((v in d.ranges || (v === ":" && d.colonRange)) && minBp < 6) {
      this.i++;
      const inclusive = v === ":" ? true : d.ranges[v];
      if (this.done() || this.isOp(")") || this.isOp("]") || this.isOp(",")) {
        return { kind: "range", from: left, to: unknown("∞"), step: null, inclusive };
      }
      let to = this.expr(6);
      let step: SExpr | null = null;
      if (v === ":" && this.isOp(":")) {
        // Julia の a:s:b
        this.i++;
        step = to;
        to = this.expr(6);
      }
      return makeRange(numeric(left), numeric(to), step, inclusive);
    }
    const bp = binaryBp(v, d);
    if (bp === null || bp <= minBp) return null;
    this.i++;
    const right = this.expr(v === "**" || (v === "^" && d.caretPow) ? bp - 1 : bp);
    if (CMP_OPS.has(v)) return { kind: "cmp", op: v, l: numeric(left), r: numeric(right) };
    if (v === "&&" || v === "||") return { kind: "logic", op: v, l: left, r: right };
    return { kind: "bin", op: v === "^" && d.caretPow ? "**" : v, l: numeric(left), r: numeric(right) };
  }

  prefix(): SExpr {
    const t = this.peek()!;
    const d = this.d;
    if (t.k === "num") {
      this.i++;
      return num(t.num ?? 0);
    }
    if (t.k === "str") {
      this.i++;
      if (t.words !== undefined) return { kind: "list", items: Array.from({ length: t.words }, () => ({ kind: "str", value: "" }) as SExpr) };
      return { kind: "str", value: t.v };
    }
    if (t.k === "pp") {
      this.i++;
      return unknown(t.v);
    }
    if (t.k === "ident") return this.identPrefix(t);
    // 記号で始まるもの
    switch (t.v) {
      case "(":
        return this.parenPrefix();
      case "[":
        return this.bracketPrefix();
      case "{":
        return this.bracePrefix();
      case "-":
      case "+":
      case "~":
      case "!": {
        this.i++;
        const e = this.expr(26);
        if (t.v === "!") return { kind: "not", e };
        return t.v === "-" ? { kind: "un", op: "-", e } : e;
      }
      case "++":
      case "--": {
        this.i++;
        if (this.done()) return unknown(t.v);
        return { kind: "assign", op: t.v, target: this.expr(26), value: null };
      }
      case "#": {
        // Lua の #t
        this.i++;
        return { kind: "size", of: this.expr(26) };
      }
      case "*": {
        this.i++;
        return this.done() ? unknown("*") : { kind: "un", op: "*", e: this.expr(26) };
      }
      case "&":
      case "&&":
      case "...":
      case "\\":
      case "@":
      case "%":
      case "$": {
        this.i++;
        if ((t.v === "@" || t.v === "%" || t.v === "$") && this.isOp("{")) {
          const inner = this.skipGroup();
          const e = parseTokens(inner, d);
          return t.v === "@" ? (e.kind === "sym" ? { ...e, sigil: "@" } : e) : e;
        }
        if (t.v === "@" && this.peek()?.k === "ident") {
          // Julia のマクロ @inbounds などは読み飛ばす
          this.i++;
          return this.done() ? unknown("@") : this.expr(26);
        }
        if (t.v === "&" && this.isWord("mut")) this.i++;
        if (this.done()) return unknown(t.v);
        // JS の ...a(展開・残りの要素)は Python の *a と同じく配列の印を付ける
        if (t.v === "...") return { kind: "un", op: "*", e: this.expr(26) };
        return this.expr(26);
      }
      case "|":
      case "||":
        if (d.lambdas.has("pipe")) return this.pipeLambda();
        break;
      case "->":
        if (d.lambdas.has("stabby")) return this.stabbyLambda();
        break;
      case "::":
        this.i++;
        return this.done() ? unknown("::") : this.expr(29);
      case "..":
      case "..=":
        if (t.v in d.ranges) {
          this.i++;
          const to = this.done() || this.isOp(")") || this.isOp("]") ? unknown("∞") : this.expr(6);
          return makeRange(null, to, null, d.ranges[t.v]);
        }
        break;
    }
    this.i++;
    return unknown(t.v);
  }

  identPrefix(t: Tok): SExpr {
    const d = this.d;
    const name = t.v;
    if (t.sigil === "$#") {
      this.i++;
      return { kind: "size", of: symE(name) };
    }
    if (!t.sigil && name in d.wordOps && d.wordOps[name] === "!") {
      this.i++;
      return { kind: "not", e: this.expr(11) };
    }
    if (name === "new" && !t.sigil && (this.peek(1)?.k === "ident" || this.isOp("::", 1))) {
      this.i++;
      return this.newExpr();
    }
    if (name === "sizeof" && !t.sigil && !this.isOp("(", 1) && this.peek(1)?.k === "ident") {
      this.i++;
      return { kind: "size", of: this.expr(26) };
    }
    if (name === "lambda" && d.lambdas.has("pylambda")) {
      this.i++;
      const params: string[] = [];
      while (!this.done() && !this.isOp(":")) {
        const p = this.peek()!;
        if (p.k === "ident") params.push(p.v);
        this.i++;
      }
      this.eat(":");
      return { kind: "lambda", params, body: [], expr: this.expr(3), loc: { line: t.line, endLine: t.line } };
    }
    if ((name === "function" && d.lambdas.has("function")) || (name === "func" && d.lambdas.has("go")) || (name === "sub" && d.lambdas.has("sub"))) {
      if (this.isOp("(", 1) || this.isOp("{", 1) || (this.peek(1)?.k === "ident" && this.isOp("(", 2))) {
        this.i++;
        return this.funcLambda(t.line);
      }
    }
    if (name === "fn" && d.lambdas.has("phpFn") && this.isOp("(", 1)) {
      this.i++;
      const params = paramNames(this.skipGroup());
      this.skipReturnType();
      if (this.eat("=>")) return this.lambdaBody(params);
      return { kind: "lambda", params, body: [], expr: null, loc: { line: t.line, endLine: t.line } };
    }
    if (name === "async" && (this.isOp("(", 1) || this.peek(1)?.k === "ident")) {
      this.i++;
      return this.prefix();
    }
    this.i++;
    // Rust のマクロ vec![…] / println!(…)
    if (d.macroBang && this.isOp("!") && !this.peek()!.sp && (this.isOp("(", 1) || this.isOp("[", 1) || this.isOp("{", 1))) {
      this.i++;
      return this.macro(name);
    }
    // 括弧なしのリスト演算子(Perl の push @a, $x / keys %h、Ruby の puts x)
    if (d.listOps.has(name) && !t.sigil) {
      const n = this.peek();
      if (n && n.k === "op" && n.v === "{" && (name === "map" || name === "grep" || name === "sort" || name === "first" || name === "any" || name === "all")) {
        const body = this.skipGroup();
        const lam: SExpr = { kind: "lambda", params: ["_"], body: d.parseBody ? d.parseBody(body) : [], expr: null, loc: { line: t.line, endLine: t.line } };
        this.eat(",");
        const rest = this.done() ? [] : this.commaList(8);
        return { kind: "call", name, ns: null, args: [lam, ...rest] };
      }
      if (n && !(n.k === "op" && n.v === "(") && startsOperand(n) && !(n.k === "op" && ["-", "+", "*", "&", "<", "["].includes(n.v) && !n.sp)) {
        const args = this.commaList(8);
        if (d.sizeFuncs.has(name) && args.length === 1) return { kind: "size", of: args[0] };
        return { kind: "call", name, ns: null, args };
      }
    }
    return t.sigil ? { kind: "sym", name, sigil: t.sigil } : symE(name);
  }

  // ---- 後置 -------------------------------------------------------------------

  callPostfix(left: SExpr): SExpr {
    const args = this.groupArgs();
    let res: SExpr;
    if (left.kind === "index" && left.of.kind === "sym" && this.d.bracketGenerics) left = left.of;
    if (left.kind === "sym") {
      res = this.d.sizeFuncs.has(left.name) && args.length >= 1 && args.length <= 2 ? { kind: "size", of: args[0] } : { kind: "call", name: left.name, ns: null, args };
    } else if (left.kind === "member" && left.args === null) {
      res = this.d.sizeMembers.has(left.name) && args.length === 0 ? { kind: "size", of: left.of } : { ...left, args };
    } else {
      res = { kind: "call", name: "", ns: null, args: [left, ...args] };
    }
    if (this.d.blockArgs && this.isOp("{")) return this.blockArg(res);
    return res;
  }

  indexPostfix(left: SExpr): SExpr {
    const brace = this.isOp("{");
    const [a, b] = this.groupRange();
    // a[i] の中身(スライスの : を含まなければ範囲のまま読む)
    if (!brace && !(this.d.pySlice && this.hasTopColon(a, b))) {
      const idx = splitArgs(this.t, this.d, a, b);
      if (idx.length === 1 && idx[0].kind === "range") return { kind: "slice", of: left, from: idx[0].from, to: idx[0].to };
      return { kind: "index", of: stripSigil(left), idx };
    }
    const inner = this.t.slice(a, b);
    if (brace) {
      // Perl の $h{key}(裸の語はキー)
      const key = inner.length === 1 && inner[0].k === "ident" ? ({ kind: "str", value: inner[0].v } as SExpr) : parseTokens(inner, this.d);
      return { kind: "index", of: stripSigil(left), idx: [key] };
    }
    if (this.d.pySlice && inner.some((x) => x.k === "op" && (x.v === ":" || x.v === "::"))) {
      // a[::-1] の :: は字句では1つなので、2つの : に分けてから区切る
      const colons = inner.flatMap((x) => (x.k === "op" && x.v === "::" ? [{ ...x, v: ":" }, { ...x, v: ":" }] : [x]));
      const parts = splitTop(colons, ":");
      const from = parts[0]?.length ? parseTokens(parts[0], this.d) : null;
      const to = parts[1]?.length ? parseTokens(parts[1], this.d) : null;
      return { kind: "slice", of: left, from, to };
    }
    const idx = splitArgs(inner, this.d);
    if (idx.length === 1 && idx[0].kind === "range") return { kind: "slice", of: left, from: idx[0].from, to: idx[0].to };
    return { kind: "index", of: stripSigil(left), idx };
  }

  /** 範囲の最上位(括弧の外)に : / :: があるか */
  hasTopColon(a: number, b: number): boolean {
    const m = matches(this.t);
    for (let j = a; j < b; j++) {
      const x = this.t[j];
      if (x.k !== "op") continue;
      if (x.v === ":" || x.v === "::") return true;
      if ((x.v === "(" || x.v === "[" || x.v === "{") && m[j] > j) j = m[j];
    }
    return false;
  }

  memberPostfix(left: SExpr): SExpr {
    const op = this.peek()!.v;
    this.i++;
    // Rust のターボフィッシュ ::<T>
    if (op === "::" && this.isOp("<")) this.trySkipGenerics();
    const n = this.peek();
    if (!n) return left;
    if (n.k === "op" && (n.v === "[" || n.v === "{") && op === "->") return this.indexPostfix(left); // Perl の $r->[0]
    if (n.k === "op" && n.v === "(" && op === "->") return this.callPostfix(left); // Perl の $f->(x)
    if (n.k === "op" && n.v === "(" && op === ".") {
      // Julia の f.(x)(要素ごとの適用)は map とみなす
      const inner = this.skipGroup();
      return { kind: "call", name: "map", ns: null, args: [left, ...splitArgs(inner, this.d)] };
    }
    if (n.k !== "ident" && n.k !== "num") return left;
    this.i++;
    const name = n.v;
    if (this.isOp("<") && this.d.genericCaps) this.trySkipGenerics();
    if (this.isOp("(") && !this.peek()!.nl) {
      const args = splitArgs(this.skipGroup(), this.d);
      if (this.d.sizeMembers.has(name) && args.length === 0) return { kind: "size", of: left };
      const res: SExpr = { kind: "member", of: left, name, args };
      return this.d.blockArgs && this.isOp("{") ? this.blockArg(res) : res;
    }
    if (this.d.sizeMembers.has(name) && !(this.d.blockArgs && this.isOp("{"))) return { kind: "size", of: left };
    return { kind: "member", of: left, name, args: null };
  }

  /** Ruby の { |x| … } ブロックを最後の引数にする */
  blockArg(call: SExpr): SExpr {
    const line = this.peek()!.line;
    const inner = this.skipGroup();
    let params: string[] = [];
    let body = inner;
    if (inner[0]?.k === "op" && inner[0].v === "|") {
      const endBar = inner.findIndex((x, j) => j > 0 && x.k === "op" && x.v === "|");
      params = inner.slice(1, endBar < 0 ? 1 : endBar).flatMap((x) => (x.k === "ident" ? [x.v] : []));
      body = inner.slice(endBar < 0 ? 1 : endBar + 1);
    } else if (inner[0]?.k === "op" && inner[0].v === "||") {
      body = inner.slice(1);
    }
    const lam: SExpr = { kind: "lambda", params, body: this.d.parseBody ? this.d.parseBody(body) : [], expr: null, loc: { line, endLine: body[body.length - 1]?.line ?? line } };
    if (call.kind === "call") return { ...call, args: [...call.args, lam] };
    if (call.kind === "member") return { ...call, args: [...(call.args ?? []), lam] };
    if (call.kind === "size") return { kind: "member", of: call.of, name: "each", args: [lam] };
    return call;
  }

  // ---- 前置の複合形 -------------------------------------------------------------

  parenPrefix(): SExpr {
    const d = this.d;
    const start = this.i;
    const c = this.close(start);
    const after = c >= 0 ? this.t[c + 1] : undefined;
    // (a, b) => … / (a, b) -> …
    if (after && after.k === "op" && ((after.v === "=>" && d.lambdas.has("arrow")) || (after.v === "->" && d.lambdas.has("thinArrow")))) {
      const params = paramNames(this.t.slice(start + 1, c));
      this.i = c + 2;
      return this.lambdaBody(params);
    }
    const innerEnd = c < 0 ? this.end : c;
    // (int)x のようなキャスト
    if (c >= 0 && c - start - 1 > 0 && c - start - 1 <= 4) {
      const inner = this.t.slice(start + 1, c);
      if (inner.every((x) => x.k === "ident" || (x.k === "op" && (x.v === "*" || x.v === "&"))) && inner.some((x) => x.k === "ident" && d.castWords.has(x.v)) && after && startsOperand(after)) {
        this.i = c + 1;
        return this.expr(26);
      }
    }
    this.i = c < 0 ? this.end : c + 1;
    const items = splitArgs(this.t, d, start + 1, innerEnd);
    const last = innerEnd > start + 1 ? this.t[innerEnd - 1] : undefined;
    if (items.length === 1 && !(last && last.k === "op" && last.v === ",")) {
      return items[0];
    }
    return { kind: "list", items };
  }

  bracketPrefix(): SExpr {
    const d = this.d;
    const start = this.i;
    const c = this.close(start);
    // C++ のラムダ [&](…) { … }
    if (d.lambdas.has("cpp") && c >= 0) {
      const after = this.t[c + 1];
      if (after && after.k === "op" && (after.v === "(" || after.v === "{")) {
        this.i = c + 1;
        const params = this.isOp("(") ? paramNames(this.skipGroup()) : [];
        this.skipReturnType();
        return this.blockLambda(params);
      }
    }
    const innerEnd = c < 0 ? this.end : c;
    this.i = c < 0 ? this.end : c + 1;
    // Rust の [x; n](vec! と同じ形)
    if (d.macroBang) {
      const semi = splitTop(this.t.slice(start + 1, innerEnd), ";");
      if (semi.length === 2) return { kind: "call", name: "vec!", ns: null, args: [parseTokens(semi[0], d), parseTokens(semi[1], d)] };
    }
    const items = splitArgs(this.t, d, start + 1, innerEnd);
    // [x for x in a] は内包表記そのもの
    if (items.length === 1 && items[0].kind === "comp") return items[0];
    return { kind: "list", items };
  }

  bracePrefix(): SExpr {
    const items = this.groupArgs();
    if (!this.d.braceHash) {
      if (items.length === 1 && items[0].kind === "comp") return items[0];
      return { kind: "list", items };
    }
    // {k: v} / {} はハッシュ、{1, 2} は集合。内包表記も同じ({k: v for …} / {x for …})
    const isPair = (x: SExpr) => x.kind === "assign" && x.op === ":";
    if (items.length === 1 && items[0].kind === "comp") return { ...items[0], brace: isPair(items[0].elem) ? "hash" : "set" };
    return { kind: "list", items, brace: items.length === 0 || items.some(isPair) ? "hash" : "set" };
  }

  newExpr(): SExpr {
    let type = "";
    while (!this.done()) {
      const x = this.peek()!;
      if (x.k === "ident") {
        type = x.v;
        this.i++;
      } else if (x.k === "op" && (x.v === "::" || x.v === ".")) this.i++;
      else if (x.k === "op" && x.v === "<") {
        if (!this.trySkipGenerics()) break;
      } else break;
    }
    const dims: SExpr[] = [];
    let args: SExpr[] = [];
    let emptyBrackets = false;
    while (this.isOp("[")) {
      const inner = this.skipGroup();
      if (inner.length > 0) dims.push(...splitArgs(inner, this.d));
      else emptyBrackets = true;
    }
    if (this.isOp("(")) {
      const a = splitArgs(this.skipGroup(), this.d);
      // D の new int[](n) / new int[][](n, m) は括弧の中がサイズ
      if (dims.length === 0 && emptyBrackets) dims.push(...a);
      else args = a;
    }
    if (this.isOp("{")) {
      const items = splitArgs(this.skipGroup(), this.d);
      if (dims.length === 0) args = [{ kind: "list", items }];
    }
    return { kind: "new", type, dims, args };
  }

  macro(name: string): SExpr {
    const brace = this.isOp("{");
    const inner = this.skipGroup();
    const semi = splitTop(inner, ";");
    if (name === "vec" && semi.length === 2) {
      return { kind: "call", name: "vec!", ns: null, args: [parseTokens(semi[0], this.d), parseTokens(semi[1], this.d)] };
    }
    if (name === "vec") return { kind: "list", items: splitArgs(inner, this.d) };
    // input! { n: usize, a: [i64; n] } は名前: 型 の並び
    const args = splitArgs(inner, this.d);
    return { kind: "call", name: `${name}!`, ns: brace ? "{}" : null, args };
  }

  // ---- ラムダ -----------------------------------------------------------------

  lambdaBody(params: string[]): SExpr {
    const line = this.peek()?.line ?? 0;
    if (this.isOp("{")) return this.blockLambda(params);
    const e = this.expr(1);
    return { kind: "lambda", params, body: [], expr: e, loc: { line, endLine: line } };
  }

  blockLambda(params: string[]): SExpr {
    const line = this.peek()?.line ?? 0;
    if (!this.isOp("{")) return { kind: "lambda", params, body: [], expr: null, loc: { line, endLine: line } };
    const inner = this.skipGroup();
    const endLine = this.t[this.i - 1]?.line ?? line;
    return { kind: "lambda", params, body: this.d.parseBody ? this.d.parseBody(inner) : [], expr: null, loc: { line, endLine } };
  }

  funcLambda(line: number): SExpr {
    if (this.peek()?.k === "ident") this.i++; // function name(…) の名前
    const params = this.isOp("(") ? paramNames(this.skipGroup()) : [];
    // PHP の use (&$f)、Go の戻り値型
    if (this.isWord("use") && this.isOp("(", 1)) {
      this.i++;
      this.skipGroup();
    }
    this.skipReturnType();
    const lam = this.blockLambda(params);
    return lam.kind === "lambda" ? { ...lam, loc: { line, endLine: lam.loc.endLine } } : lam;
  }

  pipeLambda(): SExpr {
    const params: string[] = [];
    if (this.eat("||")) {
      // 引数なし
    } else {
      this.i++;
      while (!this.done() && !this.isOp("|")) {
        const x = this.peek()!;
        if (x.k === "ident" && !this.isOp(":", -1)) params.push(x.v);
        this.i++;
      }
      this.eat("|");
    }
    this.skipReturnType();
    return this.lambdaBody(params);
  }

  stabbyLambda(): SExpr {
    this.i++;
    const params = this.isOp("(") ? paramNames(this.skipGroup()) : [];
    if (this.isOp("{")) return this.blockLambda(params);
    return { kind: "lambda", params, body: [], expr: null, loc: { line: this.peek()?.line ?? 0, endLine: 0 } };
  }

  /** -> ret / : ret / mutable / noexcept などを { か => の手前まで読み飛ばす */
  skipReturnType(): void {
    let guard = 0;
    while (!this.done() && guard++ < 32) {
      const x = this.peek()!;
      if (x.k === "op" && (x.v === "{" || x.v === "=>" || x.v === ";" || x.v === "=")) return;
      if (x.k === "op" && x.v === "(") {
        this.skipGroup();
        continue;
      }
      if (x.k === "ident" || (x.k === "op" && ["->", ":", "<", ">", "::", "&", "*", "[", "]", ",", "?", "|", ">>"].includes(x.v))) {
        this.i++;
        continue;
      }
      return;
    }
  }

  /** as の後ろの型を読み飛ばす */
  skipType(): void {
    while (!this.done()) {
      const x = this.peek()!;
      if (x.k === "ident") this.i++;
      else if (x.k === "op" && (x.v === "::" || x.v === "&")) this.i++;
      else if (x.k === "op" && x.v === "<") {
        if (!this.trySkipGenerics()) return;
      } else if (x.k === "op" && x.v === "[") this.skipGroup();
      else return;
      if (this.peek()?.k === "ident" && !this.isOp("::", -1)) return;
    }
  }

  /** a, b, c を bp より強い式として読む(括弧なしの引数) */
  commaList(bp: number): SExpr[] {
    const out: SExpr[] = [];
    for (;;) {
      if (this.done()) break;
      const n = this.peek()!;
      if (n.k === "op" && [")", "]", "}", ";"].includes(n.v)) break;
      const before = this.i;
      out.push(this.expr(bp));
      if (this.i === before) this.i++;
      if (!this.eat(",")) break;
    }
    return out;
  }
}

function makeRange(from: SExpr | null, to: SExpr, step: SExpr | null, inclusive: boolean): SExpr {
  // 負の刻み(n:-1:1 / range(n, 0, -1) 相当)は from/to を入れ替えて正にする
  if (step && step.kind === "un" && step.op === "-" && from) return { kind: "range", from: to, to: from, step: step.e, inclusive };
  return { kind: "range", from, to, step, inclusive };
}

function stripSigil(e: SExpr): SExpr {
  return e.kind === "sym" && e.sigil ? { kind: "sym", name: e.name } : e;
}

function isCallish(e: SExpr): boolean {
  return e.kind === "call" || (e.kind === "member" && (e.args === null || Array.isArray(e.args))) || e.kind === "size";
}

/** 式を始められるトークンか(括弧なし引数の判定用) */
function startsOperand(t: Tok): boolean {
  if (t.k === "ident" || t.k === "num" || t.k === "str") return true;
  return t.k === "op" && ["(", "[", "-", "!", "\\", "@", "%", "$", "&", "*", "~", "{", "+", "::", "|"].includes(t.v);
}

function binaryBp(v: string, d: Dialect): number | null {
  if (v === "||" || v === "??") return 8;
  if (v === "&&") return 10;
  if (CMP_OPS.has(v)) return 12;
  if (v === "|") return 14;
  if (v === "^") return d.caretPow ? 28 : 16;
  if (v === "&") return 18;
  if (v === "<<" || v === ">>" || v === ">>>") return 20;
  if (v === "+" || v === "-" || d.concatOps.has(v)) return 22;
  if (v === "*" || v === "/" || v === "%" || v === "//" || v === "x" || v === "div" || v === "mod") return 24;
  if (v === "**") return 28;
  if (v === "|>") return 7;
  return null;
}

/** 仮引数リストのトークンから名前だけを取る(型・既定値・修飾子は捨てる) */
export function paramNames(toks: readonly Tok[]): string[] {
  const out: string[] = [];
  for (const part of splitTop(toks, ",")) {
    // 既定値 = … と型注釈 : … を落とす
    let seg = part;
    const eq = seg.findIndex((x) => x.k === "op" && x.v === "=");
    if (eq >= 0) seg = seg.slice(0, eq);
    const colon = seg.findIndex((x) => x.k === "op" && x.v === ":");
    if (colon > 0) seg = seg.slice(0, colon);
    const ids = seg.filter((x) => x.k === "ident" && !["const", "mut", "ref", "var", "let", "final", "auto", "in", "out", "this", "self"].includes(x.v));
    // C 系の「型 名前」は最後の識別子、Go の「名前 型」は最初の識別子
    if (ids.length === 0) continue;
    out.push(seg[0]?.sigil ? ids[0].v : ids[ids.length - 1].v);
  }
  return out;
}

/** トップレベルの区切り記号で分ける(括弧の中は分けない) */
export function splitTop(toks: readonly Tok[], sep: string): Tok[][] {
  const out: Tok[][] = [[]];
  let depth = 0;
  for (const x of toks) {
    if (x.k === "op") {
      if (x.v === "(" || x.v === "[" || x.v === "{") depth++;
      else if (x.v === ")" || x.v === "]" || x.v === "}") depth--;
      else if (x.v === sep && depth === 0) {
        out.push([]);
        continue;
      }
    }
    out[out.length - 1].push(x);
  }
  return out;
}

/** カンマ区切りの引数を読む。内包表記とキーワード引数・key: value も扱う。start / end で範囲を絞れる */
export function splitArgs(toks: readonly Tok[], d: Dialect, start = 0, end = toks.length): SExpr[] {
  if (end <= start) return [];
  const p = new Parser(toks, d, start, end);
  const out: SExpr[] = [];
  while (!p.done()) {
    const before = p.i;
    let e = p.expr(1.5);
    if (d.comprehension && p.isWord("for")) e = comprehension(p, e);
    if (p.isOp(":") && !d.colonRange) {
      // key: value(辞書・オブジェクト・名前付き引数・Rust の input! の 名前: 型)
      p.i++;
      const value = p.done() ? unknown("") : p.expr(1.5);
      e = { kind: "assign", op: ":", target: e, value };
      if (d.comprehension && p.isWord("for")) e = comprehension(p, e);
    } else if (p.isOp("=") && !p.done()) {
      p.i++;
      e = { kind: "assign", op: "=", target: e, value: p.expr(1) };
    } else if (p.isOp("=>")) {
      p.i++;
      e = { kind: "assign", op: ":", target: e, value: p.expr(1.5) };
    }
    out.push(e);
    if (p.i === before) p.i++;
    // 区切りまで読み飛ばす(読めなかった残り)
    while (!p.done() && !p.isOp(",")) p.i++;
    p.eat(",");
  }
  return out;
}

function comprehension(p: Parser, elem: SExpr): SExpr {
  const gens: { vars: string[]; iter: SExpr }[] = [];
  const conds: SExpr[] = [];
  while (!p.done()) {
    if (p.isWord("for")) {
      p.i++;
      const vars: string[] = [];
      while (!p.done() && !p.isWord("in") && !p.isOp("=") && !p.isOp("∈")) {
        const x = p.peek()!;
        if (x.k === "ident") vars.push(x.v);
        p.i++;
      }
      p.i++;
      gens.push({ vars, iter: p.expr(4) });
    } else if (p.isWord("if")) {
      p.i++;
      conds.push(p.expr(4));
    } else if (p.isOp(",") && p.isWord("for", 1) === false && gens.length > 0 && p.peek(1)?.k === "ident" && p.isWord("in", 2)) {
      // Julia の for i in 1:n, j in 1:m
      p.i++;
      const v = p.peek()!.v;
      p.i += 2;
      gens.push({ vars: [v], iter: p.expr(4) });
    } else break;
  }
  return { kind: "comp", elem, gens, conds };
}

/** トークン列全体を1つの式として読む */
export function parseTokens(toks: readonly Tok[], d: Dialect): SExpr {
  if (toks.length === 0) return unknown("");
  const p = new Parser(toks, d, 0, toks.length);
  const e = p.expr(0);
  if (d.comprehension && p.isWord("for")) return comprehension(p, e);
  return e;
}

/**
 * 文として読む。a, b = b, a % b のようなタプル代入も1つの assign にまとめる。
 * 複数の式が並んでいたら list にする。
 */
export function parseStatement(toks: readonly Tok[], d: Dialect): SExpr {
  if (toks.length === 0) return unknown("");
  const p = new Parser(toks, d, 0, toks.length);
  // 左辺は代入を飲み込まない強さで読む(a, b = … の = を2つ目の要素に取られない)
  const lhs: SExpr[] = [p.expr(2)];
  while (p.isOp(",") && !p.done()) {
    p.i++;
    if (p.done()) break;
    lhs.push(p.expr(2));
  }
  const t = p.peek();
  if (t && t.k === "op" && ASSIGN_OPS.has(t.v)) {
    p.i++;
    const rhs: SExpr[] = [p.expr(1)];
    while (p.isOp(",") && !p.done()) {
      p.i++;
      rhs.push(p.expr(1));
    }
    const target = lhs.length === 1 ? lhs[0] : { kind: "list" as const, items: lhs };
    const value = rhs.length === 1 ? rhs[0] : { kind: "list" as const, items: rhs };
    return { kind: "assign", op: t.v, target, value };
  }
  if (d.comprehension && p.isWord("for")) return comprehension(p, lhs[0]);
  return lhs.length === 1 ? lhs[0] : { kind: "list", items: lhs };
}

/** 内訳や警告に出す短い再表示 */
export function sexprText(e: SExpr | null, max = 40): string {
  const s = render(e);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function render(e: SExpr | null): string {
  if (!e) return "";
  switch (e.kind) {
    case "num":
      return String(e.value);
    case "str":
      return JSON.stringify(e.value);
    case "sym":
      return e.name;
    case "size":
      return `|${render(e.of)}|`;
    case "index":
      return `${render(e.of)}[${e.idx.map(render).join(", ")}]`;
    case "slice":
      return `${render(e.of)}[${render(e.from)}:${render(e.to)}]`;
    case "member":
      return `${render(e.of)}.${e.name}${e.args ? `(${e.args.map(render).join(", ")})` : ""}`;
    case "call":
      return `${e.ns ? `${e.ns}.` : ""}${e.name}(${e.args.map(render).join(", ")})`;
    case "bin":
    case "cmp":
    case "logic":
      return `${render(e.l)} ${e.op} ${render(e.r)}`;
    case "un":
      return `${e.op}${render(e.e)}`;
    case "not":
      return `!${render(e.e)}`;
    case "assign":
      return e.value ? `${render(e.target)} ${e.op} ${render(e.value)}` : `${render(e.target)}${e.op}`;
    case "cond":
      return `${render(e.c)} ? ${render(e.a)} : ${render(e.b)}`;
    case "list":
      return `[${e.items.map(render).join(", ")}]`;
    case "range":
      return `${render(e.from)}..${e.inclusive ? "=" : ""}${render(e.to)}`;
    case "comp":
      return `[${render(e.elem)} for …]`;
    case "lambda":
      return `(${e.params.join(", ")}) => …`;
    case "new":
      return `new ${e.type}${e.dims.map((x) => `[${render(x)}]`).join("")}`;
    case "unknown":
      return e.text;
  }
}
