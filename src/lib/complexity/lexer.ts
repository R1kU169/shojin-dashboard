// 全言語共通の字句解析。言語ごとの違いは LexRules の表と、どうしても表に
// 乗らない字句(ヒアドキュメント・Perl の q 演算子・Lua の長括弧など)だけを hook に寄せる。
//
// 解析の目的は「ループ・呼び出し・確保を見つけること」なので、文字列やコメントの
// 中身は読み飛ばせれば十分で、正確に値を復元する必要はない。代わりに
//  - コメントや文字列の中の for / { を絶対にコードと取り違えない
//  - 壊れた入力でも例外を投げず、最後まで進む
// の2点を優先する。性能のため src.slice(i) のような部分文字列の切り出しはしない
// (1万行のコードで固まる)。startsWith(s, i) と charCodeAt だけで進める。
import type { FrontWarning, Tok } from "./ir.ts";

export interface BlockComment {
  open: string;
  close: string;
  /** 入れ子を数える(Rust のブロックコメント、Haskell の {- -} など) */
  nested?: boolean;
  /** 行頭でだけ始まる(Ruby の =begin、Perl の POD) */
  lineStart?: boolean;
}

export interface LexRules {
  lineComments: readonly string[];
  blockComments: readonly BlockComment[];
  /** 文字列を始める引用符 */
  quotes: string;
  /** ' の扱い: c=1文字リテラル、rust=文字かライフタイム、julia=文字か転置、nim=文字か数値の接尾辞、none=普通の引用符 */
  charQuote: "c" | "rust" | "julia" | "nim" | "none";
  tripleQuotes: boolean;
  /** 識別子の直後に引用符が続いたら文字列の接頭辞とみなす(Python の f"" r"" b""、Nim の r"" fmt"") */
  stringPrefix: RegExp | null;
  /** エスケープを処理しない接頭辞 */
  rawPrefix: RegExp | null;
  /** C++ の R"delim(...)delim" */
  cppRaw: boolean;
  /** Rust の r#"..."# */
  rustRaw: boolean;
  /** JS のテンプレート文字列 `...${}...` */
  template: boolean;
  /** 二重引用符の中の式展開を読み飛ばす(ruby: #{}、julia: $()、php: {$}) */
  interp: "none" | "ruby" | "julia";
  /** C/C++ の # で始まる前処理行を1トークンにする */
  preprocessor: boolean;
  /** 数字の区切りに使える文字 */
  digitSep: string;
  /** 数値の直後の英字を接尾辞として数値に含める(1LL / 10usize)。Julia は 2n が 2*n なので false */
  numSuffix: boolean;
  /** 識別子に使える追加の文字(JS の $) */
  identExtra: string;
  /** 識別子の末尾にだけ付けられる文字(Ruby の empty? / sort!、Julia の push!) */
  identSuffix: string;
  unicodeIdent: boolean;
  /** 値(識別子・数値・閉じ括弧)の直後でないときの / を正規表現リテラルとみなす */
  regexLiteral: boolean;
  /** 値の直後でも正規表現を許す語(Perl の split /,/ など) */
  regexAfter: ReadonlySet<string>;
  /** 値とみなさない語(if や return の直後の / や ' を値の続きと取り違えない) */
  keywords: ReadonlySet<string>;
  /** 最長一致で試す記号 */
  ops: readonly string[];
  /** 言語固有の字句。何か読んだら true */
  hook?: (lx: Lexer) => boolean;
}

/** 字句の既定値。各言語はこれを上書きする */
export const BASE_RULES: LexRules = {
  lineComments: ["//"],
  blockComments: [{ open: "/*", close: "*/" }],
  quotes: '"',
  charQuote: "c",
  tripleQuotes: false,
  stringPrefix: null,
  rawPrefix: null,
  cppRaw: false,
  rustRaw: false,
  template: false,
  interp: "none",
  preprocessor: false,
  digitSep: "_",
  numSuffix: true,
  identExtra: "",
  identSuffix: "",
  unicodeIdent: false,
  regexLiteral: false,
  regexAfter: new Set(),
  keywords: new Set(),
  ops: [],
  hook: undefined,
};

/** どの言語でも使う記号。長いものから試す */
export const COMMON_OPS: readonly string[] = [
  ">>>=", "<<=", ">>=", "**=", "//=", "...", "..<", "..=", "..^", "<=>", "===", "!==", "??=", "?->",
  "->", "=>", "::", "..", "++", "--", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "&&", "||",
  "<<", ">>", "<=", ">=", "==", "!=", "**", ":=", "?.", "??",
];

const isDigit = (c: number) => c >= 48 && c <= 57;
const isAlpha = (c: number) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
const isSpace = (c: number) => c === 32 || c === 9 || c === 13 || c === 12 || c === 11;

export class Lexer {
  readonly src: string;
  readonly rules: LexRules;
  i = 0;
  line = 1;
  lineStart = 0;
  toks: Tok[] = [];
  warnings: FrontWarning[] = [];
  /** 直前にトークンの間の空白があったか */
  sp = true;
  /** この行でまだトークンを出していないか */
  atLineStart = true;
  private colCache = { pos: 0, col: 0 };
  private heredocs: { term: string; indent: boolean; line: number }[] = [];
  /** 先頭の文字 → その文字で始まる記号(長い順) */
  private ops = new Map<string, string[]>();

  constructor(src: string, rules: LexRules) {
    this.src = src;
    this.rules = rules;
    for (const o of [...new Set([...rules.ops, ...COMMON_OPS])].sort((a, b) => b.length - a.length)) {
      const list = this.ops.get(o[0]);
      if (list) list.push(o);
      else this.ops.set(o[0], [o]);
    }
  }

  // ---- 位置と出力 -----------------------------------------------------------

  code(k = 0): number {
    return this.src.charCodeAt(this.i + k);
  }
  ch(k = 0): string {
    return this.src.charAt(this.i + k);
  }
  startsWith(s: string, at = this.i): boolean {
    return this.src.startsWith(s, at);
  }

  /** 見た目の桁。タブは8桁ごと。同じ行の中では前回の位置から続けて数える */
  colAt(pos: number): number {
    let { pos: p, col } = this.colCache;
    if (p < this.lineStart || p > pos) {
      p = this.lineStart;
      col = 0;
    }
    for (; p < pos; p++) col = this.src.charCodeAt(p) === 9 ? (Math.floor(col / 8) + 1) * 8 : col + 1;
    this.colCache = { pos, col };
    return col;
  }

  push(k: Tok["k"], v: string, start: number, extra?: Partial<Tok>): Tok {
    const t: Tok = { k, v, line: this.line, col: this.colAt(start), sp: this.sp, nl: this.atLineStart, ...extra };
    this.toks.push(t);
    this.sp = false;
    this.atLineStart = false;
    return t;
  }

  /** i を end まで進める。途中の改行で行番号を更新する */
  advanceTo(end: number): void {
    for (let p = this.i; p < end; p++) {
      if (this.src.charCodeAt(p) === 10) {
        this.line++;
        this.lineStart = p + 1;
      }
    }
    this.i = end;
  }

  warn(code: FrontWarning["code"], message: string, line = this.line): void {
    if (this.warnings.length < 200) this.warnings.push({ line, code, message });
  }

  prev(): Tok | null {
    return this.toks.length ? this.toks[this.toks.length - 1] : null;
  }

  /** 直前のトークンが「値」(その後ろの / は割り算、' は転置)か */
  prevIsValue(): boolean {
    const p = this.prev();
    if (!p) return false;
    if (p.k === "num" || p.k === "str") return true;
    if (p.k === "ident") return !this.rules.keywords.has(p.v);
    return p.k === "op" && (p.v === ")" || p.v === "]" || p.v === "}");
  }

  /** 次の改行で読み飛ばすヒアドキュメントを登録する */
  addHeredoc(term: string, indent: boolean): void {
    this.heredocs.push({ term, indent, line: this.line });
  }

  // ---- 読み取りの部品(hook からも使う) -------------------------------------

  /** 引用符 q で閉じる文字列の終わり(閉じ引用符の次)を返す */
  scanQuoted(start: number, q: string, raw: boolean, multiline: boolean): number {
    const src = this.src;
    let p = start;
    let braceDepth = 0;
    while (p < src.length) {
      const c = src[p];
      if (c === "\\" && !raw) {
        p += 2;
        continue;
      }
      if (c === "\n" && !multiline && braceDepth === 0) {
        this.warn("unterminated", "文字列が閉じていません");
        return p;
      }
      // 式展開 #{ } / $( ) / ${ } の中の引用符で文字列を閉じない
      if (braceDepth === 0 && !raw && q !== "'") {
        const it = this.rules.interp;
        if ((it === "ruby" && c === "#" && src[p + 1] === "{") || (q === "`" && c === "$" && src[p + 1] === "{")) {
          p = this.skipBalanced(p + 1, "{", "}");
          continue;
        }
        if (it === "julia" && c === "$" && src[p + 1] === "(") {
          p = this.skipBalanced(p + 1, "(", ")");
          continue;
        }
      }
      if (src.startsWith(q, p)) return p + q.length;
      p++;
    }
    this.warn("unterminated", "文字列が閉じていません");
    return src.length;
  }

  /** open の位置から対応する close の次までを読み飛ばす(中の文字列も考慮) */
  skipBalanced(p: number, open: string, close: string): number {
    const src = this.src;
    let depth = 0;
    while (p < src.length) {
      const c = src[p];
      if (c === open) depth++;
      else if (c === close) {
        depth--;
        if (depth === 0) return p + 1;
      } else if (c === '"' || c === "'" || c === "`") {
        p = this.scanQuoted(p + 1, c, false, true);
        continue;
      } else if (c === "\\") p++;
      p++;
    }
    return src.length;
  }

  private skipBlockComment(bc: BlockComment): void {
    const src = this.src;
    let p = this.i + bc.open.length;
    let depth = 1;
    while (p < src.length) {
      if (bc.nested && src.startsWith(bc.open, p)) {
        depth++;
        p += bc.open.length;
      } else if (src.startsWith(bc.close, p) && (!bc.lineStart || p === 0 || src[p - 1] === "\n")) {
        depth--;
        p += bc.close.length;
        if (depth === 0) break;
      } else p++;
    }
    if (depth > 0) this.warn("unterminated", "コメントが閉じていません");
    // =begin ... =end は =end の行末まで
    if (bc.lineStart) while (p < src.length && src[p] !== "\n") p++;
    this.advanceTo(p);
    this.sp = true;
  }

  private skipHeredocBodies(): void {
    const src = this.src;
    for (const h of this.heredocs) {
      let p = this.i;
      let found = false;
      while (p < src.length) {
        let e = src.indexOf("\n", p);
        if (e < 0) e = src.length;
        const lineText = src.slice(p, e).replace(/\r$/, "");
        const body = h.indent ? lineText.trim() : lineText;
        p = e + 1;
        if (body === h.term || body === `${h.term};` || body === `${h.term},` || body === `${h.term})`) {
          found = true;
          break;
        }
      }
      if (!found) this.warn("unterminated", `ヒアドキュメント ${h.term} が閉じていません`, h.line);
      this.advanceTo(Math.min(p, src.length));
    }
    this.heredocs = [];
  }

  private scanNumber(): void {
    const src = this.src;
    const start = this.i;
    let p = start;
    const seps = this.rules.digitSep;
    const isSep = (c: string) => seps.includes(c) && isDigit(src.charCodeAt(p + 1) || 0);
    if (src[p] === "0" && /[xXbBoO]/.test(src[p + 1] ?? "") && /[0-9a-fA-F]/.test(src[p + 2] ?? "")) {
      p += 2;
      while (p < src.length && (/[0-9a-fA-F]/.test(src[p]) || (seps.includes(src[p]) && /[0-9a-fA-F]/.test(src[p + 1] ?? "")))) p++;
    } else {
      while (p < src.length && (isDigit(src.charCodeAt(p)) || isSep(src[p]))) p++;
      // 小数点は直後が数字のときだけ(1..n / 0..<n / [1..n] を壊さない)
      if (src[p] === "." && isDigit(src.charCodeAt(p + 1) || 0)) {
        p++;
        while (p < src.length && (isDigit(src.charCodeAt(p)) || isSep(src[p]))) p++;
      }
      if ((src[p] === "e" || src[p] === "E") && (isDigit(src.charCodeAt(p + 1) || 0) || (/[+-]/.test(src[p + 1] ?? "") && isDigit(src.charCodeAt(p + 2) || 0)))) {
        p += 2;
        while (p < src.length && isDigit(src.charCodeAt(p))) p++;
      }
    }
    const text = src.slice(start, p);
    // 接尾辞(1LL / 10usize / 1'i32)は値に関係しないので読み捨てる
    if (this.rules.numSuffix) while (p < src.length && (isAlpha(src.charCodeAt(p)) || isDigit(src.charCodeAt(p)))) p++;
    if (this.rules.charQuote === "nim" && src[p] === "'" && /[a-zA-Z]/.test(src[p + 1] ?? "")) {
      p++;
      while (p < src.length && /[a-zA-Z0-9]/.test(src[p])) p++;
    }
    const clean = text.replace(new RegExp(`[${seps.replace(/[\]\\^-]/g, "\\$&")}]`, "g"), "");
    const value = /^0[xXbBoO]/.test(clean) ? Number(clean.toLowerCase().replace(/^0o/, "0o")) : Number(clean);
    this.push("num", text, start, { num: Number.isFinite(value) ? value : 0 });
    this.i = p;
  }

  private scanIdent(): string {
    const src = this.src;
    const start = this.i;
    let p = start;
    const extra = this.rules.identExtra;
    while (p < src.length) {
      const c = src.charCodeAt(p);
      if (isAlpha(c) || isDigit(c) || extra.includes(src[p]) || (this.rules.unicodeIdent && c > 127 && /[\p{L}\p{N}_]/u.test(src[p]))) p++;
      else break;
    }
    const suf = this.rules.identSuffix;
    if (suf.includes(src[p] ?? "\0") && src[p + 1] !== "=" && !(src[p] === "?" && src[p + 1] === ":")) p++;
    this.i = p;
    return src.slice(start, p);
  }

  private isIdentStart(c: number, s: string): boolean {
    return isAlpha(c) || this.rules.identExtra.includes(s) || (this.rules.unicodeIdent && c > 127 && /\p{L}/u.test(s));
  }

  // ---- 本体 -----------------------------------------------------------------

  run(): { tokens: Tok[]; warnings: FrontWarning[] } {
    const src = this.src;
    const r = this.rules;
    while (this.i < src.length) {
      const c = this.code();
      const s = this.ch();
      if (c === 10) {
        this.i++;
        this.line++;
        this.lineStart = this.i;
        this.atLineStart = true;
        this.sp = true;
        if (this.heredocs.length) this.skipHeredocBodies();
        continue;
      }
      if (isSpace(c)) {
        this.i++;
        this.sp = true;
        continue;
      }
      // 行継続の \ は空白と同じ(Python・C のマクロ・シェル)
      if (s === "\\" && (this.ch(1) === "\n" || (this.ch(1) === "\r" && this.ch(2) === "\n"))) {
        this.advanceTo(this.i + (this.ch(1) === "\r" ? 3 : 2));
        this.sp = true;
        continue;
      }
      if (r.hook && r.hook(this)) continue;
      if (r.preprocessor && s === "#" && this.atLineStart) {
        const start = this.i;
        let p = this.i;
        while (p < src.length && src[p] !== "\n") {
          if (src[p] === "\\" && src[p + 1] === "\n") p++;
          p++;
        }
        const text = src.slice(start, p).replace(/\\\n/g, " ");
        this.push("pp", text, start);
        this.advanceTo(p);
        continue;
      }
      const bc = r.blockComments.find((b) => this.startsWith(b.open) && (!b.lineStart || this.atLineStart));
      if (bc) {
        this.skipBlockComment(bc);
        continue;
      }
      if (r.lineComments.some((lc) => this.startsWith(lc))) {
        let p = this.i;
        while (p < src.length && src[p] !== "\n") p++;
        this.i = p;
        this.sp = true;
        continue;
      }
      if (r.tripleQuotes && (this.startsWith('"""') || this.startsWith("'''"))) {
        const start = this.i;
        const end = this.scanQuoted(this.i + 3, s.repeat(3), false, true);
        this.push("str", src.slice(start + 3, Math.max(start + 3, end - 3)), start);
        this.advanceTo(end);
        continue;
      }
      if (r.cppRaw && s === "R" && this.ch(1) === '"') {
        const m = /^R"([^(\s]{0,16})\(/.exec(src.slice(this.i, this.i + 20));
        if (m) {
          const close = `)${m[1]}"`;
          const at = src.indexOf(close, this.i + m[0].length);
          const end = at < 0 ? src.length : at + close.length;
          this.push("str", "", this.i);
          this.advanceTo(end);
          continue;
        }
      }
      if (r.rustRaw && (s === "r" || s === "b") && /^b?r#*"/.test(src.slice(this.i, this.i + 8))) {
        const m = /^b?r(#*)"/.exec(src.slice(this.i, this.i + 8));
        if (m) {
          const close = `"${m[1]}`;
          const at = src.indexOf(close, this.i + m[0].length);
          const end = at < 0 ? src.length : at + close.length;
          this.push("str", "", this.i);
          this.advanceTo(end);
          continue;
        }
      }
      if (s === "'" && r.charQuote !== "none") {
        if (this.scanApostrophe()) continue;
      }
      if (r.quotes.includes(s) || (r.template && s === "`")) {
        const start = this.i;
        const multiline = !(r.charQuote === "c" || r.charQuote === "rust") || s === "`";
        const end = this.scanQuoted(this.i + 1, s, false, multiline);
        // 閉じていない文字列(行末で打ち切り)は最後の文字まで中身
        const closed = end - 1 > start && src[end - 1] === s;
        this.push("str", src.slice(start + 1, closed ? end - 1 : end), start);
        this.advanceTo(end);
        continue;
      }
      if (isDigit(c) || (s === "." && isDigit(this.code(1)) && !this.prevIsValue())) {
        this.scanNumber();
        continue;
      }
      if (this.isIdentStart(c, s)) {
        const start = this.i;
        const name = this.scanIdent();
        const q = this.ch();
        if (r.stringPrefix && (q === '"' || q === "'") && r.stringPrefix.test(name)) {
          const raw = !!r.rawPrefix && r.rawPrefix.test(name);
          const triple = r.tripleQuotes && this.startsWith(q.repeat(3));
          const end = this.scanQuoted(this.i + (triple ? 3 : 1), triple ? q.repeat(3) : q, raw, true);
          this.push("str", "", start);
          this.advanceTo(end);
          continue;
        }
        this.push("ident", name, start);
        continue;
      }
      if (r.regexLiteral && s === "/" && this.ch(1) !== "/" && this.ch(1) !== "*" && this.regexAllowed()) {
        const start = this.i;
        let p = this.i + 1;
        let inClass = false;
        while (p < src.length && src[p] !== "\n") {
          if (src[p] === "\\") p++;
          else if (src[p] === "[") inClass = true;
          else if (src[p] === "]") inClass = false;
          else if (src[p] === "/" && !inClass) break;
          p++;
        }
        if (src[p] === "/") {
          p++;
          while (p < src.length && /[a-z]/.test(src[p])) p++;
          this.push("str", src.slice(start, p), start);
          this.i = p;
          continue;
        }
      }
      const op = this.ops.get(s)?.find((o) => this.startsWith(o));
      const start = this.i;
      this.i += op ? op.length : 1;
      this.push("op", op ?? s, start);
    }
    return { tokens: this.toks, warnings: this.warnings };
  }

  /** / を正規表現として読んでよいか */
  regexAllowed(): boolean {
    const p = this.prev();
    if (p && p.k === "ident" && this.rules.regexAfter.has(p.v)) return true;
    return !this.prevIsValue();
  }

  /** ' で始まる字句(文字リテラル・ライフタイム・転置)。何か読んだら true */
  private scanApostrophe(): boolean {
    const src = this.src;
    const r = this.rules;
    const start = this.i;
    if (r.charQuote === "julia" && this.prevIsValue()) return false; // 転置の '
    // 'x' / '\n' / '\u{1F600}' のような短い文字リテラル
    const m = /^'(?:\\(?:u\{[0-9a-fA-F]+\}|x[0-9a-fA-F]{2}|[0-7]{1,3}|.)|[^'\\\n])'/u.exec(src.slice(start, start + 16));
    if (m) {
      this.push("str", m[0].slice(1, -1), start);
      this.i = start + m[0].length;
      return true;
    }
    if (r.charQuote === "rust" && /[A-Za-z_]/.test(this.ch(1))) {
      // ライフタイム 'a / ループラベル 'outer: は読み捨てる
      let p = start + 1;
      while (p < src.length && /[A-Za-z0-9_]/.test(src[p])) p++;
      this.i = p;
      this.sp = true;
      return true;
    }
    if (r.charQuote === "c" || r.charQuote === "julia" || r.charQuote === "nim") {
      // 閉じていない ' は1文字の記号として進める(行の残りを飲み込まない)
      this.push("op", "'", start);
      this.i = start + 1;
      return true;
    }
    return false;
  }
}

export function tokenize(code: string, rules: LexRules): { tokens: Tok[]; warnings: FrontWarning[] } {
  return new Lexer(code, rules).run();
}
