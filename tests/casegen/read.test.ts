// コーナーケース生成: 貼り付けた「入力」「制約」の読み取り
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeText } from "../../src/lib/casegen/tex.ts";
import { parseFormat } from "../../src/lib/casegen/format.ts";
import type { Item, Node } from "../../src/lib/casegen/format.ts";
import { exprToString, parseExpr, evalExpr } from "../../src/lib/casegen/expr.ts";
import { buildSpec } from "../../src/lib/casegen/spec.ts";

// Chrome で問題ページの表示(KaTeX)をコピーしたときの文字列を、見える記号で書いたもの。
// 「.」は空白、「¶」は改行、「Z」はゼロ幅空白、「_」は改行しない空白(実測した abc463_e の形)
const katex = (v: string) => v.replace(/\./g, " ").replace(/¶/g, "\n").replace(/Z/g, "\u200b").replace(/_/g, "\u00a0");

test("問題ページの表示をコピーした入力形式を、元の行と添字に戻す", () => {
  const s = katex("N.¶M.¶Y¶u.¶1¶Z¶..¶v.¶1¶Z¶..¶T.¶1¶Z¶.¶u.¶2¶Z¶..¶v.¶2¶Z¶..¶T.¶2¶Z¶.¶⋮¶u.¶M¶Z¶..¶v.¶M¶Z¶..¶T.¶M¶Z¶.¶X.¶1¶Z¶..¶X.¶2¶Z¶..¶….¶X.¶N¶Z¶.");
  assert.equal(normalizeText(s), "N M Y\nu_{1} v_{1} T_{1}\nu_{2} v_{2} T_{2}\n⋮\nu_{M} v_{M} T_{M}\nX_{1} X_{2} … X_{N}");
});

test("問題ページの表示をコピーした制約(累乗・添字の範囲)を戻す", () => {
  const s = katex("2≤N≤2×10.¶5¶.¶1≤u.¶i¶Z¶.<v.¶i¶Z¶.≤N_(1≤i≤M)¶1≤T.¶i¶Z¶.≤10.¶9¶._(1≤i≤M)¶全てのテストケースにおける.¶N.の総和は.¶2×10.¶5¶..以下");
  assert.equal(
    normalizeText(s),
    "2≤N≤2×10^{5}\n1≤u_{i}<v_{i}≤N (1≤i≤M)\n1≤T_{i}≤10^{9} (1≤i≤M)\n全てのテストケースにおける N の総和は 2×10^{5} 以下",
  );
});

test("空白なしでつながるグリッドの行と ≠ を戻す", () => {
  const grid = "H \nW\nC \n1,1\n\u200b\n C \n1,2\n\u200b\n …C \n1,W\n\u200b\n \n⋮\nC \nH,1\n\u200b\n C \nH,2\n\u200b\n …C \nH,W\n\u200b\n ";
  assert.equal(normalizeText(grid), "H W\nC_{1,1}C_{1,2}…C_{1,W}\n⋮\nC_{H,1}C_{H,2}…C_{H,W}");
  assert.equal(normalizeText("a \ni\n\u200b\n \n\ue020\n=b \ni\n\u200b\n"), "a_{i}≠b_{i}");
});

test("TeX のまま貼っても読める", () => {
  assert.equal(normalizeText("1\\le A _ i\\le 10 ^ 9\\ (1\\le i\\le N)"), "1≤ A_i≤ 10^9 (1≤ i≤ N)");
  assert.equal(normalizeText("\\mathrm{case}_1\n{\\rm Query}_2\n\\text{query}_Q"), "case_1\nQuery_2\nquery_Q");
  assert.equal(normalizeText("A_1 A_2 \\ldots A_{N-1}\n\\vdots"), "A_1 A_2 … A_{N-1}\n⋮");
  assert.equal(normalizeText("1 <= N <= 2*10^5\nA_1 A_2 ... A_N"), "1 ≤ N ≤ 2*10^5\nA_1 A_2 … A_N");
});

test("式: 暗黙のかけ算・関数・累乗を BigInt で評価する", () => {
  const vals: Record<string, bigint> = { N: 5n, H: 3n, W: 4n };
  const ev = (s: string) =>
    evalExpr(parseExpr(s)!, { get: (n, idx) => (idx.length ? undefined : vals[n]) });
  assert.equal(ev("2×10^{5}"), 200000n);
  assert.equal(ev("N(N-1)/2"), 10n);
  assert.equal(ev("2N"), 10n);
  assert.equal(ev("3N-3"), 12n);
  assert.equal(ev("HW"), 12n);
  assert.equal(ev("H×W-1"), 11n);
  assert.equal(ev("min(N, 10^5)"), 5n);
  assert.equal(ev("10^{18}"), 10n ** 18n);
  assert.equal(ev("2^{60} - 1"), 2n ** 60n - 1n);
  assert.equal(ev("-10^9"), -(10n ** 9n));
  assert.equal(exprToString(parseExpr("2×10^5")!), "2×10^5");
});

// ---- 入力形式 ----

const showItem = (it: Item): string =>
  it.k === "lit"
    ? it.text
    : it.k === "tok"
      ? exprToString({ k: "ref", name: it.ref.base, idx: it.ref.idx })
      : `[${exprToString({ k: "ref", name: it.ref.base, idx: it.ref.idx })} j=${exprToString(it.from)}..${exprToString(it.to)}${it.joined ? " joined" : ""}]`;

const show = (nodes: Node[]): string[] =>
  nodes.map((n) =>
    n.k === "row"
      ? n.items.map(showItem).join(" ")
      : n.k === "rep"
        ? `rep(${exprToString(n.count)}) ${n.items.map(showItem).join(" ")}`
        : n.k === "cases"
          ? `cases(${exprToString(n.count)}) { ${show(n.body).join(" / ")} }`
          : `queries(${exprToString(n.count)}) { ${n.alts.map((a) => a.map(showItem).join(" ")).join(" | ")} }`,
  );

const fmt = (s: string) => show(parseFormat(normalizeText(s)).nodes);

test("横の数列と縦のくり返し", () => {
  assert.deepEqual(fmt("N M\nA_1 A_2 \\ldots A_N\nu_1 v_1\nu_2 v_2\n\\vdots\nu_M v_M"), [
    "N M",
    "[A_j j=1..N]",
    "rep(M) u_i v_i",
  ]);
  // P_2 から始まる並び・N-1 本の辺
  assert.deepEqual(fmt("N\nP_2 P_3 \\ldots P_N\nU_1 V_1\n\\vdots\nU_{N-1} V_{N-1}"), ["N", "[P_j j=2..N]", "rep(N-1) U_i V_i"]);
  // 縦の数列
  assert.deepEqual(fmt("Q\na_1\na_2\n\\vdots\na_Q"), ["Q", "rep(Q) a_i"]);
});

test("グリッド(空白なし)と2次元の数・行ごとに長さの違う並び", () => {
  assert.deepEqual(fmt("H W\nC_{1,1}C_{1,2}\\ldots C_{1,W}\n\\vdots\nC_{H,1}C_{H,2}\\ldots C_{H,W}"), [
    "H W",
    "rep(H) [C_{i,j} j=1..W joined]",
  ]);
  assert.deepEqual(fmt("N\nK_1 A_{1,1} A_{1,2} \\ldots A_{1,K_1}\n\\vdots\nK_N A_{N,1} A_{N,2} \\ldots A_{N,K_N}"), [
    "N",
    "rep(N) K_i [A_{i,j} j=1..K_i]",
  ]);
  // 1行に2つずつ: A_1 A_2 / A_3 A_4 / … / A_{2N-1} A_{2N}
  assert.deepEqual(fmt("N\nA _ 1 A _ 2\nA _ 3 A _ 4\n\\vdots\nA _ {2N-1} A _ {2N}"), ["N", "rep((2N-1-1)/2+1) A_{-1+2×i} A_{0+2×i}"]);
});

test("マルチテストとクエリ(説明文の行は読み飛ばす)", () => {
  assert.deepEqual(
    fmt("T\n\\mathrm{case}_1\n\\mathrm{case}_2\n\\vdots\n\\mathrm{case}_T\n各テストケースは以下の形式で与えられる。\nN\nA_1 A_2 \\ldots A_N"),
    ["T", "cases(T) { N / [A_j j=1..N] }"],
  );
  assert.deepEqual(fmt("N Q\n\\text{query}_1\n\\vdots\n\\text{query}_Q\n1 x\n2 y z"), ["N Q", "queries(Q) { 1 x | 2 y z }"]);
  // 種類が1つだけのクエリ・英小文字の添字(t_q)は名前の一部
  assert.deepEqual(fmt("Q\nquery_1\n\\vdots\nquery_Q\nt_q w_q"), ["Q", "queries(Q) { t_q w_q }"]);
  // 問題ページの「入力」の節をまるごとコピーしたもの(見出し・説明文・出力の節まで)
  assert.deepEqual(fmt("入力\n入力は以下の形式で標準入力から与えられる。\n\nN\nS\n出力\nYes か No を出力せよ。"), ["N", "S"]);
});

test("クエリの形式が無いときは知らせる", () => {
  const f = parseFormat(normalizeText("N Q\nquery_1\n\\vdots\nquery_Q"));
  assert.ok(f.warnings.some((w) => w.includes("query_i の形式")));
});

// ---- 制約と変数 ----

const slot = (spec: ReturnType<typeof buildSpec>, key: string) => {
  const s = spec.slots.get(key);
  assert.ok(s, `${key} が無い`);
  return s;
};

test("範囲の連鎖・並び・添字つき・他の変数を使う上限", () => {
  const spec = buildSpec(
    "N M K\nA_1 \\ldots A_N",
    "1 \\le M \\le K \\le N \\le 2 \\times 10^5\n1 \\leq A_i \\leq N\n入力される値はすべて整数",
  );
  assert.deepEqual([slot(spec, "N").hull.lo, slot(spec, "N").hull.hi], [1n, 200000n]);
  assert.deepEqual([slot(spec, "K").hull.lo, slot(spec, "K").hull.hi], [1n, 200000n]);
  assert.deepEqual([slot(spec, "A[]").hull.lo, slot(spec, "A[]").hull.hi], [1n, 200000n]);
  assert.equal(slot(spec, "N").size, true);
  assert.deepEqual(spec.unread, []);
  assert.deepEqual(spec.warnings, []);
});

test("日本語の書き方の範囲・偶数・絶対値・M=2", () => {
  const spec = buildSpec(
    "N K X M\nH W",
    "N は 2 \\le N \\le 100 を満たす偶数\nK は 0 以上 HW 以下の整数\n|X| \\leq 2 \\times 10^5\nM=2\nH,W は 1 以上 500 以下の整数",
  );
  assert.equal(slot(spec, "N").parity, "even");
  assert.deepEqual([slot(spec, "K").hull.lo, slot(spec, "K").hull.hi], [0n, 250000n]);
  assert.deepEqual([slot(spec, "X").hull.lo, slot(spec, "X").hull.hi], [-200000n, 200000n]);
  assert.deepEqual([slot(spec, "M").hull.lo, slot(spec, "M").hull.hi], [2n, 2n]);
  assert.deepEqual([slot(spec, "H").hull.lo, slot(spec, "H").hull.hi], [1n, 500n]);
});

test("文字列: 文字の種類と長さ", () => {
  const spec = buildSpec(
    "N\nS\nT\nS_1\n\\vdots\nS_N\nc",
    [
      "S は英小文字からなる長さ N の文字列",
      "T は長さ 1 以上 10 以下の英大文字および数字からなる文字列",
      "S_i は ., # からなる長さ 5 の文字列",
      "c は A、B、C のいずれか",
      "1 \\le N \\le 10",
    ].join("\n"),
  );
  assert.equal(slot(spec, "S").type, "str");
  assert.equal(slot(spec, "S").charset?.length, 26);
  assert.equal(exprToString(slot(spec, "|S|").hi[0]), "N");
  assert.deepEqual([slot(spec, "|T|").hull.lo, slot(spec, "|T|").hull.hi], [1n, 10n]);
  assert.equal(slot(spec, "T").charset?.length, 36);
  assert.deepEqual(slot(spec, "S[]").charset, [".", "#"]);
  assert.deepEqual(slot(spec, "c").choices, ["A", "B", "C"]);
});

test("順列・相異なる・昇順・積の上限・総和", () => {
  const spec = buildSpec(
    "T\ncase_1\n\\vdots\ncase_T\nN H W\nP_1 \\ldots P_N\nA_1 \\ldots A_N\nB_1 \\ldots B_N",
    [
      "1 \\le T \\le 10^4",
      "(P_1, \\dots, P_N) は (1, \\dots, N) の順列",
      "A_i は相異なる",
      "1 \\le B_1 < B_2 < \\cdots < B_N \\le 10^6",
      "1 \\le H \\times W \\le 10^6",
      "1 \\le N \\le 2 \\times 10^5",
      "全てのテストケースにおける N の総和は 2 \\times 10^5 以下",
    ].join("\n"),
  );
  assert.equal(slot(spec, "P[]").perm, true);
  assert.equal(slot(spec, "A[]").distinct, true);
  assert.equal(slot(spec, "B[]").sorted, "lt");
  assert.deepEqual(spec.products.map((p) => p.keys), [["H", "W"]]);
  assert.deepEqual(spec.caseSums.map((c) => c.key), ["N"]);
  assert.equal(spec.caseCount, "T");
  assert.equal(slot(spec, "N").scope, "case");
});

test("グラフ: 木・単純連結グラフ・辺の向き", () => {
  const tree = buildSpec("N\nu_1 v_1\n\\vdots\nu_{N-1} v_{N-1}", "2 \\le N \\le 10^5\n1 \\le u_i, v_i \\le N\n与えられるグラフは木");
  assert.equal(tree.graph?.tree, true);
  assert.equal(tree.graph?.n, "N");
  const g = buildSpec(
    "N M\na_1 b_1\n\\vdots\na_M b_M",
    "1 \\le N \\le 2 \\times 10^5\n1 \\le M \\le 2 \\times 10^5\n1 \\le a_i < b_i \\le N\n与えられるグラフは単純連結無向グラフである",
  );
  assert.equal(g.graph?.simple, true);
  assert.equal(g.graph?.connected, true);
  assert.equal(g.graph?.ordered, true);
  // 相異なる辺(グラフとは書いていない)も単純グラフとして作る
  const p = buildSpec("N M\nu_1 v_1\n\\vdots\nu_M v_M", "1 \\le N \\le 50\n0 \\le M \\le 1000\n1 \\le u_i < v_i \\le N\n(u_1,v_1),(u_2,v_2),\\dots,(u_M,v_M) は相異なる");
  assert.equal(p.graph?.simple, true);
});

test("読めない制約は使わずに知らせる", () => {
  const spec = buildSpec("N X\nA_1 \\ldots A_N", "1 \\le N \\le 40\n1 \\le A_i \\le 10^{16}\n1 \\le X \\le \\sum_{i=1}^{N} A_i\n黒いピクセルが少なくとも 1 つ存在する");
  assert.equal(spec.unread.length, 2);
  // X は上限が分からないので仮の範囲(表で直せる)
  assert.equal(slot(spec, "X").assumed, true);
});

test("範囲の手直しを使う", () => {
  const spec = buildSpec("N\nA_1 \\ldots A_N", "1 \\le N \\le 2 \\times 10^5\n1 \\le A_i \\le 10^9", { N: { hi: "10" }, "A[]": { lo: "5", hi: "2×10^1" } });
  assert.deepEqual([slot(spec, "N").hull.lo, slot(spec, "N").hull.hi], [1n, 10n]);
  assert.deepEqual([slot(spec, "A[]").hull.lo, slot(spec, "A[]").hull.hi], [5n, 20n]);
});
