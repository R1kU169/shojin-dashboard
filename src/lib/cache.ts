import { get, set } from "idb-keyval";
import {
  fetchProblems,
  fetchProblemModels,
  fetchSubmissionsSince,
} from "./api";
import { fetchAtcoderRating } from "./rating";
import {
  snapshotModels,
  snapshotProblems,
  snapshotRatings,
  snapshotSubs,
} from "./snapshot";
import type { Submission, Problem, ProblemModels } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;
const SUBS_FRESH_MS = 10 * 60 * 1000; // 10分以内の再訪はAPIを叩かない

interface ResourceEntry<T> {
  at: number;
  data: T;
}

interface SubsEntry {
  at: number;
  watermark: number;
  list: Submission[];
}

// React StrictModeの二重マウント等で同じ取得が並走してもAPIを1回しか叩かない
const inflightRes = new Map<string, Promise<unknown>>();

async function cachedResource<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs: number,
): Promise<T> {
  const hit = (await get(key)) as ResourceEntry<T> | undefined;
  if (hit && Date.now() - hit.at < ttlMs) return hit.data;
  const existing = inflightRes.get(key);
  if (existing) return existing as Promise<T>;
  const p = (async () => {
    try {
      const data = await fetcher();
      await set(key, { at: Date.now(), data } satisfies ResourceEntry<T>);
      return data;
    } catch (e) {
      if (hit) return hit.data; // オフライン等では古いキャッシュで継続
      throw e;
    }
  })().finally(() => inflightRes.delete(key));
  inflightRes.set(key, p);
  return p;
}

// まず同一オリジンのスナップショットを読み、無ければ kenkoooo に直接フォールバックする。
export const getProblems = () =>
  cachedResource<Problem[]>(
    "res:problems",
    async () => (await snapshotProblems()) ?? (await fetchProblems()),
    DAY_MS,
  );

export const getProblemModels = () =>
  cachedResource<ProblemModels>(
    "res:models",
    async () => (await snapshotModels()) ?? (await fetchProblemModels()),
    DAY_MS,
  );

// 全部員の公式レーティング表(snapshot ratings.json)。無ければ空表(devや未生成時)。
const ratingsMap = () =>
  cachedResource<Record<string, number>>(
    "res:ratings",
    async () => (await snapshotRatings()) ?? {},
    DAY_MS,
  );

/**
 * ユーザーの公式レーティング(未レートは0)。まず同一オリジンのsnapshot表を引き、
 * 無ければ(部員以外・snapshot未生成)atcoder.jpへフォールバックする。
 * 取得失敗時は例外を投げる(呼び出し側で .catch(() => null) して中立色にする)。
 */
export const getRating = (user: string): Promise<number> =>
  cachedResource<number>(
    `res:rating:${user.toLowerCase()}`,
    async () => {
      const key = user.toLowerCase();
      const map = await ratingsMap().catch(
        () => ({}) as Record<string, number>,
      );
      if (map[key] != null) return map[key];
      return fetchAtcoderRating(user);
    },
    DAY_MS,
  );

interface InflightSubs {
  promise: Promise<Submission[]>;
  onProgress?: (fetched: number) => void;
}

const inflightSubs = new Map<string, InflightSubs>();

/**
 * 提出履歴の増分キャッシュ。前回取得の最終提出時刻(watermark)以降だけを
 * APIから取り、IndexedDB内のリストへマージする。
 */
export function loadSubmissions(
  user: string,
  onProgress?: (fetched: number) => void,
): Promise<Submission[]> {
  const key = user.toLowerCase();
  const existing = inflightSubs.get(key);
  if (existing) {
    if (onProgress) existing.onProgress = onProgress;
    return existing.promise;
  }
  const entry: InflightSubs = {
    promise: Promise.resolve([]),
    onProgress,
  };
  entry.promise = doLoadSubmissions(user, (n) => entry.onProgress?.(n)).finally(
    () => inflightSubs.delete(key),
  );
  inflightSubs.set(key, entry);
  return entry.promise;
}

async function doLoadSubmissions(
  user: string,
  onProgress: (fetched: number) => void,
): Promise<Submission[]> {
  const key = `subs:${user.toLowerCase()}`;
  const hit = (await get(key)) as SubsEntry | undefined;
  if (hit && Date.now() - hit.at < SUBS_FRESH_MS) return hit.list;

  // 取得の起点。IndexedDBキャッシュがあればそれ、無ければ同一オリジンの
  // スナップショットで初回訪問者にも即座に土台データを渡す。
  let baseList = hit?.list ?? [];
  let baseWatermark = hit?.watermark ?? 0;
  if (!hit) {
    const snap = await snapshotSubs(user);
    if (snap) {
      baseList = snap.list;
      baseWatermark = snap.watermark;
    }
  }

  // 差分だけを kenkoooo からライブ取得する。ブロックやレート制限で失敗しても、
  // 土台データがあれば致命扱いにせずそれを表示する(Failed to fetch対策の要)。
  let fresh: Submission[];
  try {
    fresh = await fetchSubmissionsSince(user, baseWatermark, onProgress);
  } catch (e) {
    if (baseList.length > 0) {
      // 10分間は再取得を試みないようキャッシュしておく(kenkooooへの負荷も下げる)
      await set(key, {
        at: Date.now(),
        watermark: baseWatermark,
        list: baseList,
      } satisfies SubsEntry);
      return baseList;
    }
    throw e;
  }

  const byId = new Map<number, Submission>();
  for (const s of baseList) byId.set(s.id, s);
  for (const s of fresh) byId.set(s.id, s);
  const list = [...byId.values()].sort(
    (a, b) => a.epoch_second - b.epoch_second,
  );
  const watermark = list.length > 0 ? list[list.length - 1].epoch_second : 0;
  await set(key, { at: Date.now(), watermark, list } satisfies SubsEntry);
  return list;
}
