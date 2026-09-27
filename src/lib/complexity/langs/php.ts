// PHP の定義。波括弧系のフロントエンドで読む。$x の $ は字句で落とし(変数と関数の名前は区別しない)、
// . は文字列の連結、$a[] = x は末尾への追加として扱う。
//
// 字句の後で直すもの(canonPhp):
//   代替構文 for (…): … endfor; / if (…): … elseif (…): … else: … endif; → 波括弧
//   array(1, 2) / list($a, $b) → [1, 2] / [$a, $b]
// <?php の前と ?> の後の HTML、#[属性]、ヒアドキュメント <<<EOS は字句の hook で読み飛ばす。
import type { Tok } from "../ir.ts";
import { BASE_RULES } from "../lexer.ts";
import type { Lexer, LexRules } from "../lexer.ts";
import { BASE_DIALECT } from "../sexpr.ts";
import type { Dialect } from "../sexpr.ts";
import type { LangSpec } from "../spec.ts";

const isIdent = (c: string | undefined) => !!c && /[A-Za-z0-9_]/.test(c);

function phpHook(lx: Lexer): boolean {
  const s = lx.src;
  const i = lx.i;
  const c = s[i];
  // <?php / <?= の前(と ?> の後)の HTML は読み飛ばす
  if (i === 0 && !s.startsWith("<?php", 0) && !s.startsWith("<?=", 0) && s.includes("<?php")) {
    lx.advanceTo(s.indexOf("<?php"));
    return true;
  }
  if (s.startsWith("<?php", i) || s.startsWith("<?=", i)) {
    lx.advanceTo(i + (s[i + 2] === "=" ? 3 : 5));
    lx.sp = true;
    return true;
  }
  if (c === "?" && s[i + 1] === ">") {
    const next = s.indexOf("<?php", i + 2);
    lx.push("op", ";", i);
    lx.advanceTo(next < 0 ? s.length : next + 5);
    lx.sp = true;
    return true;
  }
  // $name(変数)。$ は落とす
  if (c === "$" && /[A-Za-z_]/.test(s[i + 1] ?? "")) {
    let p = i + 1;
    while (isIdent(s[p])) p++;
    lx.push("ident", s.slice(i + 1, p), i);
    lx.i = p;
    return true;
  }
  // #[Attribute] は読み飛ばす(# のコメントより先に見る)
  if (c === "#" && s[i + 1] === "[") {
    let p = i + 2;
    let depth = 1;
    while (p < s.length && depth > 0) {
      if (s[p] === "[") depth++;
      else if (s[p] === "]") depth--;
      p++;
    }
    lx.advanceTo(p);
    lx.sp = true;
    return true;
  }
  // ヒアドキュメント / nowdoc <<<EOS / <<<'EOS' / <<<"EOS"
  if (c === "<" && s.startsWith("<<<", i)) {
    const m = /^<<<\s*(["']?)([A-Za-z_]\w*)\1/.exec(s.slice(i, i + 64));
    if (m) {
      lx.addHeredoc(m[2], true);
      lx.push("str", "", i);
      lx.i = i + m[0].length;
      return true;
    }
  }
  return false;
}

const lex: LexRules = {
  ...BASE_RULES,
  lineComments: ["//", "#"],
  blockComments: [{ open: "/*", close: "*/" }],
  quotes: "\"'`",
  charQuote: "none",
  digitSep: "_",
  keywords: new Set(["return", "if", "elseif", "else", "while", "for", "foreach", "as", "case", "do", "new", "echo", "print", "and", "or", "xor", "instanceof", "clone", "yield", "throw"]),
  hook: phpHook,
};

const dialect: Dialect = {
  ...BASE_DIALECT,
  arrowMember: true,
  concatOps: new Set(["."]),
  lambdas: new Set(["function", "phpFn"]),
  wordOps: { and: "&&", or: "||", xor: "^" },
  sizeMembers: new Set(["count"]),
  sizeFuncs: new Set(["count", "sizeof", "strlen", "mb_strlen"]),
  castWords: new Set(["int", "integer", "float", "double", "string", "bool", "boolean", "array", "object"]),
  typeWords: new Set(),
  listOps: new Set(["echo", "print"]),
};

const isOp = (t: Tok | undefined, v: string) => !!t && t.k === "op" && t.v === v;
const isW = (t: Tok | undefined, v: string) => !!t && t.k === "ident" && t.v === v;

/** 対応する閉じ括弧 */
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

const ALT_OPENERS = new Set(["if", "elseif", "for", "foreach", "while", "switch"]);
const ALT_CLOSERS = new Set(["endif", "endfor", "endforeach", "endwhile", "endswitch"]);

/** 代替構文と array( / list( を波括弧・角括弧の形に直す */
export function canonPhp(src: Tok[]): Tok[] {
  const toks = [...src];
  // array(…) / list(…) → […]
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if ((isW(t, "array") || isW(t, "list")) && isOp(toks[i + 1], "(") && !isOp(toks[i - 1], "->") && !isOp(toks[i - 1], "::")) {
      const c = closeAt(toks, i + 1);
      if (c > 0) {
        toks[c] = { ...toks[c], v: "]" };
        toks[i + 1] = { ...toks[i + 1], v: "[", sp: t.sp, nl: t.nl };
        toks.splice(i, 1);
      }
    }
  }
  const out: Tok[] = [];
  /** 代替構文で開いたブロックの種類(if の連鎖は elseif / else で閉じて開き直す) */
  const alt: string[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.k === "ident" && ALT_OPENERS.has(t.v) && isOp(toks[i + 1], "(")) {
      const c = closeAt(toks, i + 1);
      if (c > 0 && isOp(toks[c + 1], ":")) {
        if (t.v === "elseif" && alt[alt.length - 1] === "if") out.push({ ...t, k: "op", v: "}" });
        out.push(t, ...toks.slice(i + 1, c + 1), { ...toks[c + 1], v: "{" });
        if (t.v !== "elseif") alt.push(t.v === "switch" ? "switch" : t.v === "if" ? "if" : "loop");
        i = c + 1;
        continue;
      }
    }
    if (isW(t, "else") && isOp(toks[i + 1], ":") && alt[alt.length - 1] === "if") {
      out.push({ ...t, k: "op", v: "}" }, t, { ...toks[i + 1], v: "{" });
      i++;
      continue;
    }
    if (t.k === "ident" && ALT_CLOSERS.has(t.v)) {
      alt.pop();
      out.push({ ...t, k: "op", v: "}" });
      if (isOp(toks[i + 1], ";")) i++;
      continue;
    }
    out.push(t);
  }
  return out;
}

export const phpSpec: LangSpec = {
  key: "php",
  family: "brace",
  lex,
  dialect,
  loopWords: new Set(["for", "foreach", "while"]),
  ifWords: new Set(["if"]),
  funcWords: new Set(["function"]),
  classWords: new Set(["class", "interface", "trait", "enum"]),
  controlWords: new Set(["switch", "try", "catch", "finally", "declare"]),
  declWords: new Set(["global"]),
  modifiers: new Set(["public", "private", "protected", "static", "abstract", "final", "readonly"]),
  typedDecls: false,
  typeKind: {
    // range(1, $n) は配列を作る(Python の range と違って遅延しない)
    range: "array",
    SplQueue: "deque",
    SplStack: "stack",
    SplDoublyLinkedList: "deque",
    SplPriorityQueue: "pq",
    SplMinHeap: "pq",
    SplMaxHeap: "pq",
    SplFixedArray: "array",
    SplObjectStorage: "hset",
    ArrayObject: "array",
  },
  inputMarkers: new Set(["STDIN", "fgets", "fscanf", "readline", "stream_get_contents", "file_get_contents", "file", "fgetcsv", "fread"]),
  implicitMain: false,
  asi: false,
  postfixModifiers: false,
  commandCalls: false,
  postTokenize: (toks) => ({ toks: canonPhp(toks), consts: {} }),
};
