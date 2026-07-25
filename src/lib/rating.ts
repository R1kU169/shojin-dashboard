// AtCoderの「公式レーティング」(プロフィールのユーザー名の色の基準)を取得する。
// board 本体の推定内部レート(irt.ts)とは別物で、ホームのアバター色はこちらに合わせる。
//
// 本番は public/snapshot/ratings.json を同一オリジンから読むのが主(snapshot.ts)。
// スナップショットが無い場合(dev等)のフォールバックとして atcoder.jp を叩く。
// ブラウザから atcoder.jp を直接叩くと CORS で弾かれるため、dev では
// devサーバーの同一オリジンプロキシ(vite.config.ts の /atcoder)経由にする。
import type { RatePoint } from "./types";

const ATCODER = import.meta.env.DEV ? "/atcoder" : "https://atcoder.jp";

interface HistoryEntry {
  IsRated: boolean;
  NewRating: number;
  EndTime: string;
}

async function fetchHistory(user: string): Promise<HistoryEntry[]> {
  const res = await fetch(
    `${ATCODER}/users/${encodeURIComponent(user)}/history/json`,
  );
  if (!res.ok) throw new Error(`rating API error ${res.status}: ${user}`);
  return (await res.json()) as HistoryEntry[];
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
