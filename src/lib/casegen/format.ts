// 入力形式(問題文の「入力」の pre)を読み、行の並びにする。
//
//   N M                 → row [N, M]
//   A_1 A_2 … A_N       → row [list A_{col}, col = 1..N]
//   u_1 v_1 / ⋮ / u_M v_M → rep (M 行) [u_{row}, v_{row}]
//   S_1 / ⋮ / S_H        → rep (H 行) [S_{row}]
//   T / case_1 / ⋮ / case_T と「各テストケースの形式」 → cases
//   Q / query_1 / ⋮ / query_Q と種類ごとの形式(1 x / 2 y)→ queries
//
// 行番号・列番号は Expr の {k:"row"} / {k:"col"} で表し、生成するときに値を入れて評価する。
import { hasJapanese } from "./tex.ts";
import { bin, num, parseSubscript, readSub, sameExpr } from "./expr.ts";
import type { Expr } from "./expr.ts";

/** 変数の参照。idx が空ならスカラー(P_x や t_q のように英小文字の添字は名前の一部として扱う) */
export interface Ref {
  base: string;
  idx: Expr[];
}

export type Item =
  | { k: "tok"; ref: Ref }
  /** 横に並ぶ要素。ref.idx のどこか1つが {k:"col"} で、col は from から to まで step ずつ。joined は空白なしでつなぐ(グリッドの1行) */
  | { k: "list"; ref: Ref; from: Expr; to: Expr; step: bigint; joined: boolean }
  /** クエリの種類の番号など、そのまま出す文字 */
  | { k: "lit"; text: string };

export type Node =
  | { k: "row"; items: Item[] }
  /** 同じ形の行を count 行。items の添字の {k:"row"} に行番号(1始まり)が入る */
  | { k: "rep"; count: Expr; items: Item[] }
  | { k: "cases"; name: string; count: Expr; body: Node[] }
  /** alts は種類ごとの形式(1行ずつ)。種類が1つだけのこともある */
  | { k: "queries"; name: string; count: Expr; alts: Item[][] };

export interface Format {
  nodes: Node[];
  warnings: string[];
}

// ---- 1行を読む -------------------------------------------------------------------

type LTok =
  | { t: "ref"; ref: Ref; space: boolean }
  | { t: "ell"; space: boolean }
  | { t: "lit"; text: string; space: boolean };

const VDOTS = /^(?:⋮|:|…|・|\.)$/;

function lexLine(line: string, warnings: string[]): LTok[] {
  const out: LTok[] = [];
  let i = 0;
  let space = true;
  while (i < line.length) {
    const c = line[i];
    if (c === " ") {
      space = true;
      i++;
      continue;
    }
    if (c === "…") {
      out.push({ t: "ell", space });
      i++;
      space = false;
      continue;
    }
    const id = /^[A-Za-z][A-Za-z0-9']*/.exec(line.slice(i));
    if (id) {
      i += id[0].length;
      const sub = readSub(line, i);
      let ref: Ref = { base: id[0], idx: [] };
      if (sub) {
        i = sub.end;
        // P_x / t_q のような英小文字だけの添字は名前の一部(配列の要素ではない)
        if (/^[a-z]+$/.test(sub.sub)) ref = { base: `${id[0]}_${sub.sub}`, idx: [] };
        else {
          const idx = parseSubscript(sub.sub);
          if (idx) ref = { base: id[0], idx };
          else {
            warnings.push(`添字「${sub.sub}」を読めませんでした`);
            ref = { base: `${id[0]}_${sub.sub}`, idx: [] };
          }
        }
      }
      out.push({ t: "ref", ref, space });
      space = false;
      continue;
    }
    const lit = /^[^ …]+/.exec(line.slice(i));
    if (lit) {
      out.push({ t: "lit", text: lit[0], space });
      i += lit[0].length;
      space = false;
    }
  }
  return out;
}

/** 同じ配列の要素か(添字の数も同じ) */
function sameArray(a: LTok | undefined, b: LTok | undefined): a is LTok & { t: "ref" } {
  return (
    a !== undefined &&
    b !== undefined &&
    a.t === "ref" &&
    b.t === "ref" &&
    a.ref.base === b.ref.base &&
    a.ref.idx.length > 0 &&
    a.ref.idx.length === b.ref.idx.length
  );
}

const minus = (a: Expr, b: Expr): Expr =>
  a.k === "num" && b.k === "num" ? num(a.v - b.v) : bin("-", a, b);

/** A_1 A_2 … A_N を list にまとめる */
function lineItems(toks: LTok[], warnings: string[]): Item[] {
  const items: Item[] = [];
  let i = 0;
  // 省略記号の位置で、左の同じ配列の並びと右の最後の要素をまとめる
  const used = new Set<number>();
  const lists = new Map<number, { end: number; item: Item }>();
  for (let e = 0; e < toks.length; e++) {
    if (toks[e].t !== "ell") continue;
    const right = toks[e + 1];
    if (!sameArray(toks[e - 1], right)) continue;
    let j = e - 1;
    while (j - 1 >= 0 && sameArray(toks[j - 1], toks[e - 1]) && !used.has(j - 1)) j--;
    const first = toks[j] as LTok & { t: "ref" };
    const last = right as LTok & { t: "ref" };
    const slots = first.ref.idx.map((x, s) => (sameExpr(x, last.ref.idx[s]) ? -1 : s)).filter((s) => s >= 0);
    if (slots.length !== 1) {
      warnings.push(`「${first.ref.base}」の並びの添字を読めませんでした`);
      continue;
    }
    const slot = slots[0];
    let step = 1n;
    if (e - 1 > j) {
      const second = toks[j + 1] as LTok & { t: "ref" };
      const d = minus(second.ref.idx[slot], first.ref.idx[slot]);
      if (d.k === "num" && d.v > 0n) step = d.v;
    }
    const idx = first.ref.idx.slice();
    idx[slot] = { k: "col" };
    const joined = e - 1 > j ? !toks[j + 1].space : !toks[e].space && !last.space;
    for (let x = j; x <= e + 1; x++) used.add(x);
    lists.set(j, {
      end: e + 1,
      item: { k: "list", ref: { base: first.ref.base, idx }, from: first.ref.idx[slot], to: last.ref.idx[slot], step, joined },
    });
  }
  while (i < toks.length) {
    const l = lists.get(i);
    if (l) {
      items.push(l.item);
      i = l.end + 1;
      continue;
    }
    const t = toks[i];
    if (t.t === "ref") items.push({ k: "tok", ref: t.ref });
    else if (t.t === "lit") items.push({ k: "lit", text: t.text });
    i++;
  }
  return items;
}

// ---- 縦のくり返し -----------------------------------------------------------------

function shape(items: Item[]): string {
  return items
    .map((it) =>
      it.k === "tok"
        ? `t:${it.ref.base}:${it.ref.idx.length}`
        : it.k === "list"
          ? `l:${it.ref.base}:${it.ref.idx.length}:${it.joined}`
          : `x:${it.text}`,
    )
    .join("|");
}

interface Diff {
  /** 行番号で書き直した式 */
  expr: Expr;
  /** 行数(1行目の値と最終行の式から求めたもの) */
  count?: Expr;
}

/**
 * 1行目 f と最終行 l(と2行目 s)の同じ位置の式を比べ、違うところを行番号の式にする。
 * 1行目が数 a、2行目が b、最終行が式 e なら、a + (b-a)(row-1) で、行数は (e-a)/(b-a) + 1。
 */
function diffExpr(f: Expr, l: Expr, s: Expr | undefined): Diff | null {
  if (sameExpr(f, l)) return { expr: f };
  if (f.k === "num") {
    let step = 1n;
    if (s && s.k === "num" && s.v > f.v) step = s.v - f.v;
    const a = f.v;
    const rowExpr: Expr =
      step === 1n
        ? a === 1n
          ? { k: "row" }
          : bin("+", { k: "row" }, num(a - 1n))
        : bin("+", num(a - step), bin("*", num(step), { k: "row" }));
    let count: Expr;
    if (step === 1n) count = a === 1n ? l : bin("+", minus(l, num(a)), num(1));
    else count = bin("+", bin("/", minus(l, num(a)), num(step)), num(1));
    return { expr: rowExpr, count };
  }
  if (f.k === "ref" && l.k === "ref" && f.name === l.name && f.idx.length === l.idx.length) {
    const sr = s && s.k === "ref" ? s : undefined;
    const idx: Expr[] = [];
    let count: Expr | undefined;
    for (let i = 0; i < f.idx.length; i++) {
      const d = diffExpr(f.idx[i], l.idx[i], sr?.idx[i]);
      if (!d) return null;
      idx.push(d.expr);
      count ??= d.count;
    }
    return { expr: { ...f, idx }, count };
  }
  if (f.k === "bin" && l.k === "bin" && f.op === l.op) {
    const sb = s && s.k === "bin" ? s : undefined;
    const a = diffExpr(f.a, l.a, sb?.a);
    const b = diffExpr(f.b, l.b, sb?.b);
    if (!a || !b) return null;
    return { expr: bin(f.op, a.expr, b.expr), count: a.count ?? b.count };
  }
  return null;
}

/** 1行目・2行目・最終行から、行番号で書いた1行分の並びと行数を作る */
function buildRep(first: Item[], second: Item[] | undefined, last: Item[]): { items: Item[]; count: Expr } | null {
  const items: Item[] = [];
  let count: Expr | undefined;
  const take = (d: Diff | null): Expr | null => {
    if (!d) return null;
    count ??= d.count;
    return d.expr;
  };
  for (let p = 0; p < first.length; p++) {
    const f = first[p];
    const l = last[p];
    const s = second?.[p];
    if (f.k === "lit" || l.k === "lit") {
      items.push(f);
      continue;
    }
    if (f.k === "tok" && l.k === "tok") {
      const idx: Expr[] = [];
      for (let i = 0; i < f.ref.idx.length; i++) {
        const e = take(diffExpr(f.ref.idx[i], l.ref.idx[i], s?.k === "tok" ? s.ref.idx[i] : undefined));
        if (!e) return null;
        idx.push(e);
      }
      items.push({ k: "tok", ref: { base: f.ref.base, idx } });
      continue;
    }
    if (f.k === "list" && l.k === "list") {
      const sl = s?.k === "list" ? s : undefined;
      const idx: Expr[] = [];
      for (let i = 0; i < f.ref.idx.length; i++) {
        const e = take(diffExpr(f.ref.idx[i], l.ref.idx[i], sl?.ref.idx[i]));
        if (!e) return null;
        idx.push(e);
      }
      const from = take(diffExpr(f.from, l.from, sl?.from));
      const to = take(diffExpr(f.to, l.to, sl?.to));
      if (!from || !to) return null;
      items.push({ ...f, ref: { base: f.ref.base, idx }, from, to });
      continue;
    }
    return null;
  }
  return count ? { items, count } : null;
}

// ---- 全体 ----------------------------------------------------------------------

/** case_i / query_i のように、別の形式で中身を与える行かどうか */
function placeholderOf(items: Item[]): string | null {
  if (items.length !== 1 || items[0].k !== "tok") return null;
  const { base, idx } = items[0].ref;
  return idx.length === 1 && /^[A-Za-z]{3,}$/.test(base) ? base : null;
}

interface Line {
  raw: string;
  items: Item[];
}

function parseLines(lines: Line[], warnings: string[]): Node[] {
  const nodes: Node[] = [];
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    if (!VDOTS.test(line.raw)) {
      nodes.push({ k: "row", items: line.items });
      continue;
    }
    const last = lines[li + 1];
    if (!last) {
      warnings.push("「⋮」の次の行(最後の行)がありません");
      continue;
    }
    // 最終行と同じ形の行を、⋮ の直前から1行目までさかのぼる
    const sh = shape(last.items);
    let j = nodes.length;
    while (j > 0) {
      const n = nodes[j - 1];
      if (n.k !== "row" || shape(n.items) !== sh) break;
      j--;
    }
    if (j === nodes.length) {
      warnings.push(`「⋮」の前に「${last.raw}」と同じ形の行がありません`);
      continue;
    }
    const rows = nodes.splice(j) as { k: "row"; items: Item[] }[];
    const rep = buildRep(rows[0].items, rows[1]?.items, last.items);
    li++;
    if (!rep) {
      warnings.push(`「${last.raw}」までのくり返しの行数を読めませんでした`);
      continue;
    }
    const ph = placeholderOf(rep.items);
    if (!ph) {
      nodes.push({ k: "rep", count: rep.count, items: rep.items });
      continue;
    }
    // case_1 … case_T / query_1 … query_Q: 残りの行が中身の形式
    const rest = lines.slice(li + 1);
    if (/case|test/i.test(ph)) {
      if (rest.length === 0) warnings.push(`${ph}_i の形式(各テストケースの形式)を続けて書いてください`);
      nodes.push({ k: "cases", name: ph, count: rep.count, body: parseLines(rest, warnings) });
    } else {
      // 種類ごとの形式は「1 x」「2 y」のように先頭が種類の番号。そうでなければ1つの形式
      const alts = rest.every((l) => l.items[0]?.k === "lit" && /^\d+$/.test(l.items[0].text))
        ? rest.map((l) => l.items)
        : rest.length === 1
          ? [rest[0].items]
          : [];
      if (rest.length === 0) warnings.push(`${ph}_i の形式(クエリの形式)を続けて書いてください`);
      else if (alts.length === 0) warnings.push(`${ph}_i の形式は1行ずつ書いてください(2行以上のクエリには対応していません)`);
      nodes.push({ k: "queries", name: ph, count: rep.count, alts });
    }
    break;
  }
  return nodes;
}

/** 入力形式を読む(normalizeText を通した文字列を渡す) */
export function parseFormat(text: string): Format {
  const warnings: string[] = [];
  const lines: Line[] = [];
  for (const raw of text.split("\n")) {
    const t = raw.trim();
    // 貼り付けすぎて「出力」「入力例」まで入っていたら、そこで終わり
    if (/^(?:出力|入力例|出力例|Output|Sample)/.test(t)) break;
    if (t === "" || hasJapanese(t)) continue;
    if (VDOTS.test(t)) {
      lines.push({ raw: "⋮", items: [] });
      continue;
    }
    lines.push({ raw: t, items: lineItems(lexLine(t, warnings), warnings) });
  }
  return { nodes: parseLines(lines, warnings), warnings };
}
