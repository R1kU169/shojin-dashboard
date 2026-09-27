// Nim の定義。インデント系のフロントエンドで読む(行末の : と、proc の行末の = でブロックを開く)。
// var / let / const / type の節は子の行の先頭に語を補って通常の文として読む。
// echo x / inc x / a.add x / dfs u のような括弧なしの呼び出し、div / mod / shl / shr の語の演算子、
// newSeq[int](n) の角括弧の型引数、0..<n / 0..n / countup の範囲を読む。
// {.pragma.} と #[ … ]#(入れ子)のコメントは字句で読み飛ばす。
import type { Tok } from "../ir.ts";
import { BASE_RULES } from "../lexer.ts";
import type { Lexer, LexRules } from "../lexer.ts";
import { BASE_DIALECT } from "../sexpr.ts";
import type { Dialect } from "../sexpr.ts";
import type { LangSpec } from "../spec.ts";

function nimHook(lx: Lexer): boolean {
  const s = lx.src;
  const i = lx.i;
  // {.inline.} / {.noSideEffect, inline.} のプラグマは丸ごと捨てる
  if (s[i] === "{" && s[i + 1] === ".") {
    const end = s.indexOf(".}", i + 2);
    lx.advanceTo(end < 0 ? s.length : end + 2);
    lx.sp = true;
    return true;
  }
  return false;
}

const lex: LexRules = {
  ...BASE_RULES,
  lineComments: ["#"],
  blockComments: [{ open: "#[", close: "]#", nested: true }],
  quotes: '"',
  charQuote: "nim",
  tripleQuotes: true,
  stringPrefix: /^(r|R|fmt|&)$/,
  rawPrefix: /^[rR]$/,
  digitSep: "_",
  keywords: new Set(["if", "elif", "else", "when", "case", "of", "for", "while", "in", "notin", "is", "isnot", "and", "or", "not", "xor", "div", "mod", "shl", "shr", "return", "proc", "func", "iterator", "template", "macro", "method", "let", "var", "const", "type", "block", "try", "except", "finally", "discard", "echo", "result", "break", "continue"]),
  hook: nimHook,
};

const dialect: Dialect = {
  ...BASE_DIALECT,
  cTernary: false,
  caretPow: true,
  bracketGenerics: true,
  commandMembers: true,
  concatOps: new Set(["&"]),
  ranges: { "..": true, "..<": false },
  // x in 0..<n の .. は in より強く結びつく
  rangeBp: 13,
  lambdas: new Set(["arrow"]),
  wordOps: { div: "/", mod: "%", shl: "<<", shr: ">>", and: "&&", or: "||", xor: "|", not: "!", in: "in", notin: "notin", is: "==" },
  sizeMembers: new Set(["len"]),
  sizeFuncs: new Set(["len"]),
  castWords: new Set(),
  typeWords: new Set(),
  listOps: new Set(["echo", "discard"]),
};

/** 行末がこの記号・語なら次の行へ続く */
const CONTINUES = new Set([",", "=", "+", "-", "*", "/", "&", "and", "or", "(", "[", "{", "div", "mod", "shl", "shr", "&&", "||", "..", "..<", "->"]);

export const nimSpec: LangSpec = {
  key: "nim",
  family: "indent",
  lex,
  dialect,
  loopWords: new Set(["for", "while"]),
  ifWords: new Set(["if", "when"]),
  funcWords: new Set(["proc", "func", "iterator", "template", "macro", "method", "converter"]),
  classWords: new Set(),
  controlWords: new Set(["case", "block", "try", "except", "finally"]),
  declWords: new Set(["let", "var", "const"]),
  modifiers: new Set(),
  typedDecls: false,
  typeKind: {
    seq: "array",
    array: "array",
    string: "string",
    HashSet: "hset",
    IntSet: "hset",
    PackedSet: "hset",
    Table: "hmap",
    TableRef: "hmap",
    OrderedTable: "hmap",
    CountTable: "hmap",
    HeapQueue: "pq",
    Deque: "deque",
    initHashSet: "hset",
    toHashSet: "hset",
    initIntSet: "hset",
    initTable: "hmap",
    newTable: "hmap",
    toTable: "hmap",
    initCountTable: "hmap",
    toCountTable: "hmap",
    initOrderedTable: "hmap",
    initHeapQueue: "pq",
    initDeque: "deque",
  },
  inputMarkers: new Set(["stdin", "readLine", "readAll", "readLines", "readChar", "getLine", "readLineFromStdin"]),
  implicitMain: false,
  asi: false,
  postfixModifiers: false,
  commandCalls: true,
  indent: {
    blockWords: new Set(["if", "elif", "else", "when", "for", "while", "case", "of", "block", "try", "except", "finally", "proc", "func", "iterator", "template", "macro", "method", "converter"]),
    eqBlockWords: new Set(["proc", "func", "iterator", "template", "macro", "method", "converter"]),
    sectionWords: new Set(["let", "var", "const", "type"]),
    continuesLine: (last: Tok) => (last.k === "op" || last.k === "ident") && CONTINUES.has(last.v),
  },
};
