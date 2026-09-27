// フロントエンドの入口: コード → Program。字句 → (後処理) → 生のブロック木 → IR の順に通す。
// 想定外の例外はここで止めて、警告つきの空の Program を返す(ページを壊さない)。
import type { FrontWarning, Program, Tok } from "./ir.ts";
import { tokenize } from "./lexer.ts";
import type { Dialect } from "./sexpr.ts";
import { parseBrace } from "./braceFrontend.ts";
import { parseIndent } from "./indentFrontend.ts";
import { parseHaskell } from "./haskellFrontend.ts";
import { lowerList } from "./lower.ts";
import type { LowerCtx } from "./lower.ts";
import type { LangSpec, Raw } from "./spec.ts";
import type { Consts } from "./semantics.ts";

/** これより大きい入力は先頭だけ解析する */
export const MAX_INPUT = 1_000_000;

export type RawParser = (toks: readonly Tok[], spec: LangSpec, warn: (w: FrontWarning) => void) => Raw[];

const PARSERS: Partial<Record<LangSpec["family"], RawParser>> = {
  brace: parseBrace,
  indent: parseIndent,
  // end 系と Bash は字句の後処理(endRewrite.ts / canonBash)で波括弧の形に直してあるので、波括弧系と同じに読む
  end: parseBrace,
  bash: parseBrace,
};

/** end 系・Haskell・シェルのフロントエンドを後から登録する */
export function registerParser(family: LangSpec["family"], p: RawParser): void {
  PARSERS[family] = p;
}

export function parseProgram(code: string, spec: LangSpec): Program {
  const warnings: FrontWarning[] = [];
  const warn = (w: FrontWarning) => {
    if (warnings.length < 200) warnings.push(w);
  };
  let src = code.replace(/\r\n?/g, "\n");
  if (src.length > MAX_INPUT) {
    src = src.slice(0, MAX_INPUT);
    warn({ line: 1, code: "truncated", message: "コードが長すぎるので先頭だけ解析しました" });
  }
  const lineCount = src.split("\n").length;
  let consts: Consts = {};
  try {
    const lx = tokenize(src, spec.lex);
    lx.warnings.forEach(warn);
    let toks = lx.tokens;
    if (spec.postTokenize) {
      const r = spec.postTokenize(toks, warn);
      toks = r.toks;
      consts = r.consts;
    }
    // Haskell は専用のフロントエンドで IR を直接作る
    if (spec.family === "haskell") {
      const prog = parseHaskell(toks, warn, lineCount);
      return { ...prog, warnings };
    }
    const parser = PARSERS[spec.family];
    if (!parser) {
      warn({ line: 1, code: "unsupported-syntax", message: "この言語の構文はまだ読めません" });
      return { lang: spec.key, nodes: [], consts, warnings, lineCount };
    }
    const d: Dialect = { ...spec.dialect };
    const ctx: LowerCtx = { spec, d, consts, warn, inputNames: new Set(), top: true, fields: new Map() };
    // ラムダやブロックの本体は同じフロントエンドで読み直す
    d.parseBody = (body) => lowerList(parser(body, spec, warn), { ...ctx, top: false });
    const nodes = lowerList(parser(toks, spec, warn), ctx);
    return { lang: spec.key, nodes, consts: ctx.consts, warnings, lineCount };
  } catch (e) {
    warn({ line: 1, code: "internal-error", message: `解析中にエラーが起きました (${(e as Error).message})` });
    return { lang: spec.key, nodes: [], consts, warnings, lineCount };
  }
}
