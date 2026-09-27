// Julia の定義。function / for / while / if / begin … end は字句の後で波括弧の形に書き換えてから
// (endRewrite.ts)、波括弧系のフロントエンドで読む。
//
// 書き換えの前に演算子を揃える: ÷ → //、≤ ≥ ≠ → <= >= !=、∈ → in、2n → 2 * n。
// @inbounds / @views などのマクロの注釈は計算量に関係しないので落とす。
// a[end] / a[begin] の end・begin は添字なのでブロックの語として扱わない。
import type { Tok } from "../ir.ts";
import { BASE_RULES } from "../lexer.ts";
import type { LexRules } from "../lexer.ts";
import { BASE_DIALECT } from "../sexpr.ts";
import type { Dialect } from "../sexpr.ts";
import type { LangSpec } from "../spec.ts";
import { rewriteEnd } from "../endRewrite.ts";
import type { EndRules } from "../endRewrite.ts";

const lex: LexRules = {
  ...BASE_RULES,
  lineComments: ["#"],
  blockComments: [{ open: "#=", close: "=#", nested: true }],
  quotes: '"',
  charQuote: "julia",
  tripleQuotes: true,
  interp: "julia",
  identSuffix: "!",
  unicodeIdent: true,
  numSuffix: false,
  digitSep: "_",
  keywords: new Set(["if", "elseif", "else", "end", "for", "while", "function", "return", "begin", "let", "do", "in", "isa", "where", "struct", "module", "macro", "try", "catch", "finally", "quote", "local", "global", "const", "break", "continue", "using", "import"]),
};

const dialect: Dialect = {
  ...BASE_DIALECT,
  colonRange: true,
  caretPow: true,
  comprehension: true,
  blockArgs: true,
  curlyGenerics: true,
  lambdas: new Set(["thinArrow"]),
  wordOps: { in: "in" },
  sizeMembers: new Set(),
  sizeFuncs: new Set(["length", "lastindex", "size"]),
  castWords: new Set(),
  typeWords: new Set(),
};

const END: EndRules = {
  headers: new Set(["if", "while", "for"]),
  headerEnd: new Set(),
  headerAtNewline: true,
  elif: new Set(["elseif"]),
  defs: { function: "func", macro: "func", struct: "class", module: "class", baremodule: "class" },
  plain: new Set(["begin", "let", "quote", "try", "abstract", "primitive"]),
  doKind: "block",
  clauses: new Set(["catch", "finally"]),
  endInBrackets: true,
  multiFor: true,
  bareDoParams: true,
  shortFunc: true,
  topLevelOnly: new Set(["for", "if", "begin", "let"]),
};

const OP_CANON: Record<string, string> = { "÷": "//", "≤": "<=", "≥": ">=", "≠": "!=" };

/** 演算子を揃え、2n を 2 * n にし、@macro を落とす */
function canon(toks: Tok[]): Tok[] {
  const out: Tok[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.k === "op" && t.v === "@" && toks[i + 1]?.k === "ident" && !toks[i + 1].sp) {
      // @inbounds for … / @views a[1:n] / @show x: 注釈の名前を落とす(行頭の印は次の字句へ移す)
      i++;
      if (t.nl && toks[i + 1]) toks[i + 1] = { ...toks[i + 1], nl: true };
      continue;
    }
    if (t.k === "op" && OP_CANON[t.v]) {
      out.push({ ...t, v: OP_CANON[t.v] });
      continue;
    }
    if (t.k === "op" && t.v === "∈") {
      out.push({ ...t, k: "ident", v: "in" });
      continue;
    }
    out.push(t);
    const nx = toks[i + 1];
    if (t.k === "num" && nx && nx.k === "ident" && !nx.sp && !nx.nl) out.push({ ...nx, k: "op", v: "*", sp: false });
  }
  return out;
}

export const juliaSpec: LangSpec = {
  key: "julia",
  family: "end",
  lex,
  dialect,
  loopWords: new Set(["for", "while"]),
  ifWords: new Set(["if"]),
  funcWords: new Set(["function", "macro"]),
  classWords: new Set(["struct", "module", "baremodule"]),
  controlWords: new Set(),
  declWords: new Set(["local", "global", "const"]),
  modifiers: new Set(["mutable"]),
  typedDecls: false,
  typeKind: {
    Vector: "array",
    Array: "array",
    Matrix: "array",
    BitVector: "array",
    BitArray: "array",
    Dict: "hmap",
    Set: "hset",
    String: "string",
  },
  inputMarkers: new Set(["readline", "readlines", "eachline", "stdin", "readchomp", "read"]),
  implicitMain: false,
  asi: true,
  postfixModifiers: false,
  commandCalls: false,
  postTokenize: (toks, warn) => ({ toks: rewriteEnd(canon(toks), END, warn), consts: {} }),
};
