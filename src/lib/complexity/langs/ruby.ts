// Ruby の定義。def / if / while / do … end のブロックは字句の後で波括弧の形に書き換えてから
// (endRewrite.ts)、波括弧系のフロントエンドで読む。n.times do |i| や a.each { |x| } のような
// ブロック付きの反復は、文として書かれていればループとして扱う(lowerStmt.ts)。
//
// 字句の落とし穴(計画 §7.2): 修飾子の if / while(x += 1 if c)は文末の修飾として読み、ブロックを開かない。
// ヒアドキュメント <<~EOS、%w[ ]、:sym、?a、正規表現 /…/、#{…} の中の end や do をコードと取り違えない。
import type { Tok } from "../ir.ts";
import { BASE_RULES } from "../lexer.ts";
import type { Lexer, LexRules } from "../lexer.ts";
import { BASE_DIALECT } from "../sexpr.ts";
import type { Dialect } from "../sexpr.ts";
import type { LangSpec } from "../spec.ts";
import { rewriteEnd } from "../endRewrite.ts";
import type { EndRules } from "../endRewrite.ts";

const isIdent = (c: string | undefined) => !!c && /[A-Za-z0-9_]/.test(c);
const OPEN_CLOSE: Record<string, string> = { "(": ")", "[": "]", "{": "}", "<": ">" };

/** ヒアドキュメント・%w[ ]・シンボル・?a・__END__・$x / @x */
function rubyHook(lx: Lexer): boolean {
  const s = lx.src;
  const i = lx.i;
  const c = s[i];
  // __END__ 以降はデータ
  if (lx.atLineStart && s.startsWith("__END__", i) && (s[i + 7] === "\n" || s[i + 7] === undefined)) {
    lx.advanceTo(s.length);
    return true;
  }
  // $stdin / @memo / @@count は名前だけにする(スコープは見ないので区別しない)
  if ((c === "$" || c === "@") && /[A-Za-z_]/.test(s[i + (s[i + 1] === "@" ? 2 : 1)] ?? "")) {
    let p = i + (s[i + 1] === "@" ? 2 : 1);
    const from = p;
    while (isIdent(s[p])) p++;
    lx.push("ident", s.slice(from, p), i);
    lx.i = p;
    return true;
  }
  // ヒアドキュメント <<~EOS / <<-EOS / <<EOS / <<~'EOS'
  if (c === "<" && s[i + 1] === "<") {
    const m = /^<<([~-]?)(["'`]?)([A-Za-z_]\w*)\2/.exec(s.slice(i, i + 64));
    const spaced = lx.sp && s[i + 2] !== " ";
    if (m && (m[1] !== "" || m[2] !== "" || /^[A-Z]/.test(m[3])) && (!lx.prevIsValue() || spaced)) {
      lx.addHeredoc(m[3], m[1] !== "");
      lx.push("str", "", i);
      lx.i = i + m[0].length;
      return true;
    }
    return false;
  }
  // %w[a b c] / %i[a b] / %q(…) / %Q(…) / %(…)
  if (c === "%") {
    const m = /^%([wWiIqQ]?)([[({<|!/])/.exec(s.slice(i, i + 3));
    if (m && (m[1] !== "" || !lx.prevIsValue())) {
      const open = m[2];
      const close = OPEN_CLOSE[open] ?? open;
      let p = i + m[0].length;
      let depth = 1;
      while (p < s.length) {
        if (s[p] === "\\") p++;
        else if (s[p] === open && close !== open) depth++;
        else if (s[p] === close && --depth === 0) break;
        p++;
      }
      if (p >= s.length) lx.warn("unterminated", "%記法の文字列が閉じていません");
      const inner = s.slice(i + m[0].length, Math.min(p, s.length));
      const words = /[wWiI]/.test(m[1]) ? inner.split(/\s+/).filter(Boolean).length : undefined;
      lx.push("str", inner, i, words !== undefined ? { words } : undefined);
      lx.advanceTo(Math.min(p + 1, s.length));
      return true;
    }
    return false;
  }
  // シンボル :name / :+ / :"str"(a ? b : c の : と、ハッシュのラベル a: 1 は除く)
  if (c === ":" && s[i + 1] !== ":" && (!lx.prevIsValue() || (lx.sp && s[i + 1] !== " "))) {
    const n = s[i + 1];
    if (n && /[A-Za-z_]/.test(n)) {
      let p = i + 1;
      while (isIdent(s[p])) p++;
      if (s[p] === "?" || s[p] === "!" || s[p] === "=") p++;
      lx.push("str", s.slice(i + 1, p), i);
      lx.i = p;
      return true;
    }
    if (n === '"') {
      const end = lx.scanQuoted(i + 2, '"', false, false);
      lx.push("str", s.slice(i + 2, Math.max(i + 2, end - 1)), i);
      lx.advanceTo(end);
      return true;
    }
    const opSym = /^:(\[\]=?|<=>|===?|=~|!=|<<|>>|<=|>=|\*\*|[+\-*/%<>!&|^~])/.exec(s.slice(i, i + 5));
    if (opSym && !lx.prevIsValue()) {
      lx.push("str", opSym[1], i);
      lx.i = i + opSym[0].length;
      return true;
    }
    return false;
  }
  // 文字リテラル ?a(三項演算子の ? と、empty? の ? は除く)
  if (c === "?" && !lx.prevIsValue() && s[i + 1] && !/\s/.test(s[i + 1]) && !isIdent(s[i + 2])) {
    const len = s[i + 1] === "\\" ? 3 : 2;
    lx.push("str", s.slice(i + 1, i + len), i);
    lx.i = i + len;
    return true;
  }
  return false;
}

const KEYWORDS = new Set(["if", "unless", "while", "until", "for", "in", "do", "then", "else", "elsif", "end", "case", "when", "return", "and", "or", "not", "yield", "begin", "rescue", "ensure", "def", "class", "module", "break", "next", "redo", "puts", "print", "p", "raise"]);

const lex: LexRules = {
  ...BASE_RULES,
  lineComments: ["#"],
  blockComments: [{ open: "=begin", close: "=end", lineStart: true }],
  quotes: "\"'`",
  charQuote: "none",
  interp: "ruby",
  identSuffix: "?!",
  regexLiteral: true,
  regexAfter: new Set(["split", "when", "if", "elsif", "unless", "and", "or", "not", "return", "puts", "p", "gsub", "sub", "scan", "match", "index", "grep"]),
  keywords: KEYWORDS,
  digitSep: "_",
  hook: rubyHook,
};

const dialect: Dialect = {
  ...BASE_DIALECT,
  blockArgs: true,
  commandMembers: true,
  braceHash: true,
  lambdas: new Set(["stabby"]),
  ranges: { "..": true, "...": false },
  wordOps: { and: "&&", or: "||", not: "!" },
  sizeMembers: new Set(["size", "length", "count"]),
  sizeFuncs: new Set(),
  castWords: new Set(),
  typeWords: new Set(),
  listOps: new Set(["puts", "p", "print", "pp", "printf", "require", "require_relative", "raise", "attr_accessor", "attr_reader", "attr_writer"]),
};

/** 直後の if / while を修飾子ではなくブロックの始まりとして読んでよい字句 */
const OPENS_AFTER_OP = new Set(["=", "(", "[", ",", ";", "||=", "&&=", "+=", "-=", "*=", "/=", "&&", "||", "!", "?", ":", "<<", "{", "|", "=>", "->"]);
const OPENS_AFTER_WORD = new Set(["then", "do", "else", "elsif", "and", "or", "not", "begin", "when", "in"]);

/** if / unless / while / until がブロックを開くか。値の直後なら修飾子(x += 1 if c) */
function rubyOpens(toks: readonly Tok[], i: number): boolean {
  const t = toks[i];
  if (!["if", "unless", "while", "until"].includes(t.v)) return true;
  const p = toks[i - 1];
  if (!p || t.nl) return true;
  if (p.k === "op") return OPENS_AFTER_OP.has(p.v);
  if (p.k === "ident" && !p.sigil) return OPENS_AFTER_WORD.has(p.v);
  return false;
}

const END: EndRules = {
  headers: new Set(["if", "unless", "while", "until", "for"]),
  headerEnd: new Set(["then", "do"]),
  headerAtNewline: true,
  elif: new Set(["elsif"]),
  defs: { def: "func", class: "class", module: "class" },
  plain: new Set(["begin"]),
  doKind: "block",
  caseWord: "case",
  whenWords: new Set(["when", "in"]),
  clauses: new Set(["rescue", "ensure"]),
  opens: rubyOpens,
};

export const rubySpec: LangSpec = {
  key: "ruby",
  family: "end",
  lex,
  dialect,
  loopWords: new Set(["while", "until", "for", "loop"]),
  ifWords: new Set(["if", "unless"]),
  funcWords: new Set(["def"]),
  classWords: new Set(["class", "module"]),
  controlWords: new Set(["switch"]),
  declWords: new Set(),
  modifiers: new Set(["private", "public", "protected", "module_function"]),
  typedDecls: false,
  typeKind: {
    Array: "array",
    Hash: "hmap",
    Set: "hset",
    SortedSet: "oset",
    String: "string",
  },
  inputMarkers: new Set(["gets", "STDIN", "stdin", "readline", "readlines", "ARGF"]),
  implicitMain: false,
  asi: true,
  postfixModifiers: true,
  commandCalls: true,
  postTokenize: (toks, warn) => ({ toks: rewriteEnd(toks, END, warn), consts: {} }),
};
