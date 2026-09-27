// インデント系(Python / PyPy / Nim)のブロック抽出。
// 論理行(括弧の中や行末の , で続く行はまとめる)に分け、インデントの深さでブロックを作る。
// 予期しないインデントの増加は例外にせず、ただの入れ子ブロックとして読む。
import type { FrontWarning, Tok } from "./ir.ts";
import { findTop, isOp, isWord, lastLine } from "./spec.ts";
import type { LangSpec, Raw, RawBlock, RawElse } from "./spec.ts";

interface Line {
  toks: Tok[];
  indent: number;
  line: number;
}

function logicalLines(toks: readonly Tok[], spec: LangSpec): Line[] {
  const lines: Line[] = [];
  let cur: Tok[] = [];
  let depth = 0;
  const cont = spec.indent?.continuesLine ?? (() => false);
  const flush = () => {
    if (cur.length === 0) return;
    // a = 1; b = 2 は別の文にする
    let start = 0;
    let dd = 0;
    for (let j = 0; j < cur.length; j++) {
      const x = cur[j];
      if (x.k === "op" && (x.v === "(" || x.v === "[" || x.v === "{")) dd++;
      else if (x.k === "op" && (x.v === ")" || x.v === "]" || x.v === "}")) dd--;
      else if (dd === 0 && x.k === "op" && x.v === ";") {
        if (j > start) lines.push({ toks: cur.slice(start, j), indent: cur[start].col, line: cur[start].line });
        start = j + 1;
      }
    }
    if (start < cur.length) lines.push({ toks: cur.slice(start), indent: start === 0 ? cur[0].col : cur[0].col, line: cur[start].line });
    cur = [];
  };
  for (const t of toks) {
    if (cur.length > 0 && t.nl && depth <= 0 && !cont(cur[cur.length - 1])) flush();
    cur.push(t);
    if (t.k === "op") {
      if (t.v === "(" || t.v === "[" || t.v === "{") depth++;
      else if (t.v === ")" || t.v === "]" || t.v === "}") depth = Math.max(0, depth - 1);
    }
  }
  flush();
  return lines;
}

class IndentParser {
  readonly lines: Line[];
  readonly spec: LangSpec;
  readonly warn: (w: FrontWarning) => void;
  i = 0;
  constructor(lines: Line[], spec: LangSpec, warn: (w: FrontWarning) => void) {
    this.lines = lines;
    this.spec = spec;
    this.warn = warn;
  }

  /** 見出しの行か。見出しなら [語, 見出しのトークン, 同じ行の本体] */
  header(line: Line): { kw: string; head: Tok[]; inline: Tok[] } | null {
    const p = this.spec.indent!;
    const toks = line.toks;
    let k = 0;
    while (toks[k]?.k === "ident" && (toks[k].v === "async" || this.spec.modifiers.has(toks[k].v))) k++;
    const first = toks[k];
    if (!first) return null;
    const word = first.k === "ident" && !first.sigil ? first.v : "";
    // 行末の =(Nim の proc f(x: int): int =、let f = proc(x: int): int =)
    const last = toks[toks.length - 1];
    if (isOp(last, "=") && (p.eqBlockWords.has(word) || toks.some((x) => x.k === "ident" && p.eqBlockWords.has(x.v)))) {
      const kw = p.eqBlockWords.has(word) ? "func" : "func";
      return { kw, head: toks.slice(k, toks.length - 1), inline: [] };
    }
    // proc f(x: int): int = expr のように同じ行に本体が続く形
    if (p.eqBlockWords.has(word)) {
      const eq = findTop(toks, (x, j) => j > k && isOp(x, "="));
      if (eq > 0) return { kw: "func", head: toks.slice(k, eq), inline: toks.slice(eq + 1) };
    }
    if (p.sectionWords.has(word) && toks.length === k + 1) return { kw: "section", head: [], inline: [] };
    // Nim の case x(行末に : を書かない形。of の行が続く)
    if (word === "case" && this.spec.key === "nim" && !isOp(last, ":")) return { kw: "case", head: toks.slice(k + 1), inline: [] };
    // 最初のトップレベルの : で見出しと本体を分ける
    const colon = findTop(toks, (x) => isOp(x, ":"));
    if (colon < 0) return null;
    if (p.blockWords.has(word)) {
      return { kw: word, head: toks.slice(word === "def" || word === "class" ? k : k + 1, colon), inline: toks.slice(colon + 1) };
    }
    // Nim の do 記法やテンプレート呼び出しの末尾の : は入れ子のブロック
    if (colon === toks.length - 1 && this.spec.key === "nim" && !isOp(toks[colon - 1], ")")) return { kw: "plain", head: toks.slice(0, colon), inline: [] };
    if (colon === toks.length - 1 && this.spec.key === "nim") return { kw: "plain", head: toks.slice(0, colon), inline: [] };
    return null;
  }

  /** baseIndent の深さの行を並べる。浅い行が来たら終わり */
  block(baseIndent: number): Raw[] {
    const out: Raw[] = [];
    let decorators: string[] = [];
    while (this.i < this.lines.length) {
      const line = this.lines[this.i];
      if (line.indent < baseIndent) break;
      if (line.indent > baseIndent) {
        // 予期しない字下げ: 入れ子のブロックとして読む
        const inner = this.block(line.indent);
        out.push({ t: "block", kw: "plain", head: [], body: inner, line: line.line, endLine: line.line });
        continue;
      }
      const first = line.toks[0];
      if (isOp(first, "@") && this.spec.key !== "nim") {
        decorators.push(line.toks.slice(1).map((x) => x.v).join(""));
        this.i++;
        continue;
      }
      const h = this.header(line);
      if (!h) {
        this.i++;
        out.push({ t: "stmt", toks: line.toks, line: line.line, endLine: lastLine(line.toks, line.line) });
        continue;
      }
      const r = this.compound(line, h);
      if (r.kw === "func" || r.kw === "def") r.decorators = decorators;
      decorators = [];
      out.push(r);
    }
    return out;
  }

  /** 見出しの行の本体(同じ行の続き、または次の深い行) */
  body(line: Line, inline: Tok[]): Raw[] {
    this.i++;
    if (inline.length > 0) {
      const h = this.header({ toks: inline, indent: line.indent, line: line.line });
      if (h) {
        this.i--;
        return [this.compound({ toks: inline, indent: line.indent, line: line.line }, h)];
      }
      return [{ t: "stmt", toks: inline, line: line.line, endLine: lastLine(inline, line.line) }];
    }
    const next = this.lines[this.i];
    if (!next || next.indent <= line.indent) return [];
    return this.block(next.indent);
  }

  compound(line: Line, h: { kw: string; head: Tok[]; inline: Tok[] }): RawBlock {
    const kw = h.kw === "def" ? "func" : h.kw;
    const body = this.body(line, h.inline);
    const endLine = this.lines[this.i - 1]?.line ?? line.line;
    if (kw === "section") {
      // Nim の var / let / const の節: 子の行の先頭に語を補って通常の文として読む
      const word = line.toks[0];
      const children = body.map((b) => (b.t === "stmt" ? { ...b, toks: [word, ...b.toks] } : b));
      return { t: "block", kw: "plain", head: [], body: children, line: line.line, endLine };
    }
    if (this.spec.ifWords.has(kw) || kw === "case") {
      const elses: RawElse[] = [];
      for (;;) {
        const nx = this.lines[this.i];
        if (!nx || nx.indent !== line.indent) break;
        const nh = this.header(nx);
        if (!nh || !["elif", "else", "of", "elsif"].includes(nh.kw)) break;
        const b = this.body(nx, nh.inline);
        elses.push({ kw: nh.kw === "else" ? "else" : "elif", head: nh.head, body: b, line: nx.line });
      }
      if (kw === "case") {
        // Nim の case x / of 1: … を分岐として読む(of の値は捨てる)
        return { t: "block", kw: "switch", head: h.head, body: elses.flatMap((e) => [{ t: "block", kw: "plain", head: [], body: e.body, line: e.line, endLine: e.line } as Raw]), line: line.line, endLine: this.lines[this.i - 1]?.line ?? endLine };
      }
      return { t: "block", kw, head: h.head, body, elses, line: line.line, endLine: this.lines[this.i - 1]?.line ?? endLine };
    }
    if (this.spec.loopWords.has(kw)) {
      // for … else: の else は読み飛ばさずに並べる
      const nx = this.lines[this.i];
      const r: RawBlock = { t: "block", kw, head: h.head, body, line: line.line, endLine };
      if (nx && nx.indent === line.indent && isWord(nx.toks[0], "else") && isOp(nx.toks[1], ":")) {
        const eb = this.body(nx, nx.toks.slice(2));
        r.elses = [{ kw: "else", head: [], body: eb, line: nx.line }];
      }
      return r;
    }
    return { t: "block", kw: kw === "section" ? "plain" : kw, head: h.head, body, line: line.line, endLine };
  }
}

export function parseIndent(toks: readonly Tok[], spec: LangSpec, warn: (w: FrontWarning) => void): Raw[] {
  const lines = logicalLines(toks, spec);
  const p = new IndentParser(lines, spec, warn);
  const out: Raw[] = [];
  while (p.i < lines.length) {
    const before = p.i;
    out.push(...p.block(lines[p.i].indent));
    if (p.i === before) p.i++;
  }
  return out;
}
