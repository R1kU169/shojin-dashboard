// メソッドの表の抜けを見つける: 競技プログラミングの Python でよく書くメソッドが、受け手の種類ごとの表(または
// どの入れ物でも同じ copy などの表)にあること。抜けていると、種類が分かっていても「未知の関数」として O(1) になる
// (辞書の d.copy() がそうだった)。
import { test } from "node:test";
import assert from "node:assert/strict";
import { lookupMethod } from "../../src/lib/complexity/builtins.ts";
import type { ContainerKind } from "../../src/lib/complexity/ir.ts";

const PYTHON: [ContainerKind, string, string][] = [
  ["array", "list", "append extend insert remove pop clear index count sort reverse copy"],
  ["hmap", "dict / defaultdict", "get keys values items pop popitem setdefault update copy clear"],
  ["hmap", "Counter", "most_common elements subtract total update copy"],
  ["hset", "set", "add remove discard pop clear copy update union intersection difference symmetric_difference issubset issuperset isdisjoint intersection_update difference_update"],
  ["deque", "deque", "append appendleft pop popleft extend extendleft rotate clear copy count index insert reverse"],
  ["oset", "SortedList / SortedSet", "add remove discard pop bisect_left bisect_right index irange islice count update copy clear"],
  ["string", "str", "split strip lstrip rstrip join replace find rfind count startswith endswith upper lower index isdigit isalpha"],
];

for (const [kind, label, names] of PYTHON) {
  test(`Python の ${label} のメソッドが表にある`, () => {
    const missing = names.split(" ").filter((n) => !lookupMethod(kind, n));
    assert.deepEqual(missing, [], `${label}(${kind})の表に無い: ${missing.join(", ")}`);
  });
}

test("丸ごとの複製(copy / clone / dup)は、どの入れ物でも要素数ぶん", () => {
  for (const kind of ["array", "hmap", "hset", "omap", "oset", "deque", "pq", "string", "linkedlist"] as ContainerKind[]) {
    for (const n of ["copy", "clone", "dup"]) assert.ok(lookupMethod(kind, n), `${kind}.${n}`);
  }
});
