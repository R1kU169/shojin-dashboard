// 問題ページの文字列から「入力」と「制約」の節を切り出す。
//
// 受け取るのは、問題ページ(または「問題一括表示」)の HTML を行ごとの文字列にしたもの
// (katexPaste.ts の statementHtmlToText)。見出し(<h3>)は1行になっている。
// ページ全体を全選択してコピーしたものには、上のメニューや英語版の問題文も混ざるので、
// 行全体がちょうど見出しの語になっている行だけを見出しとみなし、最初の日本語の「入力」「制約」を使う。

import { hasJapanese } from "./tex.ts";

const JA_HEADINGS =
  /^(問題文|制約|入力|出力|入出力|入力例\s*\d*|出力例\s*\d*|入出力例\s*\d*|部分点|小課題|注意|注意事項|注記|備考|配点|得点|ジャッジについて)$/;
const EN_HEADINGS =
  /^(Problem\s+Statement|Constraints|Input|Output|Input\s+and\s+Output|Sample\s+Input\s*\d*|Sample\s+Output\s*\d*|Sample\s+Interaction\s*\d*|Partial\s+Scores?|Subtasks?|Notes?|Scoring|Judging)$/i;

const isHeading = (line: string) => JA_HEADINGS.test(line) || EN_HEADINGS.test(line);

// 入力の節の先頭の決まり文句(読み取りには要らず、見せる欄が長くなるだけ)
const BOILERPLATE = [
  /^入力は以下の形式で標準入力から与えられる[。．.]?$/,
  /^The input is given from Standard Input in the following format:?$/i,
  /^Input is given from Standard Input in the following format:?$/i,
];

export interface StatementParts {
  /** 「入力」の節(入力の形式)。見つからなければ null */
  format: string | null;
  /** 「制約」の節。見つからなければ null(制約の節がない古い問題もある) */
  constraints: string | null;
}

/**
 * 見出しの次の行から、次の見出しの手前までを返す。見出しの判定は前後の空白を除いた行で行うが、
 * 返す行は元のまま(KaTeX の表示をプレーンテキストでコピーしたものは、行末の空白や空白だけの行で
 * 添字・累乗を表しているので、ここで削ると tex.ts で元に戻せなくなる)
 */
function section(raw: string[], keys: string[], heading: RegExp): string | null {
  const start = keys.findIndex((k) => heading.test(k));
  if (start < 0) return null;
  const out: string[] = [];
  for (let i = start + 1; i < keys.length && !isHeading(keys[i]); i++) {
    if (BOILERPLATE.some((b) => b.test(keys[i]))) continue;
    // 先頭の空行は捨てる
    if (out.length === 0 && keys[i] === "") continue;
    out.push(raw[i]);
  }
  // 末尾の空行(空白も無い行)は捨てる
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out.length === 0 ? null : out.join("\n");
}

/** 問題ページの文字列から「入力」と「制約」を切り出す。日本語の見出しがあればそちらを使う */
export function splitStatement(text: string): StatementParts {
  const raw = text.replace(/\r\n?/g, "\n").split("\n");
  const keys = raw.map((l) => l.replace(/^[\s\u00a0\u200b]+|[\s\u00a0\u200b]+$/g, ""));
  const ja = { format: inputFormat(section(raw, keys, /^入力$/)), constraints: section(raw, keys, /^制約$/) };
  if (ja.format !== null || ja.constraints !== null) return ja;
  return { format: inputFormat(section(raw, keys, /^Input$/i)), constraints: section(raw, keys, /^Constraints$/i) };
}

/** 「入力」の節が説明の文だけ(「この問題では入力は与えられない。」など)なら、入力の形式は無い */
function inputFormat(text: string | null): string | null {
  if (text === null) return null;
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  return lines.every((l) => hasJapanese(l)) ? null : text;
}
