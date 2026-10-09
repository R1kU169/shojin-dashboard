// 入力形式・制約に出てくる式(2×10^{5} / N-1 / N(N-1)/2 / HW / min(N, 10^5) / |S| / K_i / L_N)を読み、
// BigInt で評価する。値は 10^18 や 2^60-1 を正確に出したいので、Number ではなく BigInt で扱う。

export type Expr =
  | { k: "num"; v: bigint }
  /** 変数。idx が空ならスカラー、あれば配列の要素(K_i なら idx = [i])。bars は |S| のように縦棒で囲んだもの */
  | { k: "ref"; name: string; idx: Expr[]; bars?: boolean }
  /** 縦のくり返しの行番号(1始まり) */
  | { k: "row" }
  /** 横に並ぶ列の番号 */
  | { k: "col" }
  | { k: "bin"; op: "+" | "-" | "*" | "/" | "^"; a: Expr; b: Expr }
  | { k: "neg"; a: Expr }
  | { k: "call"; fn: "min" | "max"; args: Expr[] };

export const num = (v: bigint | number): Expr => ({ k: "num", v: BigInt(v) });
export const bin = (op: "+" | "-" | "*" | "/" | "^", a: Expr, b: Expr): Expr => ({ k: "bin", op, a, b });

// ---- 字句 ----------------------------------------------------------------------

type Tok =
  | { t: "num"; v: bigint }
  | { t: "id"; name: string; sub: string | null }
  | { t: "op"; v: string };

/** 中かっこの対応を見て、s[i] の "{" に対応する "}" の位置を返す(無ければ -1) */
export function closeBrace(s: string, i: number): number {
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === "{") depth++;
    else if (s[j] === "}" && --depth === 0) return j;
  }
  return -1;
}

/**
 * 識別子の直後の添字を読む。A_{N-1} / A_1 / A_N / A_{i,j}。
 * 中かっこなしの添字は英数字の連続(手で書いた A_10 を A の 10 番目と読む)。
 */
export function readSub(s: string, i: number): { sub: string; end: number } | null {
  if (s[i] !== "_") return null;
  if (s[i + 1] === "{") {
    const j = closeBrace(s, i + 1);
    if (j < 0) return null;
    return { sub: s.slice(i + 2, j).trim(), end: j + 1 };
  }
  const m = /^[A-Za-z0-9]+/.exec(s.slice(i + 1));
  return m ? { sub: m[0], end: i + 1 + m[0].length } : null;
}

function lex(src: string): Tok[] | null {
  const s = src.replace(/×|·|\*/g, "*").replace(/−/g, "-");
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const n = /^\d+/.exec(s.slice(i));
    if (n) {
      out.push({ t: "num", v: BigInt(n[0]) });
      i += n[0].length;
      // 1e9 / 2e5 のような書き方
      const e = /^e(\d+)/.exec(s.slice(i));
      if (e) {
        const last = out[out.length - 1] as { t: "num"; v: bigint };
        last.v *= 10n ** BigInt(e[1]);
        i += e[0].length;
      }
      continue;
    }
    const id = /^[A-Za-z][A-Za-z0-9']*/.exec(s.slice(i));
    if (id) {
      i += id[0].length;
      const sub = readSub(s, i);
      if (sub) i = sub.end;
      out.push({ t: "id", name: id[0], sub: sub ? sub.sub : null });
      continue;
    }
    if ("+-*/^(),|{}".includes(c)) {
      out.push({ t: "op", v: c });
      i++;
      continue;
    }
    return null;
  }
  return out;
}

// ---- 構文 ----------------------------------------------------------------------

/** 添字の中身(カンマ区切り)を式の列にする。i や j のような添字もそのまま変数として読む */
export function parseSubscript(sub: string): Expr[] | null {
  const parts = splitTop(sub, ",");
  const out: Expr[] = [];
  for (const p of parts) {
    const e = parseExpr(p);
    if (!e) return null;
    out.push(e);
  }
  return out;
}

/** かっこ・中かっこの外にある区切り文字で分ける */
export function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const c of s) {
    if (c === "(" || c === "{") depth++;
    else if (c === ")" || c === "}") depth--;
    if (c === sep && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((p) => p.trim());
}

/** 式を読む。読めなければ null */
export function parseExpr(src: string): Expr | null {
  const toks = lex(src);
  if (!toks || toks.length === 0) return null;
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => {
    const t = toks[p];
    return t !== undefined && t.t === "op" && t.v === v;
  };

  const primary = (): Expr | null => {
    const t = toks[p];
    if (!t) return null;
    if (t.t === "num") {
      p++;
      return { k: "num", v: t.v };
    }
    if (t.t === "id") {
      p++;
      if ((t.name === "min" || t.name === "max") && isOp("(")) {
        p++;
        const args: Expr[] = [];
        for (;;) {
          const a = additive();
          if (!a) return null;
          args.push(a);
          if (isOp(",")) {
            p++;
            continue;
          }
          if (isOp(")")) {
            p++;
            break;
          }
          return null;
        }
        return { k: "call", fn: t.name, args };
      }
      const idx = t.sub === null ? [] : parseSubscript(t.sub);
      if (!idx) return null;
      return { k: "ref", name: t.name, idx };
    }
    if (t.v === "(" || t.v === "{") {
      const close = t.v === "(" ? ")" : "}";
      p++;
      const e = additive();
      if (!e || !isOp(close)) return null;
      p++;
      return e;
    }
    if (t.v === "|") {
      p++;
      const inner = additive();
      if (!inner || !isOp("|")) return null;
      p++;
      if (inner.k === "ref") return { ...inner, bars: true };
      return null;
    }
    return null;
  };

  // 累乗(右結合)。10^{18} は中かっこを primary が読む
  const power = (): Expr | null => {
    const a = primary();
    if (!a) return null;
    if (isOp("^")) {
      p++;
      const b = unary();
      if (!b) return null;
      return { k: "bin", op: "^", a, b };
    }
    return a;
  };

  const unary = (): Expr | null => {
    if (isOp("-")) {
      p++;
      const a = unary();
      return a ? { k: "neg", a } : null;
    }
    if (isOp("+")) {
      p++;
      return unary();
    }
    return power();
  };

  // 2N / N(N-1) / HW の暗黙のかけ算もここで読む(| は |S| の始まりとも閉じとも取れるので含めない)
  const startsPrimary = () => {
    const t = peek();
    return t !== undefined && (t.t === "num" || t.t === "id" || (t.t === "op" && (t.v === "(" || t.v === "{")));
  };
  const multiplicative = (): Expr | null => {
    let a = unary();
    if (!a) return null;
    for (;;) {
      if (isOp("*") || isOp("/")) {
        const op = (toks[p] as { v: string }).v as "*" | "/";
        p++;
        const b = unary();
        if (!b) return null;
        a = { k: "bin", op, a, b };
      } else if (startsPrimary()) {
        const b = power();
        if (!b) return null;
        a = { k: "bin", op: "*", a, b };
      } else return a;
    }
  };

  const additive = (): Expr | null => {
    let a = multiplicative();
    if (!a) return null;
    while (isOp("+") || isOp("-")) {
      const op = (toks[p] as { v: string }).v as "+" | "-";
      p++;
      const b = multiplicative();
      if (!b) return null;
      a = { k: "bin", op, a, b };
    }
    return a;
  };

  const e = additive();
  if (!e || p !== toks.length) return null;
  return e;
}

// ---- 評価 ----------------------------------------------------------------------

export interface EvalEnv {
  /**
   * 変数の値。idx の要素が undefined なら、行の中の同じ配列の値(K_i の i など)を返してよい。
   * ref は元の式(t_q のような名前つきの添字を、添字の文字のまま引くのに使う)
   */
  get(name: string, idx: (bigint | undefined)[], bars: boolean, ref: Expr & { k: "ref" }): bigint | undefined;
  row?: bigint;
  col?: bigint;
}

/** BigInt の平方根の切り捨て */
export function isqrt(v: bigint): bigint {
  if (v < 2n) return v < 0n ? 0n : v;
  let x = BigInt(Math.floor(Math.sqrt(Number(v))));
  while (x * x > v) x--;
  while ((x + 1n) * (x + 1n) <= v) x++;
  return x;
}

/** BigInt の床除算(負の数も床へ) */
function floorDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  return (a % b !== 0n && (a < 0n) !== (b < 0n)) ? q - 1n : q;
}

/** 式の値。決まっていない変数があれば undefined */
export function evalExpr(e: Expr, env: EvalEnv): bigint | undefined {
  switch (e.k) {
    case "num":
      return e.v;
    case "row":
      return env.row;
    case "col":
      return env.col;
    case "neg": {
      const a = evalExpr(e.a, env);
      return a === undefined ? undefined : -a;
    }
    case "call": {
      const vs = e.args.map((a) => evalExpr(a, env));
      if (vs.some((v) => v === undefined)) return undefined;
      const bs = vs as bigint[];
      return bs.reduce((m, v) => (e.fn === "min" ? (v < m ? v : m) : v > m ? v : m));
    }
    case "bin": {
      const a = evalExpr(e.a, env);
      const b = evalExpr(e.b, env);
      if (a === undefined || b === undefined) return undefined;
      switch (e.op) {
        case "+":
          return a + b;
        case "-":
          return a - b;
        case "*":
          return a * b;
        case "/":
          return b === 0n ? undefined : floorDiv(a, b);
        case "^":
          return b < 0n || b > 5000n ? undefined : a ** b;
      }
      return undefined;
    }
    case "ref": {
      const idx = e.idx.map((x) => evalExpr(x, env));
      const v = env.get(e.name, idx, !!e.bars, e);
      if (v !== undefined || e.idx.length > 0 || e.bars) return v;
      // HW のように1文字の変数を並べたかけ算
      if (e.name.length > 1 && /^[A-Za-z]+$/.test(e.name)) {
        let prod = 1n;
        for (const ch of e.name) {
          const x = env.get(ch, [], false, { k: "ref", name: ch, idx: [] });
          if (x === undefined) return undefined;
          prod *= x;
        }
        return prod;
      }
      return undefined;
    }
  }
}

/** 式に出てくる変数名(添字の中も含む) */
export function exprRefs(e: Expr, out: Set<string> = new Set()): Set<string> {
  switch (e.k) {
    case "ref":
      out.add(e.name);
      for (const x of e.idx) exprRefs(x, out);
      break;
    case "bin":
      exprRefs(e.a, out);
      exprRefs(e.b, out);
      break;
    case "neg":
      exprRefs(e.a, out);
      break;
    case "call":
      for (const a of e.args) exprRefs(a, out);
      break;
  }
  return out;
}

// ---- 表示 ----------------------------------------------------------------------

/** 200000 → 2×10^5、1000000000 → 10^9、998244353 → そのまま */
export function formatBig(v: bigint): string {
  if (v < 0n) return `-${formatBig(-v)}`;
  const s = v.toString();
  const m = /^([1-9])(0{4,})$/.exec(s);
  if (!m) return s;
  const p = m[2].length;
  return m[1] === "1" ? `10^${p}` : `${m[1]}×10^${p}`;
}

const PREC = { "+": 1, "-": 1, "*": 2, "/": 2, "^": 3 } as const;

/** 式を書き直す(表の表示・入力欄の初期値に使う)。parseExpr で読み戻せる形にする */
export function exprToString(e: Expr, parent = 0): string {
  switch (e.k) {
    case "num":
      return formatBig(e.v);
    case "row":
      return "i";
    case "col":
      return "j";
    case "neg":
      return `-${exprToString(e.a, 3)}`;
    case "call":
      return `${e.fn}(${e.args.map((a) => exprToString(a)).join(", ")})`;
    case "ref": {
      let s = e.name;
      if (e.idx.length) {
        const inner = e.idx.map((x) => exprToString(x)).join(",");
        s += /^[A-Za-z0-9]$/.test(inner) ? `_${inner}` : `_{${inner}}`;
      }
      return e.bars ? `|${s}|` : s;
    }
    case "bin": {
      const p = PREC[e.op];
      let s: string;
      if (e.op === "^") s = `${exprToString(e.a, 4)}^${exprToString(e.b, 4)}`;
      else if (e.op === "*" && e.a.k === "num" && e.b.k === "ref" && !e.b.bars) s = `${exprToString(e.a, p)}${exprToString(e.b, p)}`;
      else {
        const sym = e.op === "*" ? "×" : e.op;
        s = `${exprToString(e.a, p)}${sym}${exprToString(e.b, e.op === "-" || e.op === "/" ? p + 1 : p)}`;
      }
      return p < parent ? `(${s})` : s;
    }
  }
}

/** 2つの式が同じ形か(入力形式の1行目と最終行を比べるのに使う) */
export function sameExpr(a: Expr, b: Expr): boolean {
  return JSON.stringify(a, big) === JSON.stringify(b, big);
}

function big(_k: string, v: unknown): unknown {
  return typeof v === "bigint" ? `${v}n` : v;
}
