import { get, set } from "idb-keyval";
import {
  fetchProblems,
  fetchProblemModels,
  fetchSubmissionsSince,
} from "./api";
import { fetchAtcoderRating, fetchRatingHistory } from "./rating";
import {
  snapshotModels,
  snapshotProblems,
  snapshotRatingHistories,
  snapshotRatings,
  snapshotSubs,
} from "./snapshot";
import type {
  Submission,
  Problem,
  ProblemModels,
  RatePoint,
} from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;
const SUBS_FRESH_MS = 10 * 60 * 1000; // 10分以内の再訪はAPIを叩かない

// atcoder.jp はCORSヘッダを返さないため、本番のブラウザからは直接読めない
// (実測: /users/*/history/json は 503)。devだけ同一オリジンプロキシ経由で叩ける。
// 本番でsnapshotに無いユーザー(=部員以外)は、必ず失敗するリクエストを出さずに
// 「レート不明」として扱う。呼び出し側は .catch() でレート表示を隠す。
const CAN_FETCH_ATCODER = import.meta.env.DEV;

class RatingUnavailable extends Error {
  constructor(user: string) {
    super(`レート情報がありません: ${user}`);
    this.name = "RatingUnavailable";
  }
}

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

/**
 * IndexedDB にキャッシュした資源。ttlMs を過ぎていたら取り直す。
 * staleWhileRevalidate なら、古いキャッシュがあればそれをすぐ返し、取り直しは裏で行う
 * (問題一覧のように1日遅れても困らないものの表示を待たせないため)。
 */
async function cachedResource<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs: number,
  staleWhileRevalidate = false,
): Promise<T> {
  const hit = (await get(key)) as ResourceEntry<T> | undefined;
  if (hit && Date.now() - hit.at < ttlMs) return hit.data;
  const existing = inflightRes.get(key);
  if (existing) return hit && staleWhileRevalidate ? hit.data : (existing as Promise<T>);
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
  if (hit && staleWhileRevalidate) {
    p.catch(() => {}); // 裏の取り直しの失敗は次の訪問で再挑戦する
    return hit.data;
  }
  return p;
}

// まず同一オリジンのスナップショットを読み、無ければ kenkoooo に直接フォールバックする。
export const getProblems = () =>
  cachedResource<Problem[]>(
    "res:problems",
    async () => (await snapshotProblems()) ?? (await fetchProblems()),
    DAY_MS,
    true,
  );

export const getProblemModels = () =>
  cachedResource<ProblemModels>(
    "res:models",
    async () => (await snapshotModels()) ?? (await fetchProblemModels()),
    DAY_MS,
    true,
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
 * 無ければ(部員以外・snapshot未生成)devのみ atcoder.jp へフォールバックする。
 * 取得できない時は例外を投げる(呼び出し側で .catch(() => null) して中立色にする)。
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
      if (!CAN_FETCH_ATCODER) throw new RatingUnavailable(user);
      return fetchAtcoderRating(user);
    },
    DAY_MS,
  );

// 公式レーティング推移。snapshot(rating-history.json)を土台に、無ければatcoder.jpへ。
const ratingHistories = () =>
  cachedResource<Record<string, RatePoint[]>>(
    "res:rating-hist",
    async () => (await snapshotRatingHistories()) ?? {},
    DAY_MS,
  );

/** ユーザーの公式レーティング推移(時系列)。取得不可時は例外(呼び出し側で .catch)。 */
export const getRatingHistory = (user: string): Promise<RatePoint[]> =>
  cachedResource<RatePoint[]>(
    `res:rhist:${user.toLowerCase()}`,
    async () => {
      const key = user.toLowerCase();
      const map = await ratingHistories().catch(
        () => ({}) as Record<string, RatePoint[]>,
      );
      if (map[key]) return map[key];
      if (!CAN_FETCH_ATCODER) throw new RatingUnavailable(user);
      return fetchRatingHistory(user);
    },
    DAY_MS,
  );

/** 手元にある提出履歴(IndexedDB のキャッシュか、同一オリジンのスナップショット) */
export interface LocalSubs {
  list: Submission[];
  watermark: number;
  /** 最後に kenkoooo から取った時刻(スナップショットなら作った時刻) */
  at: number;
  /** 10分以内に取ったもので、取り直さなくてよい */
  fresh: boolean;
}

// 同じユーザーのスナップショットを、表示用と取得用で2回読まないよう少しの間覚えておく
const snapMemo = new Map<string, { at: number; p: ReturnType<typeof snapshotSubs> }>();
const SNAP_MEMO_MS = 60 * 1000;

function snapshotSubsMemo(user: string) {
  const key = user.toLowerCase();
  const m = snapMemo.get(key);
  if (m && Date.now() - m.at < SNAP_MEMO_MS) return m.p;
  const p = snapshotSubs(user);
  snapMemo.set(key, { at: Date.now(), p });
  return p;
}

/**
 * kenkoooo に問い合わせずに手元で用意できる提出履歴(表示用)。IndexedDB のキャッシュがあればそれを
 * (古くても)すぐ返し、無ければ同一オリジンのスナップショットを読む。どちらも無ければ null。
 */
export async function peekSubmissions(user: string): Promise<LocalSubs | null> {
  const hit = (await get(`subs:${user.toLowerCase()}`)) as SubsEntry | undefined;
  if (hit) return { ...hit, fresh: Date.now() - hit.at < SUBS_FRESH_MS };
  const snap = await snapshotSubsMemo(user);
  return snap ? { list: snap.list, watermark: snap.watermark, at: snap.at, fresh: false } : null;
}

/**
 * 差分を取る起点。IndexedDB のキャッシュが古く、6時間ごとに更新されるスナップショットのほうが新しければ
 * それと合わせる(しばらく間が空いた再訪でも、kenkoooo から取り直す範囲を短くする)。
 */
async function refreshBase(user: string): Promise<LocalSubs | null> {
  const local = await peekSubmissions(user);
  if (!local || local.fresh) return local;
  const snap = await snapshotSubsMemo(user);
  if (!snap || snap.watermark <= local.watermark) return local;
  const byId = new Map<number, Submission>();
  for (const s of local.list) byId.set(s.id, s);
  for (const s of snap.list) byId.set(s.id, s);
  const list = [...byId.values()].sort((a, b) => a.epoch_second - b.epoch_second);
  return { list, watermark: snap.watermark, at: snap.at, fresh: false };
}

export interface LoadedSubs {
  list: Submission[];
  /** kenkoooo から最新の差分を取れたか(false なら手元のデータのまま) */
  live: boolean;
  /** list がいつ時点のものか(取れなかったときは手元のデータの時刻) */
  at: number;
}

interface InflightSubs {
  promise: Promise<LoadedSubs>;
  onProgress?: (fetched: number) => void;
}

const inflightSubs = new Map<string, InflightSubs>();

/**
 * 提出履歴の増分キャッシュ。手元の最終提出時刻(watermark)以降だけを
 * APIから取り、IndexedDB内のリストへマージする。
 */
export function loadSubmissions(
  user: string,
  onProgress?: (fetched: number) => void,
): Promise<Submission[]> {
  return refreshSubmissions(user, onProgress).then((r) => r.list);
}

/** loadSubmissions と同じだが、最新を取れたかと時点も返す */
export function refreshSubmissions(
  user: string,
  onProgress?: (fetched: number) => void,
): Promise<LoadedSubs> {
  const key = user.toLowerCase();
  const existing = inflightSubs.get(key);
  if (existing) {
    if (onProgress) existing.onProgress = onProgress;
    return existing.promise;
  }
  const entry: InflightSubs = {
    promise: Promise.resolve({ list: [], live: false, at: 0 }),
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
): Promise<LoadedSubs> {
  const key = `subs:${user.toLowerCase()}`;
  // 取得の起点。IndexedDBキャッシュとスナップショットの新しいほう(初回訪問者もスナップショットで即座に土台がある)
  const base = await refreshBase(user);
  if (base?.fresh) return { list: base.list, live: true, at: base.at };
  const baseList = base?.list ?? [];
  const baseWatermark = base?.watermark ?? 0;

  // 差分だけを kenkoooo からライブ取得する。ブロックやレート制限・タイムアウトで失敗しても、
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
      return { list: baseList, live: false, at: base?.at ?? 0 };
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
  const at = Date.now();
  await set(key, { at, watermark, list } satisfies SubsEntry);
  return { list, live: true, at };
}
