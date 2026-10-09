// 読み取った形式と制約(Spec)から、ケースごとの方針(Preset)に従って入力の文字列を作る。
//
// 値は入力形式の順に決める。範囲の式が後で決まる変数を使うとき(K ≤ N で K が先に出る)は、
// その変数の取りうる範囲の端(hull)で見積もり、後の変数を決めるときに残りの制約で合わせる。
import { evalExpr, exprRefs, exprToString, isqrt } from "./expr.ts";
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

const show = (v: Val) => (typeof v === "bigint" ? v.toString() : v);

const encoder = new TextEncoder();
/** 送る大きさは UTF-8 のバイト数で数える(英数字だけなら文字数と同じ) */
function utf8Length(s: string): number {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 0x7f) return encoder.encode(s).length;
  return s.length;
}

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
  /** いま値を決めている要素の添字(P_i ≠ i の右辺の i を引く) */
  private curIdx: bigint[] | undefined;
  /** 相異なる値を順に探すときの、次に試す値(最小のケースで毎回下限から数え直さない) */
  private cursor = new Map<string, bigint>();
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
    this.bytes += utf8Length(line) + this.newline;
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
    // 1行に最低でも「1文字 × 項目数 + 空白 + 改行」は要る。収まらない行数なら、配列や辺を作る前に縮めて作り直す
    this.reserve(count * (Math.max(1, n.items.length) * 2 - 1 + this.newline));
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
      if (pair && pairSeen.size < r) this.notes.add(`(${pair.map((k) => this.spec.slots.get(k)!.label).join(", ")}) を相異なる組にできなかった行があります`);
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
    this.reserve(it.joined ? len : len * 2);
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

  /** これから少なくとも bytes バイト出す。送れる大きさを超えるなら、作り始める前に縮めて作り直す */
  private reserve(bytes: number) {
    if (this.bytes + bytes > this.maxBytes) throw new TooBig();
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
      // P_i ≠ i / 1 ≤ P_i < i の右辺の i のような添字の文字は、いま作っている要素の番号
      if (!bars && !slots.has(name) && /^[ijkl]$/.test(name)) {
        const pos = this.indexLetter(name);
        if (pos !== undefined) return pos;
      }
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

  /** 添字の文字の値。A_{i,j} なら i は1つ目・j は2つ目の添字、添字が1つならどの文字もその番号 */
  private indexLetter(name: string): bigint | undefined {
    const cur = this.curIdx;
    if (cur && cur.length > 0) return cur.length === 1 ? cur[0] : cur["ijkl".indexOf(name)];
    if (name === "j") return this.colIdx ?? this.rowIdx;
    return this.rowIdx ?? this.colIdx;
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
      const prev = this.curIdx;
      this.curIdx = iv;
      try {
        v = s ? this.value(s) : 1n;
      } finally {
        this.curIdx = prev;
      }
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
      const len = Math.max(0, lenSlot ? Number(s.elem ? this.int(lenSlot) : this.scalarInt(lenSlot)) : 1);
      this.reserve(len);
      let str = this.string(s, len);
      if (s.distinct) {
        const seen = this.seenOf(s.key);
        for (let t = 0; t < 30 && seen.has(str); t++) str = this.string(s, len, "random");
        // 乱数で見つからなければ、まだ使っていない文字列を順に数えて探す(英小文字1文字を26個 など)
        for (let c = 0; seen.has(str) && c < Math.min(100_000, (s.charset?.length ?? 1) ** Math.min(len, 8)); c++) str = this.nthString(s, len, c);
        if (seen.has(str)) this.notes.add(`${s.label} を相異なる文字列にできなかったものがあります`);
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

  /** 文字の種類を数字とみた c 番目の、長さ len の文字列(末尾から数える) */
  private nthString(s: Slot, len: number, c: number): string {
    const cs = s.charset ?? ["a"];
    const out = new Array<string>(len).fill(cs[0]);
    for (let i = len - 1; i >= 0 && c > 0; i--) {
      out[i] = cs[c % cs.length];
      c = Math.floor(c / cs.length);
    }
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

    // 偶数・奇数・≠・相異なる(まとめて作れなかったとき)をまとめて満たす
    v = this.settle(s, v, lo, hi);

    for (const c of sums) this.caseUsed.set(c.key, (this.caseUsed.get(c.key) ?? 0n) + this.sumAt(c, v));
    if (es) {
      es.left -= v;
      es.count--;
    }
    return v;
  }

  /**
   * 偶数・奇数、≠(P_i ≠ i の i も含む)、相異なるを満たす値にする。v が満たさなければ近くを、
   * それでもだめなら下限から順に探す。どうしても見つからなければ v のままにして注記を出す
   */
  private settle(s: Slot, v: bigint, lo: bigint, hi: bigint): bigint {
    const want = s.parity ? (s.parity === "odd" ? 1n : 0n) : null;
    const exact = this.env(null);
    const forbidden = s.ne.map((e) => evalExpr(e, exact)).filter((x): x is bigint => x !== undefined);
    const seen = s.distinct ? this.seenOf(s.key) : null;
    if (want === null && forbidden.length === 0 && !seen) return v;
    const parityOk = (c: bigint) => want === null || ((c % 2n) + 2n) % 2n === want;
    const ok = (c: bigint) => c >= lo && c <= hi && parityOk(c) && !forbidden.includes(c) && !seen?.has(c.toString());
    const fixParity = (c: bigint) => (parityOk(c) ? c : c + 1n <= hi ? c + 1n : c - 1n);
    let x = fixParity(v);
    if (!ok(x)) {
      let found = false;
      const step = want === null ? 1n : 2n;
      for (const c of [x + step, x - step, x + 2n * step, x - 2n * step]) {
        if (ok(c)) {
          x = c;
          found = true;
          break;
        }
      }
      for (let t = 0; !found && t < 30 && this.preset.value !== "min"; t++) {
        const c = fixParity(this.rng.big(lo, hi));
        if (ok(c)) {
          x = c;
          found = true;
        }
      }
      if (!found) {
        const from = maxB(lo, this.cursor.get(s.key) ?? lo);
        for (let c = from, k = 0; c <= hi && k < 200_000; c++, k++) {
          if (ok(c)) {
            x = c;
            found = true;
            this.cursor.set(s.key, c + 1n);
            break;
          }
        }
      }
      if (!found) this.notes.add(`${s.label} を制約(偶数・奇数・≠・相異なる)どおりにできなかった値があります`);
    }
    seen?.add(x.toString());
    return x;
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
      const at = (k: number) => {
        this.setRow(BigInt(k + 1));
        return it.ref.idx.map((e) => evalExpr(e, this.env(null)) ?? 0n);
      };
      const vec = this.vector(s, count, at);
      let arr = this.arrays.get(it.ref.base);
      if (!arr) {
        arr = new Map();
        this.arrays.set(it.ref.base, arr);
      }
      for (let r = 1; r <= count; r++) arr.set(at(r - 1).join(","), vec[r - 1]);
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
    const at = (k: number) => {
      this.setCol(from + BigInt(k) * it.step);
      return it.ref.idx.map((e) => evalExpr(e, this.env(null)) ?? 0n);
    };
    const vec = this.vector(s, len, at);
    let arr = this.arrays.get(it.ref.base);
    if (!arr) {
      arr = new Map();
      this.arrays.set(it.ref.base, arr);
    }
    for (let i = 0; i < len; i++) arr.set(at(i).join(","), vec[i]);
    this.setCol(undefined);
  }

  /**
   * 配列をまとめて作る。at(k) は k 番目(0始まり)の要素の位置に行番号・列番号を合わせ、その添字を返す
   * (P_i ≠ i のように添字を使う ≠ を確かめるのに使う)
   */
  private vector(s: Slot, len: number, at: (k: number) => bigint[]): bigint[] {
    const p = this.preset.value;
    if (s.perm) {
      const base = s.permFrom ?? 1n;
      const v = Array.from({ length: len }, (_, i) => base + BigInt(i));
      if (p === "max" || p === "desc") v.reverse();
      else if (p !== "min" && p !== "asc") this.rng.shuffle(v);
      return this.rearrange(s, v, at);
    }
    const { lo, hi } = this.range(s);
    const asc = (a: bigint[]) => a.sort(cmpB);
    // 偶数・奇数は、その偶奇の値だけを並べた列(lo2, lo2+2, …)の番号として作る(相異なる・昇順を崩さない)
    const want = s.parity ? (s.parity === "odd" ? 1n : 0n) : null;
    const lo2 = want === null ? lo : ((lo % 2n) + 2n) % 2n === want ? lo : lo + 1n;
    const step = want === null ? 1n : 2n;
    const cnt = hi < lo2 ? 0n : (hi - lo2) / step + 1n;
    const val = (t: bigint) => lo2 + t * step;
    if (s.distinct || s.sorted === "lt") {
      if (cnt >= BigInt(len)) {
        let t: bigint[];
        if (p === "min") t = Array.from({ length: len }, (_, i) => BigInt(i));
        else if (p === "max") t = Array.from({ length: len }, (_, i) => cnt - BigInt(len - i));
        else t = this.sampleDistinct(0n, p === "small" ? minB(cnt - 1n, BigInt(len * 3 + 10)) : cnt - 1n, len);
        let v = t.map(val);
        if (s.sorted || p === "asc" || p === "min" || p === "max") v = asc(v);
        else if (p === "desc") v = asc(v).reverse();
        else v = this.rng.shuffle(v);
        return this.rearrange(s, v, at);
      }
      this.notes.add(`${s.label} を相異なる値にできる範囲が足りないので、重複を許しました`);
    }
    let t: bigint[];
    const last = cnt > 0n ? cnt - 1n : 0n;
    if (p === "min") t = new Array<bigint>(len).fill(0n);
    else if (p === "max") t = new Array<bigint>(len).fill(last);
    else if (p === "same") {
      let x = this.same.get(s.key);
      if (typeof x !== "bigint") {
        x = this.rng.big(lo, hi);
        this.same.set(s.key, x);
      }
      const tx = x < lo2 ? 0n : minB(last, (x - lo2) / step);
      t = new Array<bigint>(len).fill(tx);
    } else {
      const top = p === "small" ? minB(last, 9n / step) : last;
      t = Array.from({ length: len }, () => this.rng.big(0n, top));
    }
    if (cnt === 0n) this.notes.add(`${s.label} の範囲に${s.parity === "odd" ? "奇数" : "偶数"}がありません`);
    const v = t.map(cnt === 0n ? () => lo : val);
    if (s.sorted || p === "asc") asc(v);
    else if (p === "desc") asc(v).reverse();
    // ≠ は1つずつ直す(すべて同じ値・昇順などのケースでも u_i ≠ v_i や A_i ≠ i を守る)
    if (s.ne.length > 0) {
      for (let k = 0; k < len; k++) {
        this.curIdx = at(k);
        const env = this.env(null);
        for (let r = 0; r < 2; r++) {
          if (!s.ne.some((e) => evalExpr(e, env) === v[k])) break;
          v[k] = v[k] + step <= hi ? v[k] + step : v[k] - step;
        }
        if (s.ne.some((e) => evalExpr(e, env) === v[k])) this.notes.add(`${s.label} の ≠ を守れなかった値があります`);
      }
      this.curIdx = undefined;
    }
    return v;
  }

  /**
   * 順列・相異なる値の並びで、≠(P_i ≠ i など)を破る位置があれば、値の集合は変えずに並びだけ入れ替える。
   * 破る位置どうしで値を1つずらし(恒等順列なら巡回になる)、残れば他の位置と入れ替える
   */
  private rearrange(s: Slot, v: bigint[], at: (k: number) => bigint[]): bigint[] {
    if (s.ne.length === 0 || v.length === 0) return v;
    const forbidden = (k: number): bigint[] => {
      this.curIdx = at(k);
      const env = this.env(null);
      return s.ne.map((e) => evalExpr(e, env)).filter((x): x is bigint => x !== undefined);
    };
    const fb = v.map((_, k) => forbidden(k));
    const bad = (k: number) => fb[k].includes(v[k]);
    const B: number[] = [];
    for (let k = 0; k < v.length; k++) if (bad(k)) B.push(k);
    if (B.length >= 2) {
      const first = v[B[0]];
      for (let i = 0; i + 1 < B.length; i++) v[B[i]] = v[B[i + 1]];
      v[B[B.length - 1]] = first;
    }
    let left = 0;
    for (const k of B) {
      for (let t = 0; t < 60 && bad(k); t++) {
        const j = t < 2 ? (k + 1 + t) % v.length : this.rng.int(0, v.length - 1);
        if (j === k) continue;
        [v[k], v[j]] = [v[j], v[k]];
        if (bad(k) || bad(j)) [v[k], v[j]] = [v[j], v[k]];
      }
      if (bad(k)) left++;
    }
    this.curIdx = undefined;
    if (left > 0) this.notes.add(`${s.label} の ≠ を守れなかった位置が ${left} 個あります`);
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
        // 辺が多いとき(密なグラフ)は、使わない組を乱数で選び、残りの組を全部使う。
        // 全部の組を配列にしない(頂点数が多いと組の数が膨大になる)。push(...大きな配列) も引数の数の上限で落ちる
        const skip = new Set<number>();
        const skipCount = maxE - set.size - (m - edges.length);
        while (skip.size < skipCount) {
          const x = rng.int(1, n);
          const y = rng.int(1, n);
          if (x !== y && !set.has(key(x, y))) skip.add(key(x, y));
        }
        for (let x = 1; x <= n; x++) {
          for (let y = x + 1; y <= n; y++) {
            const k = key(x, y);
            if (!set.has(k) && !skip.has(k)) edges.push([x, y]);
          }
        }
        rng.shuffle(edges);
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
  // (送るときの大きさ = UTF-8 のバイト数 + 改行ごとに newlineBytes - 1 バイト)
  if (best && best.scale < 1 && best.text.length > 0) {
    let lines = 0;
    for (let i = 0; i < best.text.length; i++) if (best.text.charCodeAt(i) === 10) lines++;
    const size = utf8Length(best.text) + lines * (newlineBytes - 1);
    const next = Math.min(failed * 0.97, best.scale * (maxBytes / size) * 0.95);
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
    bytes: utf8Length(text),
    lines,
    summary: best.g.summary(),
    shrunk: best.scale < 1,
    notes: [...best.g.notes],
  };
}
