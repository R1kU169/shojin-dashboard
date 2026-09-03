// エディターの行コメントのトグル(Ctrl+/)。
// 言語ごとの記号表と、置き換えパッチを作る純粋関数だけを持つ。
// 言語別のテーブルを EditorLang に足さないのは、highlight.ts の LANG_MAP や
// godbolt.ts の GODBOLT_LANGS と同じく「機能ごとのテーブルは機能の側に置く」流儀に合わせるため。

/** edit()(EditorPage)にそのまま渡せる置換パッチ */
export interface CommentToggle {
  from: number;
  to: number;
  text: string;
  selFrom: number;
  selTo: number;
}

// EditorLang.key → 行コメントの記号。EDITOR_LANGS と同じ19言語を並べてあるので、
// 言語を足したときの抜けが目視で分かる。
const LINE_COMMENT: Record<string, string> = {
  cpp: "//",
  python: "#",
  pypy: "#",
  java: "//",
  c: "//",
  csharp: "//",
  rust: "//",
  go: "//",
  js: "//",
  ts: "//",
  ruby: "#",
  haskell: "--",
  d: "//",
  nim: "#",
  julia: "#",
  perl: "#",
  php: "//",
  lua: "--",
  bash: "#",
};

const indentOf = (line: string): string => /^[ \t]*/.exec(line)?.[0] ?? "";

/**
 * 選択範囲(またはカーソル行)の行コメントをトグルする。
 *
 * 対象行がすべてコメント済みなら外し、そうでなければ全部に付ける(VS Codeと同じ)。
 * 変化が無いときや未対応言語では null を返し、呼び出し側でキー入力を素通しさせる。
 */
export function toggleLineComment(
  code: string,
  selStart: number,
  selEnd: number,
  langKey: string,
): CommentToggle | null {
  const tok = LINE_COMMENT[langKey];
  if (!tok) return null;

  // 行範囲の導出は Tab のブロックインデントと同じ式。これ1つで
  //  - 選択が行頭でちょうど終わるとき次の行を巻き込まない(selEnd - 1)
  //  - 選択が無いときもカーソル行だけになる(Math.max)
  //  - 末尾に改行が無い最終行(indexOf が -1)
  // の3つが同時に解ける。
  // selStart が 0 のとき lastIndexOf に -1 を渡すと、負値は 0 にクランプされて
  // 先頭の改行自身に一致してしまう(from > to の壊れたパッチになる)ので分岐する
  const blockStart =
    selStart === 0 ? 0 : code.lastIndexOf("\n", selStart - 1) + 1;
  const found = code.indexOf("\n", Math.max(selStart, selEnd - 1));
  const blockEnd = found === -1 ? code.length : found;
  const original = code.slice(blockStart, blockEnd);
  const lines = original.split("\n");

  // 空白だけの行は「全部コメント済みか」の判定から外す
  const active = lines.filter((l) => l.trim() !== "");
  const allCommented =
    active.length > 0 &&
    active.every((l) => l.slice(indentOf(l).length).startsWith(tok));

  const multi = lines.length > 1;
  const converted = lines.map((line) => {
    const ws = indentOf(line);
    const body = line.slice(ws.length);
    if (allCommented) {
      if (!body.startsWith(tok)) return line; // 空白だけの行
      // 記号の後ろの空白は「1つだけ」外す。2つ以上あるのは意図した字下げなので残す
      const rest = body.slice(tok.length);
      return ws + (rest.startsWith(" ") ? rest.slice(1) : rest);
    }
    // 複数行のときは空白だけの行に記号を付けない(末尾にゴミを残さない)
    if (multi && line.trim() === "") return line;
    return `${ws}${tok} ${body}`;
  });

  const text = converted.join("\n");
  if (text === original) return null; // 無駄なundo項目を作らない

  if (selStart !== selEnd) {
    // 選択時はブロック全体を選び直す。Tabハンドラと同じ流儀で、
    // 連続で押しても同じ行に当たり続ける
    return {
      from: blockStart,
      to: blockEnd,
      text,
      selFrom: blockStart,
      selTo: blockStart + text.length,
    };
  }
  // カーソルだけのときは、その行の増減分だけずらして同じ位置に留める
  const delta = converted[0].length - lines[0].length;
  const caret = Math.min(
    Math.max(selStart + delta, blockStart),
    blockStart + text.length,
  );
  return { from: blockStart, to: blockEnd, text, selFrom: caret, selTo: caret };
}
