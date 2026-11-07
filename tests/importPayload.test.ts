// ブックマークレットから届くデータ(#/editor?import=…)の変換と検証
import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeImport, encodeImport, fromBase64Url, linkedTitle, MAX_PARAM, taskLetter, toBase64Url } from "../src/lib/importPayload.ts";
import type { ImportPayload } from "../src/lib/importPayload.ts";
import { bookmarkletHref, bookmarkletSource } from "../src/lib/bookmarklet.ts";

const PAYLOAD: ImportPayload = {
  v: 1,
  contest: "abc481",
  current: "abc481_c",
  tasks: [
    { task: "abc481_c", title: "C - Bank Accounts", html: "<section><h3>制約</h3><ul><li><var>1 \\le Q \\le 2\\times 10^5</var></li></ul></section>" },
  ],
};

test("base64url は日本語を含めて往復し、URL に使えない文字を含まない", () => {
  const s = "入力 ≤ 10^5 +/=" + "あ".repeat(40_000);
  const b = toBase64Url(s);
  assert.match(b, /^[A-Za-z0-9_-]+$/);
  assert.equal(fromBase64Url(b), s);
  assert.equal(fromBase64Url("%%%"), null);
});

test("取り込みデータは往復する", () => {
  assert.deepEqual(decodeImport(encodeImport(PAYLOAD)), PAYLOAD);
});

test("形のおかしいデータは受け取らない", () => {
  const bad = (p: unknown) => decodeImport(toBase64Url(JSON.stringify(p)));
  assert.equal(bad({ ...PAYLOAD, v: 2 }), null);
  assert.equal(bad({ ...PAYLOAD, contest: "../x" }), null);
  assert.equal(bad({ ...PAYLOAD, tasks: [] }), null);
  assert.equal(bad({ ...PAYLOAD, tasks: [{ ...PAYLOAD.tasks[0], task: "a b" }] }), null);
  assert.equal(bad({ ...PAYLOAD, tasks: [PAYLOAD.tasks[0], PAYLOAD.tasks[0]] }), null);
  assert.equal(bad({ ...PAYLOAD, tasks: Array.from({ length: 21 }, (_, i) => ({ ...PAYLOAD.tasks[0], task: `t${i}` })) }), null);
  assert.equal(decodeImport("not-json"), null);
  assert.equal(decodeImport("a".repeat(MAX_PARAM + 1)), null);
  // 一覧にない問題を current にしたら、current は無いことにする
  assert.equal(bad({ ...PAYLOAD, current: "abc481_z" })?.current, null);
});

test("問題名と記号", () => {
  assert.equal(linkedTitle("C - Bank Accounts"), "C. Bank Accounts");
  assert.equal(linkedTitle("Ex - Foo - Bar"), "Ex. Foo - Bar");
  assert.equal(linkedTitle("ふつうの名前"), "ふつうの名前");
  assert.equal(taskLetter({ task: "abc481_c", title: "C. Bank Accounts" }), "C");
  assert.equal(taskLetter({ task: "abc001_1", title: "" }), "1");
});

test("ブックマークレットは JavaScript として読め、ボードの URL を埋め込む", () => {
  const url = "https://example.github.io/shojin-dashboard/";
  const href = bookmarkletHref(url);
  assert.ok(href.startsWith("javascript:"));
  // URL の中に生の空白・改行・# を入れない(ブックマークに登録したときに壊れる)
  assert.doesNotMatch(href.slice("javascript:".length), /[\s#]/);
  const src = bookmarkletSource(url);
  assert.ok(src.includes(JSON.stringify(url)));
  assert.doesNotThrow(() => new Function(src));
});
