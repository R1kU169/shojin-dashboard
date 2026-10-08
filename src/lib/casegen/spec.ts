// 入力形式と制約を突き合わせ、変数ごとの「範囲・種類・性質」と、作るケースの一覧をまとめる。
import { bin, evalExpr, exprRefs, exprToString, num, parseExpr } from "./expr.ts";
import type { EvalEnv, Expr } from "./expr.ts";
import { parseFormat } from "./format.ts";
import type { Format, Item, Node } from "./format.ts";
import { parseConstraints } from "./constraints.ts";
import type { CRef, Fact } from "./constraints.ts";
import { normalizeText } from "./tex.ts";

export type SlotType = "int" | "str" | "char";

/**
 * 値を決める単位。スカラーは "N"、配列の要素は "A[]"、文字列の長さは "|S|" / "|S[]|"。
 * 範囲は式のまま持ち(1 ≤ A_i ≤ N の N は生成するときに決まった値を入れる)、hull は式の値の取りうる範囲。
 */
export interface Slot {
  key: string;
  /** 表に出す名前(N / A_i / |S|) */
  label: string;
  /** 入力形式での名前(配列なら添字を除いた名前) */
  name: string;
  elem: boolean;
  type: SlotType;
  lo: Expr[];
  hi: Expr[];
  ne: Expr[];
  choices?: string[];
  charset?: string[];
  parity?: "even" | "odd";
  perm?: boolean;
  distinct?: boolean;
  sorted?: "le" | "lt";
  /** 行数・個数・長さに使う(最大のケースで最大にする) */
  size: boolean;
  scope: "top" | "case" | "query";
  hull: { lo: bigint | null; hi: bigint | null };
  /** 制約から範囲が分からず仮に決めたもの */
  assumed?: boolean;
  /** 空白なしでつなぐ横の並び(グリッドの1行)に出てくる */
  joined?: boolean;
}

export interface GraphPlan {
  /** 辺を並べる縦のくり返し(無ければ親の並び P_2 … P_N) */
  node: Node | null;
  parentList: Item | null;
  u?: string;
  v?: string;
  /** 頂点数の変数 */
  n: string;
  tree: boolean;
  simple: boolean;
  connected: boolean;
  /** u_i < v_i */
  ordered: boolean;
}

export interface Preset {
  id: string;
  label: string;
  purpose: string;
  size: "min" | "small" | "max";
  value: "min" | "max" | "random" | "small" | "same" | "asc" | "desc";
  graph?: "random" | "path" | "star";
  str?: "random" | "first" | "last" | "alt";
  /** 積の上限(H×W ≤ …)の形 */
  shape?: "square" | "wide" | "tall";
  /** マルチテストのケース数 T の決め方(1ケースを大きく / たくさん) */
  multi?: "min" | "small" | "one" | "many";
}

export interface Spec {
  format: Format;
  slots: Map<string, Slot>;
  products: { keys: string[]; hi: Expr }[];
  caseSums: { key: string; name: string; expr: Expr; hi: Expr }[];
  elemSums: { key: string; hi: Expr }[];
  pairDistinct: string[][];
  graph: GraphPlan | null;
  caseCount: string | null;
  warnings: string[];
  unread: string[];
  presets: Preset[];
}

/** 範囲の手直し(表の入力欄)。式の文字列で、空なら制約のまま */
export type Overrides = Record<string, { lo?: string; hi?: string }>;

const ten9 = 10n ** 9n;

// ---- 入力形式から変数を集める ------------------------------------------------------

function newSlot(key: string, label: string, name: string, elem: boolean, scope: Slot["scope"]): Slot {
  return { key, label, name, elem, type: "int", lo: [], hi: [], ne: [], size: false, scope, hull: { lo: null, hi: null } };
}

function collectSlots(f: Format): { slots: Map<string, Slot>; caseCount: string | null } {
  const slots = new Map<string, Slot>();
  let caseCount: string | null = null;
  const sizeNames = new Set<string>();
  const sizeExpr = (e: Expr) => {
    for (const n of exprRefs(e)) sizeNames.add(n);
  };
  const addItem = (it: Item, scope: Slot["scope"]) => {
    if (it.k === "lit") return;
    const { base, idx } = it.ref;
    if (it.k === "tok" && idx.length === 0) {
      if (!slots.has(base)) slots.set(base, newSlot(base, base, base, false, scope));
      return;
    }
    const key = `${base}[]`;
    if (!slots.has(key)) {
      const label = idx.length === 1 ? `${base}_i` : `${base}_{${["i", "j", "k"].slice(0, idx.length).join(",")}}`;
      slots.set(key, newSlot(key, label, base, true, scope));
    }
    if (it.k === "list") {
      sizeExpr(it.from);
      sizeExpr(it.to);
      if (it.joined) slots.get(key)!.joined = true;
    }
  };
  const walk = (nodes: Node[], scope: Slot["scope"]) => {
    for (const n of nodes) {
      if (n.k === "row" || n.k === "rep") {
        if (n.k === "rep") sizeExpr(n.count);
        for (const it of n.items) addItem(it, scope);
      } else if (n.k === "cases") {
        sizeExpr(n.count);
        if (n.count.k === "ref" && n.count.idx.length === 0) caseCount = n.count.name;
        walk(n.body, "case");
      } else {
        sizeExpr(n.count);
        for (const alt of n.alts) for (const it of alt) addItem(it, "query");
      }
    }
  };
  walk(f.nodes, "top");
  for (const name of sizeNames) {
    const s = slots.get(name) ?? slots.get(`${name}[]`);
    if (s) s.size = true;
  }
  return { slots, caseCount };
}

// ---- 制約を変数に当てる ------------------------------------------------------------

const GENERIC_SUB = /^[a-z](?:,[a-z])*$/;

function resolveKey(slots: Map<string, Slot>, r: CRef): string | null {
  const sub = r.sub?.replace(/\s/g, "") ?? null;
  const name = sub ? `${r.base}_${sub}` : r.base;
  if (slots.has(name)) return name;
  if (slots.has(`${r.base}[]`) && (sub === null || GENERIC_SUB.test(sub))) return `${r.base}[]`;
  if (sub !== null && GENERIC_SUB.test(sub) && slots.has(r.base)) return r.base;
  return null;
}

function lengthSlot(slots: Map<string, Slot>, s: Slot): Slot {
  const key = `|${s.key}|`;
  let l = slots.get(key);
  if (!l) {
    l = newSlot(key, `|${s.label}|`, s.name, s.elem, s.scope);
    l.size = true;
    slots.set(key, l);
  }
  return l;
}

function applyFacts(slots: Map<string, Slot>, facts: Fact[], spec: Spec, graphFacts: { tree: boolean; simple: boolean; connected: boolean; rooted: boolean }) {
  const missing = new Set<string>();
  const key = (r: CRef): string | null => {
    const k = resolveKey(slots, r);
    if (!k) missing.add(r.sub ? `${r.base}_${r.sub}` : r.base);
    return k;
  };
  // 1回目: 文字列かどうか(|S| を長さと読むか絶対値と読むかが変わる)
  for (const f of facts) {
    if (f.k !== "charset" && f.k !== "string" && f.k !== "char" && f.k !== "choices") continue;
    const k = key(f.ref);
    if (!k) continue;
    const s = slots.get(k)!;
    if (f.k === "charset") s.charset = f.chars;
    else if (f.k === "string") s.type = "str";
    else if (f.k === "char") {
      if (s.type !== "str") s.type = "char";
    } else {
      s.choices = f.values;
      if (!f.values.every((v) => /^-?\d+$/.test(v)) && s.type === "int") s.type = s.joined ? "char" : "str";
    }
  }
  for (const s of slots.values()) {
    if (s.charset && s.type === "int") s.type = s.joined ? "char" : "str";
    if (s.joined && s.type === "int") s.type = "char";
    // 1文字の選択肢(. または #)は文字の種類として扱う(すべて「.」のようなケースを作れる)
    if (s.type === "char" && s.choices && s.choices.every((c) => [...c].length === 1)) {
      s.charset = s.choices;
      delete s.choices;
    }
  }
  // 2回目: 範囲・性質
  const target = (r: CRef): { slot: Slot; abs: boolean } | null => {
    const k = key({ ...r, bars: false });
    if (!k) return null;
    const s = slots.get(k)!;
    if (!r.bars) return { slot: s, abs: false };
    if (s.type === "str") return { slot: lengthSlot(slots, s), abs: false };
    return { slot: s, abs: true };
  };
  for (const f of facts) {
    switch (f.k) {
      case "lo":
      case "hi":
      case "ne": {
        const t = target(f.ref);
        if (!t) break;
        if (t.abs) {
          // |X| ≤ v は -v ≤ X ≤ v
          if (f.k === "hi") {
            t.slot.lo.push({ k: "neg", a: f.e });
            t.slot.hi.push(f.e);
          }
          break;
        }
        t.slot[f.k].push(f.e);
        break;
      }
      case "parity": {
        const t = target(f.ref);
        if (t && !t.abs) t.slot.parity = f.odd ? "odd" : "even";
        break;
      }
      case "perm":
      case "distinct": {
        const t = target(f.ref);
        if (t) t.slot[f.k] = true;
        break;
      }
      case "sorted": {
        const t = target(f.ref);
        if (t) t.slot.sorted = f.strict ? "lt" : "le";
        break;
      }
      case "pairDistinct": {
        const ks = f.refs.map((r) => key(r));
        if (ks.every((k): k is string => k !== null)) spec.pairDistinct.push(ks);
        break;
      }
      case "product": {
        const ks = f.refs.map((r) => key(r));
        if (ks.every((k): k is string => k !== null)) spec.products.push({ keys: ks, hi: f.hi });
        break;
      }
      case "caseSum": {
        const t = target(f.ref);
        if (t && !t.abs) spec.caseSums.push({ key: t.slot.key, name: f.ref.base, expr: f.expr, hi: f.hi });
        break;
      }
      case "elemSum": {
        const t = target(f.ref);
        if (t && !t.abs) spec.elemSums.push({ key: t.slot.key, hi: f.hi });
        break;
      }
      case "graph":
        if (f.tree) graphFacts.tree = true;
        if (f.simple) graphFacts.simple = true;
        if (f.connected) graphFacts.connected = true;
        if (f.rooted) graphFacts.rooted = true;
        break;
    }
  }
  for (const m of missing) spec.warnings.push(`制約の「${m}」が入力形式に見つかりません(この制約は使いません)`);
}

// ---- グラフ --------------------------------------------------------------------

/** 要素の上限の式に出てくるスカラーの名前(v_i ≤ N の N。u_i < v_i なら v の上限もたどる) */
function boundScalars(slots: Map<string, Slot>, key: string, depth = 0): Set<string> {
  const out = new Set<string>();
  const s = slots.get(key);
  if (!s || depth > 2) return out;
  for (const e of s.hi) {
    for (const n of exprRefs(e)) {
      if (slots.get(n)?.elem === false) out.add(n);
      else if (slots.has(`${n}[]`)) for (const x of boundScalars(slots, `${n}[]`, depth + 1)) out.add(x);
    }
  }
  return out;
}

function refersTo(es: Expr[], name: string): boolean {
  return es.some((e) => exprRefs(e).has(name));
}

function findGraph(spec: Spec, g: { tree: boolean; simple: boolean; connected: boolean; rooted: boolean }): GraphPlan | null {
  const { slots } = spec;
  const reps: Node[] = [];
  const lists: Item[] = [];
  const walk = (nodes: Node[]) => {
    for (const n of nodes) {
      if (n.k === "rep") reps.push(n);
      if (n.k === "row") for (const it of n.items) if (it.k === "list") lists.push(it);
      if (n.k === "cases") walk(n.body);
    }
  };
  walk(spec.format.nodes);
  for (const rep of reps) {
    if (rep.k !== "rep" || rep.items.length < 2) continue;
    const [a, b] = rep.items;
    if (a.k !== "tok" || b.k !== "tok" || a.ref.idx.length !== 1 || b.ref.idx.length !== 1) continue;
    const u = `${a.ref.base}[]`;
    const v = `${b.ref.base}[]`;
    if (slots.get(u)?.type !== "int" || slots.get(v)?.type !== "int") continue;
    const pair = spec.pairDistinct.some((p) => p.length === 2 && p.includes(u) && p.includes(v));
    if (!g.tree && !g.simple && !g.connected && !g.rooted && !pair) continue;
    const bu = boundScalars(slots, u);
    const n = [...boundScalars(slots, v)].find((x) => bu.has(x));
    if (!n) continue;
    const ordered = a.ref.base !== b.ref.base && (refersTo(slots.get(u)!.hi, b.ref.base) || refersTo(slots.get(v)!.lo, a.ref.base));
    const tree = g.tree || g.rooted;
    return { node: rep, parentList: null, u, v, n, tree, simple: tree || g.simple || pair, connected: tree || g.connected, ordered };
  }
  if (g.rooted || g.tree) {
    // 根付き木の親の並び P_2 P_3 … P_N
    for (const it of lists) {
      if (it.k !== "list" || it.from.k !== "num" || it.from.v !== 2n || it.to.k !== "ref") continue;
      return { node: null, parentList: it, n: it.to.name, tree: true, simple: true, connected: true, ordered: false };
    }
  }
  return null;
}

// ---- 範囲の見積もり ---------------------------------------------------------------

/** 式を、変数の取りうる範囲の端(下限なら下端、上限なら上端)で評価する */
function hullEnv(spec: Spec, dir: "lo" | "hi"): EvalEnv {
  return {
    get(name, idx, bars, ref) {
      const suffixed = idx.length > 0 ? `${name}_${ref.idx.map((x) => exprToString(x)).join(",")}` : "";
      let key =
        idx.length === 0 && spec.slots.has(name)
          ? name
          : suffixed && spec.slots.has(suffixed)
            ? suffixed
            : idx.length > 0 && spec.slots.has(`${name}[]`)
              ? `${name}[]`
              : null;
      if (!key) return undefined;
      if (bars) key = `|${key}|`;
      return spec.slots.get(key)?.hull[dir] ?? undefined;
    },
  };
}

const maxB = (a: bigint | null, b: bigint | null) => (a === null ? b : b === null ? a : a > b ? a : b);
const minB = (a: bigint | null, b: bigint | null) => (a === null ? b : b === null ? a : a < b ? a : b);

function computeHull(spec: Spec) {
  for (let iter = 0; iter < 12; iter++) {
    let changed = false;
    const loEnv = hullEnv(spec, "lo");
    const hiEnv = hullEnv(spec, "hi");
    for (const s of spec.slots.values()) {
      let lo: bigint | null = null;
      let hi: bigint | null = null;
      for (const e of s.lo) lo = maxB(lo, evalExpr(e, loEnv) ?? null);
      for (const e of s.hi) hi = minB(hi, evalExpr(e, hiEnv) ?? null);
      if (s.choices && s.type === "int") {
        const vs = s.choices.map((c) => BigInt(c));
        lo = maxB(lo, vs.reduce((a, b) => (a < b ? a : b)));
        hi = minB(hi, vs.reduce((a, b) => (a > b ? a : b)));
      }
      for (const p of spec.products) {
        if (!p.keys.includes(s.key)) continue;
        const v = evalExpr(p.hi, hiEnv);
        if (v === undefined) continue;
        let others = 1n;
        for (const k of p.keys) if (k !== s.key) others *= maxB(spec.slots.get(k)?.hull.lo ?? null, 1n)!;
        hi = minB(hi, v / others);
      }
      // 要素の和の上限は、1つの要素の上限でもある(S_1, …, S_K の長さの和は 2×10^5 以下)
      for (const e of spec.elemSums) {
        if (e.key !== s.key) continue;
        const v = evalExpr(e.hi, hiEnv);
        if (v !== undefined) hi = minB(hi, v);
      }
      for (const c of spec.caseSums) {
        if (c.key !== s.key) continue;
        const v = evalExpr(c.hi, hiEnv);
        if (v !== undefined && c.expr.k === "ref") hi = minB(hi, v);
      }
      if (lo !== null && (s.hull.lo === null || lo > s.hull.lo)) {
        s.hull.lo = lo;
        changed = true;
      }
      if (hi !== null && (s.hull.hi === null || hi < s.hull.hi)) {
        s.hull.hi = hi;
        changed = true;
      }
    }
    if (!changed) break;
  }
}

// ---- 作るケース ------------------------------------------------------------------

function show(c: string): string {
  return c === " " ? "空白" : c;
}

function buildPresets(spec: Spec): Preset[] {
  const slots = [...spec.slots.values()];
  const values = slots.some((s) => !s.size && (s.type === "int" ? s.hull.lo !== s.hull.hi : true));
  const numArray = slots.some((s) => s.elem && s.type === "int" && !s.perm && !s.size && s !== spec.slots.get(spec.graph?.u ?? "") && s !== spec.slots.get(spec.graph?.v ?? ""));
  const str = slots.find((s) => (s.type === "str" || s.type === "char") && !s.choices && s.charset);
  const multi = spec.caseCount !== null;
  const out: Preset[] = [
    { id: "min", label: "最小", purpose: "大きさも値もいちばん小さい入力", size: "min", value: "min", graph: "random", str: "first", multi: "min" },
  ];
  if (values) out.push({ id: "min-max", label: "最小・値は最大", purpose: "小さい入力で値だけ最大", size: "min", value: "max", str: "last", multi: "min" });
  out.push({ id: "small1", label: "小さいランダム 1", purpose: "手で確かめやすい大きさ・値", size: "small", value: "small", multi: "small" });
  out.push({ id: "small2", label: "小さいランダム 2", purpose: "小さい大きさで値は全範囲", size: "small", value: "random", multi: "small" });
  out.push({ id: "max", label: "最大・ランダム", purpose: "実行時間(TLE)の確認", size: "max", value: "random" });
  if (values) out.push({ id: "max-max", label: "最大・値はすべて最大", purpose: "和や積のオーバーフロー", size: "max", value: "max", str: "last" });
  if (numArray) {
    out.push({ id: "same", label: "最大・すべて同じ値", purpose: "同じ値が続くとき(重複・二分探索の境界)", size: "max", value: "same" });
    out.push({ id: "asc", label: "最大・昇順", purpose: "整列済みの入力(単調性・最悪ケース)", size: "max", value: "asc" });
    out.push({ id: "desc", label: "最大・降順", purpose: "逆順の入力", size: "max", value: "desc" });
  }
  if (spec.graph) {
    out.push({ id: "path", label: spec.graph.tree ? "最大・一直線の木" : "最大・一直線を含むグラフ", purpose: "再帰が深くなる(スタックあふれ)", size: "max", value: "random", graph: "path" });
    out.push({ id: "star", label: spec.graph.tree ? "最大・スター(1つの頂点に全部つながる)" : "最大・スターを含むグラフ", purpose: "1つの頂点に辺が集まる", size: "max", value: "random", graph: "star" });
  }
  if (str?.charset && str.charset.length >= 2) {
    const cs = str.charset;
    out.push({ id: "str-first", label: `最大・すべて「${show(cs[0])}」`, purpose: "同じ文字だけ", size: "max", value: "random", str: "first" });
    out.push({ id: "str-last", label: `最大・すべて「${show(cs[cs.length - 1])}」`, purpose: "同じ文字だけ(もう一方の端)", size: "max", value: "random", str: "last" });
    out.push({ id: "str-alt", label: `最大・「${show(cs[0])}${show(cs[1])}」の交互`, purpose: "文字が交互に変わる", size: "max", value: "random", str: "alt" });
  }
  const prod = spec.products.find((p) => p.keys.length === 2);
  if (prod) {
    const [a, b] = prod.keys;
    out.push({ id: "wide", label: `最大・${a} = 1 の細長い形`, purpose: "1行だけの横長", size: "max", value: "random", shape: "wide" });
    out.push({ id: "tall", label: `最大・${b} = 1 の細長い形`, purpose: "1列だけの縦長", size: "max", value: "random", shape: "tall" });
  }
  if (multi) {
    const T = spec.caseCount!;
    out.push({ id: "many", label: `${T} 最大・各ケースは小さめ`, purpose: "ケースごとの初期化の重さ・前のケースの値の消し忘れ", size: "max", value: "random", multi: "many" });
  }
  return out;
}

// ---- まとめ ----------------------------------------------------------------------

export function buildSpec(formatText: string, constraintsText: string, overrides: Overrides = {}): Spec {
  const format = parseFormat(normalizeText(formatText));
  const cons = parseConstraints(normalizeText(constraintsText));
  const { slots, caseCount } = collectSlots(format);
  const spec: Spec = {
    format,
    slots,
    products: [],
    caseSums: [],
    elemSums: [],
    pairDistinct: [],
    graph: null,
    caseCount,
    warnings: [...format.warnings],
    unread: cons.unread,
    presets: [],
  };
  const g = { tree: false, simple: false, connected: false, rooted: false };
  applyFacts(slots, cons.facts, spec, g);

  // 文字列には長さの変数を用意する(選択肢から選ぶもの・1文字のものは要らない)
  for (const s of [...slots.values()]) {
    if (s.type === "str" && !s.choices) lengthSlot(slots, s);
    if ((s.type === "str" || s.type === "char") && !s.choices && !s.charset) {
      s.charset = "abcdefghijklmnopqrstuvwxyz".split("");
      s.assumed = true;
      spec.warnings.push(`${s.label} の文字の種類が分からないので、英小文字にしました`);
    }
  }

  // 手直しした範囲
  for (const [key, o] of Object.entries(overrides)) {
    const s = slots.get(key);
    if (!s) continue;
    for (const dir of ["lo", "hi"] as const) {
      const t = o[dir]?.trim();
      if (!t) continue;
      const e = parseExpr(t.replace(/×/g, "*"));
      if (e) s[dir] = [e];
      else spec.warnings.push(`${s.label} の${dir === "lo" ? "下限" : "上限"}「${t}」を読めませんでした`);
    }
  }

  spec.graph = g.tree || g.simple || g.connected || g.rooted || spec.pairDistinct.length ? findGraph(spec, g) : null;
  if ((g.tree || g.simple || g.connected || g.rooted) && !spec.graph) spec.warnings.push("グラフの辺の行が見つからないので、グラフの制約は使いません");
  // 連結なら辺は N-1 本以上、単純なら N(N-1)/2 本以下
  const gp = spec.graph;
  if (gp?.node && gp.node.k === "rep" && gp.node.count.k === "ref" && gp.node.count.idx.length === 0) {
    const m = slots.get(gp.node.count.name);
    const n: Expr = { k: "ref", name: gp.n, idx: [] };
    if (m && m.key !== gp.n) {
      if (gp.connected) m.lo.push(bin("-", n, num(1)));
      if (gp.simple) m.hi.push(bin("/", bin("*", n, bin("-", n, num(1))), num(2)));
    }
  }

  // 大きさの変数: 積の上限に出てくるもの(H × W)、ほかの変数の上限そのもの(1 ≤ x ≤ N の N)、
  // 大きさの変数の範囲そのもの(長さ W の W)。最大のケースで最大にする
  for (const p of spec.products) for (const k of p.keys) slots.get(k)!.size = true;
  for (let round = 0; round < 3; round++) {
    for (const s of slots.values()) {
      for (const e of s.size ? [...s.lo, ...s.hi] : s.hi) {
        if (e.k !== "ref" || e.idx.length > 0 || e.bars) continue;
        const t = slots.get(e.name);
        if (t && !t.elem && t.type === "int" && t.scope !== "query") t.size = true;
      }
    }
  }

  computeHull(spec);
  // 単純グラフで辺が1本以上あるなら、頂点は辺の本数を張れるだけ要る(M ≥ 1 なら N ≥ 2)
  if (gp?.simple && gp.node?.k === "rep" && gp.node.count.k === "ref") {
    const m = slots.get(gp.node.count.name)?.hull.lo ?? null;
    const n = slots.get(gp.n);
    if (m !== null && m > 0n && n) {
      let v = 2n;
      while ((v * (v - 1n)) / 2n < m) v++;
      if (n.hull.lo === null || n.hull.lo < v) {
        n.lo.push(num(v));
        computeHull(spec);
      }
    }
  }

  // 範囲が分からないものは仮に決める
  for (const s of slots.values()) {
    if (s.type !== "int" || s.choices) continue;
    const isLen = s.key.startsWith("|");
    if (s.hull.lo === null) {
      s.hull.lo = s.hull.hi !== null && s.hull.hi < 1n ? s.hull.hi : 1n;
      if (!s.perm) s.assumed = true;
    }
    if (s.hull.hi === null) {
      s.hull.hi = maxB(s.hull.lo, isLen || s.size ? 10n : ten9)!;
      if (!s.perm) s.assumed = true;
    }
    if (s.assumed) {
      spec.warnings.push(`${s.label} の範囲が制約から分からないので、${s.hull.lo} 〜 ${s.hull.hi} にしました(下の表で直せます)`);
    }
    if (s.hull.lo > s.hull.hi) spec.warnings.push(`${s.label} の範囲が空です(下限 ${s.hull.lo} > 上限 ${s.hull.hi})`);
  }
  // 範囲の表示のため、仮の範囲で見積もり直す
  computeHull(spec);

  spec.presets = buildPresets(spec);
  return spec;
}
