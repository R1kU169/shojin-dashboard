// Haskell の定義(簡易対応)。字句の後は専用のフロントエンド(haskellFrontend.ts)で IR を作る。
// 演算子は記号の最長の並び(<$> / >>= / $!)を1つの字句にし、`div` のような中置の関数も1つの字句にする。
// -- はコメント(----- の区切り線も)、{- -} は入れ子のコメント({-# LANGUAGE #-} も含む)。
import { BASE_RULES } from "../lexer.ts";
import type { Lexer, LexRules } from "../lexer.ts";
import { BASE_DIALECT } from "../sexpr.ts";
import type { LangSpec } from "../spec.ts";

const SYMBOL = /[!#$%&*+./<=>?@\\^|\-~:]/;

function haskellHook(lx: Lexer): boolean {
  const s = lx.src;
  const i = lx.i;
  const c = s[i];
  // `div` / `mod` / `elem` は中置の関数
  if (c === "`") {
    const end = s.indexOf("`", i + 1);
    if (end > i && end - i < 40 && !s.slice(i + 1, end).includes("\n")) {
      lx.push("op", s.slice(i, end + 1), i);
      lx.i = end + 1;
      return true;
    }
    return false;
  }
  if (!SYMBOL.test(c)) return false;
  let p = i;
  while (p < s.length && SYMBOL.test(s[p])) p++;
  const run = s.slice(i, p);
  // -- / ----- はコメント(字句の規則に任せる)
  if (/^--+$/.test(run)) return false;
  lx.push("op", run, i);
  lx.i = p;
  return true;
}

const lex: LexRules = {
  ...BASE_RULES,
  lineComments: ["--"],
  blockComments: [{ open: "{-", close: "-}", nested: true }],
  quotes: '"',
  charQuote: "c",
  identSuffix: "'",
  numSuffix: false,
  digitSep: "_",
  keywords: new Set(["if", "then", "else", "case", "of", "let", "in", "where", "do", "module", "import", "data", "type", "newtype", "class", "instance", "deriving", "return"]),
  hook: haskellHook,
};

export const haskellSpec: LangSpec = {
  key: "haskell",
  family: "haskell",
  lex,
  dialect: { ...BASE_DIALECT },
  loopWords: new Set(),
  ifWords: new Set(),
  funcWords: new Set(),
  classWords: new Set(),
  controlWords: new Set(),
  declWords: new Set(),
  modifiers: new Set(),
  typedDecls: false,
  typeKind: {},
  inputMarkers: new Set(["getLine", "getContents", "readLn", "interact", "BS.getLine", "BS.getContents", "T.getLine", "readInts"]),
  implicitMain: true,
  asi: false,
  postfixModifiers: false,
  commandCalls: false,
};
