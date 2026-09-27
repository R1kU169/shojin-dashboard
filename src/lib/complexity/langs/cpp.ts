// C++ / C の定義。競プロの C++ はマクロと STL が前提なので、#define の展開と
// コンテナの型名(vector / set / map / priority_queue / ACL の segtree など)を持つ。
import type { ContainerKind } from "../ir.ts";
import { BASE_RULES } from "../lexer.ts";
import type { LexRules } from "../lexer.ts";
import { expandMacros } from "../macro.ts";
import { BASE_DIALECT } from "../sexpr.ts";
import type { Dialect } from "../sexpr.ts";
import type { LangSpec } from "../spec.ts";

const lex: LexRules = {
  ...BASE_RULES,
  quotes: '"',
  charQuote: "c",
  preprocessor: true,
  cppRaw: true,
  digitSep: "'_",
  stringPrefix: /^(L|u8|u|U)$/,
  keywords: new Set(["return", "if", "while", "for", "case", "else", "do", "sizeof", "new", "delete", "throw", "co_return", "co_yield", "and", "or", "not"]),
};

const dialect: Dialect = {
  ...BASE_DIALECT,
  arrowMember: true,
  lambdas: new Set(["cpp"]),
  sizeMembers: new Set(["size", "length"]),
  sizeFuncs: new Set(["size", "ssize", "strlen", "sz", "SZ"]),
  wordOps: { and: "&&", or: "||", not: "!" },
};

export const CPP_TYPES: Record<string, ContainerKind> = {
  vector: "array",
  array: "array",
  valarray: "array",
  bitset: "array",
  basic_string: "string",
  string: "string",
  wstring: "string",
  set: "oset",
  multiset: "oset",
  map: "omap",
  multimap: "omap",
  unordered_set: "hset",
  unordered_multiset: "hset",
  unordered_map: "hmap",
  unordered_multimap: "hmap",
  gp_hash_table: "hmap",
  cc_hash_table: "hmap",
  tree: "oset",
  priority_queue: "pq",
  queue: "deque",
  deque: "deque",
  stack: "stack",
  list: "linkedlist",
  segtree: "acl",
  lazy_segtree: "acl",
  fenwick_tree: "acl",
  dsu: "acl",
  mf_graph: "acl",
  mcf_graph: "acl",
  scc_graph: "acl",
  two_sat: "acl",
};

function spec(key: "cpp" | "c"): LangSpec {
  return {
    key,
    family: "brace",
    lex,
    dialect,
    loopWords: new Set(["for", "while"]),
    ifWords: new Set(["if"]),
    funcWords: new Set(),
    classWords: new Set(["class", "struct", "namespace", "union"]),
    controlWords: new Set(["switch", "try", "catch"]),
    declWords: new Set(),
    modifiers: new Set(["static", "inline", "constexpr", "virtual", "explicit", "extern", "friend", "consteval", "noexcept", "[[nodiscard]]"]),
    typedDecls: true,
    typeKind: CPP_TYPES,
    inputMarkers: new Set(["cin", "scanf", "getline", "getchar", "getchar_unlocked", "fread", "read", "gets", "fgets", "scan"]),
    implicitMain: true,
    asi: false,
    postfixModifiers: false,
    commandCalls: false,
    postTokenize: (toks, warn) => expandMacros(toks, lex, dialect, warn),
  };
}

export const cppSpec = spec("cpp");
export const cSpec = spec("c");
