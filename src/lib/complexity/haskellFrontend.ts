// Haskell のフロントエンド(簡易対応。確からしさは低で固定)。
// ブロック木に無理に落とさず、「反復の源」をループにして IR を作る(計画 §7.5):
//   forM_ / for_ / mapM_ / forM / mapM / replicateM_ / replicateM / foldM / zipWithM_ → loop
//   [f x | x <- xs, y <- ys](内包表記)→ comp   map / filter / foldl / sort / nub … → 組み込みの呼び出し
//   f p1 p2 | guard = e / f 0 = … / f (x:xs) = … f xs → 分岐と自己呼び出し(再帰の規則で数える)
// レイアウトは「行頭の桁」で近似する: 同じ桁で始まる行が並びの区切り、深い行は前の行の続き。
// do / where / let / of の後ろは、次の字句の桁をその並びの桁にする。
import type { FrontWarning, IrNode, Loc, Program, SExpr, Tok } from "./ir.ts";
import { evalConst } from "./semantics.ts";
import type { Consts } from "./semantics.ts";

// ---------------------------------------------------------------------------
// 小道具

const isOp = (t: Tok | undefined, v: string) => !!t && t.k === "op" && t.v === v;
const isW = (t: Tok | undefined, v: string) => !!t && t.k === "ident" && t.v === v;
const loc = (toks: readonly Tok[]): Loc => ({ line: toks[0]?.line ?? 1, endLine: toks[toks.length - 1]?.line ?? toks[0]?.line ?? 1 });
const text = (toks: readonly Tok[], max = 50) => {
  const s = toks.map((t) => (t.k === "str" ? JSON.stringify(t.v) : t.v)).join(" ");
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};
const unknown = (t = ""): SExpr => ({ kind: "unknown", text: t });

/** 深さ0で pred を満たす最初の位置 */
function findTop(toks: readonly Tok[], pred: (t: Tok, i: number) => boolean, from = 0): number {
  let d = 0;
  for (let i = from; i < toks.length; i++) {
    const t = toks[i];
    if (d === 0 && pred(t, i)) return i;
    if (t.k === "op" && (t.v === "(" || t.v === "[" || t.v === "{")) d++;
    else if (t.k === "op" && (t.v === ")" || t.v === "]" || t.v === "}")) d = Math.max(0, d - 1);
  }
  return -1;
}

/** 深さ0の sep で分ける */
function splitTop(toks: readonly Tok[], sep: string): Tok[][] {
  const out: Tok[][] = [[]];
  let d = 0;
  for (const t of toks) {
    if (t.k === "op" && (t.v === "(" || t.v === "[" || t.v === "{")) d++;
    else if (t.k === "op" && (t.v === ")" || t.v === "]" || t.v === "}")) d = Math.max(0, d - 1);
    else if (d === 0 && t.k === "op" && t.v === sep) {
      out.push([]);
      continue;
    }
    out[out.length - 1].push(t);
  }
  return out;
}

/** 行頭の桁 col で始まる字句ごとに並びを分ける(深い行は前の並びの続き)。{ ; } の明示的なレイアウトは ; で分ける */
function items(toks: readonly Tok[]): Tok[][] {
  if (toks.length === 0) return [];
  if (isOp(toks[0], "{")) return splitTop(toks.slice(1, -1), ";").filter((x) => x.length);
  const col = toks[0].col;
  const out: Tok[][] = [];
  let d = 0;
  for (const t of toks) {
    if (out.length === 0 || (d === 0 && t.nl && t.col <= col)) out.push([]);
    out[out.length - 1].push(t);
    if (t.k === "op" && (t.v === "(" || t.v === "[")) d++;
    else if (t.k === "op" && (t.v === ")" || t.v === "]")) d = Math.max(0, d - 1);
  }
  return out.flatMap((x) => splitTop(x, ";")).filter((x) => x.length);
}

// 修飾名の揃え(M.insert / Map.insert / Data.Map.Strict.insert → M.insert)
const QUALIFIERS: Record<string, string> = {
  M: "M", Map: "M", MS: "M", IM: "M", IntMap: "M", HM: "M", HashMap: "M",
  S: "S", Set: "S", IS: "S", IntSet: "S", HS: "S", HashSet: "S",
  V: "V", VU: "V", VM: "V", VUM: "V", Vector: "V", U: "V", UM: "V", MV: "V",
  BS: "BS", B: "BS", BS8: "BS", C: "BS", BC: "BS", ByteString: "BS", C8: "BS",
  A: "A", Array: "A", UA: "A", IA: "A",
  Seq: "Seq", SQ: "Seq", T: "T", Text: "T", L: "L", List: "L",
};

// ---------------------------------------------------------------------------
// 式

/** 反復の関数: 名前 → (コレクションの引数の位置, 関数の引数の位置)。count は回数を取る */
const ITERS: Record<string, { coll: number; fn: number; count?: boolean }> = {
  forM_: { coll: 0, fn: 1 },
  forM: { coll: 0, fn: 1 },
  for_: { coll: 0, fn: 1 },
  mapM_: { coll: 1, fn: 0 },
  mapM: { coll: 1, fn: 0 },
  traverse_: { coll: 1, fn: 0 },
  traverse: { coll: 1, fn: 0 },
  replicateM_: { coll: 0, fn: 1, count: true },
  replicateM: { coll: 0, fn: 1, count: true },
  foldM: { coll: 2, fn: 0 },
  foldM_: { coll: 2, fn: 0 },
  zipWithM_: { coll: 1, fn: 0 },
  zipWithM: { coll: 1, fn: 0 },
};

interface Ctx {
  warn: (w: FrontWarning) => void;
  /** 入力を読む名前(getLine などと、それを本体に含む top-level の束縛) */
  inputFns: Set<string>;
  /** 入力で読んだ値の名前 */
  inputs: Set<string>;
  consts: Consts;
  /** いま定義している関数と、(x:xs) の xs → 仮引数(自己呼び出しの引数を 仮引数 - 1 にする) */
  self: { name: string; tails: Map<string, string> } | null;
}

const INPUT_PRIMS = new Set(["getLine", "getContents", "readLn", "interact", "getArgs", "hGetLine", "hGetContents", "BS.getLine", "BS.getContents", "T.getLine", "T.getContents", "readLine"]);

const FIX: Record<string, [number, "l" | "r"]> = {
  $: [0, "r"], "$!": [0, "r"], ">>=": [1, "l"], ">>": [1, "l"], "=<<": [1, "r"], "&": [1, "l"],
  "||": [2, "r"], "&&": [3, "r"],
  "==": [4, "l"], "/=": [4, "l"], "<": [4, "l"], "<=": [4, "l"], ">": [4, "l"], ">=": [4, "l"], "`elem`": [4, "l"], "`notElem`": [4, "l"],
  "<$>": [4, "l"], "<$": [4, "l"], "<*>": [4, "l"], "*>": [4, "l"], "<*": [4, "l"], "<&>": [1, "l"],
  ":": [5, "r"], "++": [5, "r"], "<>": [6, "r"],
  "+": [6, "l"], "-": [6, "l"],
  "*": [7, "l"], "/": [7, "l"], "`div`": [7, "l"], "`mod`": [7, "l"], "`quot`": [7, "l"], "`rem`": [7, "l"],
  "^": [8, "r"], "^^": [8, "r"], "**": [8, "r"],
  ".": [9, "r"], "!!": [9, "l"], "!": [9, "l"], "V.!": [9, "l"],
};

class HsExpr {
  readonly t: readonly Tok[];
  readonly ctx: Ctx;
  i = 0;
  constructor(t: readonly Tok[], ctx: Ctx) {
    this.t = t;
    this.ctx = ctx;
  }
  peek(k = 0): Tok | undefined {
    return this.t[this.i + k];
  }
  done(): boolean {
    return this.i >= this.t.length;
  }

  /** 演算子の式(優先順位つき) */
  expr(minPrec = -1): SExpr {
    let left = this.app();
    for (;;) {
      const t = this.peek();
      if (!t || t.k !== "op" || t.v === "::" || t.v === "=" || t.v === "->" || t.v === "<-" || t.v === "|" || t.v === "," || t.v === ")" || t.v === "]" || t.v === "}" || t.v === ";" || t.v === "..") break;
      const fx = FIX[t.v] ?? (t.v.startsWith("`") ? [9, "l"] : [6, "l"]);
      const [prec, assoc] = fx as [number, "l" | "r"];
      if (prec <= minPrec) break;
      this.i++;
      const right = this.expr(assoc === "r" ? prec - 1 : prec);
      left = combine(t.v, left, right);
    }
    // 型注釈 e :: T は捨てる
    if (isOp(this.peek(), "::")) this.i = this.t.length;
    return left;
  }

  /** 関数適用 f a b(原子の並び) */
  app(): SExpr {
    const head = this.atom();
    if (!head) return unknown();
    const args: SExpr[] = [];
    for (;;) {
      const t = this.peek();
      if (!t || !startsAtom(t)) break;
      // \x -> … / do / if / case / let は最後の引数(BlockArguments の forM_ xs \i -> do)
      const a = this.atom();
      if (!a) break;
      args.push(a);
    }
    return args.length ? apply(head, args) : head;
  }

  atom(): SExpr | null {
    const t = this.peek();
    if (!t) return null;
    const ctx = this.ctx;
    if (t.k === "num") {
      this.i++;
      return { kind: "num", value: t.num ?? 0 };
    }
    if (t.k === "str") {
      this.i++;
      return { kind: "str", value: t.v };
    }
    if (t.k === "ident") {
      // 修飾名 M.insert / Data.Map.insert / BS.readInt
      if (/^[A-Z]/.test(t.v) && isOp(this.peek(1), ".") && !this.peek(1)!.sp && this.peek(2)?.k === "ident" && !this.peek(2)!.sp) {
        let j = this.i;
        const parts: string[] = [];
        while (this.t[j]?.k === "ident" && /^[A-Z]/.test(this.t[j].v) && isOp(this.t[j + 1], ".") && !this.t[j + 1].sp && this.t[j + 2] && !this.t[j + 2].sp && (this.t[j + 2].k === "ident" || this.t[j + 2].k === "op")) {
          parts.push(this.t[j].v);
          j += 2;
        }
        const last = this.t[j];
        const q = QUALIFIERS[parts[parts.length - 1]] ?? parts[parts.length - 1];
        this.i = j + 1;
        return { kind: "sym", name: `${q}.${last.v}` };
      }
      if (t.v === "if") return this.ifExpr();
      if (t.v === "case") return this.caseExpr();
      if (t.v === "let") return this.letExpr();
      if (t.v === "do") {
        this.i++;
        const body = doBlock(this.t.slice(this.i), ctx);
        this.i = this.t.length;
        return { kind: "lambda", params: [], body, expr: null, loc: loc(this.t) };
      }
      this.i++;
      return { kind: "sym", name: t.v };
    }
    if (t.k === "op") {
      if (t.v === "\\") return this.lambda();
      if (t.v === "(") return this.paren();
      if (t.v === "[") return this.bracket();
      if (t.v === "-" ) {
        this.i++;
        const e = this.atom();
        return e ? { kind: "un", op: "-", e } : unknown("-");
      }
      if (t.v.startsWith("`")) return null;
    }
    return null;
  }

  lambda(): SExpr {
    this.i++;
    const params: string[] = [];
    while (!this.done() && !isOp(this.peek(), "->")) {
      const p = this.peek()!;
      if (p.k === "ident") params.push(p.v);
      this.i++;
    }
    this.i++;
    const bodyToks = this.t.slice(this.i);
    this.i = this.t.length;
    // 本体が do なら文の並び、そうでなければ式
    if (isW(bodyToks[0], "do")) return { kind: "lambda", params, body: doBlock(bodyToks.slice(1), this.ctx), expr: null, loc: loc(bodyToks) };
    const body = exprStmts(bodyToks, this.ctx);
    return { kind: "lambda", params, body, expr: null, loc: loc(bodyToks) };
  }

  ifExpr(): SExpr {
    this.i++;
    const rest = this.t.slice(this.i);
    const th = findTop(rest, (x) => isW(x, "then"));
    const el = findTop(rest, (x) => isW(x, "else"), Math.max(0, th));
    this.i = this.t.length;
    if (th < 0) return unknown("if");
    const c = parseExpr(rest.slice(0, th), this.ctx);
    const a = el < 0 ? rest.slice(th + 1) : rest.slice(th + 1, el);
    const b = el < 0 ? [] : rest.slice(el + 1);
    return { kind: "lambda", params: [], body: [{ kind: "branch", conds: [c, null], branches: [exprStmts(a, this.ctx), exprStmts(b, this.ctx)], loc: loc(this.t) }], expr: null, loc: loc(this.t) };
  }

  caseExpr(): SExpr {
    this.i++;
    const rest = this.t.slice(this.i);
    const of = findTop(rest, (x) => isW(x, "of"));
    this.i = this.t.length;
    if (of < 0) return unknown("case");
    const scrut = parseExpr(rest.slice(0, of), this.ctx);
    const alts = items(rest.slice(of + 1));
    const branches = alts.map((alt) => {
      const arrow = findTop(alt, (x) => isOp(x, "->"));
      return arrow < 0 ? [] : exprStmts(alt.slice(arrow + 1), this.ctx);
    });
    return { kind: "lambda", params: [], body: [{ kind: "expr", e: scrut, loc: loc(rest), src: text(rest) }, { kind: "branch", conds: alts.map(() => null), branches, loc: loc(rest) }], expr: null, loc: loc(rest) };
  }

  letExpr(): SExpr {
    this.i++;
    const rest = this.t.slice(this.i);
    const inAt = findTop(rest, (x) => isW(x, "in"));
    this.i = this.t.length;
    const binds = inAt < 0 ? rest : rest.slice(0, inAt);
    const nodes = decls(items(binds), this.ctx, false);
    const body = inAt < 0 ? [] : exprStmts(rest.slice(inAt + 1), this.ctx);
    return { kind: "lambda", params: [], body: [...nodes, ...body], expr: null, loc: loc(rest) };
  }

  paren(): SExpr {
    const c = closeAt(this.t, this.i);
    const inner = this.t.slice(this.i + 1, c < 0 ? this.t.length : c);
    this.i = c < 0 ? this.t.length : c + 1;
    if (inner.length === 0) return { kind: "list", items: [] };
    // 演算子の切り出し (+) / (+ 1) / (`div` 2) / (x +)
    if (inner.length === 1 && inner[0].k === "op") return { kind: "sym", name: inner[0].v };
    if (inner[0].k === "op" && !["(", "[", "\\", "-"].includes(inner[0].v)) return { kind: "sym", name: `(${inner[0].v})` };
    const parts = splitTop(inner, ",");
    if (parts.length > 1) return { kind: "list", items: parts.map((p) => parseExpr(p, this.ctx)) };
    return parseExpr(inner, this.ctx);
  }

  bracket(): SExpr {
    const c = closeAt(this.t, this.i);
    const inner = this.t.slice(this.i + 1, c < 0 ? this.t.length : c);
    this.i = c < 0 ? this.t.length : c + 1;
    if (inner.length === 0) return { kind: "list", items: [] };
    // 内包表記 [e | x <- xs, cond]
    const bar = findTop(inner, (x) => isOp(x, "|"));
    if (bar > 0) {
      const elem = parseExpr(inner.slice(0, bar), this.ctx);
      const gens: { vars: string[]; iter: SExpr }[] = [];
      const conds: SExpr[] = [];
      for (const q of splitTop(inner.slice(bar + 1), ",")) {
        const arrow = findTop(q, (x) => isOp(x, "<-"));
        if (arrow >= 0) gens.push({ vars: q.slice(0, arrow).filter((x) => x.k === "ident").map((x) => x.v), iter: parseExpr(q.slice(arrow + 1), this.ctx) });
        else if (!isW(q[0], "let")) conds.push(parseExpr(q, this.ctx));
      }
      return { kind: "comp", elem, gens, conds };
    }
    // 範囲 [a..b] / [a, b .. c] / [a..]
    const dots = findTop(inner, (x) => isOp(x, ".."));
    if (dots >= 0) {
      const before = splitTop(inner.slice(0, dots), ",");
      const from = parseExpr(before[0], this.ctx);
      const toToks = inner.slice(dots + 1);
      if (toToks.length === 0) return { kind: "range", from, to: unknown("∞"), step: null, inclusive: true };
      const to = parseExpr(toToks, this.ctx);
      if (before.length === 2) {
        // [n, n-1 .. 1] は大きい方まで
        const a = evalConst(from, this.ctx.consts);
        const b = evalConst(to, this.ctx.consts);
        if (a !== null && b !== null && a > b) return { kind: "range", from: to, to: from, step: null, inclusive: true };
        if (a === null && b !== null) return { kind: "range", from: to, to: from, step: null, inclusive: true };
      }
      return { kind: "range", from, to, step: null, inclusive: true };
    }
    return { kind: "list", items: splitTop(inner, ",").map((p) => parseExpr(p, this.ctx)) };
  }
}

function closeAt(toks: readonly Tok[], i: number): number {
  let d = 0;
  for (let j = i; j < toks.length; j++) {
    const t = toks[j];
    if (t.k !== "op") continue;
    if (t.v === "(" || t.v === "[" || t.v === "{") d++;
    else if (t.v === ")" || t.v === "]" || t.v === "}") {
      d--;
      if (d === 0) return j;
    }
  }
  return -1;
}

const KEYWORDS = new Set(["then", "else", "of", "in", "where", "deriving", "=", "|"]);
function startsAtom(t: Tok): boolean {
  if (t.k === "num" || t.k === "str") return true;
  if (t.k === "ident") return !KEYWORDS.has(t.v);
  return t.k === "op" && ["(", "[", "\\"].includes(t.v);
}

/** 関数に引数を足す(部分適用の続き・合成・$ の右辺) */
function apply(f: SExpr, args: SExpr[]): SExpr {
  if (args.length === 0) return f;
  if (f.kind === "sym") {
    // zip [0..] xs の無限の範囲は長さの候補から外す
    const xs = f.name === "zip" || f.name === "zip3" || f.name === "zipWith" ? args.filter((a) => !(a.kind === "range" && a.to.kind === "unknown")) : args;
    return { kind: "call", name: f.name, ns: null, args: xs };
  }
  if (f.kind === "call" && f.name === "__compose") return apply(f.args[0], [apply(f.args[1], args)]);
  if (f.kind === "call") return { ...f, args: [...f.args, ...args] };
  return { kind: "call", name: "", ns: null, args: [f, ...args] };
}

function combine(op: string, l: SExpr, r: SExpr): SExpr {
  switch (op) {
    case "$":
    case "$!":
    case "<$>":
    case "<&>":
      return op === "<&>" ? apply(r, [l]) : apply(l, [r]);
    case ">>=":
      return apply(r, [l]);
    case "=<<":
      return apply(l, [r]);
    case ".":
      return { kind: "call", name: "__compose", ns: null, args: [l, r] };
    case ">>":
    case "*>":
    case "<*":
    case "<*>":
    case "<>":
    case "&":
      return { kind: "list", items: [l, r] };
    case "&&":
    case "||":
      return { kind: "logic", op, l, r };
    case "==":
    case "/=":
    case "<":
    case "<=":
    case ">":
    case ">=":
      return { kind: "cmp", op: op === "/=" ? "!=" : op, l, r } as SExpr;
    case "`elem`":
      return { kind: "call", name: "elem", ns: null, args: [l, r] };
    case "`notElem`":
      return { kind: "call", name: "notElem", ns: null, args: [l, r] };
    case ":":
      return { kind: "call", name: "cons", ns: null, args: [l, r] };
    case "++":
      return { kind: "call", name: "++", ns: null, args: [l, r] };
    case "!!":
      return { kind: "call", name: "!!", ns: null, args: [l, r] };
    case "!":
    case "V.!":
      return { kind: "index", of: l, idx: [r] };
    case "`div`":
    case "`quot`":
      return { kind: "bin", op: "/", l, r };
    case "`mod`":
    case "`rem`":
      return { kind: "bin", op: "%", l, r };
    case "^":
    case "^^":
    case "**":
      return { kind: "bin", op: "**", l, r };
    case "+":
    case "-":
    case "*":
    case "/":
      return { kind: "bin", op, l, r } as SExpr;
    default:
      if (op.startsWith("`")) return { kind: "call", name: op.slice(1, -1), ns: null, args: [l, r] };
      return { kind: "list", items: [l, r] };
  }
}

function parseExpr(toks: readonly Tok[], ctx: Ctx): SExpr {
  if (toks.length === 0) return unknown();
  try {
    return new HsExpr(toks, ctx).expr();
  } catch {
    return unknown(text(toks, 20));
  }
}

// ---------------------------------------------------------------------------
// 文(do の並び・式の本体)

/** 式が入力を読むか(getLine / readInts のような入力の関数を含む) */
function readsInput(e: SExpr | null, ctx: Ctx): boolean {
  let found = false;
  const visit = (x: SExpr | null | undefined): void => {
    if (!x || found) return;
    if (x.kind === "sym" && (INPUT_PRIMS.has(x.name) || ctx.inputFns.has(x.name))) found = true;
    else if (x.kind === "call") {
      if (INPUT_PRIMS.has(x.name) || ctx.inputFns.has(x.name)) found = true;
      x.args.forEach(visit);
    } else if (x.kind === "list") x.items.forEach(visit);
    else if (x.kind === "bin" || x.kind === "cmp" || x.kind === "logic") {
      visit(x.l);
      visit(x.r);
    }
  };
  visit(e);
  return found;
}

/** 反復の関数の呼び出しをループにする。そうでなければ null */
function iterLoop(e: SExpr, l: Loc, src: string, ctx: Ctx): IrNode | null {
  if (e.kind !== "call") return null;
  const it = ITERS[e.name];
  if (!it) return null;
  const coll = e.args[it.coll];
  const fn = e.args[it.fn];
  if (!coll) return null;
  let v: string | null = null;
  let body: IrNode[] = [];
  if (fn && fn.kind === "lambda") {
    v = fn.params[0] ?? null;
    body = fn.body.length ? fn.body : fn.expr ? [{ kind: "expr", e: fn.expr, loc: l, src }] : [];
  } else if (fn) {
    // mapM_ print xs / replicateM n getLine: 1回ぶんの呼び出し
    body = [{ kind: "expr", e: apply(fn, it.count ? [] : [{ kind: "sym", name: "__x" }]), loc: l, src }];
  }
  const bound = it.count
    ? { form: "for-range" as const, var: v, from: null, to: coll, step: null, inclusive: false }
    : coll.kind === "range"
      ? { form: "for-range" as const, var: v, from: coll.from, to: coll.to, step: coll.step, inclusive: coll.inclusive }
      : { form: "for-in" as const, var: v, coll };
  void ctx;
  return { kind: "loop", bound, body, hasBreak: false, loc: l, src };
}

/** 式を文の並びにする(反復の関数はループ、when / unless は分岐) */
function exprStmts(toks: readonly Tok[], ctx: Ctx): IrNode[] {
  if (toks.length === 0) return [];
  if (isW(toks[0], "do")) return doBlock(toks.slice(1), ctx);
  const e = parseExpr(toks, ctx);
  return exprNodes(e, loc(toks), text(toks), ctx);
}

/** 呼び出しの引数に入力の関数そのもの(readLn >>= print . fib の readLn)が来たら、読んだ値 n に置き換える */
function inputArgs(e: SExpr, ctx: Ctx, pre: IrNode[], l: Loc, src: string): SExpr {
  if (e.kind !== "call") return e;
  const args = e.args.map((a) => {
    if (a.kind === "sym" && (INPUT_PRIMS.has(a.name) || ctx.inputFns.has(a.name))) {
      pre.push({ kind: "input", scalars: ["n"], arrays: [], lens: {}, loc: l, via: src });
      ctx.inputs.add("n");
      return { kind: "sym", name: "n" } as SExpr;
    }
    return inputArgs(a, ctx, pre, l, src);
  });
  return { ...e, args };
}

function exprNodes(e0: SExpr, l: Loc, src: string, ctx: Ctx): IrNode[] {
  const pre: IrNode[] = [];
  const e = inputArgs(e0, ctx, pre, l, src);
  if (pre.length) return [...pre, ...exprNodes(e, l, src, ctx)];
  const lp = iterLoop(e, l, src, ctx);
  if (lp) return [lp];
  if (e.kind === "call" && (e.name === "when" || e.name === "unless") && e.args.length >= 2) {
    const body = e.args[1];
    const nodes = body.kind === "lambda" ? body.body : [{ kind: "expr" as const, e: body, loc: l, src }];
    return [{ kind: "branch", conds: [e.args[0]], branches: [nodes], loc: l }];
  }
  if (e.kind === "call" && (e.name === "forever") && e.args[0]) {
    const b = e.args[0];
    return [{ kind: "loop", bound: { form: "while", cond: null, doWhile: false }, body: b.kind === "lambda" ? b.body : [{ kind: "expr", e: b, loc: l, src }], hasBreak: false, loc: l, src }];
  }
  // a >> b(と if / case / let / do の本体)は並べる
  if (e.kind === "list" && e.items.length === 2) return [...exprNodes(e.items[0], l, src, ctx), ...exprNodes(e.items[1], l, src, ctx)];
  if (e.kind === "lambda" && e.params.length === 0) return e.body;
  return [{ kind: "expr", e: selfArgs(e, ctx), loc: l, src }];
}

/** 自己呼び出しの引数の (x:xs) の xs を「仮引数 - 1」にする(リストの長さで1ずつ進む再帰) */
function selfArgs(e: SExpr, ctx: Ctx): SExpr {
  const s = ctx.self;
  if (!s || s.tails.size === 0) return e;
  const fix = (x: SExpr): SExpr => {
    if (x.kind === "call") {
      const args = x.args.map(fix);
      if (x.name === s.name) return { ...x, args: args.map((a) => (a.kind === "sym" && s.tails.has(a.name) ? { kind: "bin", op: "-", l: { kind: "sym", name: s.tails.get(a.name)! }, r: { kind: "num", value: 1 } } : a)) };
      return { ...x, args };
    }
    if (x.kind === "bin") return { ...x, l: fix(x.l), r: fix(x.r) };
    if (x.kind === "list") return { ...x, items: x.items.map(fix) };
    if (x.kind === "cond") return { ...x, a: fix(x.a), b: fix(x.b) };
    return x;
  };
  return fix(e);
}

/** do の並び */
function doBlock(toks: readonly Tok[], ctx: Ctx): IrNode[] {
  const out: IrNode[] = [];
  for (const st of items(toks)) {
    const l = loc(st);
    const src = text(st);
    if (isW(st[0], "let")) {
      out.push(...decls(items(st.slice(1)), ctx, false));
      continue;
    }
    const arrow = findTop(st, (x) => isOp(x, "<-"));
    if (arrow > 0) {
      const pat = st.slice(0, arrow);
      const rhs = st.slice(arrow + 1);
      const e = parseExpr(rhs, ctx);
      const names = pat.filter((x) => x.k === "ident" && x.v !== "_").map((x) => x.v);
      const fixed = isOp(pat[0], "[") || isOp(pat[0], "(");
      if (readsInput(e, ctx)) {
        // [n, m] <- … / (a, b) <- … は固定長(スカラ)、xs <- map read . words <$> getLine は配列
        const counted = e.kind === "call" && (e.name === "replicateM" || e.name === "forM" || e.name === "mapM");
        const arrays = fixed ? [] : isListRead(e) || counted ? names : [];
        const scalars = fixed || arrays.length === 0 ? names : [];
        const lens: Record<string, SExpr> = {};
        if (counted && e.kind === "call" && arrays[0] && e.args[0]) lens[arrays[0]] = e.args[0];
        out.push({ kind: "input", scalars, arrays, lens, loc: l, via: src });
        names.forEach((n) => ctx.inputs.add(n));
        // replicateM q readInts のように回数ぶん読むのは、読み取りのループ
        if (counted && e.kind === "call" && e.args[0]) out.push({ kind: "expr", e: { kind: "call", name: "replicateM", ns: null, args: [e.args[0]] }, loc: l, src });
        continue;
      }
      const lp = iterLoop(e, l, src, ctx);
      if (lp) {
        out.push(lp);
        continue;
      }
      const target: SExpr = names.length === 1 && !fixed ? { kind: "sym", name: names[0] } : { kind: "list", items: names.map((n) => ({ kind: "sym", name: n }) as SExpr) };
      out.push({ kind: "assign", target, op: "=", value: selfArgs(e, ctx), loc: l, src });
      continue;
    }
    out.push(...exprStmts(st, ctx));
  }
  return out;
}

/** リストを読む形か(words / lines / map / replicateM / getContents) */
function isListRead(e: SExpr): boolean {
  let list = false;
  const visit = (x: SExpr | null | undefined): void => {
    if (!x || list) return;
    if (x.kind === "call") {
      if (["words", "lines", "map", "BS.words", "BS.lines", "replicateM", "unfoldr", "getContents", "BS.getContents", "mapM", "readInts"].includes(x.name)) list = true;
      x.args.forEach(visit);
    } else if (x.kind === "sym" && ["getContents", "BS.getContents"].includes(x.name)) list = true;
  };
  visit(e);
  return list;
}

// ---------------------------------------------------------------------------
// 定義(関数の等式・0引数の束縛)

interface Eq {
  name: string;
  pats: Tok[][];
  /** ガードの並び(ガードが無ければ cond は null の1つ) */
  alts: { cond: SExpr | null; rhs: Tok[] }[];
  where: Tok[];
  toks: Tok[];
}

/** 仮引数の並びを字句の原子ごとに分ける(f (x:xs) acc → [(x:xs)], [acc]) */
function patterns(toks: readonly Tok[]): Tok[][] {
  const out: Tok[][] = [];
  let i = 0;
  while (i < toks.length) {
    const t = toks[i];
    if (isOp(t, "(") || isOp(t, "[")) {
      const c = closeAt(toks, i);
      out.push(toks.slice(i, c < 0 ? toks.length : c + 1));
      i = c < 0 ? toks.length : c + 1;
      continue;
    }
    // !acc / ~x / x@(…)
    if (t.k === "op" && (t.v === "!" || t.v === "~")) {
      i++;
      continue;
    }
    if (t.k === "ident" && isOp(toks[i + 1], "@")) {
      out.push([t]);
      i += 2;
      if (isOp(toks[i], "(") || isOp(toks[i], "[")) i = closeAt(toks, i) + 1;
      else i++;
      continue;
    }
    out.push([t]);
    i++;
  }
  return out;
}

function parseEq(toks: Tok[], ctx: Ctx): Eq | null {
  const first = toks[0];
  if (!first || first.k !== "ident" || !/^[a-z_]/.test(first.v)) return null;
  // where の位置(同じ等式のガード全体に効く)
  const whereAt = findTop(toks, (x) => isW(x, "where"));
  const body = whereAt < 0 ? toks : toks.slice(0, whereAt);
  const where = whereAt < 0 ? [] : toks.slice(whereAt + 1);
  const eq = findTop(body, (x) => isOp(x, "="));
  const bar = findTop(body, (x) => isOp(x, "|"));
  const headEnd = bar >= 0 && (eq < 0 || bar < eq) ? bar : eq;
  if (headEnd < 0) return null;
  const pats = patterns(body.slice(1, headEnd));
  const alts: Eq["alts"] = [];
  if (bar >= 0 && (eq < 0 || bar < eq)) {
    // | g1 = e1 | g2 = e2
    for (const part of splitTop(body.slice(bar + 1), "|")) {
      const e = findTop(part, (x) => isOp(x, "="));
      if (e < 0) continue;
      const g = part.slice(0, e);
      alts.push({ cond: isW(g[0], "otherwise") ? null : parseExpr(g, ctx), rhs: part.slice(e + 1) });
    }
  } else alts.push({ cond: null, rhs: body.slice(eq + 1) });
  return { name: first.v, pats, alts, where, toks };
}

/** 等式を関数(引数あり)か束縛(引数なし)の IR にする */
function decls(its: Tok[][], ctx: Ctx, top: boolean): IrNode[] {
  const out: IrNode[] = [];
  const groups = new Map<string, Eq[]>();
  const order: string[] = [];
  for (const it of its) {
    const first = it[0];
    if (!first) continue;
    // 型の宣言・import・data などは読み捨てる
    if (first.k === "ident" && ["import", "module", "data", "type", "newtype", "class", "instance", "deriving", "infixl", "infixr", "infix", "default", "foreign"].includes(first.v)) continue;
    if (findTop(it, (x) => isOp(x, "::")) > 0 && findTop(it, (x) => isOp(x, "=")) < 0) continue;
    // (a, b) = … / [a, b] = … の分割の束縛
    if (isOp(first, "(") || isOp(first, "[")) {
      const eq = findTop(it, (x) => isOp(x, "="));
      if (eq > 0) {
        const names = it.slice(0, eq).filter((x) => x.k === "ident").map((x) => x.v);
        const e = parseExpr(it.slice(eq + 1), ctx);
        out.push({ kind: "assign", target: { kind: "list", items: names.map((n) => ({ kind: "sym", name: n }) as SExpr) }, op: "=", value: e, loc: loc(it), src: text(it) });
      }
      continue;
    }
    const eq = parseEq(it, ctx);
    if (!eq) continue;
    if (!groups.has(eq.name)) {
      groups.set(eq.name, []);
      order.push(eq.name);
    }
    groups.get(eq.name)!.push(eq);
  }
  for (const name of order) {
    const eqs = groups.get(name)!;
    const arity = Math.max(...eqs.map((e) => e.pats.length));
    if (arity === 0) {
      // 0引数の束縛: x = expr(main = do … は関数、それ以外は値)
      const e0 = eqs[0];
      const rhs = e0.alts[0]?.rhs ?? [];
      const whereNodes = decls(items(e0.where), ctx, false);
      if (name === "main" || isW(rhs[0], "do")) {
        out.push({ kind: "func", name, params: [], decorators: [], body: [...whereNodes, ...exprStmts(rhs, ctx)], loc: loc(e0.toks), isLambda: false, selfParam: null });
        continue;
      }
      const e = parseExpr(rhs, ctx);
      const c = evalConst(e, ctx.consts);
      if (c !== null) ctx.consts[name] = { value: c, line: e0.toks[0].line };
      if (top && readsInput(e, ctx)) ctx.inputFns.add(name);
      if (readsInput(e, ctx) && !top) {
        out.push(...whereNodes, { kind: "input", scalars: isListRead(e) ? [] : [name], arrays: isListRead(e) ? [name] : [], lens: {}, loc: loc(e0.toks), via: text(e0.toks) });
        ctx.inputs.add(name);
        continue;
      }
      out.push(...whereNodes, { kind: "assign", target: { kind: "sym", name }, op: "=", value: e, loc: loc(e0.toks), src: text(e0.toks) });
      continue;
    }
    out.push(funcOf(name, eqs, arity, ctx));
  }
  return out;
}

/** 関数の等式の並び → func(等式ごとの分岐。リテラルのパターンは 仮引数 == 値 の条件) */
function funcOf(name: string, eqs: Eq[], arity: number, ctx: Ctx): IrNode {
  // 仮引数の名前: 変数のパターンがあればそれ、(x:xs) なら xs、無ければ _k
  const params: string[] = [];
  const tails = new Map<string, string>();
  for (let k = 0; k < arity; k++) {
    let p = "";
    for (const e of eqs) {
      const pt = e.pats[k];
      if (pt && pt.length === 1 && pt[0].k === "ident" && pt[0].v !== "_" && /^[a-z]/.test(pt[0].v)) {
        p = pt[0].v;
        break;
      }
    }
    if (!p) {
      const cons = eqs.map((e) => e.pats[k]).find((pt) => pt && findTop(pt.slice(1, -1), (x) => isOp(x, ":")) >= 0);
      p = cons ? `${cons.filter((x) => x.k === "ident").pop()?.v ?? "xs"}0` : `_${k + 1}`;
    }
    params.push(p);
  }
  for (const e of eqs) {
    e.pats.forEach((pt, k) => {
      if (pt && isOp(pt[0], "(") && findTop(pt.slice(1, -1), (x) => isOp(x, ":")) >= 0) {
        const tail = pt.filter((x) => x.k === "ident").pop();
        if (tail) tails.set(tail.v, params[k]);
      }
    });
  }
  const prevSelf = ctx.self;
  ctx.self = { name, tails };
  const conds: (SExpr | null)[] = [];
  const branches: IrNode[][] = [];
  const pre: IrNode[] = [];
  for (const e of eqs) {
    // リテラルのパターン f 0 = … / f [] = … は 仮引数 == 値
    const litConds: SExpr[] = [];
    e.pats.forEach((pt, k) => {
      if (pt?.length === 1 && pt[0].k === "num") litConds.push({ kind: "cmp", op: "==", l: { kind: "sym", name: params[k] }, r: { kind: "num", value: pt[0].num ?? 0 } });
      if (pt?.length === 2 && isOp(pt[0], "[") && isOp(pt[1], "]")) litConds.push({ kind: "cmp", op: "==", l: { kind: "size", of: { kind: "sym", name: params[k] } }, r: { kind: "num", value: 0 } });
    });
    pre.push(...decls(items(e.where), ctx, false));
    for (const alt of e.alts) {
      const cs = [...litConds, ...(alt.cond ? [alt.cond] : [])];
      const cond = cs.length === 0 ? null : cs.reduce((a, b) => ({ kind: "logic", op: "&&", l: a, r: b }) as SExpr);
      conds.push(cond);
      branches.push(returns(exprStmts(alt.rhs, ctx)));
    }
  }
  ctx.self = prevSelf;
  const body: IrNode[] = [...pre, conds.length === 1 && conds[0] === null ? branches[0] : [{ kind: "branch", conds, branches, loc: loc(eqs[0].toks) } as IrNode]].flat();
  return { kind: "func", name, params, decorators: [], body, loc: { line: eqs[0].toks[0].line, endLine: eqs[eqs.length - 1].toks[eqs[eqs.length - 1].toks.length - 1].line }, isLambda: false, selfParam: null };
}

/** 式の本体の最後を return にする(再帰の打ち切りの判定に使う) */
function returns(nodes: IrNode[]): IrNode[] {
  if (nodes.length === 0) return nodes;
  const last = nodes[nodes.length - 1];
  if (last.kind === "expr") return [...nodes.slice(0, -1), { kind: "return", value: last.e, loc: last.loc }];
  return nodes;
}

export function parseHaskell(toks: readonly Tok[], warn: (w: FrontWarning) => void, lineCount: number): Program {
  const ctx: Ctx = { warn, inputFns: new Set(), inputs: new Set(), consts: {}, self: null };
  // 先に top-level の入力の関数(readInts = … <$> BS.getLine)を集める
  const tops = items(toks);
  for (let pass = 0; pass < 2; pass++) {
    for (const it of tops) {
      const eq = findTop(it, (x) => isOp(x, "="));
      if (it[0]?.k === "ident" && eq > 0 && eq <= 3) {
        const e = parseExpr(it.slice(eq + 1), ctx);
        if (readsInput(e, ctx)) ctx.inputFns.add(it[0].v);
      }
    }
  }
  const nodes = decls(tops, ctx, true);
  return { lang: "haskell", nodes, consts: ctx.consts, warnings: [], lineCount };
}
