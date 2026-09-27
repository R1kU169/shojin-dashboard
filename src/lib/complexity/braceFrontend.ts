// 波括弧系(C / C++ / Java / C# / Rust / Go / JS / TS / D / Perl / PHP)のブロック抽出。
// トークン列を再帰下降で読み、文とブロックの入れ子(Raw)にする。
//
// 要点:
//  - 文は括弧の外の ; で終わる。Go / JS は改行でも終わりうる(asi)
//  - 括弧の外の { は、直前が関数・クラス・ラムダの代入の見出しならブロック、それ以外
//    (初期化子・オブジェクト・構造体リテラル)は式の一部として読み飛ばす
//  - if / for / while の本体が { でなければ次の1文を本体にする(波括弧なしの単文)
//  - 壊れた入力(閉じ括弧の過不足)でも止まらずに最後まで読む
import type { FrontWarning, Tok } from "./ir.ts";
import { findTop, isOp, isWord, lastLine, matchClose } from "./spec.ts";
import type { LangSpec, Raw, RawBlock, RawElse } from "./spec.ts";

/** 文を終わらせられるトークン(改行で文を終える判定用) */
function endsStatement(t: Tok): boolean {
  if (t.k === "ident" || t.k === "num" || t.k === "str") return true;
  return t.k === "op" && [")", "]", "}", "++", "--"].includes(t.v);
}

/** 行頭にあっても前の行の続きになる記号 */
const CONTINUES = new Set([".", "?.", "+", "-", "*", "/", "%", "&&", "||", "?", ":", "=", ",", "=>", "==", "!=", "<", ">", "<=", ">=", "&", "|", "^", "??", "::", "->"]);

/** 見出しの後ろに付いてよい語・記号(戻り値の型、const、throws、初期化子リストなど) */
const HEAD_TAIL_OPS = new Set(["->", ":", "<", ">", ">>", "::", "*", "&", "&&", "[", "]", ",", "?", "|", ".", "(", ")", "!"]);

export class BraceParser {
  readonly t: readonly Tok[];
  readonly spec: LangSpec;
  readonly warn: (w: FrontWarning) => void;
  i = 0;
  constructor(toks: readonly Tok[], spec: LangSpec, warn: (w: FrontWarning) => void) {
    this.t = toks;
    this.spec = spec;
    this.warn = warn;
  }

  peek(k = 0): Tok | undefined {
    return this.t[this.i + k];
  }

  /** 波括弧の中(inBraces)またはファイルの終わりまでの文の並び */
  block(inBraces: boolean): Raw[] {
    const out: Raw[] = [];
    while (this.i < this.t.length) {
      const t = this.t[this.i];
      if (isOp(t, "}")) {
        this.i++;
        if (inBraces) return out;
        this.warn({ line: t.line, code: "unbalanced", message: "閉じ括弧 } が多すぎます" });
        continue;
      }
      const before = this.i;
      const r = this.statement();
      if (r) out.push(r);
      if (this.i === before) this.i++;
    }
    if (inBraces) {
      const last = this.t[this.t.length - 1];
      this.warn({ line: last?.line ?? 1, code: "unbalanced", message: "閉じ括弧 } が足りません" });
    }
    return out;
  }

  /** { で始まる本体か、無ければ次の1文 */
  body(): Raw[] {
    if (isOp(this.peek(), "{")) {
      this.i++;
      return this.block(true);
    }
    if (isOp(this.peek(), ";")) {
      this.i++;
      return [];
    }
    const r = this.statement();
    return r ? [r] : [];
  }

  /** 見出し: ( … ) があればその中身、無ければ { の手前まで(Go / Rust の if x {) */
  head(): Tok[] {
    const t = this.peek();
    if (isOp(t, "(")) {
      const c = matchClose(this.t, this.i);
      if (c >= 0) {
        // 閉じ括弧の後ろが式の続き(Go / Rust の if (a + b) % 2 == 0 {)なら、括弧は条件の一部
        const after = this.t[c + 1];
        if (!after || after.k !== "op" || after.nl || ["{", ";", "++", "--"].includes(after.v)) {
          const inner = this.t.slice(this.i + 1, c);
          this.i = c + 1;
          return inner;
        }
      }
    }
    const start = this.i;
    let depth = 0;
    // Go の見出しは ; を含む(for i := 0; i < n; i++ { / if x := f(); x > 0 {)
    const semiEnds = this.spec.key !== "go";
    while (this.i < this.t.length) {
      const x = this.t[this.i];
      if (x.k === "op") {
        if (x.v === "(" || x.v === "[") depth++;
        else if (x.v === ")" || x.v === "]") depth--;
        else if (depth <= 0 && (x.v === "{" || (x.v === ";" && semiEnds))) break;
        else if (x.v === "{") {
          const c = matchClose(this.t, this.i);
          this.i = c < 0 ? this.t.length : c + 1;
          continue;
        }
      }
      this.i++;
    }
    return this.t.slice(start, this.i);
  }

  statement(): Raw | null {
    const t = this.peek();
    if (!t) return null;
    const spec = this.spec;
    if (isOp(t, ";")) {
      this.i++;
      return null;
    }
    if (isOp(t, "{")) {
      this.i++;
      const body = this.block(true);
      return { t: "block", kw: "plain", head: [], body, line: t.line, endLine: this.t[this.i - 1]?.line ?? t.line };
    }
    if (t.k === "pp") {
      this.i++;
      return null;
    }
    if (t.k === "ident" && !t.sigil) {
      const w = t.v;
      if (spec.ifWords.has(w)) return this.ifChain();
      if (spec.loopWords.has(w) && !isOp(this.peek(1), "=") && !isOp(this.peek(1), ".")) return this.loop();
      if (w === "do" && (isOp(this.peek(1), "{") || spec.loopWords.has("do"))) return this.doWhile();
      if (w === "match" && spec.controlWords.has("match")) return this.matchBlock();
      if (spec.controlWords.has(w) && !isOp(this.peek(1), "=") && !isOp(this.peek(1), ".")) return this.control();
      if (w === "else" || w === "elsif" || w === "elseif" || w === "elif") {
        // 対応する if が無い else。本体だけ読む
        this.i++;
        if (isOp(this.peek(), "(")) this.head();
        return { t: "block", kw: "plain", head: [], body: this.body(), line: t.line, endLine: this.t[this.i - 1]?.line ?? t.line };
      }
      // C++ のアクセス指定 public: / private: は読み捨てる
      if ((w === "public" || w === "private" || w === "protected") && isOp(this.peek(1), ":")) {
        this.i += 2;
        return null;
      }
      if ((w === "case" || w === "default") && !isOp(this.peek(1), "=")) {
        // switch のラベル case x: / default: は読み捨てる(:: は区切りにしない)
        let j = this.i + 1;
        let depth = 0;
        while (j < this.t.length) {
          const x = this.t[j];
          if (x.k === "op" && (x.v === "(" || x.v === "[")) depth++;
          else if (x.k === "op" && (x.v === ")" || x.v === "]")) depth--;
          else if (depth === 0 && x.k === "op" && (x.v === ":" || x.v === "=>" || x.v === "{" || x.v === ";")) break;
          j++;
        }
        this.i = isOp(this.t[j], ":") || isOp(this.t[j], "=>") ? j + 1 : j;
        return null;
      }
    }
    return this.simple();
  }

  ifChain(): RawBlock {
    const start = this.peek()!;
    const kw = start.v;
    this.i++;
    const head = this.head();
    const body = this.body();
    const elses: RawElse[] = [];
    for (;;) {
      const t = this.peek();
      if (!t || t.k !== "ident") break;
      if (t.v === "else" && isWord(this.peek(1), "if")) {
        this.i += 2;
        const h = this.head();
        elses.push({ kw: "elif", head: h, body: this.body(), line: t.line });
        continue;
      }
      if (t.v === "elsif" || t.v === "elseif" || t.v === "elif") {
        this.i++;
        const h = this.head();
        elses.push({ kw: "elif", head: h, body: this.body(), line: t.line });
        continue;
      }
      if (t.v === "else") {
        this.i++;
        elses.push({ kw: "else", head: [], body: this.body(), line: t.line });
      }
      break;
    }
    return { t: "block", kw, head, body, elses, line: start.line, endLine: this.t[this.i - 1]?.line ?? start.line };
  }

  loop(): RawBlock {
    const start = this.peek()!;
    const kw = start.v;
    this.i++;
    const head = kw === "loop" ? [] : this.head();
    const body = this.body();
    return { t: "block", kw, head, body, line: start.line, endLine: this.t[this.i - 1]?.line ?? start.line };
  }

  doWhile(): RawBlock {
    const start = this.peek()!;
    this.i++;
    const body = this.body();
    let tail: Tok[] = [];
    let tailKw = "while";
    const t = this.peek();
    if (t && t.k === "ident" && (t.v === "while" || t.v === "until")) {
      tailKw = t.v;
      this.i++;
      tail = this.head();
      if (isOp(this.peek(), ";")) this.i++;
    }
    return { t: "block", kw: "do", head: [], body, tail, tailKw, line: start.line, endLine: this.t[this.i - 1]?.line ?? start.line };
  }

  control(): RawBlock {
    const start = this.peek()!;
    const kw = start.v;
    this.i++;
    const head = isOp(this.peek(), "{") ? [] : this.head();
    const body = this.body();
    return { t: "block", kw, head, body, line: start.line, endLine: this.t[this.i - 1]?.line ?? start.line };
  }

  /** Rust の match x { pat => expr, pat => { … } } */
  matchBlock(): RawBlock {
    const start = this.peek()!;
    this.i++;
    const head = this.head();
    const body: Raw[] = [];
    if (isOp(this.peek(), "{")) {
      const end = matchClose(this.t, this.i);
      this.i++;
      const stop = end < 0 ? this.t.length : end;
      while (this.i < stop) {
        // パターンは => まで読み捨てる
        const arrow = findTop(this.t.slice(this.i, stop), (x) => isOp(x, "=>"));
        if (arrow < 0) {
          this.i = stop;
          break;
        }
        this.i += arrow + 1;
        if (isOp(this.peek(), "{")) {
          this.i++;
          body.push({ t: "block", kw: "plain", head: [], body: this.block(true), line: this.t[this.i - 1]?.line ?? start.line, endLine: this.t[this.i - 1]?.line ?? start.line });
          if (isOp(this.peek(), ",")) this.i++;
        } else {
          const rest = this.t.slice(this.i, stop);
          const comma = findTop(rest, (x) => isOp(x, ","));
          const n = comma < 0 ? rest.length : comma;
          const toks = rest.slice(0, n);
          if (toks.length) body.push({ t: "stmt", toks, line: toks[0].line, endLine: lastLine(toks, toks[0].line) });
          this.i += n + (comma < 0 ? 0 : 1);
        }
      }
      this.i = stop + 1;
    }
    return { t: "block", kw: "match", head, body, line: start.line, endLine: this.t[this.i - 1]?.line ?? start.line };
  }

  /** 単純な文。途中で関数・クラス・ラムダの { が来たらブロックにする */
  simple(): Raw | null {
    const start = this.i;
    const first = this.t[start];
    let depth = 0;
    while (this.i < this.t.length) {
      const x = this.t[this.i];
      if (this.i > start && this.spec.asi && depth === 0 && x.nl && endsStatement(this.t[this.i - 1]) && !(x.k === "op" && CONTINUES.has(x.v)) && !isWord(x, "else")) {
        break;
      }
      if (x.k === "op") {
        if (x.v === "(" || x.v === "[") depth++;
        else if (x.v === ")" || x.v === "]") {
          depth--;
          if (depth < 0) {
            // 余分な閉じ括弧は読み捨てる
            this.warn({ line: x.line, code: "unbalanced", message: `閉じ括弧 ${x.v} が多すぎます` });
            depth = 0;
          }
        } else if (depth === 0 && x.v === ";") {
          const toks = this.t.slice(start, this.i);
          this.i++;
          return stmt(toks, first);
        } else if (depth === 0 && x.v === "}") {
          return stmt(this.t.slice(start, this.i), first);
        } else if (depth === 0 && x.v === "{") {
          const head = this.t.slice(start, this.i);
          const kind = this.braceKind(head);
          if (kind) {
            this.i++;
            const body = this.block(true);
            const end = this.t[this.i - 1]?.line ?? first.line;
            // ラムダの代入の後ろの ; や即時呼び出しは読み捨てる
            if (kind === "func" && head.some((h) => h.k === "op" && (h.v === "=" || h.v === ":="))) {
              if (isOp(this.peek(), "(")) {
                const c = matchClose(this.t, this.i);
                this.i = c < 0 ? this.i : c + 1;
              }
              if (isOp(this.peek(), ";")) this.i++;
            }
            if (kind === "class" && isOp(this.peek(), ";")) this.i++;
            return { t: "block", kw: kind, head, body, line: first.line, endLine: end };
          }
          // 式の中の { … }(初期化子・オブジェクト・構造体リテラル)
          const c = matchClose(this.t, this.i);
          this.i = c < 0 ? this.t.length : c + 1;
          // 閉じた直後が改行なら文はそこで終わり(Rust の input! { … } の後ろなど)
          const nx = this.t[this.i];
          if (nx && nx.nl && !isOp(nx, ";") && !(nx.k === "op" && CONTINUES.has(nx.v)) && !isWord(nx, "else")) {
            return stmt(this.t.slice(start, this.i), first);
          }
          continue;
        }
      }
      this.i++;
    }
    return stmt(this.t.slice(start, this.i), first);
  }

  /** 括弧の外の { の直前までの見出しが、関数・クラス・ラムダの代入か */
  braceKind(head: readonly Tok[]): "func" | "class" | null {
    const spec = this.spec;
    let h = head;
    // template<…> / 修飾語 / @Override などを剥がす
    while (h.length > 0) {
      const x = h[0];
      if (isWord(x, "template") && isOp(h[1], "<")) {
        let depth = 0;
        let j = 1;
        for (; j < h.length; j++) {
          if (isOp(h[j], "<")) depth++;
          else if (isOp(h[j], ">")) depth--;
          else if (isOp(h[j], ">>")) depth -= 2;
          if (depth <= 0) break;
        }
        h = h.slice(j + 1);
      } else if (x.k === "ident" && spec.modifiers.has(x.v)) h = h.slice(1);
      else if (isOp(x, "@") && h[1]?.k === "ident") h = h.slice(isOp(h[2], "(") ? Math.max(2, matchClose(h, 2) + 1) : 2);
      else if (isOp(x, "#") && isOp(h[1], "[")) h = h.slice(matchClose(h, 1) + 1);
      else break;
    }
    if (h.length === 0) return null;
    if (h[0].k === "ident" && spec.classWords.has(h[0].v)) return "class";
    const last = h[h.length - 1];
    // ラムダの代入: x = (…) => {、f = [&](…) {、f = function (…) {、$f = sub {、dfs = func(…) {
    const eq = findTop(h, (x) => x.k === "op" && (x.v === "=" || x.v === ":="));
    if (eq >= 0) {
      if (isOp(last, "=>") || isOp(last, "->")) return "func";
      const rhs = h.slice(eq + 1);
      const r0 = rhs[0];
      if (!r0) return null;
      if (r0.k === "ident" && ["function", "func", "sub", "fn", "async"].includes(r0.v) && spec.dialect.lambdas.size > 0) return "func";
      if (isOp(r0, "[") && spec.dialect.lambdas.has("cpp")) {
        const c = matchClose(rhs, 0);
        if (c > 0 && isOp(rhs[c + 1], "(")) return "func";
      }
      return null;
    }
    if (h[0].k === "ident" && spec.funcWords.has(h[0].v)) return "func";
    // end 系は def / function で定義するので、f(a) { … } はブロック付きの呼び出し(Ruby の foo(x) { |v| … })
    if (spec.family === "end") return null;
    // 型 名前(引数) 修飾 { の形(C 系の関数・メソッド・コンストラクタ)
    const paren = findTop(h, (x, j) => isOp(x, "(") && j > 0 && (h[j - 1].k === "ident" || (h[j - 1].k === "op" && j >= 2 && isWord(h[j - 2], "operator"))));
    if (paren < 0) return null;
    const name = h[paren - 1];
    if (name.k === "ident" && (spec.ifWords.has(name.v) || spec.loopWords.has(name.v) || spec.controlWords.has(name.v) || name.v === "return")) return null;
    const c = matchClose(h, paren);
    if (c < 0) return null;
    const tail = h.slice(c + 1);
    // コンストラクタの初期化子リスト : a(n), b(m)
    const okTail = tail.every((x) => x.k === "ident" || x.k === "num" || (x.k === "op" && HEAD_TAIL_OPS.has(x.v)));
    return okTail ? "func" : null;
  }
}

function stmt(toks: Tok[], first: Tok): Raw | null {
  if (toks.length === 0) return null;
  return { t: "stmt", toks, line: first.line, endLine: lastLine(toks, first.line) };
}

export function parseBrace(toks: readonly Tok[], spec: LangSpec, warn: (w: FrontWarning) => void): Raw[] {
  return new BraceParser(toks, spec, warn).block(false);
}
