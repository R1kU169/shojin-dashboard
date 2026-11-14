import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { usedPyLibs, wrapPython } from "../src/lib/pywrap.ts";
import type { PyLib } from "../src/lib/pywrap.ts";

const LIB_DIR = fileURLToPath(new URL("../src/lib/pylibs/", import.meta.url));

/** pylibSources.ts(Vite の import.meta.glob)と同じ形にする */
function loadFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const lib of readdirSync(LIB_DIR, { withFileTypes: true })) {
    if (!lib.isDirectory()) continue;
    for (const f of readdirSync(join(LIB_DIR, lib.name))) {
      if (f.endsWith(".py")) files[`${lib.name}/${f}`] = readFileSync(join(LIB_DIR, lib.name, f), "utf8");
    }
  }
  return files;
}

test("usedPyLibs: import しているライブラリだけを見つける", () => {
  const cases: [string, PyLib[]][] = [
    ["from sortedcontainers import SortedList", ["sortedcontainers"]],
    ["import sortedcontainers as sc", ["sortedcontainers"]],
    ["from atcoder.dsu import DSU", ["atcoder"]],
    ["def f():\n    from atcoder.segtree import SegTree", ["atcoder"]],
    ["import sys, atcoder.dsu", ["atcoder"]],
    ["from atcoder import dsu", ["atcoder"]],
    ["from sortedcontainers import SortedSet\nfrom atcoder.dsu import DSU", ["sortedcontainers", "atcoder"]],
    // atcoder は URL・コメント・文字列では同梱しない
    ["# https://atcoder.jp/contests/abc300/tasks/abc300_a\nprint(1)", []],
    ['print("atcoder")', []],
    ["import sys  # atcoder", []],
    ["important = 1; atcoder = 2", []],
    ["a, b = map(int, input().split())\nprint(a + b)", []],
  ];
  for (const [code, want] of cases) assert.deepEqual(usedPyLibs(code), want, code);
});

// 包んだコードを手元の Python で実際に動かす。-S で site-packages を読まないので、本物の sortedcontainers が
// 入っていても同梱したものが使われる(-S だと exit() が無いので使わない)。
// 実行先(Compiler Explorer・Wandbox の CPython 3.14・PyPy 3.10)でも同じことを確かめている
const python = spawnSync("python3", ["--version"]).status === 0 ? "python3" : null;

async function runPy(code: string, stdin = "") {
  const dir = mkdtempSync(join(tmpdir(), "pywrap-"));
  try {
    const file = join(dir, "prog.py");
    writeFileSync(file, await wrapPython(code, loadFiles(), usedPyLibs(code)));
    const r = spawnSync(python!, ["-I", "-S", file], { input: stdin, encoding: "utf8", cwd: dir });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("wrapPython: sortedcontainers と atcoder が使える", { skip: !python && "python3 が無い" }, async () => {
  const r = await runPy(
    `import sys
from sortedcontainers import SortedSet, SortedList, SortedDict
from atcoder.dsu import DSU
from atcoder.lazysegtree import LazySegTree
from atcoder.modint import Modint, ModContext
from atcoder.convolution import convolution
from atcoder.string import suffix_array
import math, string
s = SortedSet(map(int, sys.stdin.read().split()))
print(list(s), s.bisect_left(3), SortedList([3, 1, 2]), list(SortedDict(b=2, a=1)))
d = DSU(3); d.merge(0, 2); print(d.groups())
lz = LazySegTree(max, -1, lambda f, x: f + x, lambda f, g: f + g, 0, [1, 2, 3]); lz.apply(0, 2, 10); print(lz.prod(0, 3))
with ModContext(7):
    print(Modint(3).inv().val())
print(convolution(998244353, [1, 2], [3, 4]), suffix_array("banana"))
print(math.gcd(4, 6), string.digits[:3])
`,
    "5 1 3 3\n",
  );
  assert.equal(r.stderr, "");
  assert.equal(
    r.stdout,
    "[1, 3, 5] 1 SortedList([1, 2, 3]) ['a', 'b']\n[[0, 2], [1]]\n12\n5\n[3, 10, 8] [5, 3, 1, 0, 4, 2]\n2 012\n",
  );
});

test("wrapPython: 書いたコードの名前空間はふつうに実行したときと同じ", { skip: !python && "python3 が無い" }, async () => {
  const r = await runPy(`from __future__ import annotations
from sortedcontainers import SortedList
def f(n: int) -> int:
    return n
if __name__ == "__main__":
    print(sorted(k for k in globals() if not k.startswith("__")), f(1))
print("tab\\there", '"quote"', "日本語", "\\\\")
`);
  assert.equal(r.stderr, "");
  assert.equal(r.stdout, `['SortedList', 'annotations', 'f'] 1\ntab\there "quote" 日本語 \\\n`);
});

test("wrapPython: エラーの行番号は書いたコードのまま、包んだ側の行は出さない", { skip: !python && "python3 が無い" }, async () => {
  const r = await runPy(`from sortedcontainers import SortedList
s = SortedList()

print(s[5])
`);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^Traceback \(most recent call last\):\n {2}File "Main\.py", line 4, in <module>\n {4}print\(s\[5\]\)\n/);
  assert.match(r.stderr, /File "sortedcontainers\/sortedlist\.py", line \d+, in __getitem__\n/);
  assert.match(r.stderr, /IndexError: list index out of range\n$/);
  assert.doesNotMatch(r.stderr, /_shojin/);
});

test("wrapPython: 構文エラーは Main.py の行で出す", { skip: !python && "python3 が無い" }, async () => {
  // 閉じ忘れの括弧などは版によって出る行が違うので、どの版でも同じ行に出る書き方にする
  const r = await runPy(`from atcoder.dsu import DSU
x = = 1
print(x)
`);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^ {2}File "Main\.py", line 2\n {4}x = = 1\n/);
  assert.match(r.stderr, /SyntaxError: /);
  assert.doesNotMatch(r.stderr, /Traceback|_shojin/);
});
