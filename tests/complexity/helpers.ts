// ゴールデンテストの小道具
import assert from "node:assert/strict";
import { analyzeCode } from "../../src/lib/complexity/index.ts";
import type { Analysis } from "../../src/lib/complexity/index.ts";

export interface Golden {
  id: string;
  lang: string;
  code: string;
  time: string;
  space?: string;
  /** 警告・情報のどれかに含まれるべき文 */
  warn?: RegExp;
  /** 警告が1件も無いこと */
  noWarn?: boolean;
  conf?: "high" | "medium" | "low";
}

/** 先頭の共通の字下げを取る(テンプレートリテラルに書きやすくするため) */
export function dedent(s: string): string {
  const lines = s.replace(/^\n/, "").replace(/\n\s*$/, "").split("\n");
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => /^ */.exec(l)![0].length));
  return lines.map((l) => l.slice(indent)).join("\n") + "\n";
}

export function check(g: Golden): Analysis {
  const r = analyzeCode(dedent(g.code), g.lang);
  const msg = `${g.id} (${g.lang})\n  warnings: ${r.warnings.map((w) => w.message).join(" / ")}\n  breakdown: ${r.breakdown.map((b) => `${b.loc.line}:${b.label}=${b.text}`).join(" | ")}`;
  assert.equal(r.status, "ok", msg);
  assert.equal(r.time.text, g.time, `time: ${msg}`);
  if (g.space !== undefined) assert.equal(r.space.text, g.space, `space: ${msg}`);
  assert.ok(!r.time.text.includes("?") && !r.space.text.includes("?"), `"?" が残っている: ${msg}`);
  if (g.warn) assert.ok(r.warnings.some((w) => g.warn!.test(w.message)), `warning ${g.warn}: ${msg}`);
  if (g.noWarn) assert.deepEqual(r.warnings.filter((w) => w.level === "warn").map((w) => w.message), [], msg);
  if (g.conf) assert.equal(r.confidence, g.conf, `confidence: ${msg}`);
  return r;
}
