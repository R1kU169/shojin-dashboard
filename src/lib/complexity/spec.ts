// 言語ごとの定義(LangSpec)と、フロントエンドが作る生のブロック木(Raw)の型。
// langs/*.ts が LangSpec を1つずつ書き、frontend.ts が family ごとの抽出器に渡す。
import type { ContainerKind, FrontWarning, Tok } from "./ir.ts";
import type { LexRules } from "./lexer.ts";
import type { Dialect } from "./sexpr.ts";

export type Family = "brace" | "indent" | "end" | "haskell" | "bash";

// ---------------------------------------------------------------------------
// 生のブロック木。文とブロックの入れ子だけを表し、意味付けは lower.ts がやる

export interface RawStmt {
  t: "stmt";
  toks: Tok[];
  line: number;
  endLine: number;
}

export interface RawElse {
  /** "elif"(条件つき)か "else" */
  kw: "elif" | "else";
  head: Tok[];
  body: Raw[];
  line: number;
}

export interface RawBlock {
  t: "block";
  /** if / for / while / do / func / class / plain / switch / … */
  kw: string;
  head: Tok[];
  body: Raw[];
  line: number;
  endLine: number;
  elses?: RawElse[];
  /** do-while / repeat-until / begin…end while の条件 */
  tail?: Tok[];
  tailKw?: string;
  /** Python のデコレータ(@lru_cache など) */
  decorators?: string[];
}

export type Raw = RawStmt | RawBlock;

// ---------------------------------------------------------------------------
// end 系(Ruby / Lua / Julia)のブロック規則

export interface BlockProfile {
  /** ブロックを開く語 → 種類 */
  openers: Readonly<Record<string, string>>;
  /** 開く語 → 閉じる語 */
  closerOf: (opener: string) => string;
  /** 分岐・区切りの語(elsif / else / when / then / do …) */
  separators: ReadonlySet<string>;
  /** 見出しが終わる語(then / do)。これを見たら本体が始まる */
  headerEnds: ReadonlySet<string>;
  /** 文の途中に現れた語が本当にブロックを開くか(Ruby の修飾子 if を除く) */
  opensHere: (toks: readonly Tok[], i: number) => boolean;
}

// ---------------------------------------------------------------------------
// インデント系(Python / Nim)の規則

export interface IndentProfile {
  /** 行末の : でブロックを開く語 */
  blockWords: ReadonlySet<string>;
  /** 行末の = でブロックを開く語(Nim の proc) */
  eqBlockWords: ReadonlySet<string>;
  /** 見出しだけの行で子の行を持つ語(Nim の var / let / const / type) */
  sectionWords: ReadonlySet<string>;
  /** 行が続く記号(行末の , や演算子) */
  continuesLine: (last: Tok) => boolean;
}

export interface LangSpec {
  key: string;
  family: Family;
  lex: LexRules;
  dialect: Dialect;
  /** ブロックを開くループの語 */
  loopWords: ReadonlySet<string>;
  /** if の語(unless は条件を反転) */
  ifWords: ReadonlySet<string>;
  /** 関数定義の語(def / fn / func / function / sub / proc …) */
  funcWords: ReadonlySet<string>;
  /** 中のメソッドを平坦化する入れ物(class / struct / impl / namespace …) */
  classWords: ReadonlySet<string>;
  /** 本体を普通のブロックとして読む制御の語(switch / try / match / with …) */
  controlWords: ReadonlySet<string>;
  /** 宣言の語(let / const / var / my / local …)。剥がしてから代入として読む */
  declWords: ReadonlySet<string>;
  /** 宣言や定義の前に付く修飾語(static / public / final …) */
  modifiers: ReadonlySet<string>;
  /** C 系の「型 名前」形式の宣言を読むか */
  typedDecls: boolean;
  /** 型名 → コンテナの種類 */
  typeKind: Readonly<Record<string, ContainerKind>>;
  /** 入力を読む印(cin / input / readline / gets / STDIN …) */
  inputMarkers: ReadonlySet<string>;
  /** main が暗黙に呼ばれる(C / C++ / Java / C# / Go / Rust / D / Haskell) */
  implicitMain: boolean;
  /** 改行で文が終わりうる(Go / JS / TS) */
  asi: boolean;
  /** 文末の修飾(Ruby の x += 1 if c、Perl の print for @a) */
  postfixModifiers: boolean;
  /** 括弧なしの呼び出し文(Ruby の puts x、Nim の dfs u) */
  commandCalls: boolean;
  /** 字句の後処理(C/C++ のマクロ展開、PHP の代替構文の書き換えなど) */
  postTokenize?: (toks: Tok[], warn: (w: FrontWarning) => void) => { toks: Tok[]; consts: Record<string, { value: number; line: number }> };
  /** end 系のブロック規則 */
  blocks?: BlockProfile;
  /** インデント系の規則 */
  indent?: IndentProfile;
}

// ---------------------------------------------------------------------------
// トークン列の小道具

export const isOp = (t: Tok | undefined, v: string): boolean => !!t && t.k === "op" && t.v === v;
export const isWord = (t: Tok | undefined, v: string): boolean => !!t && t.k === "ident" && t.v === v && !t.sigil;

/** トップレベル(括弧の外)で pred を満たす最初の位置 */
export function findTop(toks: readonly Tok[], pred: (t: Tok, i: number) => boolean, from = 0): number {
  let depth = 0;
  for (let i = from; i < toks.length; i++) {
    const t = toks[i];
    if (depth === 0 && pred(t, i)) return i;
    if (t.k === "op") {
      if (t.v === "(" || t.v === "[" || t.v === "{") depth++;
      else if (t.v === ")" || t.v === "]" || t.v === "}") depth = Math.max(0, depth - 1);
    }
  }
  return -1;
}

/** i の開き括弧に対応する閉じ括弧の位置(無ければ -1) */
export function matchClose(toks: readonly Tok[], i: number): number {
  let depth = 0;
  for (let j = i; j < toks.length; j++) {
    const t = toks[j];
    if (t.k !== "op") continue;
    if (t.v === "(" || t.v === "[" || t.v === "{") depth++;
    else if (t.v === ")" || t.v === "]" || t.v === "}") {
      depth--;
      if (depth === 0) return j;
    }
  }
  return -1;
}

/** 内訳のラベル用にトークンを元の書き方に近い文字列へ戻す */
export function tokText(toks: readonly Tok[], max = 60): string {
  let s = "";
  for (const t of toks) {
    const v = t.k === "str" ? JSON.stringify(t.v.length > 12 ? `${t.v.slice(0, 12)}…` : t.v) : `${t.sigil ?? ""}${t.v}`;
    s += s && t.sp ? ` ${v}` : v;
    if (s.length > max) return `${s.slice(0, max - 1)}…`;
  }
  return s;
}

export const lastLine = (toks: readonly Tok[], fallback: number): number => (toks.length ? toks[toks.length - 1].line : fallback);
