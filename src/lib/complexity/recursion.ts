// 再帰の計算量(§5.3)。自己呼び出しの引数が仮引数からどう変わるかで形を分ける。
//
// 適用順: メモ化(R7) → Union-Find(R-UF) → グラフの DFS(R8/R9) → 半分にする(R3'/R3/R2)
//        → 1ずつ減らす・増やす(R1/R6) → 分からない(R10)
// 相互再帰(R11)は呼び出しグラフの側(analyze.ts)で扱う。
import type { Confidence, Expr, IrNode, SExpr } from "./ir.ts";
import { add, constValue, exp2Of, isConst, logOfExpr, mul, ONE, singleSym, sym } from "./expr.ts";
import { boundOf } from "./bounds.ts";
import type { BoundEnv } from "./bounds.ts";
import { walk } from "./semantics.ts";

export interface SelfCall {
  args: SExpr[];
  line: number;
  /** ループの中での自己呼び出し(分岐数が回数ぶんになる) */
  insideLoop: boolean;
  /** 隣接リストの走査の中での自己呼び出し(グラフの DFS) */
  insideAdjacency: boolean;
}

export interface RecInput {
  fn: Extract<IrNode, { kind: "func" }>;
  selfCalls: SelfCall[];
  /** 自己呼び出しを1と数えた本体の時間(隣接リストの走査は除く) */
  body: Expr;
  /** 本体の中の、仮引数の頂点を起点にした隣接リストの走査(辺の数と、1本あたりの時間) */
  adjacency: { edges: Expr; body: Expr } | null;
  env: BoundEnv;
}

export interface RecEstimate {
  time: Expr;
  depth: Expr;
  /** 呼び出しの回数(本体の中の確保・成長に掛ける) */
  calls: Expr;
  /** メモの表の大きさ(デコレータ・辞書のメモ化。配列の表は宣言の側で数える) */
  memo?: Expr;
  conf: Confidence;
  reason: string;
  warn?: string;
}

type ArgClass = "same" | "step-down" | "step-up" | "half" | "uf" | "graph" | "other";

const Q: Expr = [{ coef: 1, factors: [{ v: "?", pow: 1, log: 0, exp: 0, fact: 0 }] }];

/** mid = (l + r) / 2 のように半分の値を持つ局所変数 */
function midVars(body: readonly IrNode[]): Set<string> {
  const out = new Set<string>();
  const visit = (nodes: readonly IrNode[]) => {
    for (const n of nodes) {
      const target = n.kind === "assign" ? n.target : null;
      const value = n.kind === "assign" ? n.value : n.kind === "decl" ? n.init : null;
      const name = n.kind === "decl" ? n.name : target && target.kind === "sym" ? target.name : null;
      if (name && value && isHalf(value)) out.add(name);
      if (n.kind === "branch") n.branches.forEach(visit);
    }
  };
  visit(body);
  return out;
}

function isHalf(e: SExpr): boolean {
  let h = false;
  walk(e, (x) => {
    if (x.kind === "bin" && ["/", "//", ">>", "div"].includes(x.op) && ((x.r.kind === "num" && x.r.value === 2) || (x.op === ">>" && x.r.kind === "num" && x.r.value === 1))) h = true;
  });
  return h;
}

function classify(arg: SExpr, pos: number, params: string[], mids: Set<string>, arrays: (name: string) => boolean): ArgClass {
  const p = params[pos];
  if (arg.kind === "sym" && arg.name === p) return "same";
  if (arg.kind === "sym" && mids.has(arg.name)) return "half";
  if (arg.kind === "bin" && (arg.op === "+" || arg.op === "-") && arg.l.kind === "sym" && mids.has(arg.l.name)) return "half";
  if (isHalf(arg)) return "half";
  if (arg.kind === "bin" && (arg.op === "-" || arg.op === "+") && arg.l.kind === "sym" && params.includes(arg.l.name) && (arg.r.kind === "num" || arg.r.kind === "sym")) {
    return arg.op === "-" ? "step-down" : "step-up";
  }
  if (arg.kind === "index" && arg.of.kind === "sym" && arrays(arg.of.name) && arg.idx[0]?.kind === "sym" && params.includes(arg.idx[0].name)) return "uf";
  if (arg.kind === "sym" && !params.includes(arg.name)) return "graph";
  if (arg.kind === "bin" && (arg.op === "+" || arg.op === "-") && arg.l.kind === "sym" && params.includes(arg.l.name)) return "graph";
  if (arg.kind === "num" || arg.kind === "str") return "same";
  return "other";
}

const PRIORITY: ArgClass[] = ["uf", "half", "step-down", "step-up", "graph", "other"];

function callClass(c: SelfCall, params: string[], mids: Set<string>, arrays: (name: string) => boolean): { cls: ArgClass; pos: number } {
  let best: { cls: ArgClass; pos: number } = { cls: "same", pos: -1 };
  c.args.forEach((a, i) => {
    const cls = classify(a, i, params, mids, arrays);
    if (cls === "same") return;
    if (best.cls === "same" || PRIORITY.indexOf(cls) < PRIORITY.indexOf(best.cls)) best = { cls, pos: i };
  });
  return best;
}

/** 本体の先頭の分岐から、仮引数 p の打ち切り(p == E / p >= E / p > E)を拾う */
function baseCaseBounds(body: readonly IrNode[], params: string[]): Map<string, SExpr> {
  const out = new Map<string, SExpr>();
  for (const n of body.slice(0, 8)) {
    if (n.kind !== "branch") continue;
    for (const c of n.conds) {
      walk(c, (x) => {
        if (x.kind !== "cmp") return;
        if (x.l.kind === "sym" && params.includes(x.l.name) && ["==", ">=", ">"].includes(x.op) && !out.has(x.l.name)) out.set(x.l.name, x.r);
        if (x.r.kind === "sym" && params.includes(x.r.name) && ["==", "<=", "<"].includes(x.op) && !out.has(x.r.name)) out.set(x.r.name, x.l);
      });
    }
  }
  return out;
}

const MEMO_DECOR = /^(lru_cache|cache|functools\.(lru_cache|cache)|memoize|memo|cached)/;

/** メモ化の検出: デコレータか、先頭の分岐で表を見て return する形 */
function memoTable(fn: RecInput["fn"]): { table: string | null; source: "decorator" | "array" | "dict" } | null {
  if (fn.decorators.some((d) => MEMO_DECOR.test(d))) return { table: null, source: "decorator" };
  for (const n of fn.body.slice(0, 8)) {
    if (n.kind !== "branch") continue;
    for (let i = 0; i < n.conds.length; i++) {
      const c = n.conds[i];
      if (!c) continue;
      const returns = n.branches[i].some((b) => b.kind === "return");
      if (!returns) continue;
      let table: string | null = null;
      let dict = false;
      walk(c, (x) => {
        if (table) return false;
        // memo[i][j] != -1 / ~memo[i] / memo[i] is not None / memo[i] >= 0 / dp[i][j] に値がある
        if (x.kind === "index") {
          let base: SExpr = x;
          while (base.kind === "index") base = base.of;
          if (base.kind === "sym") table = base.name;
          return false;
        }
        // key in memo / (i, j) in memo / memo.count(k) / memo.has(k) / isset($memo[$n]) / haskey(memo, n)
        if (x.kind === "cmp" && (x.op === "in" || x.op === "notin") && x.r.kind === "sym") {
          table = x.r.name;
          dict = true;
        }
        if (x.kind === "member" && ["count", "has", "contains", "containsKey", "has_key", "key?", "haskey", "find", "ContainsKey", "exists"].includes(x.name) && x.of.kind === "sym") {
          table = x.of.name;
          dict = true;
        }
        if (x.kind === "call" && ["isset", "haskey", "exists", "defined", "array_key_exists"].includes(x.name)) {
          const a = x.args[x.args.length - 1];
          let base: SExpr | undefined = a;
          while (base && base.kind === "index") base = base.of;
          if (base && base.kind === "sym") table = base.name;
          dict = true;
        }
      });
      if (table) return { table, source: dict ? "dict" : "array" };
    }
  }
  return null;
}

/** 自己呼び出しより前に、|| を含む条件の return がある(区間クエリの枝刈り) */
function hasPruneReturn(body: readonly IrNode[]): boolean {
  for (const n of body) {
    if (n.kind !== "branch") continue;
    for (let i = 0; i < n.conds.length; i++) {
      const c = n.conds[i];
      if (c && c.kind === "logic" && c.op === "||" && n.branches[i].some((b) => b.kind === "return")) return true;
    }
  }
  return false;
}

/** 訪問済みの判定(seen[to] / to != p / dist[nv] >= 0)があるか */
function hasVisitedCheck(fn: RecInput["fn"], graphArgs: SExpr[]): boolean {
  const names = new Set(graphArgs.flatMap((a) => (a.kind === "sym" ? [a.name] : [])));
  let found = false;
  const visit = (nodes: readonly IrNode[]) => {
    for (const n of nodes) {
      if (found) return;
      if (n.kind === "branch") {
        for (const c of n.conds) {
          walk(c, (x) => {
            if (x.kind === "index" && x.idx.some((i) => i.kind === "sym" && (names.has(i.name) || fn.params.includes(i.name)))) found = true;
            if (x.kind === "cmp" && (x.op === "!=" || x.op === "==") && ((x.l.kind === "sym" && names.has(x.l.name)) || (x.r.kind === "sym" && names.has(x.r.name)))) found = true;
          });
        }
        n.branches.forEach(visit);
      } else if (n.kind === "loop") visit(n.body);
      else if (n.kind === "assign" && n.target.kind === "index" && n.target.idx.some((i) => i.kind === "sym" && fn.params.includes(i.name))) {
        // seen[v] = true を入口で立てる形
        found = true;
      }
    }
  };
  visit(fn.body);
  return found;
}

export function estimateRecursion(inp: RecInput): RecEstimate {
  const { fn, selfCalls, body, env } = inp;
  const params = fn.params;
  const mids = midVars(fn.body);
  const arrays = (name: string) => env.kindOf({ kind: "sym", name }) === "array" || env.kindOf({ kind: "sym", name }) === "unknown";
  const classes = selfCalls.map((c) => callClass(c, params, mids, arrays));
  const bodyConst = isConst(body);
  const paramSym = (i: number): Expr => (params[i] ? env.sym(params[i]) : Q);
  const bases = baseCaseBounds(fn.body, params);

  // R7 メモ化: 状態数 × 遷移
  const memo = memoTable(fn);
  if (memo) {
    const varying = new Set<number>();
    selfCalls.forEach((call) => call.args.forEach((a, i) => {
      if (classify(a, i, params, mids, arrays) !== "same") varying.add(i);
    }));
    if (varying.size === 0 && params.length > 0) params.forEach((_, i) => varying.add(i));
    let states: Expr = ONE;
    let depth: Expr = ONE;
    let conf: Confidence = "high";
    for (const i of varying) {
      const p = params[i];
      const base = bases.get(p);
      let b = base ? boundOf(base, env)?.expr ?? null : null;
      if (!b && memo.table && memo.source === "array") {
        const d = memoDim(memo.table, i, env);
        if (d) {
          b = d;
          if (conf === "high") conf = "medium";
        }
      }
      if (!b) {
        b = env.sym(p);
        conf = "low";
      }
      states = mul(states, b);
      depth = add(depth, b);
    }
    return {
      time: mul(states, body),
      depth,
      calls: states,
      memo: memo.source === "array" ? undefined : states,
      conf,
      reason: `メモ化再帰(状態数 × 1状態の計算)`,
      warn: conf === "low" ? `${fn.loc.line}行目: 状態数を仮引数の記号の積とみなしました。範囲指定で実際の上限を与えてください` : undefined,
    };
  }

  // R-UF: 根をたどる find(par[x])
  const ufIdx = classes.findIndex((c) => c.cls === "uf");
  if (selfCalls.length === 1 && ufIdx === 0) {
    const a = selfCalls[0].args[classes[0].pos];
    const arr = a.kind === "index" && a.of.kind === "sym" ? a.of.name : "";
    const n = env.sizeOf({ kind: "sym", name: arr });
    return { time: mul(logOfExpr(n), body), depth: logOfExpr(n), calls: logOfExpr(n), conf: "medium", reason: "Union-Find の根をたどる(経路圧縮前提。実際は α(N))" };
  }

  // R8 / R9 グラフの DFS: 頂点 × 本体 + 辺 × 走査の本体
  const graphCalls = selfCalls.filter((c, k) => classes[k].cls === "graph" || c.insideAdjacency);
  if (graphCalls.length > 0) {
    const V = env.vertices();
    const checked = hasVisitedCheck(fn, graphCalls.map((c, k) => c.args[classes[k]?.pos ?? 0] ?? c.args[0]));
    const adj = inp.adjacency;
    const time = adj ? add(mul(V, body), mul(adj.edges, adj.body)) : mul(V, body);
    return {
      time,
      depth: V,
      calls: V,
      conf: checked ? "high" : "low",
      reason: "グラフの深さ優先探索(頂点 + 辺)",
      warn: checked ? undefined : `${fn.loc.line}行目: DFS に訪問済みの判定が見つかりません。木なら O(N+M)、そうでなければ指数時間になりえます`,
    };
  }

  // R3' / R3 / R2 半分にする
  const halves = classes.filter((c) => c.cls === "half");
  if (halves.length > 0) {
    const pos = Math.max(...halves.map((h) => h.pos));
    const N = paramSym(pos);
    const logN = logOfExpr(N);
    if (halves.length === 1) return { time: mul(logN, body), depth: logN, calls: logN, conf: "high", reason: "半分にしていく再帰" };
    if (hasPruneReturn(fn.body)) return { time: mul(logN, body), depth: logN, calls: logN, conf: "medium", reason: "区間クエリの枝刈り(log N)" };
    return {
      time: bodyConst ? N : mul(body, logN),
      depth: logN,
      calls: N,
      conf: "high",
      reason: bodyConst ? "2分割の再帰(N)" : "分割統治(N log N)",
      warn: bodyConst ? `${fn.loc.line}行目: 2分割の再帰を N と見積もりました。区間クエリなら log N です` : undefined,
    };
  }

  // R1 / R6 1ずつ動かす
  const steps = classes.filter((c) => c.cls === "step-down" || c.cls === "step-up");
  if (steps.length > 0) {
    const s = steps[0];
    const p = params[s.pos];
    let N: Expr = paramSym(s.pos);
    if (s.cls === "step-up") {
      const base = bases.get(p);
      const bb = base ? boundOf(base, env)?.expr : null;
      N = bb ?? Q;
    }
    const branching = steps.length + (selfCalls.some((c) => c.insideLoop) ? 1 : 0);
    if (branching >= 2) {
      const s1 = singleSym(N);
      const expo = s1 ? exp2Of(s1) : constValue(N) !== null ? [{ coef: Math.pow(2, Math.min(constValue(N)!, 1023)), factors: [] }] : sym(`2^(${params[s.pos] ?? "N"})`);
      return { time: mul(expo, body), depth: N, calls: expo, conf: "medium", reason: "分岐する再帰(指数時間)", warn: `${fn.loc.line}行目: 指数時間の再帰です。メモ化があれば見落としている可能性があります` };
    }
    return { time: mul(N, body), depth: N, calls: N, conf: "high", reason: "1ずつ進む再帰" };
  }

  return { time: mul(Q, body), depth: Q, calls: Q, conf: "low", reason: "再帰", warn: `${fn.loc.line}行目: 再帰の引数の変化を解釈できません。N 回の呼び出しとみなしました` };
}

/** メモの表の i 番目の次元の大きさ */
function memoDim(table: string, i: number, env: BoundEnv): Expr | null {
  const dims = env.declDims(table);
  if (!dims || !dims[i]) return null;
  return boundOf(dims[i], env)?.expr ?? null;
}

export const __test = { classify, baseCaseBounds, memoTable };
