// AtCoder のレーティング(アルゴリズム部門)の予測。次のコンテストのパフォーマンスで、レートがどう動くか。
//
// 式(AtCoder 公式。P_i はレート対象の回のパフォで、i = 1 が最新):
//   R = 800·log2( Σ 2^(P_i/800)·0.9^i / Σ 0.9^i ) − f(n)
//   f(n) = (√(1 − 0.81^n) / (1 − 0.9^n) − 1) / (√19 − 1) × 1200(参加回数が少ないうちの補正。初回は 1200)
//   R ≤ 400 なら 400 / exp((400 − R) / 400) に写し、四捨五入して表示する
// パフォは履歴の Performance(上限で頭打ちにした値)を使う。InnerPerformance だと上限に当たった回でずれる。
// 部員の全履歴(357 回)で NewRating と一致することを確かめた(docs/rating-estimator.md)。
// 四捨五入は Math.round にしている(ちょうど .5 になる回は無く、丸め方の違いは確かめられていない)。
//
// 新しいレートはパフォについて単調に増えるので、「何パフォ以上なら」は二分探索で求める。
// 型だけを import する(テストから直接読めるように)。

/** 色の境目(灰 0・茶 400・緑 800・水 1200・青 1600・黄 2000・橙 2400・赤 2800) */
export const TIER_FLOORS = [0, 400, 800, 1200, 1600, 2000, 2400, 2800] as const;

/** ABC のパフォの上限(Rated 対象の上限 1999 + 400 余り。AtCoder のルール) */
export const ABC_PERF_CAP = 2400;
/** ABC が Rated になるレートの上限(これ以上は ABC では動かない) */
export const ABC_RATED_BELOW = 2000;

/** 二分探索の範囲。大きな ABC の最下位は -600〜-900 になることがあるので、下は広く取る */
export const PERF_MIN = -4000;
const PERF_MAX = 6000;

const correction = (n: number) => ((Math.sqrt(1 - 0.81 ** n) / (1 - 0.9 ** n) - 1) / (Math.sqrt(19) - 1)) * 1200;

/** パフォの列(古い順)からのレート(四捨五入する前)。0回なら 0 */
export function ratingOf(perfs: readonly number[]): number {
  const n = perfs.length;
  if (n === 0) return 0;
  let num = 0;
  let den = 0;
  for (let i = 1; i <= n; i++) {
    const w = 0.9 ** i;
    num += 2 ** (perfs[n - i] / 800) * w;
    den += w;
  }
  const r = 800 * Math.log2(num / den) - correction(n);
  return r <= 400 ? 400 / Math.exp((400 - r) / 400) : r;
}

/** 表示されるレート(四捨五入) */
export const displayRating = (perfs: readonly number[]): number => Math.round(ratingOf(perfs));

/** 同じパフォを times 回続けたあとの表示レート */
export function nextRating(perfs: readonly number[], perf: number, times = 1): number {
  return displayRating([...perfs, ...Array<number>(times).fill(perf)]);
}

/** 新しいレートが pred を満たす最小の整数パフォ。PERF_MAX でも満たさなければ null */
function minPerf(perfs: readonly number[], pred: (rating: number) => boolean, times: number): number | null {
  if (!pred(nextRating(perfs, PERF_MAX, times))) return null;
  let lo = PERF_MIN - 1; // pred を満たさない側(番兵)
  let hi = PERF_MAX; // pred を満たす側
  if (pred(nextRating(perfs, PERF_MIN, times))) return PERF_MIN;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (pred(nextRating(perfs, mid, times))) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** 表示レートが target 以上になる最小のパフォ(times 回続けて)。届かなければ null */
export function perfToReach(perfs: readonly number[], target: number, times = 1): number | null {
  return minPerf(perfs, (r) => r >= target, times);
}

/** 今のレートより上がる最小のパフォ */
export function perfToRise(perfs: readonly number[]): number | null {
  const now = displayRating(perfs);
  return minPerf(perfs, (r) => r > now, 1);
}

/**
 * 表示レートが floor 未満になる最大のパフォ(これ以下だと下がる)。
 * どんなに低いパフォでも次の1回では下がらなければ null
 */
export function perfToFallBelow(perfs: readonly number[], floor: number): number | null {
  const p = perfToReach(perfs, floor);
  if (p === null) return PERF_MAX; // どのパフォでも floor に届かない(今すでに下にいる)
  return p <= PERF_MIN ? null : p - 1;
}

/** 同じパフォを続けて何回で target に届くか(max 回までに届かなければ null) */
export function contestsToReach(perfs: readonly number[], perf: number, target: number, max = 30): number | null {
  const xs = [...perfs];
  for (let k = 1; k <= max; k++) {
    xs.push(perf);
    if (displayRating(xs) >= target) return k;
  }
  return null;
}

/** 同じパフォを続けたときに近づくレート(続けて届かないときの目安。十分な回数のあとの値) */
export function limitRating(perfs: readonly number[], perf: number): number {
  return nextRating(perfs, perf, 60);
}

/** レートの色の番号(0 灰 … 7 赤) */
export function tierOf(rating: number): number {
  let t = 0;
  for (let i = 0; i < TIER_FLOORS.length; i++) if (rating >= TIER_FLOORS[i]) t = i;
  return t;
}

/** 次の色の境目(赤なら null) */
export function nextTierFloor(rating: number): number | null {
  const t = tierOf(rating);
  return t + 1 < TIER_FLOORS.length ? TIER_FLOORS[t + 1] : null;
}

/** 今の色の下の境目(灰なら null。これ未満になると色が下がる) */
export function tierFloor(rating: number): number | null {
  const t = tierOf(rating);
  return t > 0 ? TIER_FLOORS[t] : null;
}
