// 生のブロック木(Raw) → IR。言語ごとの違いは LangSpec の表で吸収し、ループの見出しは
// どの書き方でも5つの形(for-c / for-range / for-in / while / count)のどれかに揃える。
import type { ContainerKind, IrNode, LoopBound, SExpr, Tok } from "./ir.ts";
import { paramNames, parseStatement, parseTokens, splitTop } from "./sexpr.ts";
import { rangeOf } from "./semantics.ts";
import { findTop, isOp, isWord, matchClose, tokText } from "./spec.ts";
import type { Raw, RawBlock } from "./spec.ts";
import { lambdaFunc, loc, lowerStmt } from "./lowerStmt.ts";
import type { LowerCtx } from "./lowerStmt.ts";

export type { LowerCtx } from "./lowerStmt.ts";

/** break / return などループを抜ける文を、子のループ・関数を跨がずに含むか(F8) */
function hasBreak(body: readonly Raw[], inSwitch = false): boolean {
  for (const r of body) {
    if (r.t === "stmt") {
      const hit = r.toks.some((x, i) => x.k === "ident" && !x.sigil && (i === 0 || isWord(r.toks[i - 1], "and") || isWord(r.toks[i - 1], "or") || isOp(r.toks[i - 1], "&&") || isOp(r.toks[i - 1], "||")) && (x.v === "return" || x.v === "goto" || x.v === "exit" || x.v === "die" || x.v === "throw" || x.v === "raise" || (!inSwitch && (x.v === "break" || x.v === "last"))));
      const modifier = r.toks.length > 1 && (isWord(r.toks[0], "break") || isWord(r.toks[0], "last") || isWord(r.toks[0], "return"));
      if (hit || (modifier && !inSwitch)) return true;
      continue;
    }
    if (r.kw === "func" || r.kw === "class") continue;
    const isLoop = ["for", "foreach", "foreach_reverse", "while", "until", "loop", "do", "repeat"].includes(r.kw);
    if (isLoop) {
      // 子のループの break は子のもの。return だけは外まで抜ける
      if (hasReturn(r.body)) return true;
      continue;
    }
    const sw = inSwitch || r.kw === "switch" || r.kw === "match" || r.kw === "select" || r.kw === "case";
    if (hasBreak(r.body, sw)) return true;
    for (const e of r.elses ?? []) if (hasBreak(e.body, sw)) return true;
  }
  return false;
}

function hasReturn(body: readonly Raw[]): boolean {
  for (const r of body) {
    if (r.t === "stmt") {
      if (isWord(r.toks[0], "return")) return true;
      continue;
    }
    if (r.kw === "func" || r.kw === "class") continue;
    if (hasReturn(r.body)) return true;
    for (const e of r.elses ?? []) if (hasReturn(e.body)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// ループの見出し

/** for-in の対象を for-range に直せるなら直す */
function forInOrRange(v: string | null, coll: SExpr): LoopBound {
  const r = rangeOf(coll);
  if (r) return { form: "for-range", var: v, from: r.from, to: r.to, step: r.step, inclusive: r.inclusive };
  return { form: "for-in", var: v, coll };
}

/** 見出しの変数名(型や my を除いた最後の識別子) */
function varOf(toks: readonly Tok[]): string | null {
  const ids = toks.filter((x) => x.k === "ident" && !["my", "our", "local", "const", "let", "var", "auto", "mut", "ref", "final", "int", "long", "ll"].includes(x.v));
  return ids.length ? ids[ids.length - 1].v : null;
}

/** C 系の for の初期化部から変数名(int i = 0 / i := 0 / $i = 0 / auto it = s.begin()) */
function initVar(toks: readonly Tok[]): string | null {
  const first = splitTop(toks, ",")[0] ?? [];
  const eq = findTop(first, (x) => x.k === "op" && (x.v === "=" || x.v === ":="));
  if (eq > 0 && first[eq - 1].k === "ident") return first[eq - 1].v;
  return varOf(first);
}

/** 型付きの初期化 int i = 0, j = n を i = 0, j = n として読む */
function initExpr(toks: readonly Tok[], ctx: LowerCtx): SExpr | null {
  if (toks.length === 0) return null;
  const parts = splitTop(toks, ",").map((p) => {
    const eq = findTop(p, (x) => x.k === "op" && (x.v === "=" || x.v === ":="));
    if (eq > 0) return parseTokens(p.slice(eq - 1), ctx.d);
    return parseTokens(p, ctx.d);
  });
  return parts.length === 1 ? parts[0] : { kind: "list", items: parts };
}

export function loopBound(kw: string, head: readonly Tok[], ctx: LowerCtx): LoopBound {
  const d = ctx.d;
  if (kw === "loop") return { form: "while", cond: null, doWhile: false };
  if (kw === "while" || kw === "until") {
    if (head.length === 0) return { form: "while", cond: null, doWhile: false };
    // Rust の while let Some(v) = q.pop_front()
    if (isWord(head[0], "let")) {
      const eq = findTop(head, (x) => isOp(x, "="));
      const cond = eq >= 0 ? parseTokens(head.slice(eq + 1), d) : null;
      const bind = head.slice(1, eq < 0 ? head.length : eq).filter((x) => x.k === "ident" && !["Some", "Ok", "mut", "ref"].includes(x.v)).map((x) => x.v);
      return { form: "while", cond, doWhile: false, bind };
    }
    const cond = parseTokens(head, d);
    return { form: "while", cond: kw === "until" ? { kind: "not", e: cond } : cond, doWhile: false };
  }
  if (kw === "repeat" && head.length > 0) return { form: "count", var: null, count: parseTokens(head, d) };
  // for / foreach
  const semis = splitTop(head, ";");
  if (semis.length === 3) {
    const [a, b, c] = semis;
    return {
      form: "for-c",
      var: initVar(a) ?? varOf(b.slice(0, 1)),
      init: initExpr(a, ctx),
      cond: b.length ? parseTokens(b, d) : null,
      update: c.length ? parseStatement(c, d) : null,
    };
  }
  if (semis.length === 2) {
    // D の foreach (i; 0 .. n) / foreach (i, x; a)
    const vars = semis[0].filter((x) => x.k === "ident");
    return forInOrRange(vars.length ? vars[vars.length - 1].v : null, parseTokens(semis[1], d));
  }
  // C++ / Java の範囲 for: auto& x : a / int x : a / auto [k, v] : mp
  const colon = d.colonRange ? -1 : findTop(head, (x) => isOp(x, ":"));
  if (colon > 0) return forInOrRange(varOf(head.slice(0, colon)), parseTokens(head.slice(colon + 1), d));
  // Go: i, x := range a / i := range n / range a
  const rg = findTop(head, (x) => isWord(x, "range"));
  if (rg >= 0 && ctx.spec.key === "go") {
    const coll = parseTokens(head.slice(rg + 1), d);
    const v = varOf(head.slice(0, Math.max(0, rg - 1)).filter((x) => !isOp(x, ":=") && !isOp(x, "=")));
    const collIsCount = coll.kind === "num" || (coll.kind === "sym" && !/^[a-z]+s$/.test(coll.name) && ctx.consts[coll.name] !== undefined);
    if (collIsCount) return { form: "for-range", var: v, from: null, to: coll, step: null, inclusive: false };
    return { form: "for-in", var: v, coll };
  }
  // PHP: $a as $x / $a as $k => $v
  const as = findTop(head, (x) => isWord(x, "as"));
  if (as > 0 && ctx.spec.key === "php") return forInOrRange(varOf(head.slice(as + 1)), parseTokens(head.slice(0, as), d));
  // x in a / x of a(JS)/ i ∈ 1:n(Julia)
  const inIdx = findTop(head, (x) => (x.k === "ident" && !x.sigil && (x.v === "in" || x.v === "of")) || (x.k === "op" && x.v === "∈"));
  if (inIdx > 0) {
    const vars = head.slice(0, inIdx).filter((x) => x.k === "ident");
    return forInOrRange(vars.length ? vars[vars.length - 1].v : null, parseTokens(head.slice(inIdx + 1), d));
  }
  // Lua の i = a, b[, s] / Julia の i = 1:n
  const eq = findTop(head, (x) => isOp(x, "="));
  if (eq > 0) {
    const v = varOf(head.slice(0, eq));
    const rest = head.slice(eq + 1);
    const parts = splitTop(rest, ",");
    if (parts.length >= 2) {
      const from = parseTokens(parts[0], d);
      const to = parseTokens(parts[1], d);
      const step = parts[2] ? parseTokens(parts[2], d) : null;
      if (step && ((step.kind === "un" && step.op === "-") || (step.kind === "num" && step.value < 0))) {
        return { form: "for-range", var: v, from: to, to: from, step: step.kind === "un" ? step.e : { kind: "num", value: -(step as { value: number }).value }, inclusive: true };
      }
      return { form: "for-range", var: v, from, to, step, inclusive: true };
    }
    return forInOrRange(v, parseTokens(rest, d));
  }
  // Perl: my $x (LIST) / $x (LIST) / (LIST)
  const lastParen = findTop(head, (x) => isOp(x, "("));
  if (lastParen >= 0 && isOp(head[head.length - 1], ")") && matchClose(head, lastParen) === head.length - 1) {
    const v = varOf(head.slice(0, lastParen));
    return forInOrRange(v ?? "_", parseTokens(head.slice(lastParen + 1, head.length - 1), d));
  }
  // Go の for cond { / for {
  if (head.length === 0) return { form: "while", cond: null, doWhile: false };
  return { form: "while", cond: parseTokens(head, d), doWhile: false };
}

// ---------------------------------------------------------------------------
// 関数

interface FuncHead {
  name: string;
  params: string[];
  selfParam: string | null;
  /** C++ のコンストラクタの初期化子リスト a(n), b(m) */
  inits: { name: string; args: Tok[] }[];
}

export function funcHead(head: readonly Tok[], ctx: LowerCtx): FuncHead {
  const spec = ctx.spec;
  let h = head.filter((x) => !(x.k === "ident" && (spec.modifiers.has(x.v) || x.v === "async" || x.v === "local" || x.v === "export" || x.v === "pub")));
  // template<…> を剥がす
  if (isWord(h[0], "template") && isOp(h[1], "<")) {
    let depth = 0;
    let j = 1;
    for (; j < h.length; j++) {
      if (isOp(h[j], "<")) depth++;
      else if (isOp(h[j], ">")) depth--;
      else if (isOp(h[j], ">>")) depth -= 2;
      if (depth <= 0) break;
    }
    h = h.slice(j + 1);
  }
  // ラムダの代入: auto dfs = [&](auto&& self, int v) / const f = (x) => / $f = function ($x) use (&$f)
  const eq = findTop(h, (x) => x.k === "op" && (x.v === "=" || x.v === ":="));
  if (eq > 0) {
    const nameTok = [...h.slice(0, eq)].reverse().find((x) => x.k === "ident");
    const rhs = h.slice(eq + 1);
    let paren = findTop(rhs, (x) => isOp(x, "("));
    if (isOp(rhs[0], "[")) {
      const c = matchClose(rhs, 0);
      paren = isOp(rhs[c + 1], "(") ? c + 1 : -1;
    }
    const pToks = paren >= 0 ? rhs.slice(paren + 1, Math.max(paren + 1, matchClose(rhs, paren))) : rhs.filter((x) => x.k === "ident" && !["function", "func", "sub", "fn", "async"].includes(x.v));
    const params = paren >= 0 ? paramNames(pToks) : pToks.map((x) => x.v);
    const name = nameTok?.v ?? "λ";
    const selfParam = params.length > 0 && (params[0] === "self" || params[0] === name || /auto\s*&&|this\s+auto/.test(tokText(splitTop(pToks, ",")[0] ?? []))) ? params[0] : null;
    return { name, params: selfParam ? params.slice(1) : params, selfParam, inits: [] };
  }
  let i = 0;
  if (h[0]?.k === "ident" && spec.funcWords.has(h[0].v)) {
    i = 1;
    // Go のメソッド func (r *T) name(…)
    if (isOp(h[1], "(") && spec.key === "go") i = matchClose(h, 1) + 1;
  }
  // 名前(Ruby の def self.f / Lua の function t:m / C++ の operator<)
  const paren = findTop(h, (x, j) => j >= i && isOp(x, "("), i);
  let name = "";
  let params: string[] = [];
  let inits: { name: string; args: Tok[] }[] = [];
  if (paren >= 0) {
    const nameTok = h[paren - 1];
    if (nameTok && nameTok.k === "ident") name = nameTok.v;
    else if (paren >= 2 && isWord(h[paren - 2], "operator")) name = `operator${h[paren - 1].v}`;
    else if (h[i]?.k === "ident") name = h[i].v;
    const c = matchClose(h, paren);
    params = paramNames(h.slice(paren + 1, c < 0 ? h.length : c));
    // 初期化子リスト : par(n, -1), sz(n, 1)
    const tail = c >= 0 ? h.slice(c + 1) : [];
    const colon = tail.findIndex((x) => isOp(x, ":"));
    if (colon >= 0) {
      inits = splitTop(tail.slice(colon + 1), ",").flatMap((p) => {
        const pp = p.findIndex((x) => isOp(x, "(") || isOp(x, "{"));
        if (pp <= 0 || p[pp - 1].k !== "ident") return [];
        return [{ name: p[pp - 1].v, args: p.slice(pp + 1, Math.max(pp + 1, matchClose(p, pp))) }];
      });
    }
  } else {
    // 括弧の無い定義(Ruby の def f a, b / Perl の sub f / シェルの function f)
    const ids = h.slice(i).filter((x) => x.k === "ident");
    const dot = h.findIndex((x, j) => j > i && (isOp(x, ".") || isOp(x, ":")));
    name = dot > 0 && h[dot + 1]?.k === "ident" ? h[dot + 1].v : (ids[0]?.v ?? "");
    params = ids.slice(1).map((x) => x.v).filter((v) => v !== name);
  }
  return { name: name || "λ", params, selfParam: null, inits };
}

/** Perl の sub の仮引数を本体の先頭(my ($a, $b) = @_ / my $x = shift)から取る */
function perlParams(body: readonly IrNode[]): string[] {
  const out: string[] = [];
  for (const n of body.slice(0, 6)) {
    if (n.kind !== "assign" || !n.value) break;
    const v = n.value;
    const fromArgs = (v.kind === "sym" && (v.name === "_" || v.name === "shift")) || (v.kind === "call" && v.name === "shift");
    if (!fromArgs) break;
    if (n.target.kind === "list") out.push(...n.target.items.flatMap((x) => (x.kind === "sym" ? [x.name] : [])));
    else if (n.target.kind === "sym") out.push(n.target.name);
  }
  return out;
}

/** Bash の関数の仮引数を本体の local n=$1 / x=$2 から取る(位置の順に並べる) */
function bashParams(body: readonly IrNode[]): string[] {
  const out: string[] = [];
  for (const n of body.slice(0, 8)) {
    if (n.kind !== "assign" || n.target.kind !== "sym" || !n.value || n.value.kind !== "sym") continue;
    const m = /^__arg(\d)$/.exec(n.value.name);
    if (m) out[Number(m[1]) - 1] = n.target.name;
  }
  return Array.from(out, (x, i) => x ?? `__arg${i + 1}`);
}

function lowerFunc(r: RawBlock, ctx: LowerCtx): IrNode {
  const h = funcHead(r.head, ctx);
  const inner: LowerCtx = { ...ctx, top: false };
  const body = lowerList(r.body, inner);
  const pre: IrNode[] = [];
  for (const it of h.inits) {
    const kind: ContainerKind | undefined = ctx.fields.get(it.name);
    if (!kind || kind === "scalar" || kind === "user") continue;
    const args = splitTop(it.args, ",").filter((x) => x.length).map((x) => parseTokens(x, ctx.d));
    if (args.length === 0) continue;
    pre.push({ kind: "decl", name: it.name, typeName: "", container: kind, dims: [args[0]], init: null, isGlobal: false, costsTime: true, loc: { line: r.line, endLine: r.line } });
  }
  const params = h.params.length === 0 && ctx.spec.key === "perl" ? perlParams(body) : h.params.length === 0 && ctx.spec.key === "bash" ? bashParams(body) : h.params;
  return { kind: "func", name: h.name, params, decorators: r.decorators ?? [], body: [...pre, ...body], loc: { line: r.line, endLine: r.endLine }, isLambda: false, selfParam: h.selfParam };
}

// ---------------------------------------------------------------------------
// ブロック

function lowerBlock(r: RawBlock, ctx: LowerCtx): IrNode[] {
  const spec = ctx.spec;
  const l = { line: r.line, endLine: r.endLine };
  if (r.kw === "func") {
    // Julia の f(x) = expr のような1行の定義は head に = があり本体が空
    return [lowerFunc(r, ctx)];
  }
  if (r.kw === "class") {
    // フィールドの種類を先に集め、コンストラクタの初期化子リストで使う
    const fields = new Map(ctx.fields);
    const inner: LowerCtx = { ...ctx, fields };
    const nodes: IrNode[] = [];
    for (const b of r.body) {
      if (b.t === "stmt") {
        for (const n of lowerStmt(b.toks, inner)) {
          if (n.kind === "decl") fields.set(n.name, n.container);
          nodes.push(n);
        }
      }
    }
    for (const b of r.body) if (b.t === "block") nodes.push(...lowerBlock(b, inner));
    return nodes;
  }
  if (spec.ifWords.has(r.kw)) {
    const conds: (SExpr | null)[] = [];
    const branches: IrNode[][] = [];
    const pre: IrNode[] = [];
    const cond = (head: readonly Tok[]): SExpr => {
      // Go の if x := f(); x > 0
      const semis = splitTop(head, ";");
      if (semis.length === 2) {
        pre.push(...lowerStmt(semis[0], ctx));
        return parseTokens(semis[1], ctx.d);
      }
      return parseTokens(head, ctx.d);
    };
    const c0 = cond(r.head);
    conds.push(r.kw === "unless" ? { kind: "not", e: c0 } : c0);
    branches.push(lowerList(r.body, ctx));
    for (const e of r.elses ?? []) {
      conds.push(e.kw === "elif" ? cond(e.head) : null);
      branches.push(lowerList(e.body, ctx));
    }
    return [...pre, { kind: "branch", conds, branches, loc: l }];
  }
  if (spec.loopWords.has(r.kw) || r.kw === "do" || r.kw === "repeat") {
    const src = `${r.kw} ${tokText(r.head, 50)}`.trim();
    const body = lowerList(r.body, ctx);
    if (r.kw === "do" || (r.kw === "repeat" && r.tail)) {
      const tail = r.tail && r.tail.length ? parseTokens(r.tail, ctx.d) : null;
      const cond = tail && (r.tailKw === "until" || r.kw === "repeat") ? ({ kind: "not", e: tail } as SExpr) : tail;
      return [{ kind: "loop", bound: { form: "while", cond, doWhile: true }, body, hasBreak: hasBreak(r.body), loc: l, src: r.kw === "do" ? `do … while ${tokText(r.tail ?? [], 40)}` : `repeat … until ${tokText(r.tail ?? [], 40)}` }];
    }
    const bound = loopBound(r.kw, r.head, ctx);
    return [{ kind: "loop", bound, body, hasBreak: hasBreak(r.body), loc: l, src }];
  }
  // switch / match / try / with / using / plain …: 見出しの式を評価して本体を並べる
  const out: IrNode[] = [];
  if (r.head.length > 0 && r.kw !== "plain") {
    const e = parseStatement(r.head, ctx.d);
    if (e.kind !== "unknown") out.push({ kind: "expr", e, loc: l, src: tokText(r.head) });
  }
  out.push(...lowerList(r.body, ctx));
  for (const e of r.elses ?? []) out.push(...lowerList(e.body, ctx));
  return out;
}

export function lowerList(raws: readonly Raw[], ctx: LowerCtx): IrNode[] {
  const out: IrNode[] = [];
  for (const r of raws) {
    try {
      if (r.t === "stmt") out.push(...lowerStmt(r.toks, ctx));
      else out.push(...lowerBlock(r, ctx));
    } catch (err) {
      // 1つの文が読めなくても残りは解析する
      ctx.warn({ line: r.line, code: "internal-error", message: `この文を解析できませんでした (${(err as Error).message})` });
      out.push({ kind: "stmt", loc: loc([], r.line) });
    }
  }
  return out;
}

export { lambdaFunc };
