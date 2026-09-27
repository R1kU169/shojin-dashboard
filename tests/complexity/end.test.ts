// end 系のブロックの書き換え(endRewrite.ts)の単体テスト。書き換えた字句を空白区切りで比べる。
import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../../src/lib/complexity/lexer.ts";
import { luaSpec } from "../../src/lib/complexity/langs/lua.ts";
import { rubySpec } from "../../src/lib/complexity/langs/ruby.ts";
import type { LangSpec } from "../../src/lib/complexity/spec.ts";

function rewrite(code: string, spec: LangSpec): string {
  const toks = tokenize(code, spec.lex).tokens;
  return spec.postTokenize!(toks, () => undefined).toks.map((t) => (t.k === "str" ? JSON.stringify(t.v) : t.v)).join(" ");
}
const rb = (code: string) => rewrite(code, rubySpec);
const lua = (code: string) => rewrite(code, luaSpec);

test("Ruby: if / elsif / else / end", () => {
  assert.equal(rb("if a\n  x\nelsif b then y\nelse\n  z\nend"), "if ( a ) { x } else if ( b ) { y } else { z }");
});

test("Ruby: 修飾子の if / while はブロックを開かない", () => {
  assert.equal(rb("x += 1 if c"), "x += 1 if c");
  assert.equal(rb("n /= 10 while n > 0"), "n /= 10 while n > 0");
  assert.equal(rb("return n if n < 2"), "return n if n < 2");
  // 代入の右辺の if は式(ブロックを開く)
  assert.equal(rb("v = if c then 1 else 2 end"), "v = if ( c ) { 1 } else { 2 }");
});

test("Ruby: メソッド名やハッシュのラベルの end / class は語ではない", () => {
  assert.equal(rb("r = (l..r).end\nputs x.class"), "r = ( l .. r ) . end puts x . class");
  assert.equal(rb('h = { end: 1, if: 2 }'), "h = { end : 1 , if : 2 }");
});

test("Ruby: ブロック do |x| … end は { |x| … }", () => {
  assert.equal(rb("a.each do |x|\n  p x\nend"), "a . each { | x | p x }");
  assert.equal(rb("loop do\n  break\nend"), "loop { break }");
});

test("Ruby: def と1行の定義", () => {
  assert.equal(rb("def f(a, b)\n  a + b\nend"), "def f ( a , b ) { a + b }");
  assert.equal(rb("def g\n  1\nend"), "def g { 1 }");
  assert.equal(rb("def sq(x) = x * x\nputs sq(3)"), "def sq ( x ) { return x * x } puts sq ( 3 )");
});

test("Ruby: begin … end while は do-while、case / when は switch", () => {
  assert.equal(rb("begin\n  y /= 2\nend while y > 0"), "do { y /= 2 } while ( y > 0 )");
  assert.equal(rb("case x\nwhen 1 then a\nwhen 2\n  b\nelse\n  c\nend"), "switch ( x ) { ; case 1 : a ; case 2 : b ; default : c }");
});

test("Ruby: %w / ヒアドキュメント / 式展開の中の end や do は読まない", () => {
  assert.equal(rb('w = %w[end do if]\nputs "#{s} end"'), 'w = "end do if" puts "#{s} end"');
  assert.equal(rb("s = <<~EOS\n  if x do end\nEOS\nputs s"), 's = "" puts s');
});

test("Lua: then / do / repeat-until / 無名関数", () => {
  assert.equal(lua("for i = 1, n do a[i] = 0 end"), "for ( i = 1 , n ) { a [ i ] = 0 }");
  assert.equal(lua("if a ~= b then x() elseif c then y() else z() end"), "if ( a != b ) { x ( ) } else if ( c ) { y ( ) } else { z ( ) }");
  assert.equal(lua("repeat\n  i = i + 1\nuntil i >= n"), "do { i = i + 1 } until ( i >= n )");
  assert.equal(lua("table.sort(a, function(x, y) return x < y end)"), "table . sort ( a , function ( x , y ) { return x < y } )");
  assert.equal(lua("local s = [[ end do ]] -- end\n--[[ end\nfor ]]\nx = 1"), 'local s = " end do " x = 1');
});

test("閉じていない / 多すぎる end は警告して最後まで読む", () => {
  const warns: string[] = [];
  const toks = tokenize("def f\n  if x\n    y\n", rubySpec.lex).tokens;
  const out = rubySpec.postTokenize!(toks, (w) => warns.push(w.message)).toks.map((t) => t.v).join(" ");
  assert.equal(out, "def f { if ( x ) { y } }");
  assert.ok(warns.some((w) => w.includes("足りません")));
  const extra: string[] = [];
  rubySpec.postTokenize!(tokenize("x = 1\nend\nend", rubySpec.lex).tokens, (w) => extra.push(w.message));
  assert.ok(extra.some((w) => w.includes("多すぎます")));
});
