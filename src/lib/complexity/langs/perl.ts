// Perl の定義。波括弧系のフロントエンドで読む。$x / @a / %h は sigil 付きの識別子にし、
// $a と @a は同じ名前の変数として扱う(計画 §7.8 の注記)。$a[$i] は @a の要素、$h{$k} は %h の要素。
//
// 字句の hook で読むもの: <STDIN> / <>(入力)、q qq qw qr m s tr y の引用、POD(=pod … =cut)、
// ヒアドキュメント <<"EOS"、__END__。
// 字句の後で直すもの: 式の途中の my / our / local(chomp(my $n = <STDIN>) / for my $i (…))は落とす。
import type { Tok } from "../ir.ts";
import { BASE_RULES } from "../lexer.ts";
import type { Lexer, LexRules } from "../lexer.ts";
import { BASE_DIALECT } from "../sexpr.ts";
import type { Dialect } from "../sexpr.ts";
import type { LangSpec } from "../spec.ts";

const isIdent = (c: string | undefined) => !!c && /[A-Za-z0-9_]/.test(c);
const PAIRS: Record<string, string> = { "(": ")", "[": "]", "{": "}", "<": ">" };

/** open の次から close までを読み飛ばした位置(括弧の組は入れ子を数える) */
function scanDelim(s: string, p: number, open: string, close: string): number {
  let depth = 1;
  while (p < s.length) {
    const c = s[p];
    if (c === "\\") p++;
    else if (c === close && --depth === 0) return p + 1;
    else if (c === open && open !== close) depth++;
    p++;
  }
  return s.length;
}

function perlHook(lx: Lexer): boolean {
  const s = lx.src;
  const i = lx.i;
  const c = s[i];
  // POD(行頭の =pod / =head1 … =cut)と __END__
  if (lx.atLineStart && c === "=" && /[A-Za-z]/.test(s[i + 1] ?? "")) {
    const m = /\n=cut[^\n]*/.exec(s.slice(i));
    lx.advanceTo(m ? i + m.index + m[0].length : s.length);
    lx.sp = true;
    return true;
  }
  if (lx.atLineStart && (s.startsWith("__END__", i) || s.startsWith("__DATA__", i))) {
    lx.advanceTo(s.length);
    return true;
  }
  // 変数 $x / @a / %h / $#a / $_ / @_ / $Foo::bar
  if (c === "$" || c === "@" || (c === "%" && !lx.prevIsValue())) {
    let sigil: string = c;
    let p = i + 1;
    if (c === "$" && s[p] === "#" && /[A-Za-z_]/.test(s[p + 1] ?? "")) {
      sigil = "$#";
      p++;
    }
    if (/[A-Za-z_]/.test(s[p] ?? "")) {
      const from = p;
      while (isIdent(s[p]) || (s[p] === ":" && s[p + 1] === ":" && isIdent(s[p + 2]))) p += s[p] === ":" ? 2 : 1;
      lx.push("ident", s.slice(from, p), i, { sigil });
      lx.i = p;
      return true;
    }
    // $0 / $1 / $& / $/ / $, などの特殊変数
    if (c === "$" && /[0-9&`'+!/\\,;.]/.test(s[p] ?? "")) {
      lx.push("ident", "__special", i, { sigil: "$" });
      lx.i = p + 1;
      return true;
    }
    return false;
  }
  // <STDIN> / <> / <$fh>(読み取り)
  if (c === "<" && !lx.prevIsValue()) {
    const m = /^<(\$?[A-Za-z_]\w*|)>/.exec(s.slice(i, i + 32));
    if (m) {
      lx.push("ident", "STDIN", i);
      lx.i = i + m[0].length;
      return true;
    }
    // ヒアドキュメント <<"EOS" / <<'EOS' / <<EOS / <<~EOS
    const h = /^<<(~?)(["']?)([A-Za-z_]\w*)\2/.exec(s.slice(i, i + 64));
    if (h && (h[2] !== "" || /^[A-Z]/.test(h[3]))) {
      lx.addHeredoc(h[3], h[1] === "~");
      lx.push("str", "", i);
      lx.i = i + h[0].length;
      return true;
    }
  }
  // q qq qw qr m s tr y の引用(語の先頭で、直後が区切り文字のとき)
  if (/[a-z]/.test(c) && !isIdent(s[i - 1]) && s[i - 1] !== "$" && s[i - 1] !== "@" && s[i - 1] !== "%" && s[i - 1] !== ">") {
    const m = /^(qq|qw|qr|q|m|s|tr|y)(\s*)([^\w\s)\]}>,;=:])/.exec(s.slice(i, i + 8));
    if (m && !(m[3] === "=" && s[i + m[0].length] === ">")) {
      const open = m[3];
      const close = PAIRS[open] ?? open;
      const kind = m[1];
      let p = scanDelim(s, i + m[0].length, open, close);
      const text = s.slice(i + m[0].length, Math.max(i + m[0].length, p - 1));
      if (kind === "s" || kind === "tr" || kind === "y") {
        // s{a}{b} は2つ目の組、s/a/b/ は同じ区切りの続き
        if (PAIRS[open]) {
          while (/\s/.test(s[p] ?? "")) p++;
          const o2 = s[p];
          if (o2) p = scanDelim(s, p + 1, o2, PAIRS[o2] ?? o2);
        } else p = scanDelim(s, p, open, close);
      }
      while (/[a-z]/.test(s[p] ?? "")) p++;
      const words = kind === "qw" ? text.trim().split(/\s+/).filter(Boolean).length : undefined;
      lx.push("str", text, i, words !== undefined ? { words } : undefined);
      lx.advanceTo(p);
      return true;
    }
  }
  return false;
}

/** 値の直後でない(次の / が正規表現、% が hash の sigil になる)語 */
const KEYWORDS = new Set(["my", "our", "local", "state", "return", "if", "unless", "elsif", "else", "while", "until", "for", "foreach", "and", "or", "not", "xor", "eq", "ne", "lt", "gt", "le", "ge", "cmp", "x", "print", "say", "push", "pop", "shift", "unshift", "splice", "split", "join", "keys", "values", "each", "exists", "delete", "defined", "scalar", "reverse", "sort", "map", "grep", "chomp", "chop", "lc", "uc", "length", "die", "warn", "printf", "sprintf", "sum", "sum0", "max", "min", "first", "any", "all", "none", "uniq", "shuffle", "wantarray", "do", "last", "next", "redo"]);

const lex: LexRules = {
  ...BASE_RULES,
  lineComments: ["#"],
  blockComments: [],
  quotes: "\"'`",
  charQuote: "none",
  regexLiteral: true,
  regexAfter: new Set(["split", "grep", "map", "join", "return", "and", "or", "not", "if", "unless", "while", "until", "push", "unshift", "print", "x"]),
  digitSep: "_",
  keywords: KEYWORDS,
  hook: perlHook,
};

const dialect: Dialect = {
  ...BASE_DIALECT,
  arrowMember: true,
  concatOps: new Set(["."]),
  ranges: { "..": true },
  lambdas: new Set(["sub"]),
  wordOps: { and: "&&", or: "||", not: "!", xor: "^", eq: "==", ne: "!=", lt: "<", gt: ">", le: "<=", ge: ">=", cmp: "<=>", x: "x" },
  sizeMembers: new Set(),
  sizeFuncs: new Set(["scalar", "length"]),
  castWords: new Set(),
  typeWords: new Set(),
  listOps: new Set(["print", "say", "push", "pop", "shift", "unshift", "splice", "split", "join", "keys", "values", "each", "exists", "delete", "defined", "scalar", "reverse", "sort", "map", "grep", "chomp", "chop", "lc", "uc", "lcfirst", "ucfirst", "length", "die", "warn", "printf", "sprintf", "abs", "int", "sqrt", "ord", "chr", "sum", "sum0", "max", "min", "first", "any", "all", "none", "uniq", "shuffle", "local"]),
};

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

/**
 * 式の途中の my / our / local / state(chomp(my $n = <STDIN>) / for my $i (…) / while (my $l = <STDIN>))を落とし、
 * 式の中の do { …; x } はブロックの最後の文の値 ( x ) にする(do { local $/; <STDIN> } の一括読み込み)
 */
function canonPerl(toks: Tok[]): Tok[] {
  const out: Tok[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const prev = out[out.length - 1];
    const atStart = !prev || t.nl || (prev.k === "op" && (prev.v === ";" || prev.v === "{" || prev.v === "}"));
    if (t.k === "ident" && !t.sigil && t.v === "do" && !atStart && toks[i + 1]?.k === "op" && toks[i + 1].v === "{") {
      const c = closeAt(toks, i + 1);
      if (c > 0) {
        const inner = toks.slice(i + 2, c);
        let lastStart = 0;
        let d = 0;
        inner.forEach((x, k) => {
          if (x.k === "op" && (x.v === "(" || x.v === "[" || x.v === "{")) d++;
          else if (x.k === "op" && (x.v === ")" || x.v === "]" || x.v === "}")) d--;
          else if (d === 0 && x.k === "op" && x.v === ";" && k < inner.length - 1) lastStart = k + 1;
        });
        const value = inner.slice(lastStart).filter((x) => !(x.k === "op" && x.v === ";"));
        out.push({ ...t, k: "op", v: "(" }, ...canonPerl(value), { ...toks[c], v: ")" });
        i = c;
        continue;
      }
    }
    if (t.k === "ident" && !t.sigil && ["my", "our", "local", "state"].includes(t.v) && !atStart) {
      const n = toks[i + 1];
      if (n && (n.sigil || (n.k === "op" && n.v === "("))) continue;
    }
    // ラベル OUTER: for … は落とす
    if (t.k === "ident" && !t.sigil && atStart && /^[A-Z_]+$/.test(t.v) && toks[i + 1]?.k === "op" && toks[i + 1].v === ":" && toks[i + 2]?.k === "ident") {
      i++;
      continue;
    }
    out.push(t);
  }
  return out;
}

export const perlSpec: LangSpec = {
  key: "perl",
  family: "brace",
  lex,
  dialect,
  loopWords: new Set(["for", "foreach", "while", "until"]),
  ifWords: new Set(["if", "unless"]),
  funcWords: new Set(["sub"]),
  classWords: new Set(),
  controlWords: new Set(),
  declWords: new Set(["my", "our", "local", "state"]),
  modifiers: new Set(),
  typedDecls: false,
  typeKind: {},
  inputMarkers: new Set(["STDIN", "readline", "ARGV"]),
  implicitMain: false,
  asi: false,
  postfixModifiers: true,
  commandCalls: false,
  postTokenize: (toks) => ({ toks: canonPerl(toks), consts: {} }),
};
