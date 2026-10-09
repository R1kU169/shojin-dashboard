// 範囲の入力と演算回数の概算の仕様テスト(docs/complexity-analyzer-plan.md §8)
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, formatOps, parseBoundValue } from "../../src/lib/complexity/evaluate.ts";
import { add, lit, logOf, mul, sym } from "../../src/lib/complexity/expr.ts";

const hi = (s: string) => parseBoundValue(s)?.hi ?? null;

test("単一の値として読める書き方", () => {
  for (const s of ["2e5", "2*10^5", "2×10^5", "2·10^5", "200000", "2 * 10 ** 5", "２０００００", "2_00_000"]) {
    assert.equal(hi(s), 200000, s);
  }
  assert.equal(hi("10^9"), 1e9);
  assert.equal(hi("2,000"), 2000);
  assert.equal(hi("1e18"), 1e18);
  assert.equal(hi("1<<20"), 1 << 20);
  assert.equal(hi("1.5"), 1.5);
});

test("範囲の書き方は上限を hi、下限を lo にする", () => {
  assert.deepEqual(parseBoundValue("1 ≤ N ≤ 2×10^5"), { lo: 1, hi: 200000 });
  assert.deepEqual(parseBoundValue("1<=N<=200000"), { lo: 1, hi: 200000 });
  assert.deepEqual(parseBoundValue("1 ≦ H,W ≦ 2000"), { lo: 1, hi: 2000 });
  assert.deepEqual(parseBoundValue("1〜2e5"), { lo: 1, hi: 200000 });
  assert.deepEqual(parseBoundValue("1..2e5"), { lo: 1, hi: 200000 });
  assert.deepEqual(parseBoundValue("2e5"), { lo: null, hi: 200000 });
});

test("読めない入力は null", () => {
  for (const s of ["N", "10^", "-5", "1/2", "0", "", "5 ≤ N ≤ 3", "abc"]) {
    assert.equal(parseBoundValue(s), null, s);
  }
});

test("演算回数の表示", () => {
  assert.equal(formatOps(999.6), "1,000");
  assert.equal(formatOps(1234.5), "1,235");
  assert.equal(formatOps(9999.9), "10^4");
  assert.equal(formatOps(200000), "2×10^5");
  assert.equal(formatOps(3.49e6), "3.5×10^6");
  assert.equal(formatOps(1e18), "10^18");
  assert.equal(formatOps(Infinity), "10^300 以上");
});

test("評価: log の底は2、値の無い記号は missing", () => {
  const nlogn = mul(sym("N"), logOf("N"));
  const r = evaluate(nlogn, { N: 1024 }, "cpp", 2);
  assert.equal(r.ops, 1024 * 10);
  assert.equal(r.verdict, "ok");
  const m = evaluate(add(sym("N"), sym("M")), { N: 10 }, "cpp", 2);
  assert.equal(m.ops, null);
  assert.deepEqual(m.missing, ["M"]);
});

test("判定: 予算比 0.3 以下で余裕、1 以下で厳しい、超えると TLE の恐れ", () => {
  const n2 = mul(sym("N"), sym("N"));
  assert.equal(evaluate(n2, { N: 2000 }, "cpp", 2).verdict, "ok");
  assert.equal(evaluate(n2, { N: 12000 }, "cpp", 2).verdict, "tight");
  assert.equal(evaluate(n2, { N: 2e5 }, "cpp", 2).verdict, "tle");
  // Python は同じ回数でも遅い(C++ なら余裕の 3000² が厳しい)
  assert.equal(evaluate(n2, { N: 3000 }, "cpp", 2).verdict, "ok");
  assert.equal(evaluate(n2, { N: 3000 }, "python", 2).verdict, "tight");
  assert.equal(evaluate(lit(1000), {}, "cpp", 2).opsText, "1,000");
});

test("指数と階乗は大きな値で打ち切る", () => {
  const r = evaluate([{ coef: 1, factors: [{ v: "N", pow: 0, log: 0, exp: 0, fact: 1 }] }], { N: 1e9 }, "cpp", 2);
  assert.equal(r.opsText, "10^300 以上");
  assert.equal(r.verdict, "tle");
});

test("問題ページからコピーした形・TeX・下限 0 や負の値も読む", () => {
  const cases: [string, { lo: number | null; hi: number }][] = [
    ["2×10 5", { lo: null, hi: 200000 }],
    ["1≤N≤2×10\n5", { lo: 1, hi: 200000 }],
    ["2×10⁵", { lo: null, hi: 200000 }],
    ["10⁹", { lo: null, hi: 1e9 }],
    ["0 ≤ K ≤ 10^9", { lo: 0, hi: 1e9 }],
    ["-10^9 ≤ A ≤ 10^9", { lo: -1e9, hi: 1e9 }],
    ["N ≤ 2×10^5", { lo: null, hi: 200000 }],
    ["N<=200000", { lo: null, hi: 200000 }],
    ["1 \\le N \\le 2 \\times 10^5", { lo: 1, hi: 200000 }],
    ["2・10^5", { lo: null, hi: 200000 }],
    ["10 000", { lo: null, hi: 10000 }],
  ];
  for (const [s, want] of cases) assert.deepEqual(parseBoundValue(s), want, s);
});

test("2^(H·W) の値が足りないときは H・W の名前で知らせる", () => {
  const r = evaluate([{ coef: 1, factors: [{ v: "2^(H·W)", pow: 1, log: 0, exp: 0, fact: 0 }] }], { H: 3 }, "cpp", 2);
  assert.deepEqual(r.missing, ["W"]);
  assert.equal(formatOps(Number.NaN), "—");
});
