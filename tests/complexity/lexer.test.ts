// 字句解析の単体テスト。文字列やコメントの中の for / { をコードと取り違えないこと、
// 壊れた入力でも例外を投げずに最後まで進むことを固める。
import { test } from "node:test";
import assert from "node:assert/strict";
import { BASE_RULES, tokenize } from "../../src/lib/complexity/lexer.ts";
import type { LexRules } from "../../src/lib/complexity/lexer.ts";
import { cppSpec } from "../../src/lib/complexity/langs/cpp.ts";
import { pythonSpec } from "../../src/lib/complexity/langs/python.ts";

/** "種類:値" の並び(比べやすくするため) */
function kinds(code: string, rules: LexRules): string[] {
  return tokenize(code, rules).tokens.map((t) => `${t.k}:${t.v}`);
}

const idents = (code: string, rules: LexRules) => tokenize(code, rules).tokens.filter((t) => t.k === "ident").map((t) => t.v);

test("C++ の桁区切り 1'000'000'007 は1つの数値", () => {
  const toks = tokenize("const int MOD = 1'000'000'007;", cppSpec.lex).tokens;
  const n = toks.find((t) => t.k === "num");
  assert.equal(n?.num, 1000000007);
  assert.equal(toks.filter((t) => t.k === "num").length, 1);
});

test("文字リテラルと指数表記", () => {
  const toks = tokenize("char c = 'x'; int m = 1e9 + 7; auto b = 0x1F;", cppSpec.lex).tokens;
  assert.deepEqual(
    toks.filter((t) => t.k === "num").map((t) => t.num),
    [1e9, 7, 31],
  );
  assert.ok(toks.some((t) => t.k === "str" && t.v === "x"));
});

test("C++ の生文字列の中の for と { はコードではない", () => {
  assert.deepEqual(idents('auto s = R"(for (int i = 0; i < n; i++) { )"; x', cppSpec.lex), ["auto", "s", "x"]);
  assert.deepEqual(idents('auto s = R"xy(a)" )xy"; y', cppSpec.lex), ["auto", "s", "y"]);
});

test("前処理行は1トークン(#define の中の for は展開前に数えない)", () => {
  const toks = tokenize("#include <bits/stdc++.h>\n#define rep(i, n) for (int i = 0; i < (n); i++)\nint x;", cppSpec.lex).tokens;
  assert.deepEqual(
    toks.map((t) => t.k),
    ["pp", "pp", "ident", "ident", "op"],
  );
  assert.equal(toks[2].line, 3);
});

test("コメントの中の for / while / { は読まない(C のブロックコメントは入れ子にしない)", () => {
  assert.deepEqual(idents("// for (;;)\n/* while { */ int y; /* a /* b */ z", cppSpec.lex), ["int", "y", "z"]);
});

test("閉じていない文字列は行末まで。次の行は普通に読む", () => {
  const r = tokenize('string s = "abc\nfor (;;) {}', cppSpec.lex);
  assert.ok(r.tokens.some((t) => t.k === "str" && t.v === "abc"));
  const f = r.tokens.find((t) => t.k === "ident" && t.v === "for");
  assert.equal(f?.line, 2);
  assert.equal(r.warnings[0]?.code, "unterminated");
});

test("閉じていないコメントは警告して最後まで飲み込む(例外にしない)", () => {
  const r = tokenize("int a; /* never closed\nfor", cppSpec.lex);
  assert.deepEqual(kinds("int a; /* never closed\nfor", cppSpec.lex), ["ident:int", "ident:a", "op:;"]);
  assert.equal(r.warnings[0]?.code, "unterminated");
});

test("数値の . は直後が数字のときだけ小数点(1..n を壊さない)", () => {
  assert.deepEqual(kinds("1..n 0..=n 1.5 a.b", { ...BASE_RULES, numSuffix: false }), [
    "num:1",
    "op:..",
    "ident:n",
    "num:0",
    "op:..=",
    "ident:n",
    "num:1.5",
    "ident:a",
    "op:.",
    "ident:b",
  ]);
});

test("Python: 三重引用符・f 文字列の中の # はコメントではない。行番号は文字列の改行ぶん進む", () => {
  const r = tokenize(`s = """for i in range(n):\n  pass"""\nt = f"{x} # not comment" # real\nu = r'\\d'`, pythonSpec.lex);
  assert.deepEqual(
    r.tokens.filter((t) => t.k === "ident").map((t) => `${t.v}@${t.line}`),
    ["s@1", "t@3", "u@4"],
  );
  assert.equal(r.tokens.filter((t) => t.k === "str").length, 3);
});

test("Python: a[::-1] と 10**9+7", () => {
  assert.deepEqual(kinds("a[::-1] 10**9+7 2e5", pythonSpec.lex), ["ident:a", "op:[", "op:::", "op:-", "num:1", "op:]", "num:10", "op:**", "num:9", "op:+", "num:7", "num:2e5"]);
});

test("JS のテンプレート文字列は ${} の入れ子ごと1つの文字列", () => {
  const rules: LexRules = { ...BASE_RULES, template: true, quotes: "\"'", charQuote: "none" };
  assert.deepEqual(kinds("const s = `${a} for ${b + `x${c}`}`; for", rules), ["ident:const", "ident:s", "op:=", "str:${a} for ${b + `x${c}`}", "op:;", "ident:for"]);
});

test("Rust: ライフタイムは読み捨て、文字リテラルは文字列。r#\"…\"# の中はコードではない", () => {
  const rules: LexRules = { ...BASE_RULES, charQuote: "rust", rustRaw: true };
  assert.deepEqual(idents("fn f<'a>(x: &'a str) -> char { let c = 'x'; c }", rules), ["fn", "f", "x", "str", "char", "let", "c", "c"]);
  assert.deepEqual(idents('let s = r#"for " { "#; x', rules), ["let", "s", "x"]);
});

test("正規表現リテラルと割り算を区別する", () => {
  const rules: LexRules = { ...BASE_RULES, regexLiteral: true, quotes: "\"'", charQuote: "none" };
  assert.deepEqual(kinds("x = /for\\/[a-z]+/g; y = a / b; z = (d) / 2", rules), [
    "ident:x",
    "op:=",
    "str:/for\\/[a-z]+/g",
    "op:;",
    "ident:y",
    "op:=",
    "ident:a",
    "op:/",
    "ident:b",
    "op:;",
    "ident:z",
    "op:=",
    "op:(",
    "ident:d",
    "op:)",
    "op:/",
    "num:2",
  ]);
});

test("記号は最長一致(>>= / <<= / ...)", () => {
  assert.deepEqual(kinds("a >>= 1; b <<= 2; c >>> 3", cppSpec.lex).filter((x) => x.startsWith("op:") && x !== "op:;"), ["op:>>=", "op:<<=", "op:>>", "op:>"]);
});

test("行と桁", () => {
  const toks = tokenize("int main() {\n  int n;\n}", cppSpec.lex).tokens;
  const n = toks.find((t) => t.v === "n");
  assert.equal(n?.line, 2);
  assert.equal(n?.col, 6);
  assert.equal(n?.nl, false);
  assert.equal(toks.find((t) => t.v === "}")?.nl, true);
});

test("壊れた入力でも例外を投げない", () => {
  for (const code of ['"', "'", "/*", "R\"(", "`${", "#", "\\", "((((", "}}}}", "'\\"]) {
    assert.doesNotThrow(() => tokenize(code, cppSpec.lex), code);
    assert.doesNotThrow(() => tokenize(code, pythonSpec.lex), code);
  }
});
