// end 系(Ruby / Lua / Julia)のブロックを波括弧の形に書き換える。
//   if c then … elsif d … else … end   → if (c) { … } else if (d) { … } else { … }
//   while c do … end / for i = 1, n do … end → while (c) { … } / for (i = 1, n) { … }
//   def f(a) … end / function f(a) … end   → def f(a) { … } / function f(a) { … }
//   x.each do |v| … end(Ruby のブロック)  → x.each { |v| … }
//   repeat … until c(Lua)                 → do { … } until (c)
//   begin … end while c(Ruby)             → do { … } while (c)
//   case x when 1 then … else … end       → switch (x) { ; case 1 : … ; default : … }
// こうしておけば、文の区切り・else の連鎖・ラムダの本体などは波括弧系のフロントエンドと式パーサを
// そのまま使える。言語ごとの違い(then / do の要否、修飾子の if、ブロックの do)は EndRules で切り替える。
import type { FrontWarning, Tok } from "./ir.ts";

export interface EndRules {
  /** 条件の見出しを持つ語(if / unless / while / until / for) */
  headers: ReadonlySet<string>;
  /** 見出しの終わりを示す語(then / do) */
  headerEnd: ReadonlySet<string>;
  /** 見出しが行末でも終わる(Ruby / Julia)。Lua は then / do が必須 */
  headerAtNewline: boolean;
  /** else if の語(elsif / elseif) */
  elif: ReadonlySet<string>;
  /** 定義の語 → 種類(def / function / class / module / struct) */
  defs: Readonly<Record<string, "func" | "class">>;
  /** 本体だけのブロックを開く語(Ruby の begin、Julia の begin / let) */
  plain: ReadonlySet<string>;
  /** do の扱い: block = Ruby のブロック(x.each do |v|)、plain = Lua の do … end */
  doKind: "block" | "plain";
  /** case / when(Ruby) */
  caseWord?: string;
  whenWords?: ReadonlySet<string>;
  /** repeat … until(Lua) */
  repeat?: { open: string; close: string };
  /** 読み捨てる節の語(rescue / ensure / catch / finally)。行頭のときだけ見出しを行末まで捨てる */
  clauses?: ReadonlySet<string>;
  /** 文の途中の語が本当にブロックを開くか(Ruby の修飾子 if / while を除く)。無ければ常に開く */
  opens?: (toks: readonly Tok[], i: number) => boolean;
  /** [ ] の中では end を閉じ語として扱わない(Julia の a[end]) */
  endInBrackets?: boolean;
}

type FrameKind = "if" | "loop" | "func" | "class" | "plain" | "block" | "case" | "begin" | "repeat" | "endless" | "tail";

interface Frame {
  kind: FrameKind;
  /** 見出しを読んでいる途中か。cond = 条件、def = 定義の引数、when = case のラベル、tail = until の条件 */
  header: null | "cond" | "def" | "when" | "tail";
  /** 見出し(と1行の定義)の中の括弧の深さ */
  depth: number;
  /** 定義の見出しで引数の ( を見たか */
  paren: boolean;
  /** 開き括弧を出した out の位置(begin … end while の書き換え用) */
  open: number;
}

/** 行頭にあっても前の行の続きになる記号 */
const CONTINUES = new Set([".", "&.", "?.", "+", "-", "*", "/", "%", "&&", "||", "?", ":", "=", ",", "=>", "==", "!=", "<", ">", "<=", ">=", "&", "|", "^", "::", "->", "..", "...", "**", "<<", ">>", "+=", "-=", "*=", "/=", "||=", "&&="]);
/** 式の途中を示す語(この語の後ろの改行では見出しが終わらない) */
const WORD_OPS = new Set(["and", "or", "not", "in", "then", "do", "else", "elsif", "elseif", "if", "unless", "while", "until", "for", "return", "when"]);

/** 式を終えられる字句か(その後ろの改行で見出しや1行の定義が終わる) */
function endsExpr(t: Tok | undefined): boolean {
  if (!t) return false;
  if (t.k === "num" || t.k === "str") return true;
  if (t.k === "ident") return !WORD_OPS.has(t.v);
  return t.k === "op" && [")", "]", "}"].includes(t.v);
}

export function rewriteEnd(src: readonly Tok[], rules: EndRules, warn: (w: FrontWarning) => void): Tok[] {
  const out: Tok[] = [];
  const stack: Frame[] = [];
  let bracket = 0;
  const op = (v: string, like: Tok, nl = false): Tok => ({ k: "op", v, line: like.line, col: like.col, sp: true, nl });
  const word = (v: string, like: Tok, nl = false): Tok => ({ k: "ident", v, line: like.line, col: like.col, sp: true, nl });
  const emit = (...ts: Tok[]) => out.push(...ts);
  const top = (): Frame | undefined => stack[stack.length - 1];
  const push = (kind: FrameKind, header: Frame["header"]) => stack.push({ kind, header, depth: 0, paren: false, open: out.length });
  const last = () => out[out.length - 1];

  /** 見出しを閉じる(if (c) { / case x : / def f(a) { / until (c)) */
  const closeHeader = (f: Frame, like: Tok) => {
    if (f.header === "cond") emit(op(")", like), op("{", like));
    else if (f.header === "when") emit(op(":", like));
    else if (f.header === "def") emit(op("{", like));
    else if (f.header === "tail") {
      emit(op(")", like));
      stack.splice(stack.indexOf(f), 1);
      return;
    }
    f.header = null;
  };

  /** t で行が変わり、そこで見出しや1行の定義が終わるか */
  const lineEnds = (t: Tok, f: Frame) => t.nl && f.depth <= 0 && endsExpr(last()) && !(t.k === "op" && CONTINUES.has(t.v));

  for (let i = 0; i < src.length; i++) {
    const t = src[i];
    const semi = t.k === "op" && t.v === ";";

    // ---- 見出し・1行の定義の終わり ----
    const f = top();
    if (f && f.header === "tail") {
      if ((f.depth <= 0 && semi) || lineEnds(t, f)) {
        closeHeader(f, last() ?? t);
        if (semi) continue;
      }
    }
    const h = top();
    if (h && (h.header === "cond" || h.header === "when")) {
      if (h.depth <= 0 && t.k === "ident" && !t.sigil && rules.headerEnd.has(t.v)) {
        closeHeader(h, t);
        continue;
      }
      if (h.depth <= 0 && semi) {
        closeHeader(h, t);
        continue;
      }
      if (rules.headerAtNewline && lineEnds(t, h)) closeHeader(h, last() ?? t);
    } else if (h && h.header === "def") {
      if (h.depth <= 0 && semi) {
        closeHeader(h, t);
        continue;
      }
      if (t.nl && h.depth <= 0) closeHeader(h, last() ?? t);
      else if (h.kind === "func" && h.depth <= 0 && !h.paren && t.k === "op" && t.v === "=") {
        // def f = expr(引数なしの1行の定義)
        h.kind = "endless";
        h.header = null;
        emit(op("{", t), word("return", t));
        continue;
      }
    }
    const g = top();
    if (g && g.kind === "endless" && !g.header && lineEnds(t, g)) {
      emit(op("}", last() ?? t));
      stack.pop();
    }

    // ---- 括弧 ----
    if (t.k === "op" && (t.v === "(" || t.v === "[" || t.v === "{" || t.v === ")" || t.v === "]" || t.v === "}")) {
      const x = top();
      const tracked = !!x && (!!x.header || x.kind === "endless");
      if (t.v === "(" || t.v === "[" || t.v === "{") {
        if (x && x.header === "def" && x.kind === "func" && t.v === "(" && x.depth <= 0 && !x.paren) x.paren = true;
        if (tracked) x.depth++;
        if (t.v === "[") bracket++;
        emit(t);
        continue;
      }
      if (tracked) x.depth--;
      if (t.v === "]") bracket = Math.max(0, bracket - 1);
      emit(t);
      // def f(a, b) の閉じ括弧で見出しが終わる。直後が = なら1行の定義(Ruby の def f(x) = expr)
      if (x && x.header === "def" && x.paren && x.depth <= 0 && t.v === ")") {
        const nx = src[i + 1];
        if (nx && nx.k === "op" && nx.v === "=" && !nx.nl) {
          x.kind = "endless";
          x.header = null;
          emit(op("{", nx), word("return", nx));
          i++;
        } else if (!(nx && !nx.nl && nx.k === "op" && (nx.v === "::" || nx.v === "->" || nx.v === ":"))) {
          closeHeader(x, t);
        }
      }
      continue;
    }

    // ---- ブロックの語 ----
    const prev = src[i - 1];
    const next = src[i + 1];
    const isKw =
      t.k === "ident" &&
      !t.sigil &&
      // x.end / r.begin / x.class はメソッド呼び出し
      !(prev && prev.k === "op" && (prev.v === "." || prev.v === "&." || prev.v === "::") && !t.sp) &&
      // Ruby のハッシュのラベル end: 1 / if: x
      !(next && next.k === "op" && next.v === ":" && !next.sp);
    if (!isKw) {
      emit(t);
      continue;
    }
    const opens = () => rules.opens?.(src, i) ?? true;
    const v = t.v;

    if (v === "end" && !(rules.endInBrackets && bracket > 0)) {
      let cur = top();
      if (cur && cur.kind === "tail") {
        closeHeader(cur, t);
        cur = top();
      }
      if (!cur) {
        warn({ line: t.line, code: "unbalanced", message: "end が多すぎます" });
        continue;
      }
      if (cur.header) closeHeader(cur, t);
      stack.pop();
      // begin … end while c / begin … end until c → do { … } while (c)
      if (cur.kind === "begin" && next && next.k === "ident" && (next.v === "while" || next.v === "until") && !next.nl) {
        // 開き括弧の前に do を足す(行頭の印は do に移す)
        const brace = out[cur.open] ?? t;
        out.splice(cur.open, 1, word("do", brace, brace.nl), { ...brace, nl: false });
        emit(op("}", t, t.nl), word(next.v, next), op("(", next));
        i++;
        push("tail", "tail");
        continue;
      }
      emit(op("}", t, t.nl));
      continue;
    }
    const cur = top();
    if (rules.headers.has(v) && opens()) {
      push(v === "while" || v === "until" || v === "for" ? "loop" : "if", "cond");
      emit(t, op("(", t));
      continue;
    }
    if (rules.elif.has(v) && cur && cur.kind === "if" && !cur.header) {
      emit(op("}", t, t.nl), word("else", t), word("if", t), op("(", t));
      cur.header = "cond";
      cur.depth = 0;
      continue;
    }
    if (v === "else" && cur && !cur.header) {
      if (cur.kind === "if") {
        emit(op("}", t, t.nl), word("else", t), op("{", t));
        continue;
      }
      if (cur.kind === "case") {
        emit(op(";", t), word("default", t), op(":", t));
        continue;
      }
      if (cur.kind === "begin" || cur.kind === "func" || cur.kind === "block") {
        emit(op(";", t)); // rescue … else(例外が起きなかったとき)は本体の続きとして読む
        continue;
      }
    }
    // 語を置き換えた字句は、元の語の「行頭か」を引き継ぐ(改行での文の区切りがずれないように)
    if (rules.caseWord === v && opens()) {
      push("case", "cond");
      emit(word("switch", t, t.nl), op("(", t));
      continue;
    }
    if (rules.whenWords?.has(v) && cur && cur.kind === "case" && !cur.header && (t.nl || (prev && prev.k === "op" && prev.v === ";"))) {
      emit(op(";", t), word("case", t));
      cur.header = "when";
      cur.depth = 0;
      continue;
    }
    if (rules.defs[v] !== undefined && opens()) {
      push(rules.defs[v] === "class" ? "class" : "func", "def");
      emit(t);
      continue;
    }
    if (rules.repeat && rules.repeat.open === v) {
      push("repeat", null);
      emit(word("do", t, t.nl), op("{", t));
      continue;
    }
    if (rules.repeat && rules.repeat.close === v && cur && cur.kind === "repeat") {
      stack.pop();
      emit(op("}", t, t.nl), word("until", t), op("(", t));
      push("tail", "tail");
      continue;
    }
    if (v === "do") {
      // Ruby のブロック(x.each do |v|)は式の続き。Lua の do … end は文
      const block = rules.doKind === "block";
      push(block ? "block" : "plain", null);
      emit(op("{", t, block ? false : t.nl));
      continue;
    }
    if (rules.plain.has(v) && opens()) {
      push(v === "begin" ? "begin" : "plain", null);
      emit(op("{", t, t.nl));
      continue;
    }
    if (rules.clauses?.has(v) && cur && (t.nl || (prev && prev.k === "op" && prev.v === ";"))) {
      // rescue ZeroDivisionError => e / ensure は見出しを捨て、本体は続きとして読む
      emit(op(";", t));
      while (i + 1 < src.length && !src[i + 1].nl) i++;
      continue;
    }
    emit(t);
  }
  // 閉じていないブロックを閉じる
  const endTok = src[src.length - 1];
  let unclosed = 0;
  while (stack.length > 0 && endTok) {
    const fr = stack[stack.length - 1];
    if (fr.header) {
      closeHeader(fr, endTok);
      if (fr.kind === "tail") continue;
    }
    stack.pop();
    if (fr.kind !== "endless") unclosed++;
    emit(op("}", endTok));
  }
  if (unclosed > 0) warn({ line: endTok?.line ?? 1, code: "unbalanced", message: `end が ${unclosed} 個足りません` });
  return out;
}
