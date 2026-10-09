// 実力推定(θの MAP 推定)とレコメンド
import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateTheta, recommend } from "../src/lib/irt.ts";
import type { IrtItem } from "../src/lib/irt.ts";
import type { Problem, ProblemModels } from "../src/lib/types.ts";

const A = Math.log(6) / 400;

/** 対数事後を 1 刻みで総当たりして最大の θ を返す(検算用) */
function bruteForce(items: IrtItem[]): number {
  let best = -Infinity;
  let arg = 0;
  for (let t = -2000; t <= 5000; t++) {
    let lp = -((t - 600) ** 2) / (2 * 1200 * 1200);
    for (const it of items) {
      const p = 1 / (1 + Math.exp(-it.a * (t - it.b)));
      lp += Math.log(it.solved ? p : 1 - p);
    }
    if (lp > best) {
      best = lp;
      arg = t;
    }
  }
  return arg;
}

const item = (b: number, solved: boolean): IrtItem => ({ a: A, b, solved });
const spread = (n: number, from: number, to: number, solved: boolean) =>
  Array.from({ length: n }, (_, i) => item(from + ((to - from) * i) / Math.max(1, n - 1), solved));

test("AC が無ければ推定しない", () => {
  assert.equal(estimateTheta([]), null);
  assert.equal(estimateTheta([item(0, false)]), null);
});

test("A を解いて B を落とした初心者でも上限に張り付かない", () => {
  // Newton 法では 5000 に張り付いていた(正しくは -400 前後)
  for (const [na, nb] of [[5, 1], [10, 3], [20, 6], [30, 8]]) {
    const items = [...spread(na, -1100, -740, true), ...spread(nb, -450, -250, false)];
    const theta = estimateTheta(items)!;
    assert.ok(Math.abs(theta - bruteForce(items)) <= 1, `A${na}/B${nb}: ${theta} vs ${bruteForce(items)}`);
    assert.ok(theta < 0, `A${na}/B${nb}: ${theta}`);
  }
});

test("観測の少ない上級者でも下限に張り付かない", () => {
  // 2000 を解いて 2600 を落とした人(Newton 法では -2000)
  const items = [item(2000, true), item(2600, false)];
  const theta = estimateTheta(items)!;
  assert.ok(Math.abs(theta - bruteForce(items)) <= 1, `${theta} vs ${bruteForce(items)}`);
  assert.ok(theta > 1500, `${theta}`);
});

test("ふつうの履歴では総当たりと一致する", () => {
  const items = [...spread(80, -1000, 1400, true), ...spread(12, 800, 1800, false)];
  const theta = estimateTheta(items)!;
  assert.ok(Math.abs(theta - bruteForce(items)) <= 1, `${theta} vs ${bruteForce(items)}`);
});

test("全部解いていても範囲の中に収まる", () => {
  const items = spread(400, 2000, 3500, true);
  const theta = estimateTheta(items)!;
  assert.ok(theta <= 5000 && theta > 3000, `${theta}`);
});

test("レコメンドは AC 確率 40〜75% の未AC問題を 60% に近い順に返す", () => {
  const problems: Problem[] = [];
  const models: ProblemModels = {};
  for (let i = 0; i < 30; i++) {
    const id = `p${i}`;
    problems.push({ id, contest_id: "c", problem_index: "A", name: id, title: id });
    models[id] = { difficulty: -1000 + i * 100, discrimination: A, is_experimental: false };
  }
  const recs = recommend(500, problems, models, new Set(["p15"]));
  assert.ok(recs.length > 0);
  for (const r of recs) {
    assert.ok(r.probability >= 0.4 && r.probability <= 0.75);
    assert.notEqual(r.problem.id, "p15");
  }
  for (let i = 1; i < recs.length; i++) {
    assert.ok(Math.abs(recs[i - 1].probability - 0.6) <= Math.abs(recs[i].probability - 0.6));
  }
});
