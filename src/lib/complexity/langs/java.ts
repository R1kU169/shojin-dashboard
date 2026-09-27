// Java の定義。クラスの中のメソッドを平坦化し、Scanner / BufferedReader の読み取りを入力とみなす。
// コレクションは宣言の型名(TreeMap / ArrayList …)で種類を決める。
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
  identExtra: "$",
  keywords: new Set(["return", "if", "while", "for", "case", "else", "do", "new", "throw", "instanceof", "yield"]),
};

const dialect: Dialect = {
  ...BASE_DIALECT,
  genericCaps: true,
  lambdas: new Set(["thinArrow"]),
  sizeMembers: new Set(["size", "length"]),
  sizeFuncs: new Set(),
  castWords: new Set(["int", "long", "short", "char", "double", "float", "byte", "boolean", "Integer", "Long"]),
  typeWords: new Set(),
};

export const javaSpec: LangSpec = {
  key: "java",
  family: "brace",
  lex,
  dialect,
  loopWords: new Set(["for", "while"]),
  ifWords: new Set(["if"]),
  funcWords: new Set(),
  classWords: new Set(["class", "interface", "enum", "record"]),
  controlWords: new Set(["switch", "try", "catch", "finally", "synchronized"]),
  declWords: new Set(["var"]),
  modifiers: new Set(["public", "private", "protected", "static", "final", "abstract", "synchronized", "native", "strictfp", "transient", "volatile", "default"]),
  typedDecls: true,
  typeKind: {
    ArrayList: "array",
    List: "array",
    Vector: "array",
    LinkedList: "linkedlist",
    HashMap: "hmap",
    Map: "hmap",
    LinkedHashMap: "hmap",
    TreeMap: "omap",
    SortedMap: "omap",
    NavigableMap: "omap",
    HashSet: "hset",
    Set: "hset",
    LinkedHashSet: "hset",
    TreeSet: "oset",
    SortedSet: "oset",
    NavigableSet: "oset",
    PriorityQueue: "pq",
    ArrayDeque: "deque",
    Deque: "deque",
    Queue: "deque",
    Stack: "stack",
    String: "string",
    StringBuilder: "string",
    BitSet: "array",
  },
  inputMarkers: new Set(["nextInt", "nextLong", "nextDouble", "next", "nextLine", "nextToken", "readLine", "nextBoolean", "nextByte", "nextShort", "nextFloat", "nextBigInteger", "readInt", "readLong", "ni", "nl", "ns"]),
  implicitMain: true,
  asi: false,
  postfixModifiers: false,
  commandCalls: false,
};
