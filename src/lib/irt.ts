import type { Problem, ProblemModels } from "./types.ts";
import { clipDifficulty } from "./colors.ts";

// kenkoooo の難易度推定と同じ 2PL ロジスティックモデル:
//   P(AC | θ) = 1 / (1 + exp(-a(θ - b)))
// a = discrimination (≈ ln6/400), b = difficulty(生値・クリップ前)。
// AC済み問題を成功、提出したのに未ACの問題を失敗の観測としてθを最尤推定する。
// 「挑戦していない問題」は観測に含めない(解けないから避けたのか、興味がないだけか区別できない)。

export interface IrtItem {
  a: number;
  b: number;
  solved: boolean;
}

export function collectIrtItems(
  models: ProblemModels,
  solved: Set<string>,
  attemptedNoAc: Set<string>,
): IrtItem[] {
  const items: IrtItem[] = [];
  const push = (pid: string, ok: boolean) => {
    const m = models[pid];
    if (m?.difficulty === undefined || m.discrimination === undefined) return;
    items.push({ a: m.discrimination, b: m.difficulty, solved: ok });
  };
  for (const p of solved) push(p, true);
  for (const p of attemptedNoAc) push(p, false);
  return items;
}

const THETA_MIN = -2000;
const THETA_MAX = 5000;

/**
 * θのMAP推定。失敗観測が少ないとMLEは発散するため、
 * 弱い事前分布 θ~N(600, 1200²) で正則化する。ACが1問もなければ null。
 *
 * 対数事後は θ について凹(勾配が単調減少)なので、勾配が 0 になる点を二分探索で求める。
 * Newton 法は 600 から全幅で進むと、観測がすべて 600 から遠い初心者(A を解いて B を落とした人)で
 * 曲率がほぼ 0 になって数千も跳び、振動したまま上限・下限に張り付く。
 */
export function estimateTheta(items: IrtItem[]): number | null {
  if (!items.some((i) => i.solved)) return null;
  const priorMu = 600;
  const priorVar = 1200 * 1200;
  const grad = (theta: number) => {
    let g = -(theta - priorMu) / priorVar;
    for (const it of items) {
      const p = 1 / (1 + Math.exp(-it.a * (theta - it.b)));
      g += it.a * ((it.solved ? 1 : 0) - p);
    }
    return g;
  };
  if (grad(THETA_MIN) <= 0) return THETA_MIN;
  if (grad(THETA_MAX) >= 0) return THETA_MAX;
  let lo = THETA_MIN;
  let hi = THETA_MAX;
  while (hi - lo > 0.5) {
    const mid = (lo + hi) / 2;
    if (grad(mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function solveProbability(theta: number, rawDifficulty: number, a: number): number {
  return 1 / (1 + Math.exp(-a * (theta - rawDifficulty)));
}

export interface Recommendation {
  problem: Problem;
  clippedDifficulty: number;
  probability: number;
  url: string;
}

/** 推定θで解ける確率が40〜75%の未AC問題を、60%に近い順に返す */
export function recommend(
  theta: number,
  problems: Problem[],
  models: ProblemModels,
  solved: Set<string>,
  limit = 12,
): Recommendation[] {
  const out: Recommendation[] = [];
  for (const p of problems) {
    if (solved.has(p.id)) continue;
    const m = models[p.id];
    if (m?.difficulty === undefined || m.discrimination === undefined) continue;
    if (m.is_experimental) continue;
    const prob = solveProbability(theta, m.difficulty, m.discrimination);
    if (prob < 0.4 || prob > 0.75) continue;
    out.push({
      problem: p,
      clippedDifficulty: clipDifficulty(m.difficulty),
      probability: prob,
      url: `https://atcoder.jp/contests/${p.contest_id}/tasks/${p.id}`,
    });
  }
  out.sort(
    (x, y) => Math.abs(x.probability - 0.6) - Math.abs(y.probability - 0.6),
  );
  return out.slice(0, limit);
}
