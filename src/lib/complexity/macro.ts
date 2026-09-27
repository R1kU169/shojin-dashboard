// C / C++ の #define を字句のまま展開する(F1)。
//
// 競プロの C++ はほぼ必ず #define rep(i, n) for (int i = 0; i < (int)(n); i++) のような
// マクロでループを書くので、展開しないと rep(i, n) が「未知の関数呼び出し」になり
// O(1) と出てしまう。関数形式のマクロは1行・非再帰の字句展開で十分(深さ3まで)。
// 定義の見つからない rep / REP / FOR などは、よくある形とみなしてループに置き換える。
import type { FrontWarning, Tok } from "./ir.ts";
import { tokenize } from "./lexer.ts";
import type { LexRules } from "./lexer.ts";
import { evalConst } from "./semantics.ts";
import type { Consts } from "./semantics.ts";
import { parseTokens } from "./sexpr.ts";
import type { Dialect } from "./sexpr.ts";
import { matchClose } from "./spec.ts";

interface Macro {
  params: string[] | null;
  variadic: boolean;
  body: Tok[];
}

const MAX_EXPANSIONS = 10000;
const MAX_DEPTH = 3;

/** 定義の無いループマクロの既定の形(引数の数ごと) */
const LOOP_MACROS: Record<string, "up" | "up1" | "down" | "range"> = {
  rep: "up",
  REP: "up",
  rep0: "up",
  loop: "up",
  rep1: "up1",
  REP1: "up1",
  rrep: "down",
  RREP: "down",
  per: "down",
  repr: "down",
  FOR: "range",
  For: "range",
  rng: "range",
};

function mk(t: Tok, k: Tok["k"], v: string, num?: number): Tok {
  return { ...t, k, v, num, sp: true, nl: false, sigil: undefined, words: undefined };
}

/** rep(i, n) / FOR(i, a, b) を for (int i = …; i < …; i++) のトークンにする */
function loopTokens(kind: "up" | "up1" | "down" | "range", args: Tok[][], at: Tok): Tok[] | null {
  const n = args.length;
  let v: Tok[], from: Tok[], to: Tok[];
  if (kind === "range" || n === 3) {
    if (n < 3) return null;
    [v, from, to] = args;
  } else if (n === 2) {
    [v, to] = args;
    from = [mk(at, "num", kind === "up1" ? "1" : "0", kind === "up1" ? 1 : 0)];
  } else return null;
  const op = (s: string) => mk(at, "op", s);
  const id = (s: string) => mk(at, "ident", s);
  if (kind === "down") {
    return [id("for"), op("("), id("int"), ...v, op("="), op("("), ...to, op(")"), op("-"), mk(at, "num", "1", 1), op(";"), ...v, op(">="), ...from, op(";"), ...v, op("--"), op(")")];
  }
  const cmp = kind === "up1" ? "<=" : "<";
  return [id("for"), op("("), id("int"), ...v, op("="), ...from, op(";"), ...v, op(cmp), op("("), ...to, op(")"), op(";"), ...v, op("++"), op(")")];
}

function splitArgs(toks: Tok[]): Tok[][] {
  const out: Tok[][] = [[]];
  let depth = 0;
  for (const t of toks) {
    if (t.k === "op" && (t.v === "(" || t.v === "[" || t.v === "{")) depth++;
    else if (t.k === "op" && (t.v === ")" || t.v === "]" || t.v === "}")) depth--;
    else if (t.k === "op" && t.v === "," && depth === 0) {
      out.push([]);
      continue;
    }
    out[out.length - 1].push(t);
  }
  return out.length === 1 && out[0].length === 0 ? [] : out;
}

export function expandMacros(toks: Tok[], rules: LexRules, d: Dialect, warn: (w: FrontWarning) => void): { toks: Tok[]; consts: Consts } {
  const macros = new Map<string, Macro>();
  const consts: Consts = {};
  const out: Tok[] = [];
  // 1. #define を集める(本体は同じ字句規則で読み直す)
  for (const t of toks) {
    if (t.k !== "pp") {
      out.push(t);
      continue;
    }
    const m = /^#\s*define\s+([A-Za-z_]\w*)(\(([^)]*)\))?\s*(.*)$/s.exec(t.v);
    if (!m) continue;
    const name = m[1];
    const params = m[2] !== undefined ? m[3].split(",").map((s) => s.trim()).filter(Boolean) : null;
    const variadic = !!params && params.some((p) => p === "..." || p.endsWith("..."));
    const body = tokenize(m[4], { ...rules, preprocessor: false }).tokens.map((b) => ({ ...b, line: t.line }));
    macros.set(name, { params: params ? params.map((p) => p.replace(/\.\.\.$/, "")) : null, variadic, body });
    if (!params && body.length > 0) {
      const v = evalConst(parseTokens(body, d), consts);
      if (v !== null) consts[name] = { value: v, line: t.line };
    }
  }
  // 2. 展開(非再帰、深さ3まで)
  let count = 0;
  const expand = (src: Tok[], depth: number, active: Set<string>): Tok[] => {
    const res: Tok[] = [];
    for (let i = 0; i < src.length; i++) {
      const t = src[i];
      if (t.k !== "ident") {
        res.push(t);
        continue;
      }
      const mac = macros.get(t.v);
      const callArgs = src[i + 1] && src[i + 1].k === "op" && src[i + 1].v === "(";
      if (mac && !active.has(t.v) && count < MAX_EXPANSIONS && depth < MAX_DEPTH) {
        if (mac.params === null) {
          // オブジェクト形式は数値の定数だけ(#define int long long は展開しない)
          if (consts[t.v] !== undefined || mac.body.length === 0) {
            res.push(t);
            continue;
          }
          const isType = mac.body.every((b) => b.k === "ident");
          if (isType) {
            res.push(t);
            continue;
          }
          count++;
          res.push(...expand(withLead(mac.body.map((b) => ({ ...b, line: t.line })), t), depth + 1, new Set([...active, t.v])));
          continue;
        }
        if (callArgs && !mac.variadic) {
          const c = matchClose(src, i + 1);
          if (c > 0) {
            const args = splitArgs(src.slice(i + 2, c));
            count++;
            const body: Tok[] = [];
            for (const b of mac.body) {
              const pi = b.k === "ident" ? mac.params.indexOf(b.v) : -1;
              // 引数の先頭の字句は、置き換える仮引数の前の空白を引き継ぐ(内訳の表示が rep(j, m) の書き方に引きずられない)
              if (pi >= 0) (args[pi] ?? []).forEach((a, k) => body.push(k === 0 ? { ...a, line: t.line, sp: b.sp, nl: false } : { ...a, line: t.line }));
              else if (b.k === "op" && (b.v === "#" || b.v === "##")) continue;
              else body.push({ ...b, line: t.line });
            }
            res.push(...expand(withLead(body, t), depth + 1, new Set([...active, t.v])));
            i = c;
            continue;
          }
        }
      }
      // 定義の無い(または可変長で展開できない)ループマクロはよくある形とみなす
      if (callArgs && t.v in LOOP_MACROS && (!mac || mac.variadic)) {
        const c = matchClose(src, i + 1);
        if (c > 0) {
          const loop = loopTokens(LOOP_MACROS[t.v], splitArgs(src.slice(i + 2, c)), t);
          if (loop) {
            warn({ line: t.line, code: "macro-fallback", message: `${t.v} の定義が見当たらないので、よくある rep(i, n) の形とみなしました` });
            res.push(...loop);
            i = c;
            continue;
          }
        }
      }
      res.push(t);
    }
    return res;
  };
  /** 展開の先頭の字句は、マクロ名の前の空白と行頭かどうかを引き継ぐ */
  const withLead = (body: Tok[], at: Tok): Tok[] => (body.length ? [{ ...body[0], sp: at.sp, nl: at.nl }, ...body.slice(1)] : body);
  const expanded = expand(out, 0, new Set());
  if (count >= MAX_EXPANSIONS) warn({ line: 1, code: "macro-limit", message: "マクロの展開が多すぎるので途中で打ち切りました" });
  return { toks: expanded, consts };
}
