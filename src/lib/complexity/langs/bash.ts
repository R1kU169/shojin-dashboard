// Bash の定義(簡易対応)。シェルの文はコマンドと空白区切りの語なので、字句の後で式の形に直してから
// (canonBash)、do / then … done / fi を波括弧の形に書き換えて(endRewrite.ts)波括弧系のフロントエンドで読む。
//
//   [ $i -lt $n ] / [[ … ]] / (( … )) → ( i < n )        $((a + b)) → ( a + b )
//   $(cmd a b) → cmd(a, b)   $(seq 1 $n) → ( 1 .. n )    "${a[@]}" → a   ${#a[@]} → len(a)
//   read a b → a, b = read()   read -a a / mapfile -t a → a = readarray()
//   a=(1 2 3) → a = [1, 2, 3]   a=($line) → a = split(line)   a+=(x) → a.push(x)
//   echo "${a[@]}" | tr … | sort | head → head(sort(scan_words(a)))(パイプの段ごとに要素数を引き継ぐ)
//   case x in pat) … ;; esac → if ( x ) then … end(分岐はまとめて足す: 上界)
import type { Tok } from "../ir.ts";
import { BASE_RULES, tokenize } from "../lexer.ts";
import type { Lexer, LexRules } from "../lexer.ts";
import { BASE_DIALECT } from "../sexpr.ts";
import type { Dialect } from "../sexpr.ts";
import type { LangSpec } from "../spec.ts";
import { rewriteEnd } from "../endRewrite.ts";
import type { EndRules } from "../endRewrite.ts";

const isIdent = (c: string | undefined) => !!c && /[A-Za-z0-9_]/.test(c);

/** ${…} の中身(#a[@] / a[i] / a[@] / x:-d / s:i:k / s//a/b)を式の字句にする */
function paramTokens(inner: string): { text: string } {
  let m = /^#(\w+)(\[[@*]\])?$/.exec(inner);
  if (m) return { text: `len(${m[1]})` };
  m = /^(\w+)\[[@*]\]$/.exec(inner);
  if (m) return { text: m[1] };
  m = /^(\w+)\[(.+)\]$/.exec(inner);
  if (m) return { text: `${m[1]}[${m[2]}]` };
  m = /^(\w+):(-?\w+):(\w+)$/.exec(inner);
  if (m) return { text: `substr(${m[1]}, ${m[2]}, ${m[3]})` };
  m = /^(\w+)\/\//.exec(inner);
  if (m) return { text: `replace(${m[1]})` };
  m = /^(\w+)/.exec(inner);
  if (m) return { text: m[1] };
  return { text: "__arg" };
}

function bashHook(lx: Lexer): boolean {
  const s = lx.src;
  const i = lx.i;
  const c = s[i];
  // # がコメントになるのは語の先頭だけ(a#b / $# は違う)
  if (c === "#" && !lx.sp && !lx.atLineStart) {
    lx.push("op", "#", i);
    lx.i = i + 1;
    return true;
  }
  if (c === "$") {
    const n = s[i + 1];
    // $(( … )) は (( … ))、$'…' は '…'
    if ((n === "(" && s[i + 2] === "(") || n === "'" || n === '"') {
      lx.i = i + 1;
      return true;
    }
    // $(cmd …) はコマンド置換
    if (n === "(") {
      lx.push("ident", "__cmd", i);
      lx.i = i + 1;
      return true;
    }
    if (n === "{") {
      let p = i + 2;
      let depth = 1;
      while (p < s.length && depth > 0) {
        if (s[p] === "{") depth++;
        else if (s[p] === "}") depth--;
        if (depth > 0) p++;
      }
      const inner = s.slice(i + 2, p);
      const t = paramTokens(inner);
      for (const x of tokenize(t.text, { ...BASE_RULES, lineComments: [], blockComments: [] }).tokens) lx.push(x.k, x.v, i, x.num !== undefined ? { num: x.num } : undefined);
      lx.advanceTo(Math.min(p + 1, s.length));
      return true;
    }
    if (n && /[A-Za-z_]/.test(n)) {
      let p = i + 1;
      while (isIdent(s[p])) p++;
      lx.push("ident", s.slice(i + 1, p), i);
      lx.i = p;
      return true;
    }
    if (n && /[0-9@#?*$!-]/.test(n)) {
      lx.push("ident", /[0-9]/.test(n) ? `__arg${n}` : n === "#" ? "__argc" : "__args", i);
      lx.i = i + 2;
      return true;
    }
    return false;
  }
  // ヒアドキュメント <<EOF / <<-EOF / <<'EOF'(<<< は文字列)
  if (c === "<" && s[i + 1] === "<" && s[i + 2] !== "<") {
    const m = /^<<(-?)\s*(["']?)(\w+)\2/.exec(s.slice(i, i + 64));
    if (m) {
      lx.addHeredoc(m[3], m[1] === "-");
      lx.push("str", "", i);
      lx.i = i + m[0].length;
      return true;
    }
  }
  return false;
}

const KEYWORDS = new Set(["if", "then", "elif", "else", "fi", "for", "while", "until", "do", "done", "case", "esac", "in", "function", "return", "break", "continue", "local", "declare", "typeset", "readonly", "export", "let", "select", "time"]);

const lex: LexRules = {
  ...BASE_RULES,
  lineComments: ["#"],
  blockComments: [],
  quotes: "\"'`",
  charQuote: "none",
  interp: "julia",
  numSuffix: false,
  digitSep: "",
  keywords: KEYWORDS,
  hook: bashHook,
};

const dialect: Dialect = {
  ...BASE_DIALECT,
  ranges: { "..": true },
  lambdas: new Set(),
  sizeMembers: new Set(),
  sizeFuncs: new Set(["len"]),
  castWords: new Set(),
  typeWords: new Set(),
};

// ---------------------------------------------------------------------------
// コマンドを式に直す

const op = (v: string, like: Tok, sp = true): Tok => ({ k: "op", v, line: like.line, col: like.col, sp, nl: false });
const word = (v: string, like: Tok, sp = true): Tok => ({ k: "ident", v, line: like.line, col: like.col, sp, nl: false });
const isOp = (t: Tok | undefined, v: string) => !!t && t.k === "op" && t.v === v;
const isW = (t: Tok | undefined, v: string) => !!t && t.k === "ident" && t.v === v;

/** 深さ0の区切りで分ける(括弧の中は分けない) */
function splitAt(toks: readonly Tok[], pred: (t: Tok, i: number) => boolean): Tok[][] {
  const out: Tok[][] = [[]];
  let d = 0;
  toks.forEach((t, i) => {
    if (t.k === "op" && (t.v === "(" || t.v === "[" || t.v === "{")) d++;
    else if (t.k === "op" && (t.v === ")" || t.v === "]" || t.v === "}")) d = Math.max(0, d - 1);
    else if (d === 0 && pred(t, i)) {
      out.push([]);
      return;
    }
    out[out.length - 1].push(t);
  });
  return out.filter((x) => x.length > 0);
}

/** 空白で語に分ける(括弧の中と、空白を挟まない字句はつなげる) */
function words(toks: readonly Tok[]): Tok[][] {
  const out: Tok[][] = [];
  let d = 0;
  for (const t of toks) {
    if (out.length === 0 || (d === 0 && t.sp)) out.push([]);
    out[out.length - 1].push(t);
    if (t.k === "op" && (t.v === "(" || t.v === "[" || t.v === "{")) d++;
    else if (t.k === "op" && (t.v === ")" || t.v === "]" || t.v === "}")) d = Math.max(0, d - 1);
  }
  return out;
}

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
  return toks.length - 1;
}

/** 語の中のコマンド置換 __cmd ( … ) と {a..b} を式にする */
function wordExpr(w: readonly Tok[]): Tok[] {
  const out: Tok[] = [];
  for (let i = 0; i < w.length; i++) {
    const t = w[i];
    if (isW(t, "__cmd") && isOp(w[i + 1], "(")) {
      const c = closeAt(w, i + 1);
      out.push(op("(", t, t.sp), ...listExpr(w.slice(i + 2, c)), op(")", t, false));
      i = c;
      continue;
    }
    // {1..n} の展開
    if (isOp(t, "{") && isOp(w[i + 2], "..") && isOp(w[i + 4], "}")) {
      out.push(op("(", t, t.sp), w[i + 1], w[i + 2], w[i + 3], op(")", t, false));
      i += 4;
      continue;
    }
    out.push(t);
  }
  // /dev/stdin のようなパスは文字列にする
  if (out.length > 1 && out.some((x) => isOp(x, "/")) && !out.some((x) => isOp(x, "("))) return [{ ...out[0], k: "str", v: out.map((x) => x.v).join("") }];
  return out;
}

/** [ … ] / [[ … ]] の条件 */
function testExpr(toks: readonly Tok[], like: Tok): Tok[] {
  const CMP: Record<string, string> = { lt: "<", le: "<=", gt: ">", ge: ">=", eq: "==", ne: "!=", a: "&&", o: "||" };
  const out: Tok[] = [op("(", like)];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const n = toks[i + 1];
    if (isOp(t, "-") && n && n.k === "ident" && !n.sp) {
      if (CMP[n.v]) {
        out.push(op(CMP[n.v], t));
        i++;
        continue;
      }
      // -z x / -n x / -f file などの単項の判定は、判定する値だけ残す
      i++;
      continue;
    }
    if (isOp(t, "=") || isOp(t, "=~")) {
      out.push(op("==", t));
      continue;
    }
    out.push(...wordExpr([t]));
  }
  out.push(op(")", like));
  return out;
}

/** パイプの1段目が流すデータ(echo "${a[@]}" → a / cat → read_all() / seq 1 n → (1 .. n)) */
function sourceOf(ws: Tok[][], like: Tok): Tok[] {
  const name = ws[0]?.[0];
  if (!name) return [word("__data", like)];
  if (isW(name, "cat") && ws.length === 1) return [word("read_all", like), op("(", like), op(")", like)];
  if (isW(name, "seq")) return commandExpr(ws);
  if (isW(name, "echo") || isW(name, "printf")) {
    const args = ws.slice(1).filter((w) => w[0]?.k !== "str" || ws.length === 2);
    const pick = [...args].reverse().find((w) => w.length === 1 && w[0].k === "ident") ?? args[args.length - 1];
    return pick ? wordExpr(pick) : [word("__data", like)];
  }
  return commandExpr(ws);
}

const FILTERS = new Set(["tr", "sed", "awk", "grep", "cut", "uniq", "rev", "tac", "paste", "nl", "fold", "xargs", "tee", "column", "comm", "join"]);

/** パイプライン: 段ごとにデータの要素数を引き継ぐ */
function pipelineExpr(toks: readonly Tok[]): Tok[] {
  const segs = splitAt(toks, (t) => isOp(t, "|"));
  if (segs.length <= 1) return commandExpr(words(toks));
  const like = toks[0];
  let data = sourceOf(words(segs[0]), like);
  for (const seg of segs.slice(1)) {
    const name = words(seg)[0]?.[0];
    const f = isW(name, "sort") ? "sort" : isW(name, "head") || isW(name, "tail") || isW(name, "wc") ? "head" : name && FILTERS.has(name.v) ? "scan_words" : "scan_words";
    data = [word(f, like), op("(", like, false), ...data, op(")", like, false)];
  }
  return data;
}

/** && / || でつないだコマンドの並び */
function listExpr(toks: readonly Tok[]): Tok[] {
  const out: Tok[] = [];
  let part: Tok[] = [];
  let d = 0;
  const flush = () => {
    if (part.length) out.push(...pipelineExpr(part));
    part = [];
  };
  for (const t of toks) {
    if (t.k === "op" && (t.v === "(" || t.v === "[" || t.v === "{")) d++;
    else if (t.k === "op" && (t.v === ")" || t.v === "]" || t.v === "}")) d = Math.max(0, d - 1);
    if (d === 0 && t.k === "op" && (t.v === "&&" || t.v === "||")) {
      flush();
      out.push(op(t.v, t));
      continue;
    }
    part.push(t);
  }
  flush();
  return out;
}

/** 代入 NAME=… / NAME+=(…) / NAME[i]=… の値 */
function assignValue(value: readonly Tok[], like: Tok): Tok[] {
  if (value.length === 0) return [{ ...like, k: "str", v: "", sp: true, nl: false }];
  // 配列のリテラル (1 2 3) / ($line) / ($(seq 1 $n))。((…)) は $((…)) の算術
  if (isOp(value[0], "(") && !isOp(value[1], "(") && closeAt(value, 0) === value.length - 1) {
    const inner = words(value.slice(1, -1));
    if (inner.length === 1) {
      const e = wordExpr(inner[0]);
      const seq = e.length > 1 && e.some((x) => isOp(x, ".."));
      return [word(seq ? "list" : "split", like), op("(", like, false), ...e, op(")", like, false)];
    }
    const items: Tok[] = [op("[", like)];
    inner.forEach((w, k) => {
      if (k > 0) items.push(op(",", like, false));
      items.push(...wordExpr(w));
    });
    items.push(op("]", like, false));
    return items;
  }
  return wordExpr(value);
}

/** 1つのコマンド(語の並び)を式にする */
function commandExpr(ws0: Tok[][]): Tok[] {
  let ws = ws0.filter((w) => w.length > 0);
  if (ws.length === 0) return [];
  // リダイレクト(< file / > file / 2>&1 / <<< str)を落とす。mapfile の < <( … ) は中で読む
  const cmd = ws[0][0];
  const keepRedirect = cmd && cmd.k === "ident" && (cmd.v === "mapfile" || cmd.v === "readarray");
  const kept: Tok[][] = [];
  for (let k = 0; k < ws.length; k++) {
    if (keepRedirect) {
      kept.push(ws[k]);
      continue;
    }
    const w = ws[k];
    if (w.length === 1 && w[0].k === "op" && ["<", ">", ">>", "<<<", "&>", "2>", ">&"].includes(w[0].v)) {
      k++;
      continue;
    }
    if (w[0].k === "num" && isOp(w[1], ">")) continue;
    kept.push(w);
  }
  ws = kept;
  if (ws.length === 0) return [];
  const first = ws[0];
  const t0 = first[0];
  // ! cmd
  if (isOp(t0, "!") && first.length === 1) return [op("!", t0), ...commandExpr(ws.slice(1))];
  // [ … ] / [[ … ]]
  if (isOp(t0, "[")) {
    const flat = ws.flat();
    const dbl = isOp(flat[1], "[") && !flat[1].sp;
    const end = flat.length - (dbl ? 2 : 1);
    return testExpr(flat.slice(dbl ? 2 : 1, end), t0);
  }
  // (( … ))
  if (isOp(t0, "(") && isOp(first[1], "(")) {
    const flat = ws.flat();
    return [op("(", t0), ...wordExpr(flat.slice(2, -2)), op(")", t0)];
  }
  const name = t0.k === "ident" ? t0.v : "";
  // 代入(複数あれば ; でつなぐ。コマンドの前の IFS= などは落とす)
  const assigns: Tok[][] = [];
  while (ws.length > 0 && ws[0].length >= 2 && ws[0][0].k === "ident") {
    const w = ws[0];
    const eq = w.findIndex((x, j) => j > 0 && x.k === "op" && (x.v === "=" || x.v === "+=") && !x.sp);
    if (eq < 0) break;
    assigns.push(w);
    ws = ws.slice(1);
  }
  if (assigns.length > 0 && ws.length > 0) return commandExpr(ws);
  if (assigns.length > 0) {
    const out: Tok[] = [];
    assigns.forEach((w, k) => {
      if (k > 0) out.push(op(";", w[0], false));
      const eq = w.findIndex((x, j) => j > 0 && x.k === "op" && (x.v === "=" || x.v === "+=") && !x.sp);
      const target = w.slice(0, eq);
      const value = w.slice(eq + 1);
      if (w[eq].v === "+=" && isOp(value[0], "(")) {
        out.push(...target, op(".", w[eq], false), word("push", w[eq], false), op("(", w[eq], false), ...assignValue(value, w[eq]).filter((x) => !isOp(x, "[") && !isOp(x, "]")), op(")", w[eq], false));
      } else out.push(...target, op(w[eq].v, w[eq]), ...assignValue(value, w[eq]));
    });
    return out;
  }
  const args = ws.slice(1);
  const call = (fname: string, xs: Tok[][]): Tok[] => {
    const out: Tok[] = [{ ...t0, k: "ident", v: fname }, op("(", t0, false)];
    xs.forEach((w, k) => {
      if (k > 0) out.push(op(",", t0, false));
      out.push(...wordExpr(w));
    });
    out.push(op(")", t0, false));
    return out;
  };
  switch (name) {
    case "read": {
      // read [-r] [-a arr] [-p prompt] a b
      let arr: Tok | null = null;
      const names: Tok[] = [];
      for (let k = 0; k < args.length; k++) {
        const w = args[k];
        if (isOp(w[0], "-")) {
          const flags = w.slice(1).map((x) => x.v).join("");
          if (flags.includes("a")) arr = args[++k]?.[0] ?? null;
          else if (/[pndtu]/.test(flags)) k++;
          continue;
        }
        if (w.length === 1 && w[0].k === "ident") names.push(w[0]);
      }
      if (arr) return [{ ...arr, sp: true }, op("=", t0), word("readarray", t0), op("(", t0, false), op(")", t0, false)];
      if (names.length === 0) return call("read", []);
      const out: Tok[] = [];
      names.forEach((n, k) => {
        if (k > 0) out.push(op(",", n, false));
        out.push({ ...n, sp: k > 0 });
      });
      return [...out, op("=", t0), word("read", t0), op("(", t0, false), op(")", t0, false)];
    }
    case "mapfile":
    case "readarray": {
      // mapfile -t a / mapfile -t a < <(cmd | sort)
      let target: Tok | null = null;
      let value: Tok[] = [word("readarray", t0), op("(", t0, false), op(")", t0, false)];
      for (let k = 0; k < args.length; k++) {
        const w = args[k];
        if (isOp(w[0], "-")) {
          if (/[nduCcs]/.test(w.slice(1).map((x) => x.v).join(""))) k++;
          continue;
        }
        if (isOp(w[0], "<") && w.length === 1) {
          const nx = args[k + 1];
          if (nx && isOp(nx[0], "<") && isOp(nx[1], "(")) value = pipelineExpr(nx.slice(2, closeAt(nx, 1)));
          k++;
          continue;
        }
        if (!target && w.length === 1 && w[0].k === "ident") target = w[0];
      }
      return [{ ...(target ?? word("MAPFILE", t0)), sp: true }, op("=", t0), ...value];
    }
    case "seq": {
      const nums = args.filter((w) => !isOp(w[0], "-"));
      if (nums.length === 1) return [op("(", t0), { ...t0, k: "num", v: "1", num: 1 }, op("..", t0), ...wordExpr(nums[0]), op(")", t0)];
      if (nums.length >= 2) return [op("(", t0), ...wordExpr(nums[0]), op("..", t0), ...wordExpr(nums[nums.length - 1]), op(")", t0)];
      return call("seq", args);
    }
    case "cat":
      return args.length === 0 ? [word("read_all", t0), op("(", t0, false), op(")", t0, false)] : call("cat", args);
    case "let":
      return args.flatMap((w, k) => [...(k > 0 ? [op(";", w[0], false)] : []), ...wordExpr(w)]);
    case "local":
    case "declare":
    case "typeset":
    case "readonly":
    case "export": {
      let hash = false;
      let list = false;
      const out: Tok[] = [];
      for (const w of args) {
        if (isOp(w[0], "-")) {
          const flags = w.slice(1).map((x) => x.v).join("");
          if (flags.includes("A")) hash = true;
          if (flags.includes("a")) list = true;
          continue;
        }
        if (out.length) out.push(op(";", w[0], false));
        const eq = w.findIndex((x, j) => j > 0 && isOp(x, "="));
        if (eq > 0) out.push(word("local", t0), ...w.slice(0, eq), op("=", w[eq]), ...assignValue(w.slice(eq + 1), w[eq]));
        else if (hash) out.push(...w, op("=", t0), word("Dict", t0), op("(", t0, false), op(")", t0, false));
        else if (list) out.push(...w, op("=", t0), op("[", t0), op("]", t0, false));
        else out.push(word("local", t0), ...w);
      }
      return out;
    }
    case "return":
    case "exit":
    case "break":
    case "continue":
      return [t0, ...args.flatMap((w) => wordExpr(w))];
    case "shift":
    case "set":
    case "shopt":
    case "trap":
    case "source":
    case "unset":
    case "wait":
    case "ulimit":
      return [];
    default:
      if (!name) return ws.flat();
      return call(name, args);
  }
}

/** 1つの文(改行か ; までの並び)を直す。制御の語で始まるものは語を残して中身だけ直す */
function statement(seg: Tok[], out: Tok[]): void {
  let s = seg;
  while (s.length > 0) {
    const t = s[0];
    const lead = (x: Tok): Tok => ({ ...x, nl: t.nl, sp: true });
    if (t.k === "ident" && (t.v === "then" || t.v === "do" || t.v === "else")) {
      out.push(lead(t));
      s = s.slice(1);
      if (s.length) s = [{ ...s[0], nl: false }, ...s.slice(1)];
      continue;
    }
    if (t.k === "ident" && (t.v === "fi" || t.v === "done" || t.v === "esac")) {
      out.push({ ...lead(t), v: "end" });
      return; // done < file のようなリダイレクトは捨てる
    }
    if (t.k === "ident" && (t.v === "if" || t.v === "elif" || t.v === "while" || t.v === "until")) {
      out.push(lead(t), ...listExpr(s.slice(1)));
      return;
    }
    if (t.k === "ident" && t.v === "for") {
      out.push(lead(t));
      const rest = s.slice(1);
      if (isOp(rest[0], "(") && isOp(rest[1], "(")) {
        // for (( i = 0; i < n; i++ ))
        const c = closeAt(rest, 0);
        out.push(...rest.slice(2, c - 1).map((x) => ({ ...x, nl: false })));
        return;
      }
      const inIdx = rest.findIndex((x) => isW(x, "in"));
      if (inIdx < 0) {
        out.push(...rest, word("in", t), word("__args", t));
        return;
      }
      out.push(...rest.slice(0, inIdx + 1));
      const coll = words(rest.slice(inIdx + 1));
      if (coll.length === 1) out.push(...wordExpr(coll[0]));
      else {
        out.push(op("[", t));
        coll.forEach((w, k) => {
          if (k > 0) out.push(op(",", t, false));
          out.push(...wordExpr(w));
        });
        out.push(op("]", t, false));
      }
      return;
    }
    if (t.k === "ident" && t.v === "case") {
      // case x in → if ( x ) then(パターンのラベルは捨て、分岐は全部足す)
      const inIdx = s.findIndex((x) => isW(x, "in"));
      out.push({ ...lead(t), v: "if" }, op("(", t), ...wordExpr(s.slice(1, inIdx < 0 ? s.length : inIdx)), op(")", t), word("then", t));
      return;
    }
    // case のパターンのラベル a) / *) / "x"|"y")
    const close = s.findIndex((x) => isOp(x, ")"));
    if (close >= 0 && !s.slice(0, close).some((x) => isOp(x, "(")) && s.slice(0, close).every((x) => !x.nl || x === t)) {
      s = s.slice(close + 1);
      if (s.length) s = [{ ...s[0], nl: t.nl }, ...s.slice(1)];
      continue;
    }
    // 関数の定義 f() { / function f {
    if ((isW(t, "function") && s[1]?.k === "ident") || (t.k === "ident" && isOp(s[1], "(") && isOp(s[2], ")"))) {
      const name = isW(t, "function") ? s[1] : t;
      const brace = s.findIndex((x) => isOp(x, "{"));
      out.push(lead(word("function", t)), { ...name, nl: false }, op("(", name, false), op(")", name, false), op("{", name));
      if (brace >= 0 && brace < s.length - 1) statement([{ ...s[brace + 1], nl: false }, ...s.slice(brace + 2)], out);
      return;
    }
    if (isOp(t, "{") || isOp(t, "}")) {
      out.push(lead(t));
      s = s.slice(1);
      if (s.length) s = [{ ...s[0], nl: false }, ...s.slice(1)];
      continue;
    }
    const e = listExpr(s);
    if (e.length) out.push({ ...e[0], nl: t.nl }, ...e.slice(1), op(";", t, false));
    return;
  }
}

/** 文字列の中身が ${a[@]} / $x / $(cmd) だけなら、式の字句に戻す */
function expandStrings(toks: Tok[]): Tok[] {
  const out: Tok[] = [];
  for (const t of toks) {
    if (t.k === "str" && /^(\$\{[^}]+\}|\$\w+|\$\(.*\))$/s.test(t.v)) {
      const inner = tokenize(t.v, lex).tokens.map((x, k) => ({ ...x, line: t.line, col: t.col, sp: k === 0 ? t.sp : x.sp, nl: k === 0 ? t.nl : false }));
      out.push(...inner);
    } else out.push(t);
  }
  return out;
}

export function canonBash(src: Tok[]): Tok[] {
  const toks = expandStrings(src);
  const out: Tok[] = [];
  // 改行と ; で文に分ける(括弧の中は分けない。;; は case の区切り)
  let seg: Tok[] = [];
  let d = 0;
  const flush = () => {
    if (seg.length) statement(seg, out);
    seg = [];
  };
  for (const t of toks) {
    // 関数の本体やコマンドのまとまりの { } は行をまたぐので、括弧の深さには数えない
    if (d === 0 && t.nl) flush();
    if (t.k === "op" && (t.v === "(" || t.v === "[")) d++;
    else if (t.k === "op" && (t.v === ")" || t.v === "]")) d = Math.max(0, d - 1);
    if (d === 0 && t.k === "op" && (t.v === ";" || t.v === "&")) {
      flush();
      continue;
    }
    seg.push(t);
  }
  flush();
  return out;
}

const END: EndRules = {
  headers: new Set(["if", "while", "until", "for"]),
  headerEnd: new Set(["then", "do"]),
  headerAtNewline: false,
  semiEndsHeader: false,
  elif: new Set(["elif"]),
  defs: {},
  plain: new Set(),
  doKind: "plain",
};

export const bashSpec: LangSpec = {
  key: "bash",
  family: "bash",
  lex,
  dialect,
  loopWords: new Set(["for", "while", "until"]),
  ifWords: new Set(["if"]),
  funcWords: new Set(["function"]),
  classWords: new Set(),
  controlWords: new Set(),
  declWords: new Set(["local"]),
  modifiers: new Set(),
  typedDecls: false,
  typeKind: {},
  inputMarkers: new Set(["read", "readarray", "read_all"]),
  implicitMain: false,
  asi: true,
  postfixModifiers: false,
  commandCalls: false,
  postTokenize: (toks, warn) => ({ toks: rewriteEnd(canonBash(toks), END, warn), consts: {} }),
};
