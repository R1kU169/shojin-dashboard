// AtCoderの「公式レーティング」(プロフィールのユーザー名の色の基準)を取得する。
// board 本体の推定内部レート(irt.ts)とは別物で、ホームのアバター色はこちらに合わせる。
//
// 本番は public/snapshot/ratings.json を同一オリジンから読む(snapshot.ts)。
// ここの atcoder.jp 直読みは dev 専用のフォールバック。atcoder.jp は CORS ヘッダを返さないので
// ブラウザから直接は読めず、dev では devサーバーの同一オリジンプロキシ(vite.config.ts の /atcoder)
// 経由にする。本番でこの関数を呼ぶと必ず失敗するので、cache.ts 側で CAN_FETCH_ATCODER を見て
// 呼ばないようにしている。
import type { RatePoint } from "./types";

const ATCODER = import.meta.env?.DEV ? "/atcoder" : "https://atcoder.jp";
const INTERVAL_MS = 1000;
const TIMEOUT_MS = 15_000;

interface HistoryEntry {
  IsRated: boolean;
  NewRating: number;
  EndTime: string;
}

// atcoder.jp へは1人ずつ1秒あけて出す(ホーム・クラブで部員全員分を同時に求められても並べない)
let turn: Promise<unknown> = Promise.resolve();
// レートと推移は同じ履歴から作るので、同じ人の取得は1回にまとめる
const inflight = new Map<string, Promise<HistoryEntry[]>>();

function fetchHistory(user: string): Promise<HistoryEntry[]> {
  const key = user.toLowerCase();
  const hit = inflight.get(key);
  if (hit) return hit;
  const p = turn.then(async () => {
    try {
      const res = await fetch(`${ATCODER}/users/${encodeURIComponent(user)}/history/json`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`rating API error ${res.status}: ${user}`);
      return (await res.json()) as HistoryEntry[];
    } finally {
      await new Promise((r) => setTimeout(r, INTERVAL_MS));
    }
  });
  turn = p.catch(() => {});
  inflight.set(key, p);
  // 成功・失敗のどちらでも少しのあいだは同じ結果を使い回す
  p.catch(() => {}).finally(() => setTimeout(() => inflight.delete(key), 60_000));
  return p;
}

/**
 * 現在の公式レーティングを返す。レート付きコンテスト履歴の最後の NewRating。
 * レート付き参加が無い(未レート)場合は 0 を返す(= 灰)。
 */
export async function fetchAtcoderRating(user: string): Promise<number> {
  const hist = await fetchHistory(user);
  let rating = 0;
  for (const h of hist) if (h.IsRated) rating = h.NewRating;
  return rating;
}

/** 公式レーティングの推移(レート付きコンテストのみ、時系列昇順)。 */
export async function fetchRatingHistory(user: string): Promise<RatePoint[]> {
  const hist = await fetchHistory(user);
  const pts: RatePoint[] = [];
  for (const h of hist) {
    if (!h.IsRated) continue;
    pts.push({ t: Math.floor(new Date(h.EndTime).getTime() / 1000), r: h.NewRating });
  }
  return pts;
}
