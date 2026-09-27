// D の定義。foreach (i; 0 .. n)、UFCS(readln.split.to!(int[]))、to!int のテンプレート引数を読む。
// 連想配列 int[string] は宣言の [] の中に型があるので、ハッシュとして扱う。
import { BASE_RULES } from "../lexer.ts";
import type { LexRules } from "../lexer.ts";
import { BASE_DIALECT } from "../sexpr.ts";
import type { Dialect } from "../sexpr.ts";
import type { LangSpec } from "../spec.ts";

const lex: LexRules = {
  ...BASE_RULES,
  blockComments: [
    { open: "/*", close: "*/" },
    { open: "/+", close: "+/", nested: true },
  ],
  quotes: '"`',
  charQuote: "c",
  digitSep: "_",
  stringPrefix: /^[rq]$/,
  rawPrefix: /r/,
  keywords: new Set(["return", "if", "while", "for", "foreach", "foreach_reverse", "else", "do", "new", "case", "in", "is", "cast"]),
};

const dialect: Dialect = {
  ...BASE_DIALECT,
  dTemplate: true,
  ranges: { "..": false },
  concatOps: new Set(["~"]),
  lambdas: new Set(["arrow"]),
  sizeMembers: new Set(["length"]),
  sizeFuncs: new Set(),
  castWords: new Set(["int", "long", "short", "char", "double", "float", "byte", "bool", "uint", "ulong", "size_t"]),
  typeWords: new Set(),
};

export const dSpec: LangSpec = {
  key: "d",
  family: "brace",
  lex,
  dialect,
  loopWords: new Set(["for", "foreach", "foreach_reverse", "while"]),
  ifWords: new Set(["if"]),
  funcWords: new Set(),
  classWords: new Set(["class", "struct", "interface", "union"]),
  controlWords: new Set(["switch", "try", "catch", "finally", "scope"]),
  declWords: new Set(["auto", "immutable", "enum"]),
  modifiers: new Set(["public", "private", "protected", "static", "pure", "nothrow", "final", "override", "abstract", "ref", "inout", "shared", "@safe", "@nogc", "@trusted", "@system"]),
  typedDecls: true,
  typeKind: {
    RedBlackTree: "oset",
    BinaryHeap: "pq",
    DList: "deque",
    Array: "array",
    string: "string",
    Appender: "array",
  },
  inputMarkers: new Set(["readln", "stdin", "readf", "scanf", "byLine"]),
  implicitMain: true,
  asi: false,
  postfixModifiers: false,
  commandCalls: false,
};
