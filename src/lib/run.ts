// 実行バックエンドの切り替え。Compiler Explorer が実行できる言語はそちらを先に使い、
// 接続できないときと、Compiler Explorer が実行できない言語(JavaScript・TypeScript・Nim・PHP・Bash)は Wandbox で実行する。
//
// Compiler Explorer を先に使う理由: 2026-11 に実測すると、テンプレートのコードの応答は
// C++ で Wandbox 12〜43秒 / CE 3〜4秒、Python で 6.5〜9秒 / 0.5〜0.9秒、Java で 20〜29秒 / 3〜4.6秒と、
// どの言語も CE の方が数倍速かった。CE は実行時間も返し、C++ は -O2 つきで AtCoder に近く、約1MBを超える入力も送れる。
//
// Wandbox は実行サンドボックス(コンテナ)だけが落ちることがあり、その間は
// どの言語・どんなコードでも "OCI runtime error: crun: clone: Resource
// temporarily unavailable" (終了コード126)しか返らなくなる。生のまま表示すると
// 自分のコードのせいだと誤解するので、理由を添えたエラーにする。
import { fitsWandbox, runCode as runWandbox } from "./wandbox";
import type { EditorLang, RunResult } from "./wandbox";
import { GODBOLT_LANGS, runCodeGodbolt } from "./godbolt";

export type Backend = "wandbox" | "godbolt";

export interface RunOutcome extends RunResult {
  /** 実際に実行したサービス */
  backend: Backend;
  /** 実際に動いた処理系のバージョン */
  backendVersion: string;
  /** Compiler Explorer に接続できず、代わりに Wandbox で実行した */
  fallback?: boolean;
}

/**
 * Wandboxのサンドボックス障害(コンテナを起動できない)かどうか。
 * これらの文字列はWandboxの実行基盤が出すものでコンパイラの出力ではないため、
 * ユーザーのコードが原因で誤検知することはない。
 * コンパイルの段階で落ちればコンパイラの出力に、コンパイルが通って実行の段階で落ちれば
 * 標準エラーに出る(2026-11 に実測: 終了コード 126 で program_error に出て、応答まで54秒かかった)
 */
function isSandboxFailure(r: RunResult): boolean {
  return (
    /OCI runtime|\bcrun\b|Resource temporarily unavailable/i.test(r.compilerError) ||
    (r.status === "126" && /OCI runtime error/i.test(r.stderr))
  );
}

/**
 * コンパイラの出力が「実行を妨げないメッセージだけ」と言い切れるか。
 *
 * 言い切れないときはfalse(=従来どおりエラー扱いの赤)。警告を赤く出す害より、
 * エラーを警告色で出して見落とさせる害の方が大きいので、迷ったら赤に寄せる。
 *
 * 終了コードだけでも文字列だけでも判定できない(どちらも実測で反例がある):
 *  - 文字列だけでは不足: Goの「declared and not used」はコンパイルエラーなのに
 *    error という語を含まない
 *  - 終了コードだけでは不足: 警告つきでabortしたコードは status 134 になるが
 *    コンパイル自体は通っている(Wandboxはシグナルを128+nとしてstatusに畳むので
 *    signalは常に空)
 */
export function isWarningOnly(r: RunResult): boolean {
  if (r.compilerError === "") return false;
  // 「エラーらしい語」の検出はわざと大雑把。ユーザーのコードにerrorという識別子が
  // あると誤検知するが、その場合は従来の赤に戻るだけで実害はない
  if (/\berrors?\b/i.test(r.compilerError)) return false;
  // プログラムが動いた証拠があれば、コンパイル自体は通っている
  return r.status === "0" || r.stdout !== "" || r.stderr !== "";
}

/** Compiler Explorer で実行する言語か(実行時間が分かる) */
export function prefersGodbolt(lang: EditorLang): boolean {
  return lang.key in GODBOLT_LANGS;
}

/**
 * コードを実行する。Compiler Explorer が実行できる言語はそちらを先に使い、接続できなければ
 * Wandbox で実行する(入力が送れる大きさなら)。エディターの実行とコーナーケースのまとめて実行で共通。
 * 中断(AbortError)はそのまま投げ直す。どちらでも実行できない場合は例外。
 */
export async function runCode(
  lang: EditorLang,
  code: string,
  stdin: string,
  signal?: AbortSignal,
): Promise<RunOutcome> {
  const g = GODBOLT_LANGS[lang.key];
  let reason = "";
  if (g) {
    try {
      const r = await runCodeGodbolt(g, code, stdin, signal);
      return { ...r, backend: "godbolt", backendVersion: g.version };
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      reason = `Compiler Explorerに接続できませんでした (${(e as Error).message})。`;
    }
  }
  if (!fitsWandbox(lang, code, stdin)) {
    throw new Error(
      `${reason}入力が大きすぎて Wandbox に送れません(コードと合わせて約1MBまで)。${g ? "" : `${lang.label} は Compiler Explorer で実行できないため、入力を小さくしてください。`}`,
    );
  }
  let r: RunResult;
  try {
    r = await runWandbox(lang, code, stdin, signal);
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new Error(`${reason}Wandbox${reason ? "にも" : "に"}接続できませんでした (${(e as Error).message})`);
  }
  if (isSandboxFailure(r)) {
    throw new Error(`${reason}Wandboxの実行サンドボックスが停止しています。時間をおいて試してください。`);
  }
  return { ...r, backend: "wandbox", backendVersion: lang.version, ...(g ? { fallback: true } : {}) };
}
