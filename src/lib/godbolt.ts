// Compiler Explorer (https://godbolt.org) でコードをコンパイル・実行する。
// Wandboxのサンドボックスが落ちている間のフォールバック先(run.ts が切り替える)。
// CORS全開放・APIキー不要なのでブラウザから直接叩ける。
// 注意: コードと標準入力は外部サービス(godbolt.org)に送信される。
import type { RunResult } from "./wandbox";

const API = "https://godbolt.org/api";

export interface GodboltLang {
  /** Compiler ExplorerのコンパイラID */
  compiler: string;
  /** Compiler Explorerの言語ID(APIのlangフィールド) */
  lang: string;
  /** コンパイラに渡す引数(Wandboxのoptionsに相当) */
  args: string;
  /** 表示用。Wandbox側とバージョンが一致しないことがあるので別に持つ */
  version: string;
}

// EDITOR_LANGS(wandbox.ts)のkey → Compiler Explorerの設定。
// 全エントリ、実際にCompiler Explorerで各テンプレートを実行して
// stdin "3 4" → "7" が出ることを検証済み。
// ここに無い言語(js/ts/nim/php/bash)はCompiler Explorerが実行に対応して
// いない(コンパイルのみ、または言語自体が無い)ためフォールバックできない。
export const GODBOLT_LANGS: Record<string, GodboltLang> = {
  cpp: { compiler: "g132", lang: "c++", args: "-O2 -std=gnu++2b", version: "GCC 13.2 / C++23" },
  python: { compiler: "python314", lang: "python", args: "", version: "CPython 3.14" },
  pypy: { compiler: "pypy310", lang: "python", args: "", version: "PyPy 3.10" },
  java: { compiler: "java2202", lang: "java", args: "", version: "JDK 22.0.2" },
  c: { compiler: "cg132", lang: "c", args: "-O2 -std=gnu17", version: "GCC 13.2 / C17" },
  // WandboxはMonoだがCompiler Explorerには無いため.NET 8で代替する
  csharp: { compiler: "dotnet80csharpcoreclr", lang: "csharp", args: "", version: ".NET 8.0" },
  // editionを明示しないとrustcのデフォルト(2015)になる
  rust: { compiler: "r1820", lang: "rust", args: "-O --edition 2021", version: "rustc 1.82" },
  go: { compiler: "gl1238", lang: "go", args: "", version: "Go 1.23.8" },
  ruby: { compiler: "ruby347", lang: "ruby", args: "", version: "Ruby 3.4.7" },
  haskell: { compiler: "ghc9102", lang: "haskell", args: "-O2", version: "GHC 9.10.2" },
  d: { compiler: "dmd21091", lang: "d", args: "-O", version: "DMD 2.109.1" },
  julia: { compiler: "julia_1_10_0", lang: "julia", args: "", version: "Julia 1.10" },
  perl: { compiler: "perl5422", lang: "perl", args: "", version: "Perl 5.42.2" },
  lua: { compiler: "lua547", lang: "lua", args: "", version: "Lua 5.4.7" },
};

interface CeText {
  text?: string;
}

interface CeResponse {
  code?: number;
  didExecute?: boolean;
  timedOut?: boolean;
  stdout?: CeText[];
  stderr?: CeText[];
  buildResult?: { code?: number; stdout?: CeText[]; stderr?: CeText[] };
}

// Compiler Explorerはgccに -fdiagnostics-color=always を付けるため、
// コンパイルエラーにANSIエスケープが混ざる。そのまま出すと画面が壊れるので剥がす。
// eslint-disable-next-line no-control-regex -- ESCを剥がすのが目的なので意図的
const ANSI = new RegExp("\\u001b\\[[0-9;]*[A-Za-z]", "g");

/** CEの行配列({text}の配列)を1つの文字列にする。 */
function joinLines(lines: CeText[] | undefined): string {
  const s = (lines ?? []).map((l) => l.text ?? "").join("\n").replace(ANSI, "");
  return s === "" ? "" : `${s}\n`;
}

/** コードを実行して結果を返す。ネットワーク/サービスエラー時は例外。 */
export async function runCodeGodbolt(
  g: GodboltLang,
  code: string,
  stdin: string,
  signal?: AbortSignal,
): Promise<RunResult> {
  const res = await fetch(`${API}/compiler/${g.compiler}/compile`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      source: code,
      lang: g.lang,
      options: {
        userArguments: g.args,
        executeParameters: { args: [], stdin },
        // この2つが揃って初めて「コンパイルして実行する」モードになる
        compilerOptions: { executorRequest: true },
        filters: { execute: true },
      },
    }),
    signal,
  });
  if (!res.ok) throw new Error(`実行APIエラー (HTTP ${res.status})`);
  const j = (await res.json()) as CeResponse;

  const build = j.buildResult ?? {};
  const compilerError = joinLines(build.stderr) + joinLines(build.stdout);
  // 実行まで到達しなかった場合(コンパイルエラー)は、Wandboxに合わせて
  // ビルドの終了コードを status にする(CEはこの時 code=-1 を返すため)
  const status = j.didExecute === false ? (build.code ?? 1) : (j.code ?? 0);
  const stderr = joinLines(j.stderr);
  return {
    status: String(status),
    signal: "",
    compilerError,
    stdout: joinLines(j.stdout),
    stderr: j.timedOut ? `${stderr}実行時間の上限を超えました\n` : stderr,
  };
}
