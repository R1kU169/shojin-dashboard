import { get, set } from "idb-keyval";
import {
  FetchSubmissionsError,
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
// スナップショットは6時間ごとに作り直すので、レートは1時間で読み直す(土曜の ABC の結果を翌日まで待たせない)
const RATING_TTL_MS = 60 * 60 * 1000;
const SUBS_FRESH_MS = 10 * 60 * 1000; // 10分以内の再訪はAPIを叩かない
// 差分は手元の最後の提出の1日前から取り直す。kenkoooo に遅れて載った提出や、判定が後から変わった提出を拾うための保険
const OVERLAP_SEC = 24 * 60 * 60;

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
  /** 最後に kenkoooo から最新まで取れた時刻(スナップショット由来ならそれを作った時刻) */
  at: number;
  watermark: number;
  list: Submission[];
  /** 最後に取得を試して失敗した時刻。10分は取り直さない(at は変えない) */
  triedAt?: number;
}

// IndexedDB はプライベートモードや容量超過で失敗することがある。読めなければ無いものとして、
// 書けなければ保存しないだけで、取れたデータの表示は続ける
async function safeGet<T>(key: string): Promise<T | undefined> {
  try {
    return (await get(key)) as T | undefined;
  } catch {
    return undefined;
  }
}

async function safeSet(key: string, value: unknown): Promise<void> {
  try {
    await set(key, value);
  } catch {
    // 保存できなくても続ける
  }
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
  const hit = await safeGet<ResourceEntry<T>>(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data;
  const existing = inflightRes.get(key);
  if (existing) return hit && staleWhileRevalidate ? hit.data : (existing as Promise<T>);
  const p = (async () => {
    try {
      const data = await fetcher();
      await safeSet(key, { at: Date.now(), data } satisfies ResourceEntry<T>);
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

// 全部員の公式レーティング表(snapshot ratings.json)。読めなければ例外にして、空の表をキャッシュしない
// (一度の失敗でアバターの色やレートが長いあいだ消えないように。古いキャッシュがあればそれを使う)
const ratingsMap = () =>
  cachedResource<Record<string, number>>(
    "res:ratings",
    async () => {
      const r = await snapshotRatings();
      if (!r) throw new Error("ratings.json を読めませんでした");
      return r;
    },
    RATING_TTL_MS,
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
    RATING_TTL_MS,
  );

// 公式レーティング推移。snapshot(rating-history.json)を土台に、無ければatcoder.jpへ。
const ratingHistories = () =>
  cachedResource<Record<string, RatePoint[]>>(
    "res:rating-hist",
    async () => {
      const r = await snapshotRatingHistories();
      if (!r) throw new Error("rating-history.json を読めませんでした");
      return r;
    },
    RATING_TTL_MS,
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
    RATING_TTL_MS,
  );

/** 手元にある提出履歴(IndexedDB のキャッシュか、同一オリジンのスナップショット) */
export interface LocalSubs {
  list: Submission[];
  watermark: number;
  /** 最後に kenkoooo から最新まで取れた時刻(スナップショットなら作った時刻) */
  at: number;
  /** 10分以内に取ったもので、取り直さなくてよい */
  fresh: boolean;
  /** 10分以内に取得を試して失敗した。取り直さず、古いデータとして扱う */
  cooldown: boolean;
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

function mergeById(...lists: Submission[][]): Submission[] {
  const byId = new Map<number, Submission>();
  for (const list of lists) for (const s of list) byId.set(s.id, s);
  return [...byId.values()].sort((a, b) => a.epoch_second - b.epoch_second);
}

/**
 * kenkoooo に問い合わせずに手元で用意できる提出履歴(表示用で、差分を取る起点にもなる)。
 * IndexedDB のキャッシュが10分以内ならそれを、古ければ6時間ごとに更新するスナップショットのほうが
 * 新しいか見て合わせる(しばらく間が空いた再訪でも、表示が新しく、kenkoooo から取り直す範囲も短くなる)。
 * キャッシュが無ければスナップショット。どちらも無ければ null。
 */
export async function peekSubmissions(user: string): Promise<LocalSubs | null> {
  const hit = await safeGet<SubsEntry>(`subs:${user.toLowerCase()}`);
  const now = Date.now();
  if (hit) {
    const fresh = now - hit.at < SUBS_FRESH_MS;
    const cooldown = !fresh && hit.triedAt != null && now - hit.triedAt < SUBS_FRESH_MS;
    const local = { list: hit.list, watermark: hit.watermark, at: hit.at, fresh, cooldown };
    if (fresh) return local;
    const snap = await snapshotSubsMemo(user);
    if (!snap || snap.watermark <= hit.watermark) return local;
    return {
      list: mergeById(hit.list, snap.list),
      watermark: snap.watermark,
      at: Math.max(hit.at, snap.at),
      fresh: false,
      cooldown,
    };
  }
  const snap = await snapshotSubsMemo(user);
  return snap ? { list: snap.list, watermark: snap.watermark, at: snap.at, fresh: false, cooldown: false } : null;
}

export interface LoadedSubs {
  list: Submission[];
  /** kenkoooo から最新の差分を取れたか(false なら手元のデータのまま) */
  live: boolean;
  /** list がいつ時点のものか(取れなかったときは手元のデータの時刻。分からなければ 0) */
  at: number;
}

interface InflightSubs {
  promise: Promise<LoadedSubs>;
  onProgress?: (fetched: number) => void;
  ctl: AbortController;
  /** この取得を待っている呼び出し元の数。全員が離れたら取得を打ち切る */
  users: number;
}

const inflightSubs = new Map<string, InflightSubs>();

/**
 * 提出履歴の増分キャッシュ。手元の最終提出時刻(watermark)以降だけを
 * APIから取り、IndexedDB内のリストへマージする。最新を取れたかと時点も返す。
 * signal が中断されると、その呼び出し元は待つのをやめる。待っている呼び出し元が
 * いなくなったら kenkoooo への取得も打ち切る(取れたページまでは保存する)ので、
 * 離れたページの取得が次のページのリクエストの順番を食わない。
 */
export function refreshSubmissions(
  user: string,
  onProgress?: (fetched: number) => void,
  signal?: AbortSignal,
): Promise<LoadedSubs> {
  const key = user.toLowerCase();
  let entry = inflightSubs.get(key);
  if (!entry) {
    const ctl = new AbortController();
    const e: InflightSubs = { promise: Promise.resolve({ list: [], live: false, at: 0 }), onProgress, ctl, users: 0 };
    e.promise = doLoadSubmissions(user, (n) => e.onProgress?.(n), ctl.signal).finally(() => {
      if (inflightSubs.get(key) === e) inflightSubs.delete(key);
    });
    inflightSubs.set(key, e);
    entry = e;
  }
  const e = entry;
  e.users++;
  if (onProgress) e.onProgress = onProgress;
  if (signal) {
    const leave = () => {
      e.users--;
      if (e.users > 0) return;
      // StrictMode の付け直しのように、すぐ別の呼び出し元が来るなら続ける
      setTimeout(() => {
        if (e.users > 0 || inflightSubs.get(key) !== e) return;
        inflightSubs.delete(key);
        e.ctl.abort();
      }, 50);
    };
    if (signal.aborted) leave();
    else signal.addEventListener("abort", leave, { once: true });
  }
  return e.promise;
}

async function doLoadSubmissions(
  user: string,
  onProgress: (fetched: number) => void,
  signal: AbortSignal,
): Promise<LoadedSubs> {
  const key = `subs:${user.toLowerCase()}`;
  // 取得の起点。IndexedDBキャッシュとスナップショットの新しいほう(初回訪問者もスナップショットで即座に土台がある)
  const base = await peekSubmissions(user);
  if (base?.fresh) return { list: base.list, live: true, at: base.at };
  // 10分以内に失敗したばかりなら取り直さない(kenkooooへの負荷を下げる)。古いことはそのまま伝える
  if (base?.cooldown) return { list: base.list, live: false, at: base.at };
  const baseList = base?.list ?? [];
  const baseWatermark = base?.watermark ?? 0;
  const from = baseWatermark > 0 ? Math.max(0, baseWatermark - OVERLAP_SEC) : 0;

  // 差分だけを kenkoooo からライブ取得する。ブロックやレート制限・タイムアウトで失敗しても、
  // 土台データがあれば致命扱いにせずそれを表示する(Failed to fetch対策の要)。
  let fresh: Submission[];
  try {
    fresh = await fetchSubmissionsSince(user, from, onProgress, signal);
  } catch (e) {
    // 途中のページまでは取れていれば、それも合わせて保存する(次はその続きから取る)
    const partial = e instanceof FetchSubmissionsError ? e.partial : [];
    const list = mergeById(baseList, partial);
    const aborted = signal.aborted;
    if (list.length > 0) {
      const watermark = Math.max(baseWatermark, partial.length > 0 ? partial[partial.length - 1].epoch_second : 0);
      // at は最後に最新まで取れた時刻のまま。中断(ページを離れた)は失敗ではないので、取り直しは止めない
      await safeSet(key, {
        at: base?.at ?? 0,
        watermark,
        list,
        ...(aborted ? {} : { triedAt: Date.now() }),
      } satisfies SubsEntry);
      if (!aborted) return { list, live: false, at: base?.at ?? 0 };
    }
    throw e;
  }

  const list = mergeById(baseList, fresh);
  const watermark = list.length > 0 ? list[list.length - 1].epoch_second : 0;
  const at = Date.now();
  await safeSet(key, { at, watermark, list } satisfies SubsEntry);
  return { list, live: true, at };
}
