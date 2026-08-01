// 実行バックエンドの切り替え。通常はWandboxで実行し、Wandbox側の障害を
// 検出した時だけCompiler Explorerにフォールバックする。
//
// 背景: Wandboxは実行サンドボックス(コンテナ)だけが落ちることがあり、その間は
// どの言語・どんなコードでも "OCI runtime error: crun: clone: Resource
// temporarily unavailable" (終了コード126)しか返らなくなる。生のまま表示すると
// 自分のコードのせいだと誤解するので、代替サービスに逃がしたうえで理由を出す。
import { runCode as runWandbox } from "./wandbox";
import type { EditorLang, RunResult } from "./wandbox";
import { GODBOLT_LANGS, runCodeGodbolt } from "./godbolt";

export type Backend = "wandbox" | "godbolt";

export interface RunOutcome extends RunResult {
  /** 実際に実行したサービス */
  backend: Backend;
  /** フォールバックした時だけ: 実際に動いた処理系のバージョン */
  backendVersion?: string;
}

/**
 * Wandboxのサンドボックス障害(コンテナを起動できない)かどうか。
 * これらの文字列はWandboxの実行基盤が出すものでコンパイラの出力ではないため、
 * ユーザーのコードが原因で誤検知することはない。
 */
function isSandboxFailure(r: RunResult): boolean {
  return /OCI runtime|\bcrun\b|Resource temporarily unavailable/i.test(
    r.compilerError,
  );
}

/**
 * コードを実行する。Wandboxが使えない場合はCompiler Explorerに切り替える。
 * 中断(AbortError)はそのまま投げ直す。どちらでも実行できない場合は例外。
 */
export async function runCode(
  lang: EditorLang,
  code: string,
  stdin: string,
  signal?: AbortSignal,
): Promise<RunOutcome> {
  let reason: string;
  try {
    const r = await runWandbox(lang.compiler, code, stdin, lang.options, signal);
    if (!isSandboxFailure(r)) return { ...r, backend: "wandbox" };
    reason = "Wandboxの実行サンドボックスが停止しています";
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    reason = `Wandboxに接続できませんでした (${(e as Error).message})`;
  }

  const g = GODBOLT_LANGS[lang.key];
  if (!g) {
    throw new Error(
      `${reason}。${lang.label} は代替の実行環境がないため、時間をおいて試すか、他の言語をお使いください。`,
    );
  }
  try {
    const r = await runCodeGodbolt(g, code, stdin, signal);
    return { ...r, backend: "godbolt", backendVersion: g.version };
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new Error(
      `${reason}。代替のCompiler Explorerにも接続できませんでした (${(e as Error).message})`,
    );
  }
}
