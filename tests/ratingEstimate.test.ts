// レート予測: AtCoder の計算式で、実際のレート推移を再現できること・「何パフォ以上なら」の境目
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  contestsToReach,
  displayRating,
  nextRating,
  nextTierFloor,
  perfToFallBelow,
  perfToReach,
  perfToRise,
  tierFloor,
  tierOf,
} from "../src/lib/ratingEstimate.ts";

// 部員(mocaluna)の Rated の 49 回のパフォ(履歴の Performance)と、そのたびの NewRating
const PERFS = [352, -147, 23, -39, 155, 279, 194, 393, -36, 258, 399, 30, 409, 85, 219, 634, 366, 787, 503, 146, 494, 165, 90, 647, 468, 507, 1025, 397, 280, 193, 246, 11, 417, 161, 181, 482, 469, 252, 311, 437, 308, 348, 238, 378, 413, 209, 578, 299, 694];
const RATINGS = [18, 31, 46, 57, 75, 97, 112, 139, 137, 152, 175, 172, 194, 192, 198, 237, 250, 305, 325, 311, 329, 316, 300, 335, 348, 364, 452, 446, 430, 408, 392, 361, 366, 349, 335, 350, 361, 352, 349, 357, 353, 353, 343, 347, 353, 342, 365, 359, 396];

test("実際のレート推移を、1回ごとに再現する", () => {
  for (let i = 1; i <= PERFS.length; i++) assert.equal(displayRating(PERFS.slice(0, i)), RATINGS[i - 1], `${i} 回目`);
});

test("初回はパフォから 1200 引いた値(400 以下は写す)", () => {
  assert.equal(displayRating([352]), 18);
  assert.equal(displayRating([2000]), 800);
  assert.equal(displayRating([]), 0);
});

test("何パフォ以上なら届くか: その値で届き、1 小さいと届かない", () => {
  const p = perfToReach(PERFS, 800)!;
  assert.ok(nextRating(PERFS, p) >= 800);
  assert.ok(nextRating(PERFS, p - 1) < 800);
  const two = perfToReach(PERFS, 800, 2)!;
  assert.ok(two < p, "2回続けるなら1回より低くてよい");
  assert.ok(nextRating(PERFS, two, 2) >= 800 && nextRating(PERFS, two - 1, 2) < 800);
  // 届かない目標
  assert.equal(perfToReach(PERFS, 100000), null);
});

test("上がる境目と、下がる境目", () => {
  const now = displayRating(PERFS);
  const up = perfToRise(PERFS)!;
  assert.ok(nextRating(PERFS, up) > now && nextRating(PERFS, up - 1) <= now);
  // 茶に上がったばかり(400 ちょうど付近)の人が灰に下がる: これ以下で 400 未満
  const brown = [...PERFS, perfToReach(PERFS, 400)!];
  assert.ok(displayRating(brown) >= 400);
  const down = perfToFallBelow(brown, 400)!;
  assert.ok(nextRating(brown, down) < 400 && nextRating(brown, down + 1) >= 400);
  // 色の境目より十分上にいれば、どんなに低いパフォでも次の1回では下がらない(568 → 最低でも 522)
  assert.equal(perfToFallBelow([...PERFS, 1500], 400), null);
});

test("同じパフォを続けて何回で届くか", () => {
  const k = contestsToReach(PERFS, 1200, 800)!;
  assert.ok(k >= 1);
  assert.ok(nextRating(PERFS, 1200, k) >= 800 && (k === 1 || nextRating(PERFS, 1200, k - 1) < 800));
  assert.equal(contestsToReach(PERFS, 500, 800), null);
});

test("色の境目", () => {
  assert.equal(tierOf(399), 0);
  assert.equal(tierOf(400), 1);
  assert.equal(nextTierFloor(396), 400);
  assert.equal(nextTierFloor(2900), null);
  assert.equal(tierFloor(396), null);
  assert.equal(tierFloor(1250), 1200);
});
