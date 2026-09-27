// 計算量の式の代数と表示。
//
// 式は「係数 × 変数ごとの成長因子の積」を項とする和(ir.ts の Expr)。
// ビッグオーの計算で要るのは次の2つだけなので、それに絞った最小の代数にしている:
//  - ネスト(積): mul
//  - 逐次(和): add。ビッグオーでは和と max は同じ(O(f+g) = O(max(f,g)))なので、
//    同じ形の項は係数を足さずに max を取る(ループを2回書いても 2·N にはしない)
//
// 係数について: 「実際の数値が分かるなら O(1000) のように出す」という要件があるので、
// 数値の係数は捨てずに持ち回る。ただし 2·N のような小さい係数は競プロでも書かないので、
// COEF_KEEP 未満は表示もせず、他の項に吸収されてよいことにする。
import type { Expr, Factor, Term } from "./ir.ts";

/** この値以上の係数は表示し、支配判定でも「係数でも勝たないと落とせない」扱いにする */
export const COEF_KEEP = 10;

const fac = (v: string, pow = 0, log = 0, exp = 0, fact = 0): Factor => ({ v, pow, log, exp, fact });
const isUnit = (x: Factor) => x.pow === 0 && x.log === 0 && x.exp === 0 && x.fact === 0;
const byName = (a: Factor, b: Factor) => (a.v < b.v ? -1 : a.v > b.v ? 1 : 0);

export const ONE: Expr = [{ coef: 1, factors: [] }];

/** 数値だけの項。0 以下の回数は意味を持たないので 1 に丸める */
export function lit(n: number): Expr {
  return [{ coef: Number.isFinite(n) ? Math.max(1, n) : Number.MAX_VALUE, factors: [] }];
}
export const sym = (v: string): Expr => [{ coef: 1, factors: [fac(v, 1)] }];
export const powOf = (v: string, k: number): Expr => [{ coef: 1, factors: [fac(v, k)] }];
export const logOf = (v: string): Expr => [{ coef: 1, factors: [fac(v, 0, 1)] }];
export const exp2Of = (v: string): Expr => [{ coef: 1, factors: [fac(v, 0, 0, 1)] }];
export const factOf = (v: string): Expr => [{ coef: 1, factors: [fac(v, 0, 0, 0, 1)] }];

function termKey(t: Term): string {
  return t.factors.map((x) => `${x.v}:${x.pow}:${x.log}:${x.exp}:${x.fact}`).join("|");
}

function mulTerm(a: Term, b: Term): Term {
  const map = new Map<string, Factor>();
  for (const x of [...a.factors, ...b.factors]) {
    const cur = map.get(x.v);
    map.set(
      x.v,
      cur ? fac(x.v, cur.pow + x.pow, cur.log + x.log, cur.exp + x.exp, cur.fact + x.fact) : { ...x },
    );
  }
  const factors = [...map.values()].filter((x) => !isUnit(x)).sort(byName);
  return { coef: Math.min(a.coef * b.coef, Number.MAX_VALUE), factors };
}

/**
 * 同じ形の項をまとめ(係数は max)、意味の無い項を落とす。
 * 他に変数の項があるとき、係数が COEF_KEEP 未満の数値だけの項は落とす(N + 5 → N)。
 */
export function normalize(e: Expr): Expr {
  // よくある形(1項で、因子が名前順に並び単位因子を含まない)はそのまま返す
  if (e.length === 1 && cleanTerm(e[0])) return e;
  const m = new Map<string, Term>();
  for (const t of e) {
    const clean: Term = { coef: t.coef, factors: t.factors.filter((x) => !isUnit(x)).sort(byName) };
    const k = termKey(clean);
    const cur = m.get(k);
    if (!cur || cur.coef < clean.coef) m.set(k, clean);
  }
  let terms = [...m.values()];
  if (terms.some((t) => t.factors.length > 0)) {
    terms = terms.filter((t) => t.factors.length > 0 || t.coef >= COEF_KEEP);
  }
  return terms.length > 0 ? terms : ONE;
}

/** 因子が名前順で、単位因子(v^0)を含まない */
function cleanTerm(t: Term): boolean {
  const f = t.factors;
  for (let i = 0; i < f.length; i++) {
    if (isUnit(f[i])) return false;
    if (i > 0 && f[i - 1].v >= f[i].v) return false;
  }
  return true;
}

/** 係数1の定数(O(1)) */
const isOne = (e: Expr) => e.length === 1 && e[0].coef === 1 && e[0].factors.length === 0;

export function mul(a: Expr, b: Expr): Expr {
  if (isOne(a)) return normalize(b);
  if (isOne(b)) return normalize(a);
  const out: Term[] = [];
  for (const x of a) for (const y of b) out.push(mulTerm(x, y));
  return normalize(out);
}

export function add(a: Expr, b: Expr): Expr {
  // 1 + b は b(b の項は係数1以上なので、1 は必ず吸収される)
  if (isOne(a) && b.length > 0) return normalize(b);
  if (isOne(b) && a.length > 0) return normalize(a);
  return normalize([...a, ...b]);
}

export function sum(list: Expr[]): Expr {
  return list.reduce((acc, e) => add(acc, e), ONE);
}

type Growth = [number, number, number, number];
function growth(t: Term, v: string): Growth {
  const x = t.factors.find((y) => y.v === v);
  return x ? [x.fact, x.exp, x.pow, x.log] : [0, 0, 0, 0];
}
function cmpGrowth(p: Growth, q: Growth): number {
  for (let i = 0; i < 4; i++) if (p[i] !== q[i]) return p[i] - q[i];
  return 0;
}

/**
 * a が b を支配する(b を表示から落としてよい)か。
 * すべての変数で a の成長が b 以上であること。成長は (階乗, 指数, 冪, log) の辞書順。
 * 加えて b の係数が COEF_KEEP 以上なら、a の係数も b 以上でないと落とさない
 * (N² と 1000·N は両方残す。落とすと「実際の数値」が表示から消える)。
 */
export function dominates(a: Term, b: Term): boolean {
  const vs = new Set([...a.factors, ...b.factors].map((x) => x.v));
  for (const v of vs) if (cmpGrowth(growth(a, v), growth(b, v)) < 0) return false;
  if (b.coef >= COEF_KEEP && a.coef < b.coef) return false;
  return true;
}

/** 表示用: 支配される項を落とす */
export function simplify(e: Expr): Expr {
  const n = normalize(e);
  const kept = n.filter((b, i) => !n.some((a, j) => j !== i && termKey(a) !== termKey(b) && dominates(a, b)));
  return kept.length > 0 ? kept : n;
}

export function vars(e: Expr): string[] {
  const s = new Set<string>();
  for (const t of e) for (const x of t.factors) s.add(x.v);
  return [...s];
}

export function isConst(e: Expr): boolean {
  return e.every((t) => t.factors.length === 0);
}

/** 数値だけの式ならその値(複数項なら max)、そうでなければ null */
export function constValue(e: Expr): number | null {
  return isConst(e) ? Math.max(...e.map((t) => t.coef)) : null;
}

/** 単一の記号そのもの(係数1・冪1)ならその名前 */
export function singleSym(e: Expr): string | null {
  if (e.length !== 1 || e[0].coef !== 1 || e[0].factors.length !== 1) return null;
  const x = e[0].factors[0];
  return x.pow === 1 && x.log === 0 && x.exp === 0 && x.fact === 0 ? x.v : null;
}

/**
 * log(e)。二分探索や倍々ループの回数に使う。上界として次のように取る:
 * 積 → 各因子の log の和、和 → 各項の log の和、数値 c → ceil(log2 c)(1e18 → 60)。
 * 変数を含む項の係数の log(定数)は捨てる。
 */
export function logOfExpr(e: Expr): Expr {
  const parts: Expr[] = [];
  for (const t of e) {
    if (t.factors.length === 0) {
      if (t.coef >= 2) parts.push(lit(Math.ceil(Math.log2(t.coef))));
      continue;
    }
    for (const x of t.factors) {
      if (x.pow > 0) parts.push(logOf(x.v));
      if (x.exp > 0) parts.push(sym(x.v));
      if (x.fact > 0) parts.push(mul(sym(x.v), logOf(x.v)));
    }
  }
  return parts.length > 0 ? sum(parts) : ONE;
}

/** e^p(分数冪は項ごとに取って足す上界) */
export function powExpr(e: Expr, p: number): Expr {
  if (Number.isInteger(p) && p >= 1) {
    let r = e;
    for (let i = 1; i < p; i++) r = mul(r, e);
    return r;
  }
  // 分数冪(√ など)は項ごとに取って足す(√(a+b) ≤ √a + √b の上界)
  return normalize(
    e.map((t) => ({ coef: Math.pow(t.coef, p), factors: t.factors.map((x) => ({ ...x, pow: x.pow * p })) })),
  );
}

function exp2Expr(e: Expr, k: number): Expr {
  const c = constValue(e);
  if (c !== null) return lit(Math.pow(2, Math.min(c * k, 1023)));
  const s = singleSym(e);
  if (s) return [{ coef: 1, factors: [fac(s, 0, 0, k)] }];
  return [{ coef: 1, factors: [fac(`2^(${format(e, [])})`, k)] }];
}

function factExpr(e: Expr, k: number): Expr {
  const c = constValue(e);
  if (c !== null && c <= 170) {
    let f = 1;
    for (let i = 2; i <= c; i++) f *= i;
    return lit(Math.pow(f, k));
  }
  const s = singleSym(e);
  if (s) return [{ coef: 1, factors: [fac(s, 0, 0, 0, k)] }];
  return [{ coef: 1, factors: [fac(`(${format(e, [])})!`, k)] }];
}

/** 記号 from に式 to を代入して正規化する(|a| ≡ N、"?" ≡ 主記号、仮引数 → 実引数) */
export function rename(e: Expr, from: string, to: Expr): Expr {
  const out: Term[] = [];
  for (const t of e) {
    const x = t.factors.find((y) => y.v === from);
    if (!x) {
      out.push(t);
      continue;
    }
    let r: Expr = [{ coef: t.coef, factors: t.factors.filter((y) => y.v !== from) }];
    if (x.pow > 0) r = mul(r, powExpr(to, x.pow));
    if (x.log > 0) {
      const lg = logOfExpr(to);
      for (let i = 0; i < x.log; i++) r = mul(r, lg);
    }
    if (x.exp > 0) r = mul(r, exp2Expr(to, x.exp));
    if (x.fact > 0) r = mul(r, factExpr(to, x.fact));
    out.push(...r);
  }
  return normalize(out);
}

export function equals(a: Expr, b: Expr): boolean {
  const ka = normalize(a).map((t) => `${t.coef}*${termKey(t)}`).sort();
  const kb = normalize(b).map((t) => `${t.coef}*${termKey(t)}`).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i]);
}

// ---------------------------------------------------------------------------
// 表示

const SUP: Record<string, string> = { "2": "²", "3": "³" };

/** 係数や数値の表示: 10^4 未満は整数、それ以上は有効2桁の 2×10^5 形式 */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n) || n >= 1e300) return "10^300";
  if (n < 1e4) return String(Math.round(n));
  let e = Math.floor(Math.log10(n));
  let m = Math.round((n / Math.pow(10, e)) * 10) / 10;
  if (m >= 10) {
    m = 1;
    e += 1;
  }
  return m === 1 ? `10^${e}` : `${String(m).replace(/\.0$/, "")}×10^${e}`;
}

function powText(v: string, p: number): string {
  if (p === 1) return v;
  if (p === 0.5) return `√${v}`;
  const whole = Math.floor(p);
  const half = p - whole === 0.5;
  if (Number.isInteger(p) || half) {
    const base = whole === 1 ? v : SUP[String(whole)] ? `${v}${SUP[String(whole)]}` : `${v}^${whole}`;
    return half ? `${base}√${v}` : base;
  }
  return `${v}^${Number(p.toFixed(2))}`;
}

/** 項の強さ(表示の並び順): 階乗 → 指数 → 冪の合計 → log の合計 */
function strength(t: Term): number[] {
  let fact = 0,
    exp = 0,
    pow = 0,
    log = 0;
  for (const x of t.factors) {
    fact += x.fact;
    exp += x.exp;
    pow += x.pow;
    log += x.log;
  }
  return [fact, exp, pow, log];
}

function orderIndex(order: readonly string[], v: string): number {
  const i = order.indexOf(v);
  return i >= 0 ? i : order.length;
}

function termText(t: Term, order: readonly string[]): string {
  const fs = [...t.factors].sort(
    (a, b) => orderIndex(order, a.v) - orderIndex(order, b.v) || byName(a, b),
  );
  const main: string[] = [];
  if (t.factors.length === 0 || t.coef >= COEF_KEEP) main.push(formatNumber(t.coef));
  for (const x of fs) if (x.pow > 0) main.push(powText(x.v, x.pow));
  const logs = fs
    .filter((x) => x.log > 0)
    .map((x) => `log${x.log === 1 ? "" : (SUP[String(x.log)] ?? `^${x.log}`)} ${x.v}`);
  const tail: string[] = [];
  for (const x of fs) if (x.exp > 0) tail.push(`${Math.pow(2, x.exp)}^${x.v}`);
  for (const x of fs) if (x.fact > 0) tail.push(x.fact === 1 ? `${x.v}!` : `(${x.v}!)${SUP[String(x.fact)] ?? `^${x.fact}`}`);
  let s = [main.join("·"), logs.join(" ")].filter(Boolean).join(" ");
  if (tail.length > 0) s = s ? `${s}·${tail.join("·")}` : tail.join("·");
  return s || "1";
}

/** 式を表示用の文字列にする(O() は付けない)。order は記号の初出順 */
export function format(e: Expr, order: readonly string[]): string {
  const terms = [...normalize(e)].sort((a, b) => {
    const sa = strength(a),
      sb = strength(b);
    for (let i = 0; i < 4; i++) if (sa[i] !== sb[i]) return sb[i] - sa[i];
    const va = a.factors.length ? Math.min(...a.factors.map((x) => orderIndex(order, x.v))) : Infinity;
    const vb = b.factors.length ? Math.min(...b.factors.map((x) => orderIndex(order, x.v))) : Infinity;
    if (va !== vb) return va - vb;
    return b.coef - a.coef;
  });
  return terms.map((t) => termText(t, order)).join(" + ");
}

export function formatO(e: Expr, order: readonly string[]): string {
  return `O(${format(e, order)})`;
}
