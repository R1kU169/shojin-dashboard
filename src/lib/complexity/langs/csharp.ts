// C# の定義。クラスの中のメソッドを平坦化し、Console.ReadLine の読み取りを入力とみなす。
// LINQ(Select / Where / Sum …)は既知のメソッドとして要素数ぶんに数える。
import { BASE_RULES } from "../lexer.ts";
import type { LexRules } from "../lexer.ts";
import { BASE_DIALECT } from "../sexpr.ts";
import type { Dialect } from "../sexpr.ts";
import type { LangSpec } from "../spec.ts";

const lex: LexRules = {
  ...BASE_RULES,
  quotes: '"',
  charQuote: "c",
  tripleQuotes: true,
  digitSep: "_",
  keywords: new Set(["return", "if", "while", "for", "foreach", "case", "else", "do", "new", "throw", "in", "is", "as", "yield", "await"]),
};

const dialect: Dialect = {
  ...BASE_DIALECT,
  genericCaps: true,
  lambdas: new Set(["arrow"]),
  sizeMembers: new Set(["Count", "Length", "LongLength", "size"]),
  sizeFuncs: new Set(),
  castWords: new Set(["int", "long", "short", "char", "double", "float", "byte", "bool", "uint", "ulong", "decimal"]),
  typeWords: new Set(),
};

export const csharpSpec: LangSpec = {
  key: "csharp",
  family: "brace",
  lex,
  dialect,
  loopWords: new Set(["for", "foreach", "while"]),
  ifWords: new Set(["if"]),
  funcWords: new Set(),
  classWords: new Set(["class", "struct", "interface", "namespace", "record"]),
  controlWords: new Set(["switch", "try", "catch", "finally", "using", "lock", "checked", "unchecked", "unsafe", "fixed"]),
  declWords: new Set(["var"]),
  modifiers: new Set(["public", "private", "protected", "internal", "static", "readonly", "const", "override", "virtual", "abstract", "sealed", "partial", "unsafe", "async", "extern", "volatile"]),
  typedDecls: true,
  typeKind: {
    List: "array",
    Dictionary: "hmap",
    SortedDictionary: "omap",
    SortedList: "omap",
    HashSet: "hset",
    SortedSet: "oset",
    PriorityQueue: "pq",
    Queue: "deque",
    Stack: "stack",
    LinkedList: "linkedlist",
    string: "string",
    String: "string",
    StringBuilder: "string",
  },
  inputMarkers: new Set(["ReadLine", "Read", "ReadToEnd", "ReadAllText", "ReadAllLines"]),
  implicitMain: true,
  asi: false,
  postfixModifiers: false,
  commandCalls: false,
};
