// 問題文から貼り付けた「入力」「制約」を、読み取りやすい素の書き方にそろえる。
//
// 貼り付けられる文字列は3通りある。
//  1. 手で書いたもの: A_1 A_2 ... A_N / 1 <= N <= 2*10^5
//  2. 問題文の TeX: A _ 1 \ldots A _ N / 1 \le N \le 2\times 10^5
//  3. 問題ページの表示(KaTeX)をそのままコピーしたもの。Chrome では添字や累乗が別の行に割れる:
//       u_1   → "u \n1\n\u200b\n "(添字の後ろにゼロ幅空白の行と空白が付く)
//       10^5  → "10 \n5\n "
//       元の空白 → " \n"、元の改行 → "\n"
//       ≠     → "\n\ue020\n="(否定の斜線が私用領域の文字になる)
// どれも最後は「A_{1} A_{2} … A_{N}」「1≤N≤2×10^{5}」の形にする。

const JAPANESE = /[\u3040-\u30ff\u3400-\u9fff]/;

/** 日本語(ひらがな・カタカナ・漢字)を含むか。入力形式では説明文の行を読み飛ばすのに使う */
export function hasJapanese(s: string): boolean {
  return JAPANESE.test(s);
}

/** KaTeX の表示をコピーした文字列を、添字・累乗つきの1行ずつの形に戻す */
function decodeKatexCopy(s: string): string {
  // 否定(≠ など)は斜線の文字と = に割れる。前後の改行ごと1文字に戻す(その前の添字の区切りは残す)
  s = s.replace(/\n?\ue020\n?=/g, "≠");
  // 添字: 「本体 空白 改行 添字 改行 ゼロ幅空白 改行 空白」。入れ子の添字もあるので2回かける
  for (let k = 0; k < 2; k++) {
    s = s.replace(/(\S+) \n([^\n]+)\n\u200b\n ?/g, "$1_{$2}");
  }
  // 累乗: 「本体 空白 改行 指数 改行 空白」。空白で終わらないものは元の空白区切り(N M など)
  s = s.replace(/(\S+) \n(\S+)\n /g, "$1^{$2}");
  // 残った「空白 改行」は元の空白
  s = s.replace(/ \n/g, " ");
  return s.replace(/\u200b/g, "");
}

/**
 * KaTeX の表示をコピーした文字列か。添字があればゼロ幅空白が、≠ があれば私用領域の文字が入る。
 * どちらも無い制約(S は長さ 1 以上 4×10^5 以下…)でも、累乗は「10 改行 5 改行 空白」になる。
 * TeX(バックスラッシュを含む)なら KaTeX のコピーではない
 */
function looksLikeKatexCopy(s: string): boolean {
  if (s.includes("\u200b") || s.includes("\ue020")) return true;
  return !s.includes("\\") && /\d \n\d+\n /.test(s);
}

/**
 * 貼り付けた文字列を素の書き方にそろえる。行の区切りは保つ。
 * 添字は A_{1} / A_{N-1} / A_{i,j}、累乗は 10^{5} のように中かっこで包む(包まない A_1 も残る)。
 */
export function normalizeText(raw: string): string {
  let s = raw.replace(/\r\n?/g, "\n");
  if (looksLikeKatexCopy(s)) s = decodeKatexCopy(s);
  // 全角英数字・全角空白を半角に。… は NFKC で ... になるので、あとで省略の記号として読む
  s = s.normalize("NFKC");
  s = s
    .replace(/\\\(|\\\)|\$/g, "")
    .replace(/\\(?:leqq|leq|le)(?![a-zA-Z])/g, "≤")
    .replace(/\\(?:geqq|geq|ge)(?![a-zA-Z])/g, "≥")
    .replace(/\\lt(?![a-zA-Z])/g, "<")
    .replace(/\\gt(?![a-zA-Z])/g, ">")
    .replace(/\\(?:neq|ne)(?![a-zA-Z])/g, "≠")
    .replace(/\\(?:times|cdot)(?![a-zA-Z])/g, "×")
    .replace(/\\vdots(?![a-zA-Z])/g, "⋮")
    .replace(/\\(?:ldots|cdots|dots)(?![a-zA-Z])/g, "…")
    .replace(/\\in(?![a-zA-Z])/g, "∈")
    .replace(/\\(?:lbrace|\{)/g, "{")
    .replace(/\\(?:rbrace|\})/g, "}")
    .replace(/\\(?:vert|mid)(?![a-zA-Z])/g, "|")
    .replace(/\\(min|max)(?![a-zA-Z])/g, "$1")
    .replace(/\\sum(?![a-zA-Z])/g, "Σ")
    // \mathrm{case} / \text{query} / {\rm Query}
    .replace(/\\(?:mathrm|text|textrm|mathit|operatorname|mathbf|textbf)\s*\{([^{}]*)\}/g, "$1")
    .replace(/\{\\(?:rm|it|bf)\s+([^{}]*)\}/g, "$1")
    // \ (空白) / \, / \; / \! / ~ は空白
    .replace(/\\[ ,;:!]/g, " ")
    .replace(/~/g, " ")
    .replace(/\\quad|\\qquad/g, " ")
    .replace(/\u00a0|\u3000/g, " ")
    .replace(/[−–—]/g, "-")
    // |S| は KaTeX の表示では ∣S∣(U+2223)になる
    .replace(/[∣｜]/g, "|")
    .replace(/[≦⩽]/g, "≤")
    .replace(/[≧⩾]/g, "≥")
    .replace(/<=/g, "≤")
    .replace(/>=/g, "≥")
    .replace(/!=/g, "≠")
    .replace(/[⋯]|\.\.\.+/g, "…")
    .replace(/[︙]/g, "⋮")
    // A _ 1 / 10 ^ 5 の空白を詰める
    .replace(/[ \t]*([_^])[ \t]*/g, "$1");
  return s
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .join("\n");
}
