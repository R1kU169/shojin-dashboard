// 言語キー → 言語の定義。EDITOR_LANGS(wandbox.ts)と同じ19言語を並べて、抜けを目視できるようにする。
// 機能ごとの言語の表は機能の側に置く(comment.ts の LINE_COMMENT と同じ流儀)。
import type { LangSpec } from "./spec.ts";
import { cSpec, cppSpec } from "./langs/cpp.ts";
import { pypySpec, pythonSpec } from "./langs/python.ts";

export const LANG_SPECS: Record<string, LangSpec | null> = {
  cpp: cppSpec,
  python: pythonSpec,
  pypy: pypySpec,
  java: null,
  c: cSpec,
  csharp: null,
  rust: null,
  go: null,
  js: null,
  ts: null,
  ruby: null,
  haskell: null,
  d: null,
  nim: null,
  julia: null,
  perl: null,
  php: null,
  lua: null,
  bash: null,
};
