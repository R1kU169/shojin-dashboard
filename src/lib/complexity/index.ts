// 計算量解析の入口。ページはここだけを import する。
//
// 既知の限界(docs/complexity-analyzer-plan.md §12):
//  - 篩は上界 N log N(真は N log log N)、部分集合の列挙は 4^N 表示(真は 3^N)
//  - unordered_map / dict は平均 O(1)。Python / Java の文字列の += は O(1) + 警告
//  - スコープを見ない(同名の変数は同じもの)。入力配列の長さの推定は外れることがある
//  - 入力の読み取り(1行の分割・数値変換)そのものは時間に数えない
//  - 出力の個数に比例する列挙・要素の値に依存する償却(フィルタで作り直すリスト、取り出しては入れ直すヒープ)・
//    刻みが変数の while は推定できず、過大に出すか警告する(AtCoder 公式解説での検証: docs/complexity-verification.md)
import type { Analysis } from "./ir.ts";
import { ONE } from "./expr.ts";
import { analyze } from "./analyze.ts";
import { parseProgram } from "./frontend.ts";
import { LANG_SPECS } from "./langTable.ts";

export { evaluate, formatOps, parseBoundValue, SPEED, TIGHT_RATIO } from "./evaluate.ts";
export { format, formatO } from "./expr.ts";
export type { Analysis, AnalysisWarning, BreakdownItem, Confidence, EvalResult, Expr, TimeVerdict, Variable } from "./ir.ts";

export function isSupported(langKey: string): boolean {
  return !!LANG_SPECS[langKey];
}

/** 推定が粗い言語(ページで「簡易対応」と出す) */
export const BASIC_LANGS: ReadonlySet<string> = new Set(["haskell", "bash"]);

/** 言語ごとの注記(§7.8) */
export const LANG_NOTES: Record<string, string | undefined> = {
  ruby: "文字列補間 #{…} の中の式は解析しません。sort { } の比較ブロックは N log N 回として数えます。",
  lua: ".. による連結は O(1) として数えます(ループの中で連結すると実際は O(N) ずつ)。自作イテレータ for x in f(t) は |t| 回とみなします。",
  julia: "同名関数の多重定義は最初の定義だけを見ます。Iterators.product・DataStructures.jl・@threads は未対応です。",
  bash: "簡易対応です。配列の添字アクセスは O(1)、$(…) のプロセス起動のコストは無視します。awk / sed の中の処理は数えません。",
  nim: "while q.len > 0 はキューとして扱います。自作 iterator は N 回、template / do 記法の本体は1回として数えます。",
  haskell: "簡易対応です(推定: 低)。forM_ / map / 再帰などの反復から推定し、遅延評価の中間リストは見積もりません。",
  perl: "$a と @a は同じ変数として扱います。OO(bless)・配列スライス・s///e は未対応です。",
  php: "クラスの $this->x は変数として扱い、型は追跡しません。配列のコピーオンライトは無視します。",
};

const EMPTY_TEXT = "O(1)";

function unsupported(langKey: string): Analysis {
  return {
    lang: langKey,
    status: "unsupported",
    time: { expr: ONE, full: ONE, text: EMPTY_TEXT },
    space: { expr: ONE, full: ONE, text: EMPTY_TEXT },
    variables: [],
    breakdown: [],
    warnings: [{ message: "この言語はまだ解析できません", level: "warn" }],
    confidence: "low",
    entries: [],
    symbolOrder: [],
  };
}

/** コードを解析する。例外は投げず、失敗したら status: "error" を返す */
export function analyzeCode(code: string, langKey: string): Analysis {
  const spec = LANG_SPECS[langKey];
  if (!spec) return unsupported(langKey);
  try {
    const prog = parseProgram(code, spec);
    return analyze(prog, spec);
  } catch (e) {
    return { ...unsupported(langKey), status: "error", warnings: [{ message: `解析中にエラーが起きました (${(e as Error).message})`, level: "warn" }] };
  }
}
