// Rust の定義。proconio の input! と stdin().read_line を入力とみなし、
// a..b / a..=b の範囲、while let Some(v) = q.pop_front()、|x| のクロージャを読む。
import { BASE_RULES } from "../lexer.ts";
import type { LexRules } from "../lexer.ts";
import { BASE_DIALECT } from "../sexpr.ts";
import type { Dialect } from "../sexpr.ts";
import type { LangSpec } from "../spec.ts";

const lex: LexRules = {
  ...BASE_RULES,
  blockComments: [{ open: "/*", close: "*/", nested: true }],
  quotes: '"',
  charQuote: "rust",
  rustRaw: true,
  digitSep: "_",
  stringPrefix: /^b$/,
  keywords: new Set(["return", "if", "while", "for", "loop", "match", "else", "in", "let", "mut", "as", "move", "break", "continue"]),
};

const dialect: Dialect = {
  ...BASE_DIALECT,
  genericCaps: true,
  macroBang: true,
  cTernary: false,
  lambdas: new Set(["pipe"]),
  ranges: { "..": false, "..=": true },
  sizeMembers: new Set(["len"]),
  sizeFuncs: new Set(),
  castWords: new Set(),
  typeWords: new Set(["Vec", "HashMap", "HashSet", "BTreeMap", "BTreeSet", "VecDeque", "BinaryHeap", "Option", "Result", "Box", "Reverse"]),
};

export const rustSpec: LangSpec = {
  key: "rust",
  family: "brace",
  lex,
  dialect,
  loopWords: new Set(["for", "while", "loop"]),
  ifWords: new Set(["if"]),
  funcWords: new Set(["fn"]),
  classWords: new Set(["impl", "mod", "trait"]),
  controlWords: new Set(["match", "unsafe"]),
  declWords: new Set(["let", "static", "const"]),
  modifiers: new Set(["pub", "async", "unsafe", "extern", "const"]),
  typedDecls: false,
  typeKind: {
    Vec: "array",
    VecDeque: "deque",
    HashMap: "hmap",
    HashSet: "hset",
    BTreeMap: "omap",
    BTreeSet: "oset",
    BinaryHeap: "pq",
    String: "string",
  },
  inputMarkers: new Set(["input!", "stdin", "read_line", "read_to_string", "lines"]),
  implicitMain: true,
  asi: false,
  postfixModifiers: false,
  commandCalls: false,
};
