// 問題文の「入力」「制約」から変数ごとの範囲を出す(計算量タブの「変数の範囲」を埋める)
import { test } from "node:test";
import assert from "node:assert/strict";
import { statementBounds } from "../../src/lib/casegen/bounds.ts";

const map = (format: string, constraints: string) =>
  Object.fromEntries(statementBounds(format, constraints).map((b) => [b.name, [b.lo, b.hi]]));

test("制約の式はほかの変数の上限を入れて数にする(min・K ≤ N)", () => {
  const m = map("N M K", "2 \\le N \\le 2\\times 10^5\n1 \\le M \\le \\min(3 \\times 10^5, N(N-1)/2)\n1 \\le K \\le N");
  assert.deepEqual(m.N, [2n, 200000n]);
  assert.deepEqual(m.M, [1n, 300000n]);
  assert.deepEqual(m.K, [1n, 200000n]);
});

test("配列の長さは入力の形式から(横の並び・N 行のくり返し)", () => {
  const m = map("N M\nA_1 A_2 \\ldots A_N\nu_1 v_1\n\\vdots\nu_M v_M", "1 \\le N \\le 10^5\n0 \\le M \\le 2 \\times 10^5\n1 \\le A_i \\le 10^9");
  assert.deepEqual(m["|A|"], [null, 100000n]);
  assert.deepEqual(m["|u|"], [null, 200000n]);
  assert.deepEqual(m.A_i, [1n, 1000000000n]);
});

test("文字列の長さと、日本語の制約", () => {
  const m = map("", "S は長さ 1 以上 10 以下の英小文字からなる文字列\nQ は 1 以上 2 \\times 10^5 以下の整数");
  assert.deepEqual(m["|S|"], [1n, 10n]);
  assert.deepEqual(m.Q, [1n, 200000n]);
});

test("グリッド: 行の数と1行の長さ", () => {
  const m = map("H W\nS_1\n\\vdots\nS_H", "1 \\le H, W \\le 2000\nS_i は長さ W の文字列");
  assert.deepEqual(m["|S|"], [null, 2000n]);
  assert.deepEqual(m["|S_i|"]?.[1], 2000n);
});
