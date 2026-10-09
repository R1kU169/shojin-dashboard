// 変数の範囲から演算回数を概算し、制限時間に対する目安を出す。
//
// ここで使う式は表示用に簡約する前のもの(Analysis.time.full)。簡約で落とした項も
// 具体的な値では効くことがある(N² + 1000·N で N が小さいとき)ため。
import type { EvalResult, Expr, TimeVerdict } from "./ir.ts";
import { formatNumber } from "./expr.ts";

/**
 * 1秒あたりの単純演算回数の目安。ループ本体を1演算と数える前提の粗い値で、
 * 言語の遅さの桁が分かれば十分という割り切り。EDITOR_LANGS と同じ19言語を並べる。
 */
export const SPEED: Record<string, number> = {
  cpp: 1e8,
  c: 1e8,
  rust: 1e8,
  go: 1e8,
  d: 1e8,
  nim: 1e8,
  java: 1e8,
  csharp: 1e8,
  js: 3e7,
  ts: 3e7,
  pypy: 3e7,
  julia: 3e7,
  haskell: 3e7,
  python: 1e7,
  ruby: 1e7,
  php: 1e7,
  perl: 1e7,
  lua: 1e7,
  bash: 1e5,
};

/**
 * 予算に対する比がこれ以下なら「余裕」。ループ本体を1演算と数えているが実体は
 * 3〜10演算あるので、0.3 でちょうど「実際の演算数 ≒ 予算」くらいになる。
 */
export const TIGHT_RATIO = 0.3;

/** 単一の値: 2e5 / 2*10^5 / 2×10^5 / 10**9 / 1<<20 / 2,000 / 200_000。下限(lower)なら 0 や負の値(-10^9)も読む */
function parseSingle(s: string, lower = false): number | null {
  if (lower && s.startsWith("-")) {
    const v = parseSingle(s.slice(1));
    return v === null ? null : -v;
  }
  if (s === "") return null;
  let v = 1;
  for (const part of s.split("*")) {
    const m = /^(\d+(?:\.\d+)?(?:e[+-]?\d+)?)(?:\^(\d+))?$/.exec(part);
    if (!m) return null;
    v *= Math.pow(Number(m[1]), m[2] ? Number(m[2]) : 1);
  }
  return Number.isFinite(v) && (lower ? v >= 0 : v > 0) && v < 1e30 ? v : null;
}

const SUPERSCRIPT: Record<string, string> = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9" };

/**
 * 範囲の入力を読む。上限だけ(2e5)でも、制約の書き方(1 ≤ N ≤ 2×10^5 / N ≤ 2×10^5 / 1 \le N \le 2 \times 10^5)でもよい。
 * 最悪ケースの評価には hi を使う。lo は表示にだけ使う(0 や負の値でもよい)。読めなければ null。
 */
export function parseBoundValue(input: string): { lo: number | null; hi: number } | null {
  // 上付きの数字(10⁵)は NFKC で 105 になってしまうので、先に ^5 にする
  let s = input.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (m) => `^${[...m].map((c) => SUPERSCRIPT[c]).join("")}`);
  s = s.normalize("NFKC").toLowerCase();
  // TeX の書き方
  s = s
    .replace(/\\(?:leqq|leq|le)(?![a-z])/g, "≤")
    .replace(/\\(?:geqq|geq|ge)(?![a-z])/g, "≥")
    .replace(/\\lt(?![a-z])/g, "<")
    .replace(/\\(?:times|cdot)(?![a-z])/g, "×")
    .replace(/\\[,;: !]|[{}$]/g, " ");
  // 問題ページの表示(KaTeX)をコピーすると累乗が「10 5」「10 改行 5」に割れる。10 の後ろの空白と1〜2桁の数は指数
  s = s.replace(/(^|[^\d.])10[ \t\r\n]+(\d{1,2})(?!\d)/g, "$110^$2");
  s = s.replace(/[\s,_']/g, "").replace(/[×·・⋅∙]/g, "*").replace(/\*\*/g, "^").replace(/[−–]/g, "-");
  s = s.replace(/≦|=</g, "<=").replace(/≧/g, ">=").replace(/≤/g, "<=");
  // 1<<20 は範囲の区切りの < と取り違えないよう、区切りを探す前に 1*2^20 にする
  s = s.replace(/(\d+)<<(\d+)/g, "$1*2^$2");
  // lo <= X <= hi / lo < X < hi(X は変数名なので読み捨てる)
  const cmp = /^([^<]+?)<=?[a-z|()_\d]*?[a-z|()][a-z|()_\d]*<=?(.+)$/.exec(s);
  if (cmp) return range(cmp[1], cmp[2]);
  // X <= hi(下限を書かない制約)
  const upper = /^[a-z|()_\d]*?[a-z|()][a-z|()_\d]*<=?(.+)$/.exec(s);
  if (upper) {
    const hi = parseSingle(upper[1]);
    return hi === null ? null : { lo: null, hi };
  }
  const sep = /^(.+?)(?:〜|~|\.\.)(.+)$/.exec(s);
  if (sep) return range(sep[1], sep[2]);
  const hi = parseSingle(s);
  return hi === null ? null : { lo: null, hi };
}

function range(a: string, b: string): { lo: number; hi: number } | null {
  const lo = parseSingle(a, true);
  const hi = parseSingle(b);
  if (lo === null || hi === null || lo > hi) return null;
  return { lo, hi };
}

/** log2(v!) を1024ビットで打ち切って計算する(それを超えたら Infinity) */
function factorial(v: number): number {
  if (v > 170) return Infinity;
  let r = 1;
  for (let i = 2; i <= v; i++) r *= i;
  return r;
}

/** 2^(H·W) のような疑似記号の値 */
function pseudoValue(name: string, values: Record<string, number>): number | null {
  const m = /^2\^\((.+)\)$/.exec(name);
  if (!m) return null;
  let prod = 1;
  for (const p of m[1].split("·")) {
    const v = values[p];
    if (v === undefined) return null;
    prod *= v;
  }
  return prod >= 1024 ? Infinity : Math.pow(2, prod);
}

/** 演算回数を数値にする。値の無い記号があれば ops は null で missing に並べる */
export function evaluate(e: Expr, values: Record<string, number>, lang: string, timeLimitSec: number): EvalResult {
  const missing = new Set<string>();
  let ops = 0;
  for (const t of e) {
    let v = t.coef;
    for (const x of t.factors) {
      let n = values[x.v];
      if (n === undefined) {
        const p = pseudoValue(x.v, values);
        if (p === null) {
          // 2^(H·W) のような疑似記号は、範囲を入れる欄のある元の変数(H, W)の名前で知らせる
          const parts = /^2\^\((.+)\)$/.exec(x.v)?.[1].split("·");
          if (parts) for (const part of parts) if (values[part] === undefined) missing.add(part);
          if (!parts) missing.add(x.v);
          continue;
        }
        n = p;
      }
      if (x.pow) v *= Math.pow(n, x.pow);
      if (x.log) v *= Math.pow(Math.log2(Math.max(n, 2)), x.log);
      if (x.exp) v *= x.exp * n >= 1024 ? Infinity : Math.pow(2, x.exp * n);
      if (x.fact) v *= Math.pow(factorial(n), x.fact);
    }
    ops += v;
  }
  const budget = (SPEED[lang] ?? 1e8) * Math.max(timeLimitSec, 0.001);
  if (missing.size > 0) {
    return { ops: null, opsText: "", missing: [...missing], budget, ratio: null, verdict: null };
  }
  const ratio = ops / budget;
  const verdict: TimeVerdict = ratio <= TIGHT_RATIO ? "ok" : ratio <= 1 ? "tight" : "tle";
  return { ops, opsText: formatOps(ops), missing: [], budget, ratio, verdict };
}

/** 演算回数の表示: 10^4 未満はカンマ区切りの整数、それ以上は有効2桁 */
export function formatOps(n: number): string {
  if (Number.isNaN(n)) return "—";
  if (!Number.isFinite(n) || n >= 1e300) return "10^300 以上";
  const r = Math.round(n);
  if (r < 1e4) return r.toLocaleString("en-US");
  // 丸めて 10^4 に届いたら指数表記に繰り上げる(9999.9 → 10^4)
  return formatNumber(r);
}
