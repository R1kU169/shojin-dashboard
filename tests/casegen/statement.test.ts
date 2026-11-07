// コーナーケース: 問題ページの文字列から「入力」「制約」を切り出す(ブックマークレット・まるごと貼り付け)
import { test } from "node:test";
import assert from "node:assert/strict";
import { splitStatement } from "../../src/lib/casegen/statement.ts";
import { buildSpec } from "../../src/lib/casegen/spec.ts";

// 問題ページ(abc481_c)の日本語の問題文を statementHtmlToText に通したときの形
const TASK_PAGE = [
  "配点 : 300 点",
  "問題文",
  "銀行の口座についての出来事が Q 回起こります。",
  "制約",
  "Q は 1 以上 2 \\times 10^5 以下の整数",
  "各出来事において、s は英小文字からなる長さ 1 以上 10 以下の文字列",
  "入力",
  "入力は以下の形式で標準入力から与えられる。",
  "Q",
  "\\mathrm{query}_1",
  "\\vdots",
  "\\mathrm{query}_Q",
  "\\mathrm{query}_i は i 回目の出来事を表し、以下の形式で与えられる。",
  "s",
  "出力",
  "Q 行出力せよ。",
].join("\n");

test("問題ページの「入力」と「制約」を切り出し、決まり文句の行は落とす", () => {
  const p = splitStatement(TASK_PAGE);
  assert.equal(p.format, "Q\n\\mathrm{query}_1\n\\vdots\n\\mathrm{query}_Q\n\\mathrm{query}_i は i 回目の出来事を表し、以下の形式で与えられる。\ns");
  assert.equal(p.constraints, "Q は 1 以上 2 \\times 10^5 以下の整数\n各出来事において、s は英小文字からなる長さ 1 以上 10 以下の文字列");
  const spec = buildSpec(p.format ?? "", p.constraints ?? "");
  assert.ok(spec.slots.has("Q"));
});

test("ページ全体のコピー(メニューや英語版が混ざる)でも日本語の節を使う", () => {
  const whole = [
    "AtCoder",
    "トップ",
    "問題",
    "提出",
    "C - Bank Accounts",
    "実行時間制限: 2 sec / メモリ制限: 1024 MiB",
    TASK_PAGE,
    "入力例 1",
    "3",
    "abc",
    "出力例 1",
    "1",
    "Problem Statement",
    "Constraints",
    "1 \\leq Q \\leq 2 \\times 10^5",
    "Input",
    "The input is given from Standard Input in the following format:",
    "Q",
  ].join("\n");
  const p = splitStatement(whole);
  assert.equal(p.constraints?.split("\n")[0], "Q は 1 以上 2 \\times 10^5 以下の整数");
  assert.equal(p.format?.split("\n").at(-1), "s");
});

test("入力例の見出しで止まる・行の途中の「入力」は見出しにしない", () => {
  const p = splitStatement(["入力", "N", "A_1 \\ldots A_N", "入力例 1", "3", "1 2 3", "出力例 1", "6"].join("\n"));
  assert.equal(p.format, "N\nA_1 \\ldots A_N");
  const q = splitStatement(["入力は N 個の整数", "制約", "1 \\le N \\le 10", "入力", "N"].join("\n"));
  assert.equal(q.format, "N");
  assert.equal(q.constraints, "1 \\le N \\le 10");
});

test("注意・部分点などの節で止まる", () => {
  const p = splitStatement(["制約", "1 \\le N \\le 10", "部分点", "N \\le 5 を満たすデータセットに正解すると 30 点", "入力", "N"].join("\n"));
  assert.equal(p.constraints, "1 \\le N \\le 10");
  const q = splitStatement(["入力", "N", "注意", "入力は改行で終わる"].join("\n"));
  assert.equal(q.format, "N");
});

test("制約の節がない古い問題は、入力だけ返す", () => {
  const p = splitStatement(["問題文", "…", "入力", "入力は以下の形式で標準入力から与えられる。", "H_1", "H_2", "1 行目には、整数 H_1 (0 ≦ H_1 ≦ 4,000) が与えられる。", "出力", "…"].join("\n"));
  assert.equal(p.constraints, null);
  assert.equal(p.format?.split("\n")[0], "H_1");
});

test("出力だけの問題(入力の節が説明の文だけ)は、入力の形式なし", () => {
  const p = splitStatement(["問題文", "この問題は output-only です。", "入力", "この問題では入力は与えられない。", "出力", "X"].join("\n"));
  assert.equal(p.format, null);
});

test("英語の問題文だけなら英語の見出しを使う", () => {
  const p = splitStatement(["Constraints", "1 \\leq N \\leq 100", "Input", "The input is given from Standard Input in the following format:", "N", "Output", "Print"].join("\n"));
  assert.equal(p.constraints, "1 \\leq N \\leq 100");
  assert.equal(p.format, "N");
});

test("KaTeX の表示をプレーンテキストでコピーしたものは、行末の空白を保ったまま返す", () => {
  // 10^5 は「10 改行 5 改行 空白」になる(tex.ts が元に戻す)。ここで空白を削ると戻せない
  const p = splitStatement(["制約", "1≤N≤10 ", "5", " ", "入力", "N "].join("\n"));
  assert.equal(p.constraints, "1≤N≤10 \n5\n ");
  const spec = buildSpec(p.format ?? "", p.constraints ?? "");
  assert.equal(spec.slots.get("N")?.hull.hi, 100000n);
});

test("見つからなければ null", () => {
  assert.deepEqual(splitStatement("N M\nA_1 A_2"), { format: null, constraints: null });
});
