// ブックマークレット(bookmarklet.ts)が AtCoder の問題ページから送ってくるデータの形と、
// URL(#/editor?import=…)に載せるための base64url の変換。
//
// URL は誰でも作れるので、受け取った側では中身を信用しない: ID の形・件数・大きさを確かめ、
// 問題文の HTML は DOMParser で文字列にするだけ(ページには HTML として入れない)。

export interface ImportTask {
  /** 問題ID(abc481_c) */
  task: string;
  /** 「C - Bank Accounts」 */
  title: string;
  /** 問題文(日本語)の HTML。数式は TeX に戻し、入力例・出力例は除いてある */
  html: string;
}

export interface ImportPayload {
  v: 1;
  /** 押したページのコンテストID(abc481・adt_all_20251024_1 など) */
  contest: string;
  /** 問題ページで押したときはその問題。「問題一括表示」で押したときは null */
  current: string | null;
  tasks: ImportTask[];
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_TASKS = 20;
const MAX_TITLE = 200;
const MAX_HTML = 100_000;
/** URL の import= の長さの上限(base64 で 300KB ≒ 元の 225KB) */
export const MAX_PARAM = 300_000;

/** UTF-8 のバイト列を base64url にする(大きい配列を一度に fromCharCode へ渡すと RangeError になるので 8K ずつ) */
export function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(s: string): string | null {
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function encodeImport(p: ImportPayload): string {
  return toBase64Url(JSON.stringify(p));
}

/** URL の import= の値を読む。形がおかしければ null */
export function decodeImport(param: string): ImportPayload | null {
  if (param.length === 0 || param.length > MAX_PARAM) return null;
  const json = fromBase64Url(param);
  if (json === null) return null;
  let j: unknown;
  try {
    j = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof j !== "object" || j === null) return null;
  const o = j as Record<string, unknown>;
  if (o.v !== 1 || typeof o.contest !== "string" || !ID.test(o.contest)) return null;
  if (!Array.isArray(o.tasks) || o.tasks.length === 0 || o.tasks.length > MAX_TASKS) return null;
  const tasks: ImportTask[] = [];
  const seen = new Set<string>();
  for (const t of o.tasks as unknown[]) {
    if (typeof t !== "object" || t === null) return null;
    const r = t as Record<string, unknown>;
    if (typeof r.task !== "string" || !ID.test(r.task) || seen.has(r.task)) return null;
    if (typeof r.html !== "string" || r.html.length > MAX_HTML) return null;
    const title = typeof r.title === "string" ? r.title.trim().slice(0, MAX_TITLE) : "";
    seen.add(r.task);
    tasks.push({ task: r.task, title, html: r.html });
  }
  const current = typeof o.current === "string" && seen.has(o.current) ? o.current : null;
  return { v: 1, contest: o.contest, current, tasks };
}

/** 「C - Bank Accounts」→「C. Bank Accounts」(AtCoder Problems の問題名と同じ書き方にそろえる) */
export function linkedTitle(title: string): string {
  const m = title.match(/^([A-Za-z0-9]{1,4})\s+-\s+(.+)$/);
  return m ? `${m[1]}. ${m[2]}` : title;
}

/** 問題の記号(「C - Bank Accounts」→「C」)。読めなければ問題IDの末尾 */
export function taskLetter(t: { task: string; title: string }): string {
  const m = t.title.match(/^([A-Za-z0-9]{1,4})\s*[-.]\s/);
  return m ? m[1].toUpperCase() : (t.task.split("_").pop() ?? t.task).toUpperCase();
}
