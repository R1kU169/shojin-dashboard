// コーナーケース生成: 作った入力が形式と制約を満たすか(読み戻して確かめる)
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSpec } from "../../src/lib/casegen/spec.ts";
import { generateCase } from "../../src/lib/casegen/generate.ts";
import type { GeneratedCase } from "../../src/lib/casegen/generate.ts";

/** 全部のケースを作る。テストを速くするため、最大のケースは 300KB に縮める */
function all(format: string, constraints: string, maxBytes = 300_000): GeneratedCase[] {
  const spec = buildSpec(format, constraints);
  return spec.presets.map((p) => generateCase(spec, p, "test", maxBytes));
}

function one(format: string, constraints: string, id: string, maxBytes = 8_000_000): GeneratedCase {
  const spec = buildSpec(format, constraints);
  const p = spec.presets.find((x) => x.id === id);
  assert.ok(p, `${id} のケースが無い`);
  return generateCase(spec, p, "test", maxBytes);
}

/** 1行ずつ空白で区切って読む */
class Reader {
  private lines: string[];
  private i = 0;
  constructor(s: string) {
    assert.ok(s.endsWith("\n"), "最後に改行がある");
    this.lines = s.slice(0, -1).split("\n");
  }
  row(): string[] {
    assert.ok(this.i < this.lines.length, "行が足りない");
    const l = this.lines[this.i++];
    return l === "" ? [] : l.split(" ");
  }
  ints(): bigint[] {
    return this.row().map((t) => {
      assert.match(t, /^-?\d+$/);
      return BigInt(t);
    });
  }
  end() {
    assert.equal(this.i, this.lines.length, "余分な行がある");
  }
}

const inRange = (v: bigint, lo: bigint, hi: bigint, what: string) => assert.ok(lo <= v && v <= hi, `${what} = ${v} が ${lo}..${hi} の外`);

test("数列: 長さ・範囲・K ≤ N、昇順・降順・同じ値", () => {
  const f = "N K\nA_1 A_2 \\ldots A_N";
  const c = "1 \\le K \\le N \\le 2\\times 10^5\n1 \\le A_i \\le 10^9";
  for (const k of all(f, c)) {
    const r = new Reader(k.input);
    const [N, K] = r.ints();
    inRange(N, 1n, 200000n, "N");
    inRange(K, 1n, N, "K");
    const A = r.ints();
    assert.equal(A.length, Number(N), k.label);
    for (const a of A) inRange(a, 1n, 10n ** 9n, "A_i");
    r.end();
    if (k.id === "asc") assert.ok(A.every((a, i) => i === 0 || A[i - 1] <= a));
    if (k.id === "desc") assert.ok(A.every((a, i) => i === 0 || A[i - 1] >= a));
    if (k.id === "same") assert.ok(A.every((a) => a === A[0]));
    if (k.id === "min") assert.deepEqual([N, K, ...A], [1n, 1n, 1n]);
  }
});

test("最大・値はすべて最大は、縮めなければ上限ちょうど", () => {
  const k = one("N\nA_1 A_2 \\ldots A_N", "1 \\le N \\le 2\\times 10^5\n1 \\le A_i \\le 10^9", "max-max");
  const r = new Reader(k.input);
  assert.deepEqual(r.ints(), [200000n]);
  const A = r.ints();
  assert.equal(A.length, 200000);
  assert.ok(A.every((a) => a === 10n ** 9n));
  assert.equal(k.shrunk, false);
  // 10^18 や 2^60-1 も正確に出す
  const big = one("N S", "1 \\le N \\le 10^{18}\n0 \\le \\mathrm{seed} \\le 2^{60} - 1\n0 \\le S \\le 2^{60}-1", "max-max");
  assert.equal(big.input, `${10n ** 18n} ${2n ** 60n - 1n}\n`);
});

test("辺の並び: u_i < v_i ≤ N と重み", () => {
  const f = "N M Y\nu _ 1 v _ 1 T _ 1\nu _ 2 v _ 2 T _ 2\n\\vdots\nu _ M v _ M T _ M\nX _ 1 X _ 2 \\ldots X _ N";
  const c = "2\\le N\\le2\\times10 ^ 5\n0\\le M\\le2\\times10 ^ 5\n1\\le u _ i\\lt v _ i\\le N\\ (1\\le i\\le M)\n1\\le T _ i\\le10 ^ 9\n1\\le X _ i\\le10 ^ 9\n1\\le Y\\le 10 ^ 9";
  for (const k of all(f, c)) {
    const r = new Reader(k.input);
    const [N, M, Y] = r.ints();
    inRange(N, 2n, 200000n, "N");
    inRange(M, 0n, 200000n, "M");
    inRange(Y, 1n, 10n ** 9n, "Y");
    for (let i = 0; i < Number(M); i++) {
      const [u, v, t] = r.ints();
      assert.ok(1n <= u && u < v && v <= N, `${k.label}: ${u} < ${v} ≤ ${N}`);
      inRange(t, 1n, 10n ** 9n, "T_i");
    }
    assert.equal(r.ints().length, Number(N));
    r.end();
  }
});

/** 辺の並びが木(連結で N-1 本)か */
function isTree(n: number, edges: [number, number][]): boolean {
  if (edges.length !== n - 1) return false;
  const p = Array.from({ length: n + 1 }, (_, i) => i);
  const find = (x: number): number => (p[x] === x ? x : (p[x] = find(p[x])));
  for (const [a, b] of edges) {
    if (a < 1 || a > n || b < 1 || b > n) return false;
    const x = find(a);
    const y = find(b);
    if (x === y) return false;
    p[x] = y;
  }
  return true;
}

test("木: どのケースも木になり、一直線とスターの形もある", () => {
  const f = "N\nU_1 V_1\nU_2 V_2\n\\vdots\nU_{N-1} V_{N-1}";
  const c = "2 \\leq N \\leq 2\\times 10^5\n1 \\leq U_i, V_i \\leq N\n与えられるグラフは木";
  const ids = new Set<string>();
  for (const k of all(f, c)) {
    ids.add(k.id);
    const r = new Reader(k.input);
    const [N] = r.ints();
    const edges: [number, number][] = [];
    for (let i = 1; i < Number(N); i++) {
      const [a, b] = r.ints();
      edges.push([Number(a), Number(b)]);
    }
    r.end();
    assert.ok(isTree(Number(N), edges), k.label);
    if (k.id === "path") assert.ok(edges.every(([a, b], i) => a === i + 1 && b === i + 2));
    if (k.id === "star") assert.ok(edges.every(([a]) => a === 1));
  }
  assert.ok(ids.has("path") && ids.has("star"));
});

test("マルチテストの単純連結グラフ: 総和・連結・多重辺なし", () => {
  const f = "T\n\\mathrm{case}_1\n\\vdots\n\\mathrm{case}_T\nN M\na_1 b_1\n\\vdots\na_M b_M";
  const c = [
    "1 \\le T \\le 2\\times10^5",
    "1 \\le N, M \\le 2\\times10^5",
    "全てのテストケースにおける N の総和は 2×10^5 以下",
    "全てのテストケースにおける M の総和は 2×10^5 以下",
    "1 \\le a_i,b_i \\le N",
    "a_i\\ne b_i",
    "与えられるグラフは単純連結無向グラフである",
  ].join("\n");
  for (const k of all(f, c)) {
    const r = new Reader(k.input);
    const [T] = r.ints();
    let sumN = 0n;
    let sumM = 0n;
    for (let t = 0n; t < T; t++) {
      const [N, M] = r.ints();
      sumN += N;
      sumM += M;
      const n = Number(N);
      assert.ok(M >= N - 1n, `${k.label}: 連結なら M ≥ N-1`);
      const seen = new Set<string>();
      const p = Array.from({ length: n + 1 }, (_, i) => i);
      const find = (x: number): number => (p[x] === x ? x : (p[x] = find(p[x])));
      let comps = n;
      for (let i = 0; i < Number(M); i++) {
        const [a, b] = r.ints().map(Number);
        assert.ok(a !== b && a >= 1 && b >= 1 && a <= n && b <= n, `${k.label}: 辺 ${a} ${b}`);
        const key = a < b ? `${a} ${b}` : `${b} ${a}`;
        assert.ok(!seen.has(key), `${k.label}: 多重辺`);
        seen.add(key);
        if (find(a) !== find(b)) {
          p[find(a)] = find(b);
          comps--;
        }
      }
      assert.equal(comps, 1, `${k.label}: 連結`);
    }
    r.end();
    assert.ok(sumN <= 200000n && sumM <= 200000n, k.label);
  }
});

test("マルチテスト: T 最大のケースは総和に収まる数だけ並べる", () => {
  const k = one("T\ncase_1\n\\vdots\ncase_T\nN\nA_1 \\ldots A_N", "1\\le T\\le 10^4\n1\\le N\\le 2\\times 10^5\n全てのテストケースにおける N の総和は 2\\times 10^5 以下\n0\\le A_i\\le 10^9", "many");
  const r = new Reader(k.input);
  const [T] = r.ints();
  assert.equal(T, 10000n);
  let sum = 0n;
  for (let t = 0n; t < T; t++) {
    const [N] = r.ints();
    sum += N;
    assert.equal(r.ints().length, Number(N));
  }
  r.end();
  assert.ok(sum <= 200000n && sum > 150000n, `総和 ${sum}`);
});

test("グリッド: H × W ≤ 10^6、正方形・細長い形、文字の種類", () => {
  const f = "H W\nS_1\nS_2\n\\vdots\nS_H";
  const c = "1 \\leq H \\times W \\leq 10^6\nH, W は正整数\nS_i は ., # からなる長さ W の文字列";
  const shapes = new Map<string, [bigint, bigint]>();
  for (const k of all(f, c, 8_000_000)) {
    const r = new Reader(k.input);
    const [H, W] = r.ints();
    assert.ok(H * W <= 1000000n, k.label);
    shapes.set(k.id, [H, W]);
    for (let i = 0n; i < H; i++) {
      const [s] = r.row();
      assert.equal(BigInt(s.length), W);
      assert.match(s, /^[.#]+$/);
      if (k.id === "str-first") assert.match(s, /^\.+$/);
      if (k.id === "str-last") assert.match(s, /^#+$/);
    }
    r.end();
  }
  assert.deepEqual(shapes.get("max"), [1000n, 1000n]);
  assert.deepEqual(shapes.get("wide"), [1n, 1000000n]);
  assert.deepEqual(shapes.get("tall"), [1000000n, 1n]);
});

test("順列・狭義に昇順・相異なる", () => {
  for (const k of all("N\nP_1 P_2 \\ldots P_N\nB_1 \\ldots B_N\nC_1 \\ldots C_N", "1\\le N\\le 5\\times 10^5\nP は (1,2,\\ldots,N) の並び替え\n1 \\le B_1 < B_2 < \\cdots < B_N \\le 10^6\n-10^9 \\le C_i \\le 10^9\nC_i は相異なる")) {
    const r = new Reader(k.input);
    const [N] = r.ints();
    const P = r.ints();
    assert.deepEqual([...P].sort((a, b) => (a < b ? -1 : 1)), Array.from({ length: Number(N) }, (_, i) => BigInt(i + 1)), k.label);
    const B = r.ints();
    assert.ok(B.every((b, i) => i === 0 || B[i - 1] < b) && B[0] >= 1n && B[B.length - 1] <= 1000000n, k.label);
    const C = r.ints();
    assert.equal(new Set(C.map(String)).size, C.length, k.label);
    r.end();
  }
});

test("クエリ: 種類ごとの形式で、どの種類も出す", () => {
  const f = "N Q\n\\mathrm{query}_1\n\\vdots\n\\mathrm{query}_Q\n1 x\n2 l r";
  const c = "1\\leq N\\leq 3\\times 10^5\n1\\leq Q\\leq 3\\times 10^5\n1\\leq x\\leq N\n種類 2 のクエリにおいて、1 \\le l \\le r \\le N";
  for (const k of all(f, c)) {
    const r = new Reader(k.input);
    const [N, Q] = r.ints();
    const types = new Set<bigint>();
    let last = 0n;
    for (let q = 0n; q < Q; q++) {
      const t = r.ints();
      types.add(t[0]);
      last = t[0];
      if (t[0] === 1n) {
        assert.equal(t.length, 2);
        inRange(t[1], 1n, N, "x");
      } else {
        assert.equal(t.length, 3);
        assert.ok(1n <= t[1] && t[1] <= t[2] && t[2] <= N, k.label);
      }
    }
    r.end();
    assert.equal(last, 2n, "最後は答えを出す種類");
    if (Q >= 2n) assert.equal(types.size, 2, k.label);
  }
});

test("文字列・偶数・絶対値・選択肢", () => {
  for (const k of all("N K X\nS\nc", "2 \\le N \\le 100\nN は偶数\nS は o と x からなる長さ N の文字列\n|X| \\le 2\\times 10^5\nK は 1 以上 N 以下の整数\nc は B、Y、R のいずれか")) {
    const r = new Reader(k.input);
    const [N, K, X] = r.ints();
    assert.equal(N % 2n, 0n, k.label);
    inRange(K, 1n, N, "K");
    inRange(X, -200000n, 200000n, "X");
    const [S] = r.row();
    assert.equal(BigInt(S.length), N);
    assert.match(S, /^[ox]+$/);
    const [cc] = r.row();
    assert.ok(["B", "Y", "R"].includes(cc));
    r.end();
    if (k.id === "min") assert.equal(X, -200000n);
  }
});

test("行ごとに長さの違う並び・要素の和・空白なしのグリッド", () => {
  for (const k of all("N\nK_1 A_{1,1} A_{1,2} \\ldots A_{1,K_1}\n\\vdots\nK_N A_{N,1} A_{N,2} \\ldots A_{N,K_N}", "2\\le N\\le 100\n1\\le K_i\\le N-1\n1\\le A_{i,1} < A_{i,2} < \\cdots < A_{i,K_i}\\le N\nA_{i,j} \\neq i")) {
    const r = new Reader(k.input);
    const [N] = r.ints();
    for (let i = 0n; i < N; i++) {
      const [K, ...A] = r.ints();
      inRange(K, 1n, N - 1n, "K_i");
      assert.equal(A.length, Number(K));
      assert.ok(A.every((a, j) => a >= 1n && a <= N && (j === 0 || A[j - 1] < a)), k.label);
    }
    r.end();
  }
  for (const k of all("N\nD_1 D_2 \\ldots D_N", "1 \\le N \\le 2\\times 10^5\n1 \\le D_i\nD_1+D_2+\\cdots+D_N\\leq 10^6", 8_000_000)) {
    const r = new Reader(k.input);
    const [N] = r.ints();
    const D = r.ints();
    assert.equal(D.length, Number(N));
    assert.ok(D.every((d) => d >= 1n) && D.reduce((a, b) => a + b, 0n) <= 1000000n, k.label);
  }
  for (const k of all("H W\nC_{1,1}C_{1,2}\\ldots C_{1,W}\n\\vdots\nC_{H,1}C_{H,2}\\ldots C_{H,W}", "1 \\le H, W \\le 50\nC_{i,j} は . または # である")) {
    const r = new Reader(k.input);
    const [H, W] = r.ints();
    for (let i = 0n; i < H; i++) {
      const [s] = r.row();
      assert.equal(BigInt(s.length), W);
      assert.match(s, /^[.#]+$/);
    }
    r.end();
  }
});

test("同じ形式・制約からは同じ入力。送れる大きさに縮める", () => {
  const f = "N\nA_1 \\ldots A_N";
  const c = "1 \\le N \\le 2\\times 10^5\n1 \\le A_i \\le 10^9";
  const spec = buildSpec(f, c);
  const p = spec.presets.find((x) => x.id === "max")!;
  assert.equal(generateCase(spec, p, "a", 300_000).input, generateCase(buildSpec(f, c), p, "a", 300_000).input);
  assert.notEqual(generateCase(spec, p, "a", 300_000).input, generateCase(spec, p, "b", 300_000).input);
  // Wandbox 用: 改行を2バイトに数えて 1MB に収める
  const k = generateCase(spec, p, "a", 1_000_000, 2);
  assert.equal(k.shrunk, true);
  assert.ok(k.bytes + k.lines <= 1_000_000);
  assert.ok(k.bytes > 800_000, `縮めすぎ: ${k.bytes}`);
});

// ---- 点検(2026-10)で見つかった読み違い・作り違いの回帰テスト ----

/** u ≠ v で同じ組が無いか */
function simpleEdges(n: bigint, edges: bigint[][]): boolean {
  const seen = new Set<string>();
  for (const [a, b] of edges) {
    if (a === b || a < 1n || b < 1n || a > n || b > n) return false;
    const k = a < b ? `${a} ${b}` : `${b} ${a}`;
    if (seen.has(k)) return false;
    seen.add(k);
  }
  return true;
}

test("密なグラフ: 最大のケースも作れる(引数の数の上限で落ちない)", () => {
  const f = "N M\nA_1 B_1 C_1\n⋮\nA_M B_M C_M";
  const c = "1≤N≤500\n0≤M≤\\min(N(N-1)/2, 2×10^5)\n1≤A_i,B_i≤N\nA_i≠B_i\n(A_i,B_i) は相異なる\n1≤C_i≤10^9";
  for (const k of all(f, c, 8_000_000)) {
    assert.deepEqual(k.notes.filter((n) => /できません/.test(n)), [], k.label);
    const r = new Reader(k.input);
    const [N, M] = r.ints();
    const edges = Array.from({ length: Number(M) }, () => r.ints());
    r.end();
    assert.ok(M <= (N * (N - 1n)) / 2n, k.label);
    assert.ok(simpleEdges(N, edges), k.label);
    if (k.id === "max") assert.equal(M, 124750n);
  }
});

test("分数・\\left / \\right を含む上限を読み、全部の頂点対を並べない", () => {
  const f = "N M\nu_1 v_1\n⋮\nu_M v_M";
  const c = "2≤N≤2×10^5\nN-1 ≤ M ≤ \\min\\left(2×10^5, \\frac{N(N-1)}{2}\\right)\n1≤u_i<v_i≤N\nグラフは単純かつ連結";
  const spec = buildSpec(f, c);
  assert.deepEqual(spec.unread, []);
  const t0 = Date.now();
  const k = one(f, c, "max");
  assert.ok(Date.now() - t0 < 5000, "時間がかかりすぎ");
  const r = new Reader(k.input);
  const [N, M] = r.ints();
  assert.ok(M <= 200000n && M >= N - 1n, `M = ${M}`);
});

test("P_i ≠ i / A_i ≠ i: 添字の文字との ≠ を守る(まとめて作るケースも)", () => {
  for (const k of all("N\nP_1 P_2 \\ldots P_N", "2≤N≤2×10^5\nP は (1,2,…,N) の順列\nP_i \\neq i", 8_000_000)) {
    const r = new Reader(k.input);
    const [N] = r.ints();
    const P = r.ints();
    assert.equal(P.length, Number(N));
    assert.deepEqual([...P].sort((a, b) => (a < b ? -1 : 1)), Array.from({ length: Number(N) }, (_, i) => BigInt(i + 1)), `${k.label}: 順列`);
    assert.ok(P.every((p, i) => p !== BigInt(i + 1)), `${k.label}: P_i ≠ i`);
  }
  for (const k of all("N\nA_1 A_2 \\ldots A_N", "2≤N≤10\n1≤A_i≤N\nA_i \\neq i")) {
    const r = new Reader(k.input);
    r.ints();
    assert.ok(r.ints().every((a, i) => a !== BigInt(i + 1)), `${k.label}: A_i ≠ i`);
  }
});

test("偶数・u_i ≠ v_i は、すべて同じ値・昇順・降順のケースでも守る", () => {
  for (const k of all("N\nA_1 A_2 \\ldots A_N", "1≤N≤10\n1≤A_i≤100\nA_i は偶数")) {
    const r = new Reader(k.input);
    r.ints();
    assert.ok(r.ints().every((a) => a % 2n === 0n && a >= 1n && a <= 100n), k.label);
  }
  for (const k of all("N M\nu_1 v_1\n⋮\nu_M v_M", "2≤N≤10\n1≤M≤10\n0 \\leq u_i, v_i \\leq N-1\nu_i \\neq v_i")) {
    const r = new Reader(k.input);
    const [N, M] = r.ints();
    for (let i = 0; i < Number(M); i++) {
      const [u, v] = r.ints();
      assert.ok(u !== v && u >= 0n && v >= 0n && u < N && v < N, `${k.label}: ${u} ${v}`);
    }
  }
});

test("(0, 1, …, N-1) の順列は 0 始まり", () => {
  for (const k of all("N\nP_1 P_2 \\ldots P_N", "1≤N≤10\nP は (0,1,…,N-1) の順列")) {
    const r = new Reader(k.input);
    const [N] = r.ints();
    const P = r.ints();
    assert.deepEqual([...P].sort((a, b) => (a < b ? -1 : 1)), Array.from({ length: Number(N) }, (_, i) => BigInt(i)), k.label);
  }
});

test("「連結とは限らない」「単純とは限らない」を逆の意味に読まない", () => {
  const f = "N M\nu_1 v_1\n⋮\nu_M v_M";
  const notConnected = all(f, "2≤N≤10\n0≤M≤10\n1≤u_i<v_i≤N\nグラフは連結とは限らない");
  assert.ok(notConnected.some((k) => new Reader(k.input).ints()[1] === 0n), "M = 0 のケースがある");
  const notSimple = all(f, "2≤N≤4\n0≤M≤10\n1≤u_i,v_i≤N\nグラフは単純とは限らない");
  assert.ok(notSimple.some((k) => new Reader(k.input).ints()[1] === 10n), "単純グラフの上限(6本)を超える本数も作る");
  assert.deepEqual(buildSpec(f, "2≤N≤10\n0≤M≤10\n1≤u_i<v_i≤N\nグラフは連結とは限らない").unread, []);
});

test("|S| の総和の制約を守る(「S の長さの総和」と同じ)", () => {
  const f = "T\n\\mathrm{case}_1\n\\mathrm{case}_2\n\\vdots\n\\mathrm{case}_T\n各テストケースは以下の形式で与えられる。\nS";
  for (const c of [
    "1≤T≤10^5\nS は英小文字からなる\n1≤|S|≤2×10^5\n|S| の総和は 2×10^5 以下",
    "1≤T≤10^5\nS は英小文字からなる長さ 1 以上 2×10^5 以下の文字列\nすべてのテストケースにおける |S| の総和は 2×10^5 以下",
  ]) {
    for (const k of all(f, c, 8_000_000)) {
      const lines = k.input.split("\n").filter(Boolean);
      const sum = lines.slice(1).reduce((a, s) => a + s.length, 0);
      assert.ok(sum <= 200000, `${k.label}: Σ|S| = ${sum}`);
      assert.equal(lines.length - 1, Number(lines[0]), k.label);
    }
  }
});

test("相異なる文字列: 乱数で見つからなくても重複させない", () => {
  for (const k of all("N\nS_1\n\\vdots\nS_N", "1≤N≤26\nS_i は英小文字からなる長さ 1 の文字列\nS_i は相異なる")) {
    const S = k.input.split("\n").filter(Boolean).slice(1);
    assert.equal(new Set(S).size, S.length, `${k.label}: ${S.join(" ")}`);
  }
});

test("(L_i, R_i) は相異なる + L_i ≤ R_i は区間として作る(L = R もある)", () => {
  const ks = all("N Q\nL_1 R_1\n⋮\nL_Q R_Q", "1≤N≤4\n1≤Q≤10\n1≤L_i≤R_i≤N\n(L_i,R_i) は相異なる");
  let equal = false;
  for (const k of ks) {
    const r = new Reader(k.input);
    const [N, Q] = r.ints();
    for (let i = 0; i < Number(Q); i++) {
      const [L, R] = r.ints();
      assert.ok(1n <= L && L <= R && R <= N, `${k.label}: ${L} ${R}`);
      if (L === R) equal = true;
    }
  }
  assert.ok(equal, "L = R のケースがある");
  const max = ks.find((k) => k.id === "max")!;
  const r = new Reader(max.input);
  assert.equal(r.ints()[1], 10n, "Q は区間の数(10)まで");
});

test("M の下限が大きくても仕様をすぐ作る(頂点数を1つずつ数えない)", () => {
  const t0 = Date.now();
  buildSpec("N M\nu_1 v_1\n⋮\nu_M v_M", "1≤N≤10^9\n10^{18}≤M≤10^{18}\n1≤u_i<v_i≤N\nグラフは単純");
  assert.ok(Date.now() - t0 < 1000, `${Date.now() - t0}ms`);
});
