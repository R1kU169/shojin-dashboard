// JavaScript / TypeScript の定義。文は改行でも終わる(asi)。readFileSync で一度に読む形と
// readline の形を入力とみなす。forEach / map / reduce などのコールバックは要素数ぶん呼ぶものとして数える。
// TS は型注釈(x: number)と型引数(Map<number, number>)を読み飛ばすだけで、JS と同じに扱う。
import { BASE_RULES } from "../lexer.ts";
import type { LexRules } from "../lexer.ts";
import { BASE_DIALECT } from "../sexpr.ts";
import type { Dialect } from "../sexpr.ts";
import type { LangSpec } from "../spec.ts";

const lex: LexRules = {
  ...BASE_RULES,
  quotes: "\"'",
  charQuote: "none",
  template: true,
  regexLiteral: true,
  identExtra: "$",
  digitSep: "_",
  keywords: new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await", "if", "while", "for"]),
};

function dialect(ts: boolean): Dialect {
  return {
    ...BASE_DIALECT,
    genericCaps: ts,
    braceHash: true,
    lambdas: new Set(["arrow", "function"]),
    sizeMembers: new Set(["length", "size"]),
    sizeFuncs: new Set(),
    castWords: new Set(),
    typeWords: new Set(),
  };
}

function spec(key: "js" | "ts"): LangSpec {
  return {
    key,
    family: "brace",
    lex,
    dialect: dialect(key === "ts"),
    loopWords: new Set(["for", "while"]),
    ifWords: new Set(["if"]),
    funcWords: new Set(["function"]),
    classWords: new Set(["class", "interface", "namespace"]),
    controlWords: new Set(["switch", "try", "catch", "finally"]),
    declWords: new Set(["let", "const", "var"]),
    modifiers: new Set(["async", "export", "default", "static", "public", "private", "protected", "readonly", "abstract", "declare", "get", "set", "override"]),
    typedDecls: false,
    typeKind: {
      Array: "array",
      Map: "hmap",
      Set: "hset",
      Int32Array: "array",
      Float64Array: "array",
      BigInt64Array: "array",
      Uint8Array: "array",
      string: "string",
      String: "string",
    },
    inputMarkers: new Set(["readFileSync", "createInterface", "stdin", "readline", "prompt"]),
    implicitMain: false,
    asi: true,
    postfixModifiers: false,
    commandCalls: false,
  };
}

export const jsSpec = spec("js");
export const tsSpec = spec("ts");
