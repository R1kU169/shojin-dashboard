// Lua の定義。then / do … end のブロックは字句の後で波括弧の形に書き換えてから(endRewrite.ts)、
// 波括弧系のフロントエンドで読む。長い文字列 [[ ]] と長いコメント --[[ ]] は字句の hook で読み飛ばす。
import type { Tok } from "../ir.ts";
import { BASE_RULES } from "../lexer.ts";
import type { Lexer, LexRules } from "../lexer.ts";
import { BASE_DIALECT } from "../sexpr.ts";
import type { Dialect } from "../sexpr.ts";
import type { LangSpec } from "../spec.ts";
import { rewriteEnd } from "../endRewrite.ts";
import type { EndRules } from "../endRewrite.ts";

/** [[ … ]] / [==[ … ]==] の長い文字列と、--[[ … ]] の長いコメント */
function longBracket(lx: Lexer): boolean {
  const s = lx.src;
  const start = lx.i;
  let p = start;
  const comment = s.startsWith("--", p);
  if (comment) p += 2;
  if (s[p] !== "[") return false;
  let q = p + 1;
  while (s[q] === "=") q++;
  if (s[q] !== "[") return false;
  const close = `]${"=".repeat(q - p - 1)}]`;
  const at = s.indexOf(close, q + 1);
  if (at < 0) lx.warn("unterminated", comment ? "コメントが閉じていません" : "文字列が閉じていません");
  const end = at < 0 ? s.length : at + close.length;
  if (comment) lx.sp = true;
  else lx.push("str", s.slice(q + 1, at < 0 ? s.length : at), start);
  lx.advanceTo(end);
  return true;
}

const lex: LexRules = {
  ...BASE_RULES,
  lineComments: ["--"],
  blockComments: [],
  quotes: "\"'",
  charQuote: "none",
  numSuffix: false,
  digitSep: "",
  keywords: new Set(["if", "then", "else", "elseif", "end", "for", "while", "do", "repeat", "until", "function", "local", "return", "and", "or", "not", "in", "break", "goto"]),
  hook: longBracket,
};

const dialect: Dialect = {
  ...BASE_DIALECT,
  caretPow: true,
  cTernary: false,
  colonMethod: true,
  concatOps: new Set([".."]),
  lambdas: new Set(["function"]),
  wordOps: { and: "&&", or: "||", not: "!" },
  sizeMembers: new Set(["len"]),
  sizeFuncs: new Set(),
  castWords: new Set(),
  typeWords: new Set(),
};

const END: EndRules = {
  headers: new Set(["if", "while", "for"]),
  headerEnd: new Set(["then", "do"]),
  headerAtNewline: false,
  elif: new Set(["elseif"]),
  defs: { function: "func" },
  plain: new Set(),
  doKind: "plain",
  repeat: { open: "repeat", close: "until" },
};

/** ~= は不等号(D の連結代入と同じ字句なので、Lua ではここで != に直す) */
function canon(toks: Tok[]): Tok[] {
  return toks.map((t) => (t.k === "op" && t.v === "~=" ? { ...t, v: "!=" } : t));
}

export const luaSpec: LangSpec = {
  key: "lua",
  family: "end",
  lex,
  dialect,
  loopWords: new Set(["for", "while"]),
  ifWords: new Set(["if"]),
  funcWords: new Set(["function"]),
  classWords: new Set(),
  controlWords: new Set(),
  declWords: new Set(["local"]),
  modifiers: new Set(["local"]),
  typedDecls: false,
  typeKind: {},
  inputMarkers: new Set(["io.read", "io.lines", "read", "lines", "stdin"]),
  implicitMain: false,
  asi: true,
  postfixModifiers: false,
  commandCalls: false,
  postTokenize: (toks, warn) => ({ toks: rewriteEnd(canon(toks), END, warn), consts: {} }),
};
