// 性能のテスト。大きな入力で固まらないこと(正規表現の暴走や2乗の走査のような桁違いの遅さ)を捕まえる。
//
// 経過時間も CPU 時間も、機械が混んでいると何倍にも揺れる(混んでいると遅いコアに回される)。
// そこで絶対値ではなく伸び方で判定する: 同じプロセスで 1/10 の大きさと元の大きさを測り、
// 10倍の入力で時間が 40倍を超えたら(2乗なら100倍になる)失敗にする。各大きさは3回測って最も速い回を使う。
// 手元の目安(元の大きさで 200〜300ms)から大きく外れた暴走だけを捕まえるよう、絶対値の上限は緩く 5秒にしておく。
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeCode } from "../../src/lib/complexity/index.ts";

const MAX_RATIO = 40;
const HARD_LIMIT_MS = 5000;

function cpuMs(code: string, lang: string): { ms: number; text: string } {
  let ms = Infinity;
  let text = "";
  for (let k = 0; k < 3; k++) {
    const c0 = process.cpuUsage();
    text = analyzeCode(code, lang).time.text;
    const d = process.cpuUsage(c0);
    ms = Math.min(ms, (d.user + d.system) / 1000);
  }
  return { ms, text };
}

/** 1/10 の大きさと元の大きさの時間を測り、伸び方と上限を確かめる */
function scales(make: (n: number) => string, n: number, lang: string, expect?: string): void {
  const small = cpuMs(make(n / 10), lang);
  const large = cpuMs(make(n), lang);
  if (expect) assert.equal(large.text, expect);
  const ratio = large.ms / Math.max(small.ms, 1);
  assert.ok(ratio < MAX_RATIO, `10倍の入力で ${ratio.toFixed(1)} 倍(${small.ms.toFixed(0)}ms → ${large.ms.toFixed(0)}ms)`);
  assert.ok(large.ms < HARD_LIMIT_MS, `${large.ms.toFixed(0)}ms`);
}

test("1万行の for の連なり(C++)", () => {
  scales((n) => `int main() {\n    int n; cin >> n; long long s = 0;\n${Array.from({ length: n }, (_, i) => `    for (int i${i} = 0; i${i} < n; i${i}++) s += i${i};`).join("\n")}\n}\n`, 10000, "cpp", "O(N)");
});

test("1万行の for の連なり(Python)", () => {
  scales((n) => `n = int(input())\ns = 0\n${Array.from({ length: n }, (_, i) => `for i in range(n):\n    s += ${i}`).join("\n")}\n`, 10000, "python", "O(N)");
});

test("min(a, min(b, …)) の1万段の入れ子", () => {
  scales((n) => `int main() { int x = ${"min(a, ".repeat(n)}b${")".repeat(n)}; }`, 10000, "cpp");
});

test("rep マクロの5,000回の展開", () => {
  scales((n) => `#define rep(i, n) for (int i = 0; i < (int)(n); i++)\nint main() {\n    int n; cin >> n; long long s = 0;\n${Array.from({ length: n }, () => "    rep(i, n) s += i;").join("\n")}\n}\n`, 5000, "cpp", "O(N)");
});

test("1万行の end 系(Ruby)", () => {
  scales((n) => `n = gets.to_i\ns = 0\n${Array.from({ length: n }, (_, i) => `n.times do |i${i}|\n  s += i${i} if s > 0\nend`).join("\n")}\n`, 10000, "ruby", "O(N)");
});

test("深いループの入れ子(200段)", () => {
  const open = Array.from({ length: 200 }, (_, i) => `for (int i${i} = 0; i${i} < 2; i${i}++) {`).join("\n");
  const { ms } = cpuMs(`int main() {\n${open}\nx++;\n${"}".repeat(200)}\n}\n`, "cpp");
  assert.ok(ms < HARD_LIMIT_MS, `${ms.toFixed(0)}ms`);
});
