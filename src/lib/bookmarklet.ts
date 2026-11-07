// ブックマークレット「精進ボードに送る」。AtCoder の問題ページ(または「問題一括表示」)で押すと、
// 問題文から入力・制約などの節を取り出してエディターを開き、コーナーケースに読み込ませる。
//
// - AtCoder のページ(ログイン中のこともある)の中で動くので、外部のスクリプトは読まず、ここに全部書く。
//   ボード側が改ざんされても、登録済みのブックマークレットの動きは変わらない。
// - 問題文はユーザーのブラウザの中で受け渡すだけ。URL の # より後ろはサーバーに送られない。
// - 問題ID は「問題一括表示」には載っていないので、そのときだけ同じオリジンの問題一覧を1回読む。
// - 先に名前付きのウィンドウを開いてから(ユーザーの操作の直後でないとポップアップを止められる)、
//   問題一覧を読み終えたところで行き先を書き換える。noopener は付けない(付けると名前で同じタブを探せない)。
//
// ここを変えたら、登録し直してもらわないと反映されない。形を変えるときは importPayload.ts の v を上げる。

const SOURCE = String.raw`(async () => {
  const APP = __APP__;
  const m = location.hostname === "atcoder.jp" && location.pathname.match(/^\/contests\/([^/]+)\/(?:tasks\/([^/]+)|tasks_print)\/?$/);
  if (!m) {
    alert("AtCoder の問題ページ(または「問題一括表示」)で押してください");
    return;
  }
  const contest = m[1];
  const own = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();
  const grab = (root) => {
    const st = root.querySelector("#task-statement");
    if (!st) return null;
    const c = (st.querySelector(".lang-ja") || st).cloneNode(true);
    c.querySelectorAll(".katex").forEach((k) => {
      const a = k.querySelector('annotation[encoding="application/x-tex"]');
      k.replaceWith(a ? a.textContent : k.textContent);
    });
    c.querySelectorAll("section").forEach((s) => {
      const h = s.querySelector("h3");
      if (h && /^(入力例|出力例|入出力例|Sample)/.test(h.textContent.trim())) s.remove();
    });
    c.querySelectorAll("script,style,img,button,.btn-copy,.div-btn-copy").forEach((e) => e.remove());
    return c.innerHTML;
  };
  const tasks = [];
  if (m[2]) {
    const h = document.querySelector("span.h2");
    const html = grab(document);
    if (html !== null) tasks.push({ task: m[2], title: h ? own(h) : "", html });
  } else {
    document.querySelectorAll("span.h2").forEach((h) => {
      const title = own(h);
      const html = grab(h.parentElement);
      if (html !== null) tasks.push({ task: "", letter: title.split(" - ")[0].trim(), title, html });
    });
  }
  if (tasks.length === 0) {
    alert("問題文が見つかりませんでした");
    return;
  }
  const w = window.open("", "shojin-editor");
  if (!w) {
    alert("ポップアップがブロックされました。atcoder.jp のポップアップを許可してください");
    return;
  }
  if (!m[2]) {
    const ids = {};
    try {
      const ac = new AbortController();
      setTimeout(() => ac.abort(), 5000);
      const res = await fetch("/contests/" + contest + "/tasks", { signal: ac.signal });
      const doc = new DOMParser().parseFromString(await res.text(), "text/html");
      doc.querySelectorAll("table tbody tr").forEach((tr) => {
        const a = tr.querySelector("td a[href*='/tasks/']");
        if (a) ids[a.textContent.trim()] = a.getAttribute("href").split("/").pop();
      });
    } catch (e) {}
    tasks.forEach((t) => {
      t.task = ids[t.letter] || contest.replace(/-/g, "_") + "_" + t.letter.toLowerCase();
      delete t.letter;
    });
  }
  const bytes = new TextEncoder().encode(JSON.stringify({ v: 1, contest, current: m[2] || null, tasks }));
  let bin = "";
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  const d = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  w.location.href = APP + "#/editor?import=" + d;
  w.focus();
})()`;

/**
 * ブックマークに登録する URL。appUrl は開いているボードの URL(本番も開発サーバーも同じコードで動く)。
 * 改行と字下げは詰め、URL として使えない文字は encodeURIComponent する
 */
export function bookmarkletHref(appUrl: string): string {
  const src = SOURCE.replace("__APP__", JSON.stringify(appUrl))
    .split("\n")
    .map((l) => l.trim())
    .join("\n");
  return `javascript:${encodeURIComponent(src)}`;
}

/** テスト・確かめ用: ブックマークレットの本体(javascript: を除いたもの) */
export function bookmarkletSource(appUrl: string): string {
  return decodeURIComponent(bookmarkletHref(appUrl).slice("javascript:".length));
}
