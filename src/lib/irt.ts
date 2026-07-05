import type { Problem, ProblemModels } from "./types";
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

/**
 * θのMAP推定(Newton-Raphson)。失敗観測が少ないとMLEは発散するため、
 * 弱い事前分布 θ~N(600, 1200²) で正則化する。ACが1問もなければ null。
 */
export function estimateTheta(items: IrtItem[]): number | null {
  if (!items.some((i) => i.solved)) return null;
  const priorMu = 600;
  const priorVar = 1200 * 1200;
  let theta = priorMu;
  for (let iter = 0; iter < 100; iter++) {
    let grad = -(theta - priorMu) / priorVar;
    let hess = -1 / priorVar;
    for (const it of items) {
      const p = 1 / (1 + Math.exp(-it.a * (theta - it.b)));
      grad += it.a * ((it.solved ? 1 : 0) - p);
      hess -= it.a * it.a * p * (1 - p);
    }
    const step = grad / hess;
    theta -= step;
    if (Math.abs(step) < 0.5) break;
  }
  return Math.max(-2000, Math.min(5000, theta));
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
