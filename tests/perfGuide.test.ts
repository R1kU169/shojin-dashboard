// パフォの目安: 最近の ABC の各記号を解ける確率と、その一言
import { test } from "node:test";
import assert from "node:assert/strict";
import { groupChances, recentAbcTable, solveChances } from "../src/lib/perfGuide.ts";
import type { ProblemModels } from "../src/lib/types.ts";

const A = Math.log(6) / 400;
/** 記号ごとの難易度を同じにした ABC を、番号 from〜to のぶん作る */
function models(from: number, to: number, extra: ProblemModels = {}): ProblemModels {
  const diff: Record<string, number> = { a: -900, b: -400, c: 400, d: 800, e: 1300, f: 1800, g: 2400 };
  const out: ProblemModels = {};
  for (let n = from; n <= to; n++) for (const [l, d] of Object.entries(diff)) out[`abc${n}_${l}`] = { difficulty: d, discrimination: A };
  return { ...out, ...extra };
}

test("最近の ABC を新しい順に選び、難易度が仮の回は飛ばす", () => {
  const t = recentAbcTable(models(400, 430, { abc430_c: { difficulty: 400, discrimination: A, is_experimental: true } }), 20)!;
  assert.equal(t.to, 429);
  assert.equal(t.from, 410);
  assert.equal(t.byLetter.get("A")!.length, 20);
  assert.equal(recentAbcTable(models(400, 402), 20), null, "少なすぎるときは出さない");
});

test("難易度ちょうどのパフォなら半々", () => {
  const t = recentAbcTable(models(400, 420))!;
  const c = solveChances(t, 800);
  assert.ok(Math.abs(c.find((x) => x.letter === "D")!.p - 0.5) < 1e-9);
  assert.ok(c.find((x) => x.letter === "A")!.p > 0.99);
});

test("解ける度合いで分ける", () => {
  const groups = (ps: number[]) => groupChances(ps.map((p, i) => ({ letter: "ABCDEFG"[i], p }))).map((g) => `${g.short}: ${g.letters.join("・")}`);
  // パフォ 433 くらい
  assert.deepEqual(groups([1, 0.96, 0.53, 0.22, 0.04, 0, 0]), ["ほぼ毎回: A・B", "2回に1回: C", "たまに: D"]);
  // パフォ 1210 くらい
  assert.deepEqual(groups([1, 1, 0.95, 0.86, 0.44, 0.09, 0.01]), ["ほぼ毎回: A・B・C・D", "2回に1回: E"]);
  // ほぼ毎回解ける問題が無い
  assert.deepEqual(groups([0.5, 0.2, 0.05, 0, 0, 0, 0]), ["2回に1回: A", "たまに: B"]);
});
