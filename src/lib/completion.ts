// エディターの識別子補完。いま書いているコードに出てくる単語だけを候補にする。
// 言語ごとのキーワード表は持たない: テンプレートに cin/cout/int などが入っているので
// 実用上は自然に候補へ入るし、言語非依存で誤爆も少ない。

/** 補完の候補と、確定時に置き換える範囲の開始位置 */
export interface Completion {
  items: string[];
  /** 入力中の語の開始位置(ここからキャレットまでを置き換える) */
  from: number;
}

// PHP/Perl/Bashの $name を1語として扱うため $ を含める
const WORD_CHAR = /[A-Za-z0-9_$]/;
const WORD_START = /[A-Za-z_$]/;

/**
 * 何文字打ったら候補を出すか。
 * 競プロのコードは n/i/a のような1文字名だらけなので、1文字で出すと
 * ほぼ全打鍵でポップアップが点滅して邪魔になる。
 */
const MIN_PREFIX = 2;
const MAX_ITEMS = 8;

/**
 * キャレット直前の語を接頭辞として、バッファ内の識別子から候補を集める。
 * 候補が無いときは null。
 */
export function collectCompletions(
  text: string,
  caret: number,
): Completion | null {
  // 既存の語の途中にキャレットがあるときは出さない
  if (WORD_CHAR.test(text[caret] ?? "")) return null;

  let from = caret;
  while (from > 0 && WORD_CHAR.test(text[from - 1])) from--;
  const prefix = text.slice(from, caret);
  if (prefix.length < MIN_PREFIX) return null;
  // 数値リテラルの途中(12など)では出さない
  if (!WORD_START.test(prefix[0])) return null;

  // 語ごとに「出現回数」と「キャレットからの最短距離」を集める。
  // 正規表現は毎回作る: /g のlastIndexが呼び出しをまたいで残ると
  // 候補が1回おきに消えるという厄介なバグになる
  const found = new Map<string, { count: number; best: number }>();
  for (const m of text.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)) {
    const w = m[0];
    const at = m.index;
    // 入力中の語そのものは候補にしない。位置で判定するのが要点で、
    // 文字列一致で外すと「まさに補完したい同名の識別子」まで落ちてしまう
    if (at === from) continue;
    if (w === prefix || !w.startsWith(prefix)) continue;
    const d = Math.abs(at - caret);
    const cur = found.get(w);
    if (cur) {
      cur.count++;
      if (d < cur.best) cur.best = d;
    } else {
      found.set(w, { count: 1, best: d });
    }
  }
  if (found.size === 0) return null;

  const items = [...found.entries()]
    .sort(
      (a, b) =>
        // 近さ(1ファイル内では局所性が一番強い手がかり) → 出現回数 → 短さ → 名前
        a[1].best - b[1].best ||
        b[1].count - a[1].count ||
        a[0].length - b[0].length ||
        a[0].localeCompare(b[0]),
    )
    .slice(0, MAX_ITEMS)
    .map(([w]) => w);
  return { items, from };
}
