import type { Submission, Problem, ProblemModels } from "./types";

// kenkoooo.com は gzip 非対応クライアントを 403 で弾く(転送量対策)。
// ブラウザの fetch は常に Accept-Encoding: gzip を送るので問題ないが、
// Node や curl からこの API を叩くときは gzip を明示しないと 403 になる。
//
// kenkoooo は CORS を許可している(access-control-allow-origin: *)ので、本番はブラウザから直接読む
// (スナップショットが主・直接アクセスは差分とフォールバック)。開発時(vite dev)は
// devサーバーの同一オリジンプロキシ(vite.config.ts の /kenkoooo)経由にしている。
// Node から読み込むとき(scripts/smoke.mjs)は import.meta.env が無いので本番と同じ絶対URLにする。
const BASE = import.meta.env?.DEV
  ? "/kenkoooo/atcoder"
  : "https://kenkoooo.com/atcoder";

// API 利用規約: アクセス間隔は 1 秒以上あける
const PAGE_INTERVAL_MS = 1100;
const PAGE_SIZE = 500;

// kenkoooo が混んでいると応答が返らないまま待ち続けることがあるので、1リクエストごとに打ち切る
const REQUEST_TIMEOUT_MS = 15_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function abortError(): Error {
  return new DOMException("中断しました", "AbortError");
}

// kenkoooo へのリクエストは、ページ全体で前の開始から PAGE_INTERVAL_MS 以上あけて出す
// (ランキングのように何人分も続けて取るときも、利用規約の間隔を守り、混雑させない)。
// 順番待ちのあいだに中断されたら、その回は間隔を使わずに次へ譲る
let turn: Promise<void> = Promise.resolve();
let lastStart = 0;
function waitTurn(signal?: AbortSignal): Promise<void> {
  const next = turn.then(async () => {
    if (signal?.aborted) throw abortError();
    const wait = lastStart + PAGE_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    if (signal?.aborted) throw abortError();
    lastStart = Date.now();
  });
  turn = next.catch(() => {});
  return next;
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  // AbortSignal.any は古い Safari に無いので、タイムアウトと呼び出し元の中断を手でまとめる
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new DOMException("タイムアウトしました", "TimeoutError")), REQUEST_TIMEOUT_MS);
  const onAbort = () => ctl.abort(abortError());
  signal?.addEventListener("abort", onAbort);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`API error ${res.status}: ${url}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

export const fetchProblems = async () => {
  await waitTurn();
  return fetchJson<Problem[]>(`${BASE}/resources/problems.json`);
};

export const fetchProblemModels = async () => {
  await waitTurn();
  return fetchJson<ProblemModels>(`${BASE}/resources/problem-models.json`);
};

/** 途中のページで失敗した。partial はそれまでに取れた分(from_second からの昇順の先頭部分) */
export class FetchSubmissionsError extends Error {
  readonly partial: Submission[];
  constructor(partial: Submission[], cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = cause instanceof Error && cause.name === "AbortError" ? "AbortError" : "FetchSubmissionsError";
    this.partial = partial;
  }
}

const sortByTime = (list: Iterable<Submission>) =>
  [...list].sort((a, b) => a.epoch_second - b.epoch_second);

/**
 * 提出履歴を from_second から全件取得する。
 * 同一秒に複数提出がありうるため、次ページは「最後の提出の epoch_second」から
 * 重複込みで取得し、id で dedupe する(+1 すると同秒の取りこぼしがありうる)。
 * 途中で失敗・中断したら、それまでに取れた分を FetchSubmissionsError.partial に入れて投げる。
 */
export async function fetchSubmissionsSince(
  user: string,
  fromSecond: number,
  onProgress?: (fetched: number) => void,
  signal?: AbortSignal,
): Promise<Submission[]> {
  const byId = new Map<number, Submission>();
  let from = fromSecond;
  try {
    for (;;) {
      await waitTurn(signal);
      const page = await fetchJson<Submission[]>(
        `${BASE}/atcoder-api/v3/user/submissions?user=${encodeURIComponent(user)}&from_second=${from}`,
        signal,
      );
      let added = 0;
      for (const s of page) {
        if (!byId.has(s.id)) {
          byId.set(s.id, s);
          added++;
        }
      }
      onProgress?.(byId.size);
      if (page.length < PAGE_SIZE) break;
      const last = page[page.length - 1].epoch_second;
      if (added === 0 && last <= from) break;
      from = last;
    }
  } catch (e) {
    throw new FetchSubmissionsError(sortByTime(byId.values()), e);
  }
  return sortByTime(byId.values());
}

export function isValidAtcoderId(id: string): boolean {
  return /^[0-9A-Za-z_]{1,24}$/.test(id);
}
