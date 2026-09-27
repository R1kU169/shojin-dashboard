// Go の定義。文は改行でも終わる(asi)。for は C 形式・条件だけ・range の3通りがあり、
// fmt.Scan / bufio の読み取りを入力とみなす。スライスは make と append で確保・成長する。
import { BASE_RULES } from "../lexer.ts";
import type { LexRules } from "../lexer.ts";
import { BASE_DIALECT } from "../sexpr.ts";
import type { Dialect } from "../sexpr.ts";
import type { LangSpec } from "../spec.ts";

const lex: LexRules = {
  ...BASE_RULES,
  quotes: '"`',
  charQuote: "c",
  digitSep: "_",
  keywords: new Set(["return", "if", "for", "else", "case", "go", "defer", "range", "select", "switch"]),
};

const dialect: Dialect = {
  ...BASE_DIALECT,
  lambdas: new Set(["go"]),
  sizeMembers: new Set(["Len"]),
  sizeFuncs: new Set(["len"]),
  castWords: new Set(),
  typeWords: new Set(),
};

export const goSpec: LangSpec = {
  key: "go",
  family: "brace",
  lex,
  dialect,
  loopWords: new Set(["for"]),
  ifWords: new Set(["if"]),
  funcWords: new Set(["func"]),
  classWords: new Set(["type"]),
  controlWords: new Set(["switch", "select"]),
  declWords: new Set(["var", "const"]),
  modifiers: new Set(),
  typedDecls: false,
  typeKind: {
    map: "hmap",
    string: "string",
  },
  inputMarkers: new Set(["Scan", "Scanln", "Scanf", "Fscan", "Fscanln", "Fscanf", "ReadString", "ReadLine", "ReadRune", "Text", "Stdin"]),
  implicitMain: true,
  asi: true,
  postfixModifiers: false,
  commandCalls: false,
};
