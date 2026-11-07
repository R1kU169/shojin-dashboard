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
/** 1回で取り込める問題の数(EDPC の「問題一括表示」は 26 問) */
export const MAX_TASKS = 40;
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

/** 取り込めなかった理由(画面に出し分ける) */
export type ImportError = "too-large" | "too-many" | "broken";

/** URL の import= の値を読む。形がおかしければ null */
export function decodeImport(param: string): ImportPayload | null {
  const r = readImport(param);
  return "error" in r ? null : r.payload;
}

/** URL の import= の値を読む。取り込めなければ理由 */
export function readImport(param: string): { payload: ImportPayload } | { error: ImportError } {
  if (param.length > MAX_PARAM) return { error: "too-large" };
  const p = parsePayload(param);
  return typeof p === "string" ? { error: p } : { payload: p };
}

function parsePayload(param: string): ImportPayload | ImportError {
  if (param.length === 0) return "broken";
  const json = fromBase64Url(param);
  if (json === null) return "broken";
  let j: unknown;
  try {
    j = JSON.parse(json);
  } catch {
    return "broken";
  }
  if (typeof j !== "object" || j === null) return "broken";
  const o = j as Record<string, unknown>;
  if (o.v !== 1 || typeof o.contest !== "string" || !ID.test(o.contest)) return "broken";
  if (!Array.isArray(o.tasks) || o.tasks.length === 0) return "broken";
  if (o.tasks.length > MAX_TASKS) return "too-many";
  const tasks: ImportTask[] = [];
  const seen = new Set<string>();
  for (const t of o.tasks as unknown[]) {
    if (typeof t !== "object" || t === null) return "broken";
    const r = t as Record<string, unknown>;
    if (typeof r.task !== "string" || !ID.test(r.task) || seen.has(r.task)) return "broken";
    if (typeof r.html !== "string" || r.html.length > MAX_HTML) return "broken";
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

/** 問題の記号(「C - Bank Accounts」→「C」、「Ex. …」→「Ex」)。読めなければ問題IDの末尾を大文字で */
export function taskLetter(t: { task: string; title: string }): string {
  const m = t.title.match(/^([A-Za-z0-9]{1,4})\s*[-.]\s/);
  return m ? m[1] : (t.task.split("_").pop() ?? t.task).toUpperCase();
}
