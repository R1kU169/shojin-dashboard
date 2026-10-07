// Python / PyPy の定義。インデントでブロックを作り、内包表記・スライス・a if c else b を読む。
import { BASE_RULES } from "../lexer.ts";
import type { LexRules } from "../lexer.ts";
import { BASE_DIALECT } from "../sexpr.ts";
import type { Dialect } from "../sexpr.ts";
import type { LangSpec } from "../spec.ts";

const lex: LexRules = {
  ...BASE_RULES,
  lineComments: ["#"],
  blockComments: [],
  quotes: "\"'",
  charQuote: "none",
  tripleQuotes: true,
  stringPrefix: /^[rRbBuUfF]{1,2}$/,
  rawPrefix: /[rR]/,
  numSuffix: false,
  keywords: new Set(["if", "else", "elif", "return", "in", "not", "and", "or", "is", "lambda", "yield", "for", "while", "print", "assert", "del", "raise"]),
};

const dialect: Dialect = {
  ...BASE_DIALECT,
  cTernary: false,
  pyTernary: true,
  comprehension: true,
  pySlice: true,
  braceHash: true,
  wordOps: { and: "&&", or: "||", not: "!", in: "in", is: "is" },
  lambdas: new Set(["pylambda"]),
  sizeFuncs: new Set(["len"]),
  sizeMembers: new Set(),
  castWords: new Set(),
  typeWords: new Set(),
};

function spec(key: "python" | "pypy"): LangSpec {
  return {
    key,
    family: "indent",
    lex,
    dialect,
    loopWords: new Set(["for", "while"]),
    ifWords: new Set(["if"]),
    funcWords: new Set(["def"]),
    classWords: new Set(["class"]),
    controlWords: new Set(["try", "except", "finally", "with", "match", "case"]),
    declWords: new Set(),
    modifiers: new Set(["async"]),
    typedDecls: false,
    typeKind: {
      list: "array",
      tuple: "array",
      str: "string",
      dict: "hmap",
      defaultdict: "hmap",
      Counter: "hmap",
      OrderedDict: "hmap",
      set: "hset",
      frozenset: "hset",
      deque: "deque",
      SortedList: "oset",
      SortedSet: "oset",
      SortedDict: "omap",
      // ACL(from atcoder.xxx import …)
      FenwickTree: "acl",
      SegTree: "acl",
      LazySegTree: "acl",
      DSU: "acl",
      MFGraph: "acl",
      MCFGraph: "acl",
      SCCGraph: "acl",
      TwoSAT: "acl",
    },
    inputMarkers: new Set(["input", "stdin", "readline", "readlines", "raw_input", "open", "sys.stdin"]),
    implicitMain: false,
    asi: false,
    postfixModifiers: false,
    commandCalls: false,
    indent: {
      blockWords: new Set(["if", "elif", "else", "for", "while", "def", "class", "try", "except", "finally", "with", "match", "case"]),
      eqBlockWords: new Set(),
      sectionWords: new Set(),
      continuesLine: () => false,
    },
  };
}

export const pythonSpec = spec("python");
export const pypySpec = spec("pypy");
