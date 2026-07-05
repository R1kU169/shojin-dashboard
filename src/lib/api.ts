import type { Submission, Problem, ProblemModels } from "./types";

// kenkoooo.com は gzip 非対応クライアントを 403 で弾く(転送量対策)。
// ブラウザの fetch は常に Accept-Encoding: gzip を送るので問題ないが、
// Node や curl からこの API を叩くときは gzip を明示しないと 403 になる。
const BASE = "https://kenkoooo.com/atcoder";

// API 利用規約: アクセス間隔は 1 秒以上あける
const PAGE_INTERVAL_MS = 1100;
const PAGE_SIZE = 500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error ${res.status}: ${url}`);
  return res.json() as Promise<T>;
}

export const fetchProblems = () =>
  fetchJson<Problem[]>(`${BASE}/resources/problems.json`);

export const fetchProblemModels = () =>
  fetchJson<ProblemModels>(`${BASE}/resources/problem-models.json`);

/**
 * 提出履歴を from_second から全件取得する。
 * 同一秒に複数提出がありうるため、次ページは「最後の提出の epoch_second」から
 * 重複込みで取得し、id で dedupe する(+1 すると同秒の取りこぼしがありうる)。
 */
export async function fetchSubmissionsSince(
  user: string,
  fromSecond: number,
  onProgress?: (fetched: number) => void,
): Promise<Submission[]> {
  const byId = new Map<number, Submission>();
  let from = fromSecond;
  for (;;) {
    const page = await fetchJson<Submission[]>(
      `${BASE}/atcoder-api/v3/user/submissions?user=${encodeURIComponent(user)}&from_second=${from}`,
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
    await sleep(PAGE_INTERVAL_MS);
  }
  return [...byId.values()].sort((a, b) => a.epoch_second - b.epoch_second);
}

export function isValidAtcoderId(id: string): boolean {
  return /^[0-9A-Za-z_]{1,24}$/.test(id);
}
