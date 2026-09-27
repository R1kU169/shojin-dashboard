// 性能のテスト。大きな入力で固まらないこと(正規表現の暴走や2乗の走査のような桁違いの遅さ)を捕まえる。
// CI の揺れで落ちないよう上限は各1秒にしている(手元の目安は 200ms 程度)。
// 経過時間は他の処理で機械が混んでいると何倍にも揺れるので、このプロセスが使った CPU 時間で測り、
// 2回測って少ない方で判定する(1回目は JIT の準備を含む)。
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeCode } from "../../src/lib/complexity/index.ts";

const LIMIT_MS = 1000;

function timed(code: string, lang: string): { ms: number; text: string } {
  let ms = Infinity;
  let text = "";
  for (let k = 0; k < 2; k++) {
    const c0 = process.cpuUsage();
    text = analyzeCode(code, lang).time.text;
    const d = process.cpuUsage(c0);
    ms = Math.min(ms, (d.user + d.system) / 1000);
  }
  return { ms, text };
}

test("1万行の for の連なり(C++)", () => {
  const lines = Array.from({ length: 10000 }, (_, i) => `    for (int i${i} = 0; i${i} < n; i${i}++) s += i${i};`).join("\n");
  const { ms, text } = timed(`int main() {\n    int n; cin >> n; long long s = 0;\n${lines}\n}\n`, "cpp");
  assert.equal(text, "O(N)");
  assert.ok(ms < LIMIT_MS, `${ms.toFixed(0)}ms`);
});

test("1万行の for の連なり(Python)", () => {
  const lines = Array.from({ length: 10000 }, (_, i) => `for i in range(n):\n    s += ${i}`).join("\n");
  const { ms, text } = timed(`n = int(input())\ns = 0\n${lines}\n`, "python");
  assert.equal(text, "O(N)");
  assert.ok(ms < LIMIT_MS, `${ms.toFixed(0)}ms`);
});

test("min(a, min(b, …)) の1万段の入れ子", () => {
  const mins = "min(a, ".repeat(10000) + "b" + ")".repeat(10000);
  const { ms } = timed(`int main() { int x = ${mins}; }`, "cpp");
  assert.ok(ms < LIMIT_MS, `${ms.toFixed(0)}ms`);
});

test("rep マクロの5,000回の展開", () => {
  const reps = Array.from({ length: 5000 }, () => "    rep(i, n) s += i;").join("\n");
  const { ms, text } = timed(`#define rep(i, n) for (int i = 0; i < (int)(n); i++)\nint main() {\n    int n; cin >> n; long long s = 0;\n${reps}\n}\n`, "cpp");
  assert.equal(text, "O(N)");
  assert.ok(ms < LIMIT_MS, `${ms.toFixed(0)}ms`);
});

test("深いループの入れ子(200段)", () => {
  const open = Array.from({ length: 200 }, (_, i) => `for (int i${i} = 0; i${i} < 2; i${i}++) {`).join("\n");
  const { ms } = timed(`int main() {\n${open}\nx++;\n${"}".repeat(200)}\n}\n`, "cpp");
  assert.ok(ms < LIMIT_MS, `${ms.toFixed(0)}ms`);
});
