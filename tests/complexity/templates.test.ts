// エディターの各言語のテンプレート(A+B)は、時間・領域とも O(1) になること(計画 §5.6 の I1〜I4)。
// エディターで書き始めたコードをそのまま解析したときに、入力の読み取りを数えてしまわないかの確認。
import { test } from "node:test";
import assert from "node:assert/strict";
import { EDITOR_LANGS } from "../../src/lib/wandbox.ts";
import { analyzeCode, isSupported } from "../../src/lib/complexity/index.ts";

for (const lang of EDITOR_LANGS) {
  test(`${lang.label} のテンプレートは O(1) / O(1)`, { skip: !isSupported(lang.key) && "まだ解析できない言語" }, () => {
    const r = analyzeCode(lang.template, lang.key);
    const msg = `warnings: ${r.warnings.map((w) => w.message).join(" / ")}\nbreakdown: ${r.breakdown.map((b) => `${b.loc.line}:${b.label}=${b.text}`).join(" | ")}`;
    assert.equal(r.status, "ok", msg);
    assert.equal(r.time.text, "O(1)", msg);
    assert.equal(r.space.text, "O(1)", msg);
    assert.deepEqual(r.warnings.filter((w) => w.level === "warn").map((w) => w.message), [], msg);
  });
}
