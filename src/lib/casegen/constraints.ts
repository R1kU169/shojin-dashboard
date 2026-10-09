// 制約(問題文の「制約」の箇条書き)を読み、変数ごとの事実の並びにする。
// どの変数が入力形式のどれに当たるかは spec.ts が決める(ここでは名前と添字の文字のまま持つ)。
import { hasJapanese } from "./tex.ts";
import { bin, num, parseExpr, splitTop } from "./expr.ts";
import type { Expr } from "./expr.ts";

/** 制約に出てくる変数。A_i なら base "A"・sub "i"、|S| なら bars */
export interface CRef {
  base: string;
  sub: string | null;
  bars: boolean;
}

export type Fact =
  | { k: "lo"; ref: CRef; e: Expr }
  | { k: "hi"; ref: CRef; e: Expr }
  | { k: "ne"; ref: CRef; e: Expr }
  | { k: "choices"; ref: CRef; values: string[] }
  | { k: "charset"; ref: CRef; chars: string[] }
  | { k: "string"; ref: CRef }
  | { k: "char"; ref: CRef }
  | { k: "parity"; ref: CRef; odd: boolean }
  /** from は値の始まり((0,1,…,N-1) の順列なら 0。書いていなければ 1) */
  | { k: "perm"; ref: CRef; from?: number }
  | { k: "distinct"; ref: CRef }
  | { k: "pairDistinct"; refs: CRef[] }
  | { k: "sorted"; ref: CRef; strict: boolean }
  | { k: "product"; refs: CRef[]; hi: Expr }
  /** マルチテストの総和(全てのテストケースにおける N の総和は … 以下) */
  | { k: "caseSum"; ref: CRef; expr: Expr; hi: Expr }
  /** 配列の要素の和(D_1+…+D_N ≤ 10^6 / S_1, …, S_K の長さの和は … 以下) */
  | { k: "elemSum"; ref: CRef; hi: Expr }
  | { k: "graph"; tree?: boolean; simple?: boolean; connected?: boolean; rooted?: boolean };

export interface Constraints {
  facts: Fact[];
  /** 読み取れなかった制約(ケースを作るときに考えない) */
  unread: string[];
}

const REF_RE = /^(\|)?([A-Za-z][A-Za-z0-9']*)(?:_(\{[^{}]*\}|[A-Za-z0-9]+))?(\|)?$/;

function readRef(s: string): CRef | null {
  const m = REF_RE.exec(s.trim());
  if (!m || !!m[1] !== !!m[4]) return null;
  let sub = m[3] ?? null;
  if (sub?.startsWith("{")) sub = sub.slice(1, -1).trim();
  return { base: m[2], sub: sub === "" ? null : sub, bars: !!m[1] };
}

/** "N, M" / "A_i, B_j" / "|x_i|,|y_i|" のような変数の並び。1つでも変数でなければ null */
function readRefList(s: string): CRef[] | null {
  const parts = splitTop(s, ",");
  const out: CRef[] = [];
  for (const p of parts) {
    const r = readRef(p);
    if (!r) return null;
    out.push(r);
  }
  return out.length ? out : null;
}

/** 文中に出てくる変数の名前(添字は落とす)。順列・相異なるの主語を取るのに使う */
function basesIn(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(/([A-Za-z][A-Za-z0-9']*)(?:_(?:\{[^{}]*\}|[A-Za-z0-9]+))?/g)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

const gen = (base: string): CRef => ({ base, sub: "i", bars: false });

// ---- 文字の種類 -------------------------------------------------------------------

const range = (a: string, b: string) =>
  Array.from({ length: b.charCodeAt(0) - a.charCodeAt(0) + 1 }, (_, i) => String.fromCharCode(a.charCodeAt(0) + i));
const LOWER = range("a", "z");
const UPPER = range("A", "Z");
const DIGITS = range("0", "9");

/** 「英小文字と数字」「. と #」「o、x」のような文字の種類を文字の並びにする。読めなければ null */
function readCharset(s: string): string[] | null {
  const items = s
    .replace(/\(0-9\)|\(a-z\)|\(A-Z\)/g, "")
    .replace(/のみ|だけ/g, "")
    .split(/\s*(?:、|,|及び|および|または|と|or)\s*/)
    .map((x) => x.trim())
    .filter(Boolean);
  if (items.length === 0) return null;
  const out: string[] = [];
  for (const it of items) {
    let add: string[] | null = null;
    if (/^英小文字$|^小文字$/.test(it)) add = LOWER;
    else if (/^英大文字$|^大文字$/.test(it)) add = UPPER;
    else if (/^(?:英字|アルファベット|英文字)$/.test(it)) add = [...UPPER, ...LOWER];
    else if (/^数字$/.test(it)) add = DIGITS;
    else if (/^[a-z]-[a-z]$|^[A-Z]-[A-Z]$|^[0-9]-[0-9]$/.test(it)) add = range(it[0], it[2]);
    else if ([...it].length === 1) add = [it];
    if (!add) return null;
    for (const c of add) if (!out.includes(c)) out.push(c);
  }
  return out;
}

// ---- 不等式の連鎖 -----------------------------------------------------------------

type Part =
  | { k: "ell" }
  | { k: "val"; refs: CRef[] | null; expr: Expr | null; product: CRef[] | null; sum: string | null };

function readPart(s: string): Part | null {
  const t = s.trim();
  if (t === "…") return { k: "ell" };
  // D_1+D_2+…+D_N(要素の和)
  const sum = /^([A-Za-z]\w*)_\{?1\}?\s*\+.*….*\+\s*\1_/.exec(t);
  if (sum) return { k: "val", refs: null, expr: null, product: null, sum: sum[1] };
  const refs = readRefList(t);
  // H × W(積の上限)
  const prod = /^([A-Za-z]\w*)\s*×\s*([A-Za-z]\w*)$/.exec(t);
  const product = prod ? [readRef(prod[1])!, readRef(prod[2])!] : null;
  const expr = refs && refs.length > 1 ? null : parseExpr(t);
  if (!refs && !expr && !product) return null;
  return { k: "val", refs, expr, product, sum: null };
}

const OPS = ["≤", "<", "≥", ">", "=", "∈"] as const;
type Op = (typeof OPS)[number];

/** 演算子で分ける(かっこ・中かっこの中は分けない) */
function splitChain(s: string): { parts: string[]; ops: Op[] } {
  const parts: string[] = [];
  const ops: Op[] = [];
  let depth = 0;
  let cur = "";
  for (const c of s) {
    if (c === "(" || c === "{") depth++;
    else if (c === ")" || c === "}") depth--;
    if (depth === 0 && (OPS as readonly string[]).includes(c)) {
      parts.push(cur);
      ops.push(c as Op);
      cur = "";
    } else cur += c;
  }
  parts.push(cur);
  return { parts, ops };
}

const plus1 = (e: Expr): Expr => (e.k === "num" ? num(e.v + 1n) : bin("+", e, num(1)));
const minus1 = (e: Expr): Expr => (e.k === "num" ? num(e.v - 1n) : bin("-", e, num(1)));

/** 1 ≤ K < N ≤ 2×10^5 のような不等式の連鎖を事実にする。読めなければ false */
function readChain(s: string, facts: Fact[]): boolean {
  // a_i ≠ b_i / A_i ≠ 0 / A_i ≠ A_j
  if (s.includes("≠")) {
    const [l, r, ...rest] = s.split("≠").map((x) => x.trim());
    if (rest.length) return false;
    const lr = readRef(l);
    const rr = readRef(r);
    if (lr && rr && lr.base === rr.base && lr.sub !== rr.sub) {
      facts.push({ k: "distinct", ref: lr });
      return true;
    }
    if (!lr) return false;
    const e = parseExpr(r);
    if (!e) return false;
    facts.push({ k: "ne", ref: lr, e });
    // A_{i,j} ≠ i の i は添字の文字なので、逆向きは要らない
    if (rr && (rr.sub !== null || !/^[a-z]$/.test(rr.base))) facts.push({ k: "ne", ref: rr, e: parseExpr(l)! });
    return true;
  }
  const { parts: raw, ops } = splitChain(s);
  if (ops.length === 0) return false;
  // t_i ∈ {0,1}
  if (ops.length === 1 && ops[0] === "∈") {
    const r = readRef(raw[0]);
    const m = /^\{(.*)\}$/.exec(raw[1].trim());
    if (!r || !m) return false;
    facts.push({ k: "choices", ref: r, values: m[1].split(",").map((x) => x.trim()).filter(Boolean) });
    return true;
  }
  const parts = raw.map(readPart);
  if (parts.some((p) => p === null)) return false;
  const ps = parts as Part[];

  // A_1 < A_2 < … < A_N(並び順の制約): 要素の範囲は外側の値、並びは sorted
  const ellAt = ps.findIndex((p) => p.k === "ell");
  if (ellAt >= 0) {
    const vals = ps.map((p) => (p.k === "val" && p.refs?.length === 1 ? p.refs[0] : null));
    const inner = vals.filter((v): v is CRef => v !== null && v.sub !== null);
    const base = inner[0]?.base;
    if (!base || !inner.every((v) => v.base === base)) return false;
    // 2次元の A_{i,1} < A_{i,2} < … は1行の中での並び
    const firstI = vals.findIndex((v) => v?.base === base);
    const lastI = vals.length - 1 - [...vals].reverse().findIndex((v) => v?.base === base);
    const between = ops.slice(firstI, lastI);
    if (!between.every((o) => o === "<" || o === "≤")) return false;
    const ref = gen(base);
    facts.push({ k: "sorted", ref, strict: between.every((o) => o === "<") });
    if (firstI > 0) {
      const lo = ps[firstI - 1];
      if (lo.k === "val" && lo.expr) facts.push({ k: "lo", ref, e: ops[firstI - 1] === "<" ? plus1(lo.expr) : lo.expr });
    }
    if (lastI < ps.length - 1) {
      const hi = ps[lastI + 1];
      if (hi.k === "val" && hi.expr) facts.push({ k: "hi", ref, e: ops[lastI] === "<" ? minus1(hi.expr) : hi.expr });
    }
    return true;
  }

  // |x| = |y| = 6 / M = 2: 最後が値、それより前が変数
  if (ops.every((o) => o === "=")) {
    const last = ps[ps.length - 1];
    if (last.k !== "val" || !last.expr) return false;
    for (const p of ps.slice(0, -1)) {
      if (p.k !== "val" || !p.refs) return false;
      for (const r of p.refs) {
        facts.push({ k: "lo", ref: r, e: last.expr });
        facts.push({ k: "hi", ref: r, e: last.expr });
      }
    }
    return true;
  }

  let any = false;
  for (let i = 0; i < ops.length; i++) {
    let op = ops[i];
    let L = ps[i];
    let R = ps[i + 1];
    if (L.k !== "val" || R.k !== "val") return false;
    if (op === "≥" || op === ">") {
      [L, R] = [R, L];
      op = op === "≥" ? "≤" : "<";
    }
    if (op !== "≤" && op !== "<") return false;
    const strict = op === "<";
    // 右が変数: 左の値が下限
    if (R.refs && L.expr && !(L.refs && L.refs.length > 1)) {
      for (const r of R.refs) facts.push({ k: "lo", ref: r, e: strict ? plus1(L.expr) : L.expr });
      any = true;
    }
    // 左が変数: 右の値が上限
    if (L.refs && R.expr && !(R.refs && R.refs.length > 1)) {
      for (const l of L.refs) facts.push({ k: "hi", ref: l, e: strict ? minus1(R.expr) : R.expr });
      any = true;
    }
    if (L.product && R.expr) {
      facts.push({ k: "product", refs: L.product, hi: strict ? minus1(R.expr) : R.expr });
      any = true;
    }
    if (L.sum && R.expr) {
      facts.push({ k: "elemSum", ref: gen(L.sum), hi: strict ? minus1(R.expr) : R.expr });
      any = true;
    }
    if (R.product || R.sum) any = true; // 1 ≤ H×W は自明
  }
  return any;
}

// ---- 1行ずつ ---------------------------------------------------------------------

/** 「X は …」の主語を変数の並びにする */
function subjects(s: string): CRef[] | null {
  const t = s.replace(/\s*はそれぞれ$|\s*は$/, "").replace(/、|\s+と\s+/g, ",");
  return readRefList(t);
}

function readLine(line: string, facts: Fact[]): boolean {
  // 「タイプ 2 のクエリにおいて、C は英小文字 1 文字」の前置きを落とす
  const s = line.replace(/[。.]$/, "").replace(/^.*?(?:において|について|では|の場合)[、,]\s*/, "").trim();
  if (s === "") return true;

  // グラフ
  if (/グラフ|木/.test(s) && !/[≤<≥>]/.test(s)) {
    const g: Fact & { k: "graph" } = { k: "graph" };
    // 「連結とは限らない」「単純とは限りません」「連結でないこともある」は、その性質を約束しないという意味
    const notSure = (word: string) => new RegExp(`${word}[^、。,]*?(?:とは限ら|でない|ではない|じゃない)`).test(s);
    // 「自己ループや多重辺は存在しない」なら単純。「…が存在する可能性がある」「…を含むことがある」なら単純ではない
    const loops = /自己ループ/.test(s) || /多重辺/.test(s);
    const loopsMayExist = loops && (/ことがあ|場合があ|かもしれ|可能性|あり得|ありう|存在しうる|含みうる/.test(s) || !/ない|無い|ません/.test(s));
    if (/根付き木|を根と/.test(s)) g.rooted = true;
    else if (/木/.test(s) && !notSure("木")) g.tree = true;
    if ((/単純/.test(s) && !notSure("単純")) || (loops && !loopsMayExist)) g.simple = true;
    if (/連結/.test(s) && !/非連結/.test(s) && !notSure("連結")) g.connected = true;
    if (!g.tree && !g.rooted && !g.simple && !g.connected) {
      // 性質が無いと分かった文(連結とは限らない など)は、読めた制約として何も足さない
      return notSure("連結") || notSure("単純") || loopsMayExist || /非連結/.test(s);
    }
    facts.push(g);
    return true;
  }

  // 総和
  const sum = /^(.*?)の\s*(長さの)?\s*(?:総和|和|合計)は\s*(.+?)\s*以下/.exec(s);
  if (sum) {
    const hi = parseExpr(sum[3]);
    if (!hi) return false;
    const subj = sum[1].replace(/^.*(?:における|において|について)[、,]?\s*/, "").replace(/^各テストケースの\s*/, "").trim();
    // 「S の長さの総和」も「|S| の総和」も文字列の長さの和
    const bars = !!sum[2] || /^\|[^|]+\|$/.test(sum[1].trim().replace(/^.*\s/, ""));
    if (subj.includes(",") || subj.includes("…")) {
      const base = basesIn(subj)[0];
      if (!base) return false;
      facts.push({ k: "elemSum", ref: { base, sub: "i", bars }, hi });
      return true;
    }
    const e = parseExpr(subj);
    if (!e) return false;
    const base = basesIn(subj)[0];
    if (!base) return false;
    facts.push({ k: "caseSum", ref: { base, sub: null, bars }, expr: bars ? { k: "ref", name: base, idx: [], bars: true } : e, hi });
    return true;
  }

  // 順列
  if (/順列|並び替え|並べ替え/.test(s)) {
    const subj = s.split(/\s*は/)[0];
    const bases = basesIn(subj);
    if (bases.length === 0) return false;
    // (0, 1, …, N-1) の順列 / 0 以上 N-1 以下の整数の並べ替え は 0 始まり
    const from = /\(\s*0\s*,|0\s*以上|0\s*から/.test(s) ? 0 : undefined;
    for (const b of bases) facts.push({ k: "perm", ref: gen(b), from });
    return true;
  }

  // 相異なる
  if (/相異なる|(?:すべて|全て|互いに)異なる/.test(s)) {
    const subj = s.split(/\s*は/)[0];
    const tuple = /^\(([^()]*)\)/.exec(subj.trim());
    if (tuple) {
      const bases = basesIn(tuple[1]);
      if (bases.length < 2) return false;
      facts.push({ k: "pairDistinct", refs: bases.map(gen) });
      return true;
    }
    const bases = basesIn(subj);
    if (bases.length === 0) return false;
    for (const b of bases) facts.push({ k: "distinct", ref: gen(b) });
    return true;
  }

  // 「X は a 以上 b 以下の整数」「N は 2 ≤ N ≤ 100 を満たす偶数」「S は … からなる長さ N の文字列」
  const ha = /^(.+?)\s*は\s*(.+)$/.exec(s);
  if (ha && hasJapanese(ha[2])) {
    // 「S の長さは 1 以上 10 以下」「S の長さは奇数」
    const lenOf = /^(.+?)\s*の長さ$/.exec(ha[1]);
    const subj = subjects(lenOf ? lenOf[1] : ha[1]);
    if (!subj) return readChainIn(s, facts);
    const refs = lenOf ? subj.map((r) => ({ ...r, bars: true })) : subj;
    return readPredicate(refs, ha[2], facts);
  }

  return readChainIn(s, facts);
}

/** 日本語の前置き(各クエリについて、/ タイプ 1 のクエリにおいて、)を落とし、「、」で分けて不等式として読む */
function readChainIn(s: string, facts: Fact[]): boolean {
  let t = s.replace(/^.*?(?:において|について|では|の場合)[、,]?\s*/, "");
  // (1 ≤ i ≤ N) / (i ≠ j) のような添字の範囲は落とす
  t = t.replace(/\((?=[^()]*[≤<≠])[^()]*\)/g, "").trim();
  if (hasJapanese(t.replace(/、/g, ""))) return false;
  const chunks = t.split(/、/).map((x) => x.trim()).filter(Boolean);
  if (chunks.length === 0) return false;
  let ok = true;
  for (const c of chunks) ok = readChain(c, facts) && ok;
  return ok;
}

/** 「X は」の後ろ(述語)を読む */
function readPredicate(refs: CRef[], pred: string, facts: Fact[]): boolean {
  let p = pred.trim();
  const parity = /偶数/.test(p) ? false : /奇数/.test(p) ? true : null;
  if (parity !== null) for (const r of refs) facts.push({ k: "parity", ref: r, odd: parity });

  // 2 ≤ N ≤ 100 を満たす
  const sat = /^(.+?)\s*を満たす/.exec(p);
  if (sat) return readChain(sat[1].replace(/\((?=[^()]*[≤<])[^()]*\)/g, "").trim(), facts) || parity !== null;

  // a 以上 b 以下 / a 以上 / b 以下 / b 未満(長さの話でなければ値の範囲)
  if (!/長さ|文字/.test(p)) {
    const lo = /(\S+?)\s*以上/.exec(p);
    const hi = /(\S+?)\s*(以下|未満)/.exec(p.replace(/^.*以上/, ""));
    let any = false;
    const bound = (k: "lo" | "hi", e: Expr | null) => {
      if (!e) return;
      for (const r of refs) facts.push({ k, ref: r, e });
      any = true;
    };
    if (lo) bound("lo", parseExpr(lo[1]));
    if (hi) {
      const e = parseExpr(hi[1]);
      bound("hi", e && (hi[2] === "未満" ? minus1(e) : e));
    }
    if (/正整数|正の整数/.test(p)) bound("lo", num(1));
    else if (/非負整数|非負の整数/.test(p)) bound("lo", num(0));
    if (any || parity !== null) return true;
    if (/^(?:整数|すべて整数|全て整数)/.test(p)) return true;
  }

  // 選択肢: A、B、C のいずれか / keep または take / . または # である
  const anyOf = /^(.+?)\s*のいずれか/.exec(p) ?? (!/からなる/.test(p) ? /^(.+?\s*または\s*.+?)\s*(?:である|のどちらか)?$/.exec(p) : null);
  if (anyOf) {
    const values = anyOf[1].split(/\s*(?:、|,|または|か)\s*/).map((x) => x.trim()).filter(Boolean);
    if (values.length < 2) return false;
    for (const r of refs) facts.push({ k: "choices", ref: r, values });
    return true;
  }

  // 長さ
  let lenLo: Expr | null = null;
  let lenHi: Expr | null = null;
  const between = /長さ\s*(.+?)\s*以上\s*(.+?)\s*以下(?:の|、)?/.exec(p);
  const exact = /長さ(?:が)?\s*(.+?)\s*の/.exec(p);
  if (between) {
    lenLo = parseExpr(between[1]);
    lenHi = parseExpr(between[2]);
    p = p.replace(between[0], "");
  } else if (exact && !/以上|以下/.test(exact[1])) {
    lenLo = lenHi = parseExpr(exact[1]);
    p = p.replace(exact[0], "");
  }
  if (/空でない/.test(p)) lenLo ??= num(1);
  const oneChar = /1\s*文字/.test(p);

  // 文字の種類
  let chars: string[] | null = null;
  const made = /^(.*?)(?:のみ)?\s*からなる/.exec(p.replace(/^[、,\s]+/, ""));
  if (made) chars = readCharset(made[1].replace(/[、,]\s*$/, ""));
  else {
    const word = /^(英小文字|英大文字|数字|英字)/.exec(p.trim());
    if (word) chars = readCharset(word[1]);
  }
  const isString = /文字列/.test(p);
  if (!chars && !isString && lenLo === null && !oneChar) return false;
  for (const r of refs) {
    if (chars) facts.push({ k: "charset", ref: r, chars });
    if (isString) facts.push({ k: "string", ref: r });
    else if (chars || oneChar) facts.push({ k: "char", ref: r });
    const bars = { ...r, bars: true };
    if (lenLo) facts.push({ k: "lo", ref: bars, e: lenLo });
    if (lenHi) facts.push({ k: "hi", ref: bars, e: lenHi });
  }
  return true;
}

/** 入力される値はすべて整数 などの、読まなくてよい行 */
function ignorable(s: string): boolean {
  return /^(?:入力|入力される(?:値|数値)?|与えられる(?:入力|値)?)(?:は|の値は)?\s*(?:すべて|全て)?整数(?:である)?[。.]?$/.test(s) || /^(?:入力される数値はすべて整数|入力は全て整数である)/.test(s);
}

/** 制約を読む(normalizeText を通した文字列を渡す) */
export function parseConstraints(text: string): Constraints {
  const facts: Fact[] = [];
  const unread: string[] = [];
  for (const raw of text.split("\n")) {
    // 箇条書きの記号は落とす(-10^9 ≤ X の負号は残す)
    const line = raw.replace(/^(?:[・*•]|-(?=\s))\s*/, "").trim();
    if (line === "" || /^制約$/.test(line) || ignorable(line)) continue;
    const before = facts.length;
    let ok = false;
    try {
      ok = readLine(line, facts);
    } catch {
      ok = false;
    }
    if (!ok) {
      facts.length = before;
      unread.push(line);
    }
  }
  return { facts, unread };
}
