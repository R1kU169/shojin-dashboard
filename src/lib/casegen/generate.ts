// 読み取った形式と制約(Spec)から、ケースごとの方針(Preset)に従って入力の文字列を作る。
//
// 値は入力形式の順に決める。範囲の式が後で決まる変数を使うとき(K ≤ N で K が先に出る)は、
// その変数の取りうる範囲の端(hull)で見積もり、後の変数を決めるときに残りの制約で合わせる。
import { evalExpr, exprRefs, exprToString } from "./expr.ts";
import type { EvalEnv, Expr } from "./expr.ts";
import type { Item, Node } from "./format.ts";
import type { Preset, Slot, Spec } from "./spec.ts";
import { Rng, hashSeed } from "./rng.ts";

type Val = bigint | string;

export interface GeneratedCase {
  id: string;
  label: string;
  purpose: string;
  input: string;
  bytes: number;
  lines: number;
  /** N = 200000, M = 199999 のような大きさの要約 */
  summary: string;
  /** 送れる大きさに合わせて縮めた */
  shrunk: boolean;
  notes: string[];
}

class TooBig extends Error {}

const minB = (a: bigint, b: bigint) => (a < b ? a : b);
const maxB = (a: bigint, b: bigint) => (a > b ? a : b);
const cmpB = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0);

function isqrt(v: bigint): bigint {
  if (v < 2n) return v < 0n ? 0n : v;
  let x = BigInt(Math.floor(Math.sqrt(Number(v))));
  while (x * x > v) x--;
  while ((x + 1n) * (x + 1n) <= v) x++;
  return x;
}

const show = (v: Val) => (typeof v === "bigint" ? v.toString() : v);

class Gen {
  private spec: Spec;
  private preset: Preset;
  private rng: Rng;
  private scale: number;
  private maxBytes: number;
  /** 改行1つを何バイトと数えるか(Wandbox には JSON で送るので \n の2文字になる) */
  private newline: number;
  private out: string[] = [];
  private bytes = 0;
  private scalars = new Map<string, Val>();
  private arrays = new Map<string, Map<string, Val>>();
  /** 今の行で決まった要素(K_i のような添字の文字の参照を引く) */
  private row = new Map<string, Val>();
  private rowIdx: bigint | undefined;
  private colIdx: bigint | undefined;
  private same = new Map<string, Val>();
  private caseUsed = new Map<string, bigint>();
  private casesLeft = 1;
  private multi: "min" | "small" | "one" | "many" | null = null;
  private elemSum = new Map<string, { left: bigint; count: number }>();
  private seen = new Map<string, Set<string>>();
  /** P_x / t_q のような名前つき添字のスカラーの、添字を除いた名前 */
  private suffixBases = new Set<string>();
  private productsOf = new Map<string, Spec["products"]>();
  private sumsOf = new Map<string, Spec["caseSums"]>();
  notes = new Set<string>();

  constructor(spec: Spec, preset: Preset, rng: Rng, scale: number, maxBytes: number, newline: number) {
    this.spec = spec;
    this.preset = preset;
    this.rng = rng;
    this.scale = scale;
    this.maxBytes = maxBytes;
    this.newline = newline;
    for (const s of spec.slots.values()) {
      const m = /^([A-Za-z][A-Za-z0-9']*)_/.exec(s.key);
      if (!s.elem && m) this.suffixBases.add(m[1]);
    }
    for (const p of spec.products) for (const k of p.keys) this.productsOf.set(k, [...(this.productsOf.get(k) ?? []), p]);
    for (const c of spec.caseSums) this.sumsOf.set(c.key, [...(this.sumsOf.get(c.key) ?? []), c]);
  }

  run(): string {
    this.emitNodes(this.spec.format.nodes);
    return this.out.length ? `${this.out.join("\n")}\n` : "";
  }

  summary(): string {
    const parts: string[] = [];
    for (const s of this.spec.slots.values()) {
      if (s.scope !== "top" || s.elem || !(s.size || s.key === this.spec.caseCount)) continue;
      const v = this.scalars.get(s.key);
      if (typeof v === "bigint") parts.push(`${s.label} = ${v}`);
    }
    for (const [key, used] of this.caseUsed) parts.push(`Σ${this.spec.slots.get(key)?.label ?? key} = ${used}`);
    return parts.slice(0, 5).join(", ");
  }

  // ---- 出力 ----

  private push(line: string) {
    this.bytes += line.length + this.newline;
    if (this.bytes > this.maxBytes) throw new TooBig();
    this.out.push(line);
  }

  private emitNodes(nodes: Node[]) {
    for (const n of nodes) {
      if (n.k === "row") {
        this.row.clear();
        this.push(this.emitItems(n.items));
      } else if (n.k === "rep") this.emitRep(n);
      else if (n.k === "cases") this.emitCases(n);
      else this.emitQueries(n);
    }
  }

  private emitItems(items: Item[]): string {
    const parts: string[] = [];
    for (const it of items) {
      if (it.k === "lit") parts.push(it.text);
      else if (it.k === "tok") parts.push(show(this.tok(it.ref.base, it.ref.idx)));
      else parts.push(this.emitList(it));
    }
    return parts.join(" ");
  }

  private tok(base: string, idx: Expr[]): Val {
    if (idx.length === 0) return this.scalar(base);
    const env = this.env(null);
    const iv = idx.map((e) => evalExpr(e, env) ?? 0n);
    return this.elem(base, iv);
  }

  private count(e: Expr): number {
    const v = evalExpr(e, this.env(null));
    if (v === undefined) {
      this.notes.add(`「${exprToString(e)}」の値が決まらないので 0 にしました`);
      return 0;
    }
    return v < 0n ? 0 : Number(v);
  }

  private emitRep(n: Node & { k: "rep" }) {
    const count = this.count(n.count);
    const g = this.spec.graph;
    if (g && g.node === n) this.placeEdges(n, count);
    this.prepare(n.items, count);
    // (L_i, R_i) は相異なる: 同じ組が出たら作り直す
    const pair = this.spec.pairDistinct.find(
      (p) => !(g && g.node === n) && p.every((k) => n.items.some((it) => it.k === "tok" && `${it.ref.base}[]` === k)),
    );
    const pairSeen = new Set<string>();
    for (let r = 1; r <= count; r++) {
      this.setRow(BigInt(r));
      let line = "";
      for (let t = 0; t < 30; t++) {
        this.row.clear();
        line = this.emitItems(n.items);
        if (!pair) break;
        const key = pair.map((k) => show(this.row.get(this.spec.slots.get(k)!.name) ?? "")).join(" ");
        if (!pairSeen.has(key)) {
          pairSeen.add(key);
          break;
        }
        // 作り直すため、この行の要素を消す
        for (const k of pair) {
          const name = this.spec.slots.get(k)!.name;
          const it = n.items.find((x) => x.k === "tok" && x.ref.base === name) as Item & { k: "tok" };
          const env = this.env(null);
          this.arrays.get(name)?.delete(it.ref.idx.map((e) => evalExpr(e, env) ?? 0n).join(","));
        }
      }
      this.push(line);
    }
    this.setRow(undefined);
  }

  private emitList(it: Item & { k: "list" }): string {
    const env = this.env(null);
    const from = evalExpr(it.from, env);
    const to = evalExpr(it.to, env);
    if (from === undefined || to === undefined) {
      this.notes.add(`「${it.ref.base}」の並びの長さが決まりませんでした`);
      return "";
    }
    const len = to < from ? 0 : Number((to - from) / it.step) + 1;
    const g = this.spec.graph;
    if (g && g.parentList === it) this.placeParents(it, from, to);
    this.prepareList(it, from, len);
    const parts: string[] = [];
    let size = this.bytes;
    for (let c = from, i = 0; i < len; c += it.step, i++) {
      this.setCol(c);
      const iv = it.ref.idx.map((e) => evalExpr(e, this.env(null)) ?? 0n);
      const s = show(this.elem(it.ref.base, iv));
      size += s.length + 1;
      if (size > this.maxBytes) throw new TooBig();
      parts.push(s);
    }
    this.setCol(undefined);
    return parts.join(it.joined ? "" : " ");
  }

  private emitCases(n: Node & { k: "cases" }) {
    const T = this.count(n.count);
    this.casesLeft = T;
    for (let c = 0; c < T; c++) {
      this.clearScope("case");
      this.emitNodes(n.body);
      this.casesLeft--;
    }
  }

  private emitQueries(n: Node & { k: "queries" }) {
    const Q = this.count(n.count);
    const k = n.alts.length;
    if (k === 0) {
      this.notes.add(`${n.name} の形式が分からないので、クエリの行は出していません`);
      return;
    }
    for (let q = 1; q <= Q; q++) {
      // どの種類も1回は出す(最後のクエリは最後の種類: 答えを出すクエリのことが多い)
      const a = q === Q ? k - 1 : q < k ? q - 1 : this.rng.int(0, k - 1);
      this.clearScope("query");
      this.row.clear();
      this.push(this.emitItems(n.alts[a]));
    }
  }

  private clearScope(scope: Slot["scope"]) {
    for (const s of this.spec.slots.values()) {
      if (s.scope !== scope) continue;
      this.scalars.delete(s.key);
      this.arrays.delete(s.name);
      this.elemSum.delete(s.key);
      this.seen.delete(s.key);
    }
  }

  // ---- 値の参照 ----

  private envs: Record<"lo" | "hi" | "exact", EvalEnv> | null = null;

  /** 式の評価で変数を引く口(1要素ごとに作り直さない。行番号・列番号は setRow / setCol で入れる) */
  private env(dir: "lo" | "hi" | null): EvalEnv {
    if (!this.envs) {
      const make = (d: "lo" | "hi" | null): EvalEnv => ({
        row: this.rowIdx,
        col: this.colIdx,
        get: (name, idx, bars, ref) => this.lookup(name, idx, bars, ref, d),
      });
      this.envs = { lo: make("lo"), hi: make("hi"), exact: make(null) };
    }
    return this.envs[dir ?? "exact"];
  }

  private setRow(r: bigint | undefined) {
    this.rowIdx = r;
    if (this.envs) for (const e of Object.values(this.envs)) e.row = r;
  }

  private setCol(c: bigint | undefined) {
    this.colIdx = c;
    if (this.envs) for (const e of Object.values(this.envs)) e.col = c;
  }

  private lookup(name: string, idx: (bigint | undefined)[], bars: boolean, ref: Expr & { k: "ref" }, dir: "lo" | "hi" | null): bigint | undefined {
    const slots = this.spec.slots;
    const asNum = (v: Val | undefined): bigint | undefined =>
      v === undefined ? undefined : typeof v === "bigint" ? (bars ? undefined : v) : bars ? BigInt(v.length) : undefined;
    if (idx.length === 0) {
      const v = this.scalars.get(name);
      if (v !== undefined) return asNum(v);
      return dir ? this.estimate(bars ? `|${name}|` : name, dir) : undefined;
    }
    if (this.suffixBases.has(name)) {
      const sname = `${name}_${ref.idx.map((x) => exprToString(x)).join(",")}`;
      if (slots.has(sname)) {
        const v = this.scalars.get(sname);
        if (v !== undefined) return asNum(v);
        return dir ? this.estimate(bars ? `|${sname}|` : sname, dir) : undefined;
      }
    }
    const v = idx.every((x) => x !== undefined) ? this.arrays.get(name)?.get(idx.join(",")) : this.row.get(name);
    if (v !== undefined) return asNum(v);
    return dir ? this.estimate(bars ? `|${name}[]|` : `${name}[]`, dir) : undefined;
  }

  private depth = 0;

  /**
   * まだ決まっていない変数の範囲の端。今わかっている値で範囲の式を評価する
   * (u_i < v_i ≤ N の u を決めるとき、v の上限は全体の上限ではなく今の N - 1)
   */
  private estimate(key: string, dir: "lo" | "hi"): bigint | undefined {
    const s = this.spec.slots.get(key);
    if (!s) return undefined;
    if (this.depth >= 3) return s.hull[dir] ?? undefined;
    this.depth++;
    try {
      return this.range(s)[dir];
    } finally {
      this.depth--;
    }
  }

  /** 制約の式から、今の時点の範囲を出す(まだ決まっていない変数は取りうる範囲の端で見積もる) */
  private range(s: Slot): { lo: bigint; hi: bigint } {
    let lo: bigint | null = null;
    let hi: bigint | null = null;
    const le = this.env("lo");
    const he = this.env("hi");
    for (const e of s.lo) {
      const v = evalExpr(e, le);
      if (v !== undefined) lo = lo === null ? v : maxB(lo, v);
    }
    for (const e of s.hi) {
      const v = evalExpr(e, he);
      if (v !== undefined) hi = hi === null ? v : minB(hi, v);
    }
    return { lo: lo ?? s.hull.lo ?? 1n, hi: hi ?? s.hull.hi ?? lo ?? s.hull.lo ?? 1n };
  }

  private scaled(lo: bigint, hi: bigint): bigint {
    if (this.scale >= 1 || hi <= lo) return hi;
    return lo + BigInt(Math.floor(Number(hi - lo) * this.scale));
  }

  private scaleTotal(v: bigint): bigint {
    return this.scale >= 1 ? v : BigInt(Math.floor(Number(v) * this.scale));
  }

  // ---- 値を決める ----

  private scalar(name: string): Val {
    const got = this.scalars.get(name);
    if (got !== undefined) return got;
    const s = this.spec.slots.get(name);
    let v: Val;
    if (!s) v = 1n;
    else if (name === this.spec.caseCount) v = this.caseCount(s);
    else v = this.value(s);
    this.scalars.set(name, v);
    return v;
  }

  private elem(base: string, iv: bigint[]): Val {
    let arr = this.arrays.get(base);
    if (!arr) {
      arr = new Map();
      this.arrays.set(base, arr);
    }
    const key = iv.join(",");
    let v = arr.get(key);
    if (v === undefined) {
      const s = this.spec.slots.get(`${base}[]`);
      v = s ? this.value(s) : 1n;
      arr.set(key, v);
    }
    this.row.set(base, v);
    return v;
  }

  /** 文字列なら長さを決めてから作る */
  private value(s: Slot): Val {
    if (s.choices) return this.choose(s);
    if (s.type === "char") return this.char(s);
    if (s.type === "str") {
      const lenSlot = this.spec.slots.get(`|${s.key}|`);
      const len = lenSlot ? Number(s.elem ? this.int(lenSlot) : this.scalarInt(lenSlot)) : 1;
      let str = this.string(s, Math.max(0, len));
      if (s.distinct) {
        const seen = this.seenOf(s.key);
        for (let t = 0; t < 30 && seen.has(str); t++) str = this.string(s, len, "random");
        seen.add(str);
      }
      return str;
    }
    return this.int(s);
  }

  private scalarInt(s: Slot): bigint {
    const v = this.scalars.get(s.key);
    if (typeof v === "bigint") return v;
    const x = this.int(s);
    this.scalars.set(s.key, x);
    return x;
  }

  private seenOf(key: string): Set<string> {
    let s = this.seen.get(key);
    if (!s) {
      s = new Set();
      this.seen.set(key, s);
    }
    return s;
  }

  private choose(s: Slot): Val {
    const cs = s.choices!;
    const p = this.preset.value;
    const c = p === "min" ? cs[0] : p === "max" ? cs[cs.length - 1] : this.rng.pick(cs);
    return s.type === "int" && /^-?\d+$/.test(c) ? BigInt(c) : c;
  }

  private strMode(): "first" | "last" | "alt" | "random" | "small" {
    if (this.preset.str) return this.preset.str;
    const p = this.preset.value;
    return p === "min" ? "first" : p === "max" ? "last" : p === "small" ? "small" : "random";
  }

  private string(s: Slot, len: number, force?: "random"): string {
    const cs = s.charset ?? ["a"];
    const mode = force ?? this.strMode();
    if (mode === "first") return cs[0].repeat(len);
    if (mode === "last") return cs[cs.length - 1].repeat(len);
    if (mode === "alt") {
      const two = cs.length >= 2 ? cs[0] + cs[1] : cs[0];
      return two.repeat(Math.ceil(len / two.length)).slice(0, len);
    }
    const pool = mode === "small" ? cs.slice(0, 3) : cs;
    const out = new Array<string>(len);
    for (let i = 0; i < len; i++) out[i] = pool[Math.floor(this.rng.next() * pool.length)];
    return out.join("");
  }

  private char(s: Slot): string {
    const cs = s.charset ?? ["a"];
    const mode = this.strMode();
    if (mode === "first") return cs[0];
    if (mode === "last") return cs[cs.length - 1];
    if (mode === "alt") return cs[Number(((this.rowIdx ?? 0n) + (this.colIdx ?? 0n)) % 2n) % cs.length];
    const pool = mode === "small" ? cs.slice(0, 3) : cs;
    return pool[Math.floor(this.rng.next() * pool.length)];
  }

  /** そのケースの方針で、大きさの変数をどう決めるか */
  private sizePolicy(s: Slot): "min" | "small" | "max" {
    if (s.scope === "case" && this.multi === "many" && !this.spec.caseSums.length) return "small";
    return this.preset.size;
  }

  private caseCount(s: Slot): bigint {
    const innerSize = [...this.spec.slots.values()].some((x) => x.scope === "case" && x.size);
    const mode = (this.multi = this.preset.multi ?? (innerSize ? "one" : "many"));
    const { lo, hi } = this.range(s);
    if (mode === "min" || mode === "one") return lo;
    if (mode === "small") return this.rng.big(lo, minB(hi, lo + 3n));
    let t = this.scaled(lo, hi);
    for (const c of this.spec.caseSums) {
      const total = this.scaleTotal(evalExpr(c.hi, this.env("hi")) ?? 0n);
      const unitSlot = this.spec.slots.get(c.key);
      const unit = this.sumAt(c, unitSlot?.hull.lo ?? 1n);
      if (unit > 0n) t = minB(t, total / unit);
    }
    return maxB(t, lo);
  }

  /** 総和の式(N や N^2 や |S|)を、その変数が x のときの値にする */
  private sumAt(c: Spec["caseSums"][number], x: bigint): bigint {
    if (c.expr.k === "ref" && c.expr.idx.length === 0) return x;
    const env = this.env("lo");
    return (
      evalExpr(c.expr, {
        ...env,
        get: (name, idx, bars, ref) => (name === c.name ? x : env.get(name, idx, bars, ref)),
      }) ?? x
    );
  }

  private int(s: Slot): bigint {
    let { lo, hi } = this.range(s);
    let forced: bigint | null = null;
    const sp = this.sizePolicy(s);
    const isSize = s.size;

    // 積の上限(H × W ≤ 10^6)
    for (const p of this.productsOf.get(s.key) ?? []) {
      let V = evalExpr(p.hi, this.env("hi"));
      if (V === undefined) continue;
      if (sp === "max") V = maxB(1n, this.scaleTotal(V));
      let decided = 1n;
      let undecidedLo = 1n;
      let undecided = 0;
      for (const k of p.keys) {
        if (k === s.key) continue;
        const v = this.scalars.get(k);
        if (typeof v === "bigint") decided *= maxB(v, 1n);
        else {
          undecided++;
          undecidedLo *= maxB(this.spec.slots.get(k)?.hull.lo ?? 1n, 1n);
        }
      }
      hi = minB(hi, V / (decided * undecidedLo));
      if (sp === "max" && undecided > 0 && p.keys[0] === s.key) {
        const shape = this.preset.shape ?? "square";
        if (shape === "wide") forced = lo;
        else if (shape === "square") forced = minB(hi, maxB(lo, isqrt(V / decided)));
      }
    }

    // マルチテストの総和(全てのテストケースにおける N の総和は … 以下)
    const sums = this.sumsOf.get(s.key) ?? [];
    for (const c of sums) {
      const total = sp === "max" || this.multi === "many" ? this.scaleTotal(evalExpr(c.hi, this.env("hi")) ?? 0n) : (evalExpr(c.hi, this.env("hi")) ?? 0n);
      const left = total - (this.caseUsed.get(c.key) ?? 0n);
      const casesLeft = BigInt(Math.max(1, this.casesLeft));
      const allow = this.multi === "many" ? left / casesLeft : left - (casesLeft - 1n) * this.sumAt(c, lo);
      if (this.sumAt(c, lo) > allow) {
        hi = lo;
        continue;
      }
      // N の総和なら N ≤ allow。N^2 の総和のような式だけ二分探索する
      if (c.expr.k === "ref" && c.expr.idx.length === 0) {
        hi = minB(hi, allow);
        continue;
      }
      let a = lo;
      let b = hi;
      while (a < b) {
        const m = (a + b + 1n) / 2n;
        if (this.sumAt(c, m) <= allow) a = m;
        else b = m - 1n;
      }
      hi = a;
    }

    // 配列の要素の和(D_1 + … + D_N ≤ 10^6)
    const es = this.elemSum.get(s.key);
    if (es) {
      const cnt = BigInt(Math.max(1, es.count));
      hi = minB(hi, es.left - (cnt - 1n) * lo);
      if (sp === "max" || this.preset.value !== "min") hi = maxB(lo, minB(hi, es.left / cnt));
    }

    if (hi < lo) {
      this.notes.add(`${s.label} の範囲が空になったので下限を使いました`);
      hi = lo;
    }

    let v: bigint;
    if (forced !== null) v = forced;
    else if (isSize) {
      v = sp === "min" ? lo : sp === "small" ? this.rng.big(lo, minB(hi, lo + 4n)) : this.scaled(lo, hi);
    } else {
      const p = this.preset.value;
      if (p === "min") v = lo;
      else if (p === "max") v = hi;
      else if (p === "small") v = this.rng.big(lo, minB(hi, lo + 9n));
      else if (p === "same") {
        let x = this.same.get(s.key);
        if (typeof x !== "bigint") {
          x = this.rng.big(lo, hi);
          this.same.set(s.key, x);
        }
        v = minB(hi, maxB(lo, x));
      } else v = this.rng.big(lo, hi);
    }

    // 相異なる(まとめて作れなかったとき)
    if (s.distinct) {
      const seen = this.seenOf(s.key);
      for (let t = 0; t < 30 && seen.has(v.toString()); t++) {
        v = this.preset.value === "min" ? minB(hi, lo + BigInt(seen.size + t)) : this.rng.big(lo, hi);
      }
      seen.add(v.toString());
    }
    // 偶数・奇数
    if (s.parity) {
      const want = s.parity === "odd" ? 1n : 0n;
      if (((v % 2n) + 2n) % 2n !== want) v = v + 1n <= hi ? v + 1n : v - 1n;
    }
    // ≠
    const exact = this.env(null);
    for (const e of s.ne) {
      const x = evalExpr(e, exact);
      if (x !== undefined && x === v) v = v + 1n <= hi ? v + 1n : v - 1n;
    }

    for (const c of sums) this.caseUsed.set(c.key, (this.caseUsed.get(c.key) ?? 0n) + this.sumAt(c, v));
    if (es) {
      es.left -= v;
      es.count--;
    }
    return v;
  }

  // ---- 配列をまとめて作る(順列・相異なる・昇順など) ----

  /** 範囲の式が行の中の他の要素を使わないか(使うなら1つずつ作る) */
  private independent(s: Slot): boolean {
    for (const e of [...s.lo, ...s.hi]) {
      for (const n of exprRefs(e)) {
        const sc = this.spec.slots.get(n);
        if (!sc || sc.elem) return false;
      }
    }
    return true;
  }

  private vectorizable(s: Slot): boolean {
    if (s.type !== "int" || s.choices || s.size) return false;
    // 要素の和に上限があるものは、1つずつ残りの和を見ながら作る
    if (this.spec.elemSums.some((x) => x.key === s.key)) return false;
    if (s.perm) return true;
    if (!this.independent(s)) return false;
    return !!(s.distinct || s.sorted || ["same", "asc", "desc"].includes(this.preset.value));
  }

  /** 縦のくり返しの列で、まとめて作る配列を先に作っておく */
  private prepare(items: Item[], count: number) {
    for (const it of items) {
      const key = it.k === "lit" ? null : `${it.ref.base}[]`;
      const s = key ? this.spec.slots.get(key) : undefined;
      if (!s) continue;
      // 和の制約のある配列は、要素の数で均等に分ける
      for (const k of [s.key, `|${s.key}|`]) {
        const sum = this.spec.elemSums.find((x) => x.key === k);
        if (sum && !this.elemSum.has(k)) {
          const total = evalExpr(sum.hi, this.env("hi"));
          if (total !== undefined) this.elemSum.set(k, { left: this.preset.size === "max" ? this.scaleTotal(total) : total, count });
        }
      }
      if (it.k !== "tok" || !this.vectorizable(s)) continue;
      const g = this.spec.graph;
      if (g && (g.u === s.key || g.v === s.key)) continue;
      const vec = this.vector(s, count);
      let arr = this.arrays.get(it.ref.base);
      if (!arr) {
        arr = new Map();
        this.arrays.set(it.ref.base, arr);
      }
      for (let r = 1; r <= count; r++) {
        this.setRow(BigInt(r));
        const iv = it.ref.idx.map((e) => evalExpr(e, this.env(null)) ?? 0n);
        arr.set(iv.join(","), vec[r - 1]);
      }
      this.setRow(undefined);
    }
  }

  private prepareList(it: Item & { k: "list" }, from: bigint, len: number) {
    const s = this.spec.slots.get(`${it.ref.base}[]`);
    if (!s) return;
    for (const k of [s.key, `|${s.key}|`]) {
      const sum = this.spec.elemSums.find((x) => x.key === k);
      if (sum && !this.elemSum.has(k)) {
        const total = evalExpr(sum.hi, this.env("hi"));
        if (total !== undefined) this.elemSum.set(k, { left: this.preset.size === "max" ? this.scaleTotal(total) : total, count: len });
      }
    }
    const g = this.spec.graph;
    if (g && g.parentList === it) return;
    if (!this.vectorizable(s)) return;
    const vec = this.vector(s, len);
    let arr = this.arrays.get(it.ref.base);
    if (!arr) {
      arr = new Map();
      this.arrays.set(it.ref.base, arr);
    }
    for (let i = 0; i < len; i++) {
      this.setCol(from + BigInt(i) * it.step);
      const iv = it.ref.idx.map((e) => evalExpr(e, this.env(null)) ?? 0n);
      arr.set(iv.join(","), vec[i]);
    }
    this.setCol(undefined);
  }

  private vector(s: Slot, len: number): bigint[] {
    const p = this.preset.value;
    if (s.perm) {
      const v = Array.from({ length: len }, (_, i) => BigInt(i + 1));
      if (p === "max" || p === "desc") v.reverse();
      else if (p !== "min" && p !== "asc") this.rng.shuffle(v);
      return v;
    }
    const { lo, hi } = this.range(s);
    const asc = (a: bigint[]) => a.sort(cmpB);
    if (s.distinct || s.sorted === "lt") {
      const span = hi - lo + 1n;
      if (span >= BigInt(len)) {
        let v: bigint[];
        if (p === "min") v = Array.from({ length: len }, (_, i) => lo + BigInt(i));
        else if (p === "max") v = Array.from({ length: len }, (_, i) => hi - BigInt(len - 1 - i));
        else v = this.sampleDistinct(lo, p === "small" ? minB(hi, lo + BigInt(len * 3 + 10)) : hi, len);
        if (s.sorted || p === "asc" || p === "min" || p === "max") return asc(v);
        if (p === "desc") return asc(v).reverse();
        return this.rng.shuffle(v);
      }
      this.notes.add(`${s.label} を相異なる値にできる範囲が足りないので、重複を許しました`);
    }
    let v: bigint[];
    if (p === "min") v = new Array<bigint>(len).fill(lo);
    else if (p === "max") v = new Array<bigint>(len).fill(hi);
    else if (p === "same") {
      let x = this.same.get(s.key);
      if (typeof x !== "bigint") {
        x = this.rng.big(lo, hi);
        this.same.set(s.key, x);
      }
      v = new Array<bigint>(len).fill(x);
    } else {
      const top = p === "small" ? minB(hi, lo + 9n) : hi;
      v = Array.from({ length: len }, () => this.rng.big(lo, top));
    }
    if (s.sorted || p === "asc") asc(v);
    else if (p === "desc") asc(v).reverse();
    return v;
  }

  private sampleDistinct(lo: bigint, hi: bigint, k: number): bigint[] {
    const span = hi - lo + 1n;
    if (span <= BigInt(4 * k + 16)) {
      const all = Array.from({ length: Number(span) }, (_, i) => lo + BigInt(i));
      return this.rng.shuffle(all).slice(0, k);
    }
    const seen = new Set<string>();
    const out: bigint[] = [];
    while (out.length < k) {
      const x = this.rng.big(lo, hi);
      const key = x.toString();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(x);
    }
    return out;
  }

  // ---- グラフ ----

  private placeEdges(n: Node & { k: "rep" }, count: number) {
    const g = this.spec.graph!;
    const V = Number(this.scalar(g.n));
    const edges = this.edges(V, count);
    const [a, b] = n.items as (Item & { k: "tok" })[];
    const ua = this.arrays.get(a.ref.base) ?? new Map<string, Val>();
    const vb = this.arrays.get(b.ref.base) ?? new Map<string, Val>();
    this.arrays.set(a.ref.base, ua);
    this.arrays.set(b.ref.base, vb);
    for (let r = 1; r <= count; r++) {
      this.setRow(BigInt(r));
      const env = this.env(null);
      const [x, y] = edges[r - 1] ?? [1, 1];
      ua.set(a.ref.idx.map((e) => evalExpr(e, env) ?? 0n).join(","), BigInt(x));
      vb.set(b.ref.idx.map((e) => evalExpr(e, env) ?? 0n).join(","), BigInt(y));
    }
    this.setRow(undefined);
  }

  private edges(n: number, count: number): [number, number][] {
    const g = this.spec.graph!;
    const pol = this.preset.graph ?? "random";
    const rng = this.rng;
    if (n < 2) return [];
    const tree = (): [number, number][] => {
      const e: [number, number][] = [];
      if (pol === "path") for (let i = 1; i < n; i++) e.push([i, i + 1]);
      else if (pol === "star") for (let i = 2; i <= n; i++) e.push([1, i]);
      else {
        const label = rng.shuffle(Array.from({ length: n }, (_, i) => i + 1));
        for (let i = 2; i <= n; i++) e.push([label[rng.int(1, i - 1) - 1], label[i - 1]]);
        rng.shuffle(e);
      }
      return e;
    };
    let edges: [number, number][];
    if (g.tree && count === n - 1) edges = tree();
    else {
      const maxE = (n * (n - 1)) / 2;
      const m = Math.min(count, maxE);
      const key = (x: number, y: number) => (x < y ? x * (n + 1) + y : y * (n + 1) + x);
      const set = new Set<number>();
      edges = [];
      if ((g.connected || pol !== "random") && m >= n - 1) {
        for (const e of tree()) {
          edges.push(e);
          set.add(key(e[0], e[1]));
        }
      }
      if (m - edges.length > maxE / 2) {
        const rest: [number, number][] = [];
        for (let x = 1; x <= n; x++) for (let y = x + 1; y <= n; y++) if (!set.has(key(x, y))) rest.push([x, y]);
        rng.shuffle(rest);
        edges.push(...rest.slice(0, m - edges.length));
      } else {
        while (edges.length < m) {
          const x = rng.int(1, n);
          const y = rng.int(1, n);
          if (x === y || set.has(key(x, y))) continue;
          set.add(key(x, y));
          edges.push([x, y]);
        }
      }
      if (pol === "random") rng.shuffle(edges);
      while (edges.length < count) {
        // 単純グラフに収まらない本数: 重複を許して足す
        this.notes.add("辺の本数が単純グラフの上限を超えるので、重複する辺を含めました");
        const x = rng.int(1, n);
        let y = rng.int(1, n - 1);
        if (y >= x) y++;
        edges.push([x, y]);
      }
    }
    return edges.map(([x, y]) => (g.ordered ? (x < y ? [x, y] : [y, x]) : pol === "random" && rng.next() < 0.5 ? [y, x] : [x, y]));
  }

  private placeParents(it: Item & { k: "list" }, from: bigint, to: bigint) {
    const pol = this.preset.graph ?? "random";
    let arr = this.arrays.get(it.ref.base);
    if (!arr) {
      arr = new Map();
      this.arrays.set(it.ref.base, arr);
    }
    for (let c = from; c <= to; c += it.step) {
      this.setCol(c);
      const iv = it.ref.idx.map((e) => evalExpr(e, this.env(null)) ?? 0n);
      const p = pol === "path" ? c - 1n : pol === "star" ? 1n : BigInt(this.rng.int(1, Number(c) - 1));
      arr.set(iv.join(","), p);
    }
    this.setCol(undefined);
  }
}

/**
 * 1つのケースを作る。maxBytes を超えるときは、大きさの上限を縮めて作り直す(shrunk になる)。
 * newlineBytes は改行1つの数え方(JSON で送るなら2)。seedText が同じなら同じ入力になる。
 */
export function generateCase(spec: Spec, preset: Preset, seedText: string, maxBytes: number, newlineBytes = 1): GeneratedCase {
  const seed = hashSeed(`${seedText}\n${preset.id}`);
  const attempt = (scale: number) => {
    const g = new Gen(spec, preset, new Rng(seed), scale, maxBytes, newlineBytes);
    try {
      return { text: g.run(), g, scale };
    } catch (e) {
      if (e instanceof TooBig) return null;
      throw e;
    }
  };
  let scale = 1;
  let failed = Infinity;
  let best = attempt(scale);
  while (!best && scale > 1e-7) {
    failed = scale;
    scale /= 2;
    best = attempt(scale);
  }
  // 半分ずつ縮めると小さくなりすぎるので、大きさの比で1回だけ戻す
  if (best && best.scale < 1 && best.text.length > 0) {
    const next = Math.min(failed * 0.97, best.scale * (maxBytes / (best.text.length * newlineBytes)) * 0.95);
    if (next > best.scale * 1.1) best = attempt(next) ?? best;
  }
  if (!best) {
    return {
      id: preset.id,
      label: preset.label,
      purpose: preset.purpose,
      input: "",
      bytes: 0,
      lines: 0,
      summary: "",
      shrunk: true,
      notes: ["送れる大きさに収まるケースを作れませんでした"],
    };
  }
  const text = best.text;
  let lines = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lines++;
  return {
    id: preset.id,
    label: preset.label,
    purpose: preset.purpose,
    input: text,
    bytes: text.length,
    lines,
    summary: best.g.summary(),
    shrunk: best.scale < 1,
    notes: [...best.g.notes],
  };
}
