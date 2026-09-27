// 式パーサ(Pratt)の単体テスト。解析に効く形(サイズ・範囲・内包表記・代入・三項演算子)と、
// 深い入れ子で固まらないことを固める。
import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../../src/lib/complexity/lexer.ts";
import { parseStatement, parseTokens, sexprText } from "../../src/lib/complexity/sexpr.ts";
import { evalConst } from "../../src/lib/complexity/semantics.ts";
import type { SExpr } from "../../src/lib/complexity/ir.ts";
import { cppSpec } from "../../src/lib/complexity/langs/cpp.ts";
import { pythonSpec } from "../../src/lib/complexity/langs/python.ts";

const cpp = (code: string): SExpr => parseTokens(tokenize(code, cppSpec.lex).tokens, cppSpec.dialect);
const py = (code: string): SExpr => parseStatement(tokenize(code, pythonSpec.lex).tokens, pythonSpec.dialect);

test("サイズの取り出し: a.size() / (int)a.size() / len(a)", () => {
  assert.deepEqual(cpp("a.size()"), { kind: "size", of: { kind: "sym", name: "a" } });
  assert.deepEqual(cpp("(int)a.size()"), { kind: "size", of: { kind: "sym", name: "a" } });
  assert.equal(sexprText(py("len(a) - 1")), "|a| - 1");
});

test("定数式: 桁区切り・指数表記・シフト・べき", () => {
  assert.equal(evalConst(cpp("1'000'000'007"), {}), 1000000007);
  assert.equal(evalConst(cpp("2e5 + 5"), {}), 200005);
  assert.equal(evalConst(cpp("(1LL << 20)"), {}), 1 << 20);
  assert.equal(evalConst(py("10**9+7"), {}), 1000000007);
  assert.equal(evalConst(cpp("n + 1"), {}), null);
  assert.equal(evalConst(cpp("N + 1"), { N: { value: 100, line: 1 } }), 101);
});

test("前置・後置の ++ / -- は代入", () => {
  for (const [code, op] of [
    ["i++", "++"],
    ["++i", "++"],
    ["--j", "--"],
    ["j--", "--"],
  ] as const) {
    const e = cpp(code);
    assert.equal(e.kind, "assign", code);
    if (e.kind === "assign") {
      assert.equal(e.op, op, code);
      assert.deepEqual(e.target.kind, "sym", code);
    }
  }
});

test("論理・比較・添字・呼び出し・三項演算子", () => {
  assert.equal(sexprText(cpp("i < n && j < m")), "i < n && j < m");
  assert.equal(sexprText(cpp("a[i][j]")), "a[i][j]");
  assert.equal(sexprText(cpp("f(x, g(y))")), "f(x, g(y))");
  assert.equal(cpp("c ? a : b").kind, "cond");
  assert.equal(cpp("it != s.end()").kind, "cmp");
  assert.equal(sexprText(cpp("p->next")), "p.next");
});

test("代入の連鎖と cin >> の連鎖", () => {
  assert.equal(sexprText(cpp("x = y = 0")), "x = y = 0");
  assert.equal(sexprText(cpp("cin >> n >> m")), "cin >> n >> m");
});

test("Python: a if c else b は三項演算子", () => {
  const e = py("a if c else b");
  assert.equal(e.kind, "cond");
  if (e.kind === "cond") {
    assert.equal(sexprText(e.c), "c");
    assert.equal(sexprText(e.a), "a");
    assert.equal(sexprText(e.b), "b");
  }
  // 内包表記の条件 if は三項演算子に取らない
  const c = py("[x * 2 for x in a if x > 0]");
  assert.equal(c.kind, "comp");
  if (c.kind === "comp") assert.equal(c.conds.length, 1);
});

test("Python: 内包表記(リスト・辞書・集合・ジェネレータ)", () => {
  const d = py("{i: 0 for i in range(n)}");
  assert.equal(d.kind, "comp");
  if (d.kind === "comp") assert.equal(sexprText(d.gens[0].iter), "range(n)");
  assert.equal(py("{x for x in a}").kind, "comp");
  const g = py("sum(x for x in a)");
  assert.ok(g.kind === "call" && g.args[0].kind === "comp");
  const nested = py("[[0] * m for _ in range(n)]");
  assert.ok(nested.kind === "comp" && nested.elem.kind === "bin");
});

test("Python: not in / not x in s / スライス / タプル代入", () => {
  assert.equal(sexprText(py("x not in s")), "x notin s");
  assert.equal(py("not x in s").kind, "not");
  assert.deepEqual(py("a[::-1]"), { kind: "slice", of: { kind: "sym", name: "a" }, from: null, to: null });
  assert.equal(sexprText(py("a[1:n]")), "a[1:n]");
  const t = py("a, b = b, a % b");
  assert.ok(t.kind === "assign" && t.target.kind === "list" && t.value?.kind === "list");
  const m = py("n, m = map(int, input().split())");
  assert.ok(m.kind === "assign" && m.target.kind === "list" && m.target.items.length === 2);
});

test("Python: lambda と * 展開", () => {
  const l = py("lambda x: x + 1");
  assert.ok(l.kind === "lambda" && l.params[0] === "x");
  assert.equal(sexprText(py("print(*a)")), "print(*a)");
});

test("深い入れ子(括弧1万段・min 1万段)でも固まらず、例外も投げない", () => {
  const deep = "(".repeat(10000) + "x" + ")".repeat(10000);
  const mins = "min(a, ".repeat(10000) + "b" + ")".repeat(10000);
  for (const code of [deep, mins]) {
    const toks = tokenize(code, cppSpec.lex).tokens;
    const t0 = performance.now();
    assert.doesNotThrow(() => parseTokens(toks, cppSpec.dialect));
    assert.ok(performance.now() - t0 < 1000, "1秒以内");
  }
});

test("壊れた式でも例外を投げない", () => {
  for (const code of ["(", ")", "a[", "f(,,)", "? :", "x = ", "[for]", "lambda", "a..", "::"]) {
    assert.doesNotThrow(() => cpp(code), code);
    assert.doesNotThrow(() => py(code), code);
  }
});
