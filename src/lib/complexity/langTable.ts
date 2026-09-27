// 言語キー → 言語の定義。EDITOR_LANGS(wandbox.ts)と同じ19言語を並べて、抜けを目視できるようにする。
// 機能ごとの言語の表は機能の側に置く(comment.ts の LINE_COMMENT と同じ流儀)。
import type { LangSpec } from "./spec.ts";
import { cSpec, cppSpec } from "./langs/cpp.ts";
import { pypySpec, pythonSpec } from "./langs/python.ts";
import { javaSpec } from "./langs/java.ts";
import { csharpSpec } from "./langs/csharp.ts";
import { rustSpec } from "./langs/rust.ts";
import { goSpec } from "./langs/go.ts";
import { jsSpec, tsSpec } from "./langs/js.ts";
import { dSpec } from "./langs/d.ts";
import { luaSpec } from "./langs/lua.ts";
import { rubySpec } from "./langs/ruby.ts";

export const LANG_SPECS: Record<string, LangSpec | null> = {
  cpp: cppSpec,
  python: pythonSpec,
  pypy: pypySpec,
  java: javaSpec,
  c: cSpec,
  csharp: csharpSpec,
  rust: rustSpec,
  go: goSpec,
  js: jsSpec,
  ts: tsSpec,
  ruby: rubySpec,
  haskell: null,
  d: dSpec,
  nim: null,
  julia: null,
  perl: null,
  php: null,
  lua: luaSpec,
  bash: null,
};
