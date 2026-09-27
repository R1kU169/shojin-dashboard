// 計算量の式の代数と表示の仕様テスト(docs/complexity-analyzer-plan.md §6)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  add,
  exp2Of,
  factOf,
  format,
  formatNumber,
  lit,
  logOf,
  logOfExpr,
  mul,
  powOf,
  rename,
  simplify,
  sym,
} from "../../src/lib/complexity/expr.ts";
import type { Expr } from "../../src/lib/complexity/ir.ts";

const N = sym("N");
const M = sym("M");
const show = (e: Expr, order = ["N", "M", "K", "Q"]) => format(simplify(e), order);

test("数値だけの小さい項は落ち、10以上は残る", () => {
  assert.equal(show(add(N, lit(5))), "N");
  assert.equal(show(add(N, lit(1000))), "N + 1000");
  assert.equal(show(add(lit(1e5), lit(1000))), "10^5");
});

test("同じ形の項は係数の max でまとまる", () => {
  assert.equal(show(add(N, N)), "N");
  assert.equal(show(add(mul(lit(1000), N), N)), "1000·N");
});

test("支配: 変数の成長で勝ち、係数10以上は係数でも勝たないと落とさない", () => {
  assert.equal(show(add(mul(N, N), N)), "N²");
  assert.equal(show(add(mul(N, N), mul(lit(5), N))), "N²");
  assert.equal(show(add(mul(N, N), mul(lit(1e6), N))), "N² + 10^6·N");
  assert.equal(show(add(mul(N, N), lit(1e6))), "N² + 10^6");
  assert.equal(show(add(mul(N, M), N)), "N·M");
  assert.equal(show(add(mul(N, N), mul(N, M))), "N² + N·M");
  assert.equal(show(add(exp2Of("N"), powOf("N", 100))), "2^N");
  assert.equal(show(add(factOf("N"), exp2Of("N"))), "N!");
  assert.equal(show(add(mul(N, logOf("N")), mul(lit(26), N))), "N log N + 26·N");
});

test("2·N のような小さい係数は表示しない", () => {
  assert.equal(show(mul(lit(2), N)), "N");
  assert.equal(show(mul(lit(60), N)), "60·N");
});

test("表示の並び: 強い項が先、同じ強さなら記号の初出順", () => {
  assert.equal(show(add(N, M)), "N + M");
  assert.equal(show(add(N, M), ["M", "N"]), "M + N");
  assert.equal(show(mul(N, exp2Of("N"))), "N·2^N");
  assert.equal(show(mul(N, factOf("N"))), "N·N!");
  assert.equal(show(add(mul(N, logOf("N")), mul(M, logOf("M")))), "N log N + M log M");
  assert.equal(show(powOf("N", 0.5)), "√N");
  assert.equal(show(powOf("N", 1.5)), "N√N");
  assert.equal(show(mul(N, mul(N, N))), "N³");
  assert.equal(show(powOf("N", 4)), "N^4");
  assert.equal(show(mul(logOf("N"), logOf("N"))), "log² N");
  assert.equal(show(mul(exp2Of("N"), exp2Of("N"))), "4^N");
});

test("数値の表示: 1万未満は整数、以上は有効2桁", () => {
  assert.equal(formatNumber(1000), "1000");
  assert.equal(formatNumber(200005), "2×10^5");
  assert.equal(formatNumber(2005 * 2005), "4×10^6");
  assert.equal(formatNumber(1e5), "10^5");
  assert.equal(formatNumber(3.49e6), "3.5×10^6");
  assert.equal(formatNumber(9.96e5), "10^6");
});

test("log: 積は log の和、数値は ceil(log2)", () => {
  assert.equal(show(logOfExpr(mul(N, M))), "log N + log M");
  assert.equal(show(logOfExpr(lit(1e18))), "60");
  assert.equal(show(logOfExpr(lit(1e9))), "30");
  assert.equal(show(logOfExpr(mul(lit(1000), N))), "log N");
});

test("rename: 記号への式の代入と再正規化", () => {
  assert.equal(show(rename(mul(N, sym("|a|")), "|a|", N)), "N²");
  assert.equal(show(rename(mul(M, logOf("|pq|")), "|pq|", add(N, M))), "M log N + M log M");
  assert.equal(show(rename(sym("K"), "K", N)), "N");
  assert.equal(show(rename(exp2Of("K"), "K", N)), "2^N");
  assert.equal(show(rename(mul(N, sym("K")), "K", lit(1000))), "1000·N");
});
