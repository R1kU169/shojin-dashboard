import { MEMBERS } from "../data/members";
import type {
  Problem,
  ProblemModels,
  RatePoint,
  Submission,
  UpcomingContest,
} from "./types";

// scripts/build-snapshot.mjs が public/snapshot/ に書き出す静的データを、
// 同一オリジンから読む。base は相対(vite.config: base "./")なので、
// document のベースURL(.../shojin-dashboard/)基準で解決される。
const SNAP = `${import.meta.env.BASE_URL}snapshot`;

// 応答が始まるまでは短く待ち、始まったら本文(問題一覧は数MB)の受信には余裕を持たせる。
// 遅い回線で本文ごと10秒で打ち切ると、もっと重い kenkoooo への直接取得に落ちてしまうため
const HEADER_TIMEOUT_MS = 10_000;
const BODY_TIMEOUT_MS = 60_000;

async function snapJson<T>(file: string): Promise<T | null> {
  const ctl = new AbortController();
  let timer = setTimeout(() => ctl.abort(), HEADER_TIMEOUT_MS);
  try {
    const res = await fetch(`${SNAP}/${file}`, { cache: "no-cache", signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    timer = setTimeout(() => ctl.abort(), BODY_TIMEOUT_MS);
    return (await res.json()) as T;
  } catch {
    // スナップショット未デプロイやオフライン時は null を返し、呼び出し側で
    // kenkoooo への直接アクセスにフォールバックさせる。
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export const snapshotProblems = () => snapJson<Problem[]>("problems.json");

export const snapshotModels = () => snapJson<ProblemModels>("problem-models.json");

/** 部員の公式レーティング: { id(小文字): rating }。ホームのアバター色に使う。 */
export const snapshotRatings = () =>
  snapJson<Record<string, number>>("ratings.json");

/** 部員の公式レーティング推移: { id(小文字): RatePoint[] }。個人ページの推移グラフに使う。 */
export const snapshotRatingHistories = () =>
  snapJson<Record<string, RatePoint[]>>("rating-history.json");

/** 予定されているABC/ARC/AGC(開始昇順)。ホームの「次のコンテスト」リンクに使う。 */
export const snapshotUpcoming = () =>
  snapJson<UpcomingContest[]>("upcoming.json");

export interface SubsSnapshot {
  at: number;
  watermark: number;
  list: Submission[];
}

const MEMBER_IDS = new Set(MEMBERS.map((m) => m.id.toLowerCase()));

/** 部員の提出履歴。スナップショットは部員の分しか作らないので、部員以外は取りに行かない(404 を出さない) */
export const snapshotSubs = async (user: string): Promise<SubsSnapshot | null> =>
  MEMBER_IDS.has(user.toLowerCase()) ? snapJson<SubsSnapshot>(`subs/${user.toLowerCase()}.json`) : null;
