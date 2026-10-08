// 問題ページ(数式を KaTeX で描画したもの)からコピーした HTML を、元の TeX の文字列に戻す。
//
// プレーンテキストでコピーすると、添字や累乗が別の行に割れてしまい、元の行の区切りも
// 推測でしか戻せない(casegen/tex.ts)。KaTeX の HTML には表示用の要素とは別に元の TeX
// (<annotation encoding="application/x-tex">)が入っているので、貼り付けではこちらを使う。

const BLOCK = new Set(["P", "DIV", "LI", "UL", "OL", "PRE", "SECTION", "H1", "H2", "H3", "H4", "H5", "H6", "TABLE", "TR", "BLOCKQUOTE"]);

/** 見た目の行の区切り(段落・箇条書き・pre の改行)を保って文字列にする */
function blockText(root: Node): string {
  let out = "";
  const walk = (n: Node, inPre: boolean) => {
    if (n.nodeType === Node.TEXT_NODE) {
      const t = n.textContent ?? "";
      out += inPre ? t : t.replace(/\s+/g, " ");
      return;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const e = n as Element;
    if (e.tagName === "BR") {
      out += "\n";
      return;
    }
    if (e.tagName === "SCRIPT" || e.tagName === "STYLE") return;
    const block = BLOCK.has(e.tagName);
    if (block && out !== "" && !out.endsWith("\n")) out += "\n";
    for (const c of e.childNodes) walk(c, inPre || e.tagName === "PRE");
    if (block && !out.endsWith("\n")) out += "\n";
  };
  walk(root, false);
  return out;
}

/** KaTeX の数式を含む HTML なら、数式を TeX に戻した文字列を返す。含まなければ null */
export function katexHtmlToText(html: string): string | null {
  if (!html.includes("application/x-tex")) return null;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const nodes = [...doc.querySelectorAll(".katex")];
  if (nodes.length === 0) return null;
  for (const k of nodes) {
    const tex = k.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
    if (tex != null) k.replaceWith(doc.createTextNode(tex));
  }
  return blockText(doc.body)
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
