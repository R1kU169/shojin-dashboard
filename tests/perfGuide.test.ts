// パフォの目安: 最近の ABC の各記号を解ける確率と、その一言
import { test } from "node:test";
import assert from "node:assert/strict";
import { describeChances, recentAbcTable, solveChances } from "../src/lib/perfGuide.ts";
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

test("一言の言い分け", () => {
  const say = (ps: number[]) => describeChances(ps.map((p, i) => ({ letter: "ABCDEFG"[i], p })));
  assert.equal(say([1, 0.99, 0.81, 0.55, 0.15, 0.02, 0]), "C までほぼ解けて、D が半々くらい");
  assert.equal(say([0.99, 0.96, 0.5, 0.2, 0.03, 0, 0]), "B までほぼ解けて、C が半々くらい");
  assert.equal(say([1, 1, 1, 1, 0.91, 0.68, 0.19]), "E までほぼ解けて、F も解けることが多い");
  assert.equal(say([0.97, 0.82, 0.19, 0.04, 0, 0, 0]), "B までほぼ解けて、C はときどき解ける");
  assert.equal(say([0.5, 0.1, 0, 0, 0, 0, 0]), "A が解けるかどうかくらい");
  assert.equal(say([1, 1, 1, 1, 1, 1, 0.9]), "G までほぼ解けるくらい");
});
