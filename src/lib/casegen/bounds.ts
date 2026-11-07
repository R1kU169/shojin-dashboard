// 問題文の「制約」(と「入力」)から、変数ごとの数値の範囲を出す。計算量タブの「変数の範囲」を埋めるのに使う。
//
// 制約の式(M ≤ min(3×10^5, N(N-1)/2)・K ≤ N)は、ほかの変数の上限を入れて数にする。
// 配列の長さ(|A|)は制約にはふつう書かれないので、入力の形式(A_1 … A_N / N 行の u_i v_i)から決める。
import { evalExpr, exprRefs } from "./expr.ts";
import type { EvalEnv, Expr } from "./expr.ts";
import { parseConstraints } from "./constraints.ts";
import type { CRef } from "./constraints.ts";
import { parseFormat } from "./format.ts";
import type { Item, Node } from "./format.ts";
import { normalizeText } from "./tex.ts";

export interface NamedBound {
  /** N / |S|(文字列の長さ)/ |A|(配列の長さ)/ A_i(要素の値) */
  name: string;
  lo: bigint | null;
  hi: bigint;
}

/**
 * 変数を引く・変数で割る式か(N - K + 1 / N / K)。上限を求めるとき、ほかの変数に上限を入れると小さく出すぎる
 * (K の上限 N を入れると N - K + 1 が 1 になる)ので、こういう式からは上限を決めない
 */
function shrinksByVariable(e: Expr): boolean {
  if (e.k === "bin") {
    if ((e.op === "-" || e.op === "/") && exprRefs(e.b).size > 0) return true;
    return shrinksByVariable(e.a) || shrinksByVariable(e.b);
  }
  if (e.k === "neg") return exprRefs(e.a).size > 0;
  if (e.k === "call") return e.args.some(shrinksByVariable);
  return false;
}

const keyOf = (r: CRef) => {
  const core = r.sub ? `${r.base}_${r.sub}` : r.base;
  return r.bars ? `|${core}|` : core;
};

/** 問題文の「入力」「制約」から、変数ごとの範囲 */
export function statementBounds(formatText: string, constraintsText: string): NamedBound[] {
  const los = new Map<string, Expr[]>();
  const his = new Map<string, Expr[]>();
  const push = (m: Map<string, Expr[]>, k: string, e: Expr) => m.set(k, [...(m.get(k) ?? []), e]);
  for (const f of parseConstraints(normalizeText(constraintsText)).facts) {
    if (f.k === "lo") push(los, keyOf(f.ref), f.e);
    else if (f.k === "hi" && !shrinksByVariable(f.e)) push(his, keyOf(f.ref), f.e);
  }

  // 式の中の変数には、上限を求めるときは上限を、下限を求めるときは下限を入れる
  const lo = new Map<string, bigint>();
  const hi = new Map<string, bigint>();
  const envOf = (vals: Map<string, bigint>): EvalEnv => ({
    get: (name, idx, bars) => {
      const k = bars ? `|${name}|` : name;
      return idx.length === 0 ? vals.get(k) : undefined;
    },
  });
  // K ≤ N のように順番に決まるので、変わらなくなるまで数回まわす
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    for (const [k, es] of his) {
      const vs = es.map((e) => evalExpr(e, envOf(hi))).filter((v): v is bigint => v !== undefined);
      if (vs.length === 0) continue;
      const v = vs.reduce((a, b) => (b < a ? b : a));
      if (hi.get(k) !== v) {
        hi.set(k, v);
        changed = true;
      }
    }
    for (const [k, es] of los) {
      const vs = es.map((e) => evalExpr(e, envOf(lo))).filter((v): v is bigint => v !== undefined);
      if (vs.length === 0) continue;
      const v = vs.reduce((a, b) => (b > a ? b : a));
      if (lo.get(k) !== v) {
        lo.set(k, v);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const out = new Map<string, NamedBound>();
  for (const [k, h] of hi) out.set(k, { name: k, lo: lo.get(k) ?? null, hi: h });

  // 配列の長さを入力の形式から(制約に |A| が書いてあればそちらを使う)
  if (formatText.trim()) {
    const env = envOf(hi);
    const length = (name: string, e: Expr) => {
      const v = evalExpr(e, env);
      const k = `|${name}|`;
      if (v !== undefined && v > 0n && !out.has(k)) out.set(k, { name: k, lo: null, hi: v });
    };
    const fromItems = (items: Item[], rows: Expr | null) => {
      for (const it of items) {
        if (it.k === "list" && it.ref.idx.length === 1) {
          // A_K … A_N / A_1 … A_{N-K+1} のように変数を引く長さは、上限を入れると小さく出すぎるので決めない
          if (exprRefs(it.from).size > 0 || shrinksByVariable(it.to)) continue;
          // A_1 A_2 … A_N の長さ。from が 1 でなければ to - from + 1
          const from = evalExpr(it.from, env);
          const to = evalExpr(it.to, env);
          if (from !== undefined && to !== undefined) length(it.ref.base, { k: "num", v: to - from + 1n });
        } else if (rows && (it.k === "tok" || it.k === "list") && it.ref.idx.length >= 1) {
          // N 行の u_i v_i / H 行の A_{i,1} … A_{i,W} は行の数
          length(it.ref.base, rows);
        }
      }
    };
    const walk = (nodes: Node[]) => {
      for (const n of nodes) {
        if (n.k === "row") fromItems(n.items, null);
        else if (n.k === "rep") fromItems(n.items, n.count);
        else if (n.k === "cases") walk(n.body);
      }
    };
    walk(parseFormat(normalizeText(formatText)).nodes);
  }
  return [...out.values()];
}
