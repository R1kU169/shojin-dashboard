# 計算量解析タブ(/complexity)の追加

## 背景

精進ボードのエディターで書いた(または他所から貼り付けた)コードが「そのまま提出して間に合うか」を、
実行せずに見積もれるようにしたい。要望:

- ヘッダーに新しくタブを追加する
- 言語を選択してコードを貼り付け、「実行」すると計算量(最悪時間計算量・領域計算量)を出す
- 上限が記号なら O(N) のような一般的な表記、リテラルで分かるなら O(1000) のように数値で出す
- 記号変数の値の範囲(N ≤ 2×10^5 など)を指定できる

アプリは「バックエンド無し・APIキー無し・完全静的SPA」なので、解析はブラウザ内の静的解析
(ヒューリスティック)で行い、コードを外部へ送らない。「実行」= 解析ボタン(Ctrl+Enter)。
結果は推定なので、根拠(内訳)と推定できなかった箇所(警告)を必ず添える。

## 決定事項(2026-09-27)

| 論点 | 決定 |
| --- | --- |
| 解析方式 | ブラウザ内の静的解析(外部送信なし・LLM 不使用) |
| 対応言語 | エディターの **19言語すべて**。推定が粗い言語(Haskell・Bash)は「簡易対応」と表示する |
| エディター連携 | 双方向: 計算量ページに「エディターのコードを読み込む」、エディターのツールバーに「計算量を調べる →」(コードは localStorage 経由) |
| ボタンの名前 | 「解析 ▶」。コードを実行しないので、エディターの「実行 ▶」と呼び分ける |
| 範囲の入力 | 変数ごとに上限(`2e5`)か制約の書き方(`1 ≤ N ≤ 2×10^5`)で入れる。最悪ケースは上限で評価する |
| 入力の読み取り | 1行の分割・数値変換そのものは時間に数えない。読み取りのループは数える(§5.6) |

設計は解析コア・言語フロントエンド・UI の3観点で案を作り、AtCoder の典型的な提出コードでの反証と、実装可能性・UI 整合の批評を反映して確定した。

## 既存資産(再利用するもの)

| 用途 | 場所 |
| --- | --- |
| 言語一覧・表示名 | `EDITOR_LANGS` in [src/lib/wandbox.ts](../src/lib/wandbox.ts)(19言語 key: cpp, python, pypy, java, c, csharp, rust, go, js, ts, ruby, haskell, d, nim, julia, perl, php, lua, bash) |
| ヘッダーのタブ・ルート | [src/App.tsx](../src/App.tsx) の `<nav>` と `<Routes>` |
| ツールバー / ボタン / 入出力欄 / 表 / チップの CSS | `.editor-toolbar` `.editor-lang` `.run-btn` `.editor-hint` `.editor-note` `.io-area` `.io-out` `.io-label` `.exit-chip.ok/.ng` `.data-table` `.table-scroll` `.card` `.two-col` `.stat-grid/.stat-card` `.linklike` in [src/index.css](../src/index.css) |
| エディターの保存コード | localStorage `shojin:editor:code:<lang>` / `shojin:editor:lang`(EditorPage の `CODE_KEY`/`LANG_KEY`) |
| Ctrl+Enter のページ全域ホットキー | [src/pages/EditorPage.tsx:265-284](../src/pages/EditorPage.tsx#L265-L284) の `useEffectEvent` + document キャプチャ |
| 400ms デバウンス保存・言語切替(保存→読む) | [src/pages/EditorPage.tsx:183-238](../src/pages/EditorPage.tsx#L183-L238) |
| localStorage の try/catch 流儀 | [src/lib/updates.ts](../src/lib/updates.ts) |
| アップデート告知 | [src/data/updates.ts](../src/data/updates.ts) の `UPDATES` 先頭に追加(id 単調増加) |
| 機能表 | [README.md](../README.md) |

流儀: 機能ごとの言語テーブルは機能側のファイルに置き、19キーを全部並べて抜けを目視できるようにする
([src/lib/comment.ts](../src/lib/comment.ts) の `LINE_COMMENT` と同じ)。各ファイル先頭に目的と設計判断の理由を日本語コメント。
`erasableSyntaxOnly` のため enum 不可(string union)。`verbatimModuleSyntax` のため `import type`。新規依存なし。
`npm run lint`(oxlint)を通す(代入付き while 条件・不要なエスケープを避ける)。

---

## 1. アーキテクチャ

```text
code + langKey
  │ frontend.ts: parseProgram()          ← 言語ファミリ別フロントエンド(投げない・必ず Program を返す)
  │   lexer.ts (ファミリ共通トークナイザ) → macro.ts (c/cpp の #define 展開)
  │   → braceFrontend.ts | indentFrontend.ts | endFrontend.ts | haskellFrontend.ts
  │   → sexpr.ts で式を SExpr に(Pratt、キャスト剥がし、size 畳み込み)
  ▼
Program (IR: ブロック木。ir.ts が唯一の契約、import ゼロ)
  │ analyze.ts: analyze()                 ← 言語非依存
  │   bounds.ts (ループ上限 L 規則) / builtins.ts (既知関数) / recursion.ts (再帰 R 規則) / expr.ts (式代数)
  ▼
Analysis { time, space, variables, breakdown, warnings, confidence }
  │ evaluate.ts: evaluate(full, ranges, lang, tl)  ← 範囲入力のたびに UI 側で再計算(解析し直さない)
  ▼
ComplexityPage.tsx
```

設計上の要点(批評で確定したもの):

- **式の AST はフロントが作り、意味付けはコアがやる**。19言語の式文法はほぼ共通なので式パーサ(`sexpr.ts`)は1つ。
- **while の上限はコア(`bounds.ts`)で決める**。フロントは `cond: SExpr` と本体を渡すだけ。
- **数値項の扱いは1規則**: 係数 10 以上の項は「係数でも勝たないと落とせない」。`O(N + 5)` は消え、`O(N + 1000)` と `O(N² + 1000·N)` は残る。
- **`full` と `expr` の二本立て**: 表示は `simplify` 後、範囲評価は落とした項も含む `normalize` 後で行う。
- **主記号の二段階問題**は内部予約記号 `"?"` を使い最終段で `rename`。出力に `?` が残ったらバグ(ゴールデンで検出)。
- **main が無ければトップレベルの各関数を独立入口**として `add`(=max)、info 警告。
- **呼び出し解決順**: ユーザー定義関数 → ユーザー定義型のメソッド → builtins → 未知(O(1)、まとめて info)。
- **テストは `tests/complexity/` + `tsconfig.test.json`**(`src/` 内に置くと `node:test` の型が解決できず `tsc -b` が落ちる)。`complexity/` と `tests/` の相対 import は型 import も含め全部 `.ts` 拡張子付き。`complexity/` は `src/lib` の他モジュールを import しない。

---

## 2. ファイル一覧

| パス | 責務 | 概算行数 |
| --- | --- | --- |
| `src/lib/complexity/ir.ts` | **型のみ・import ゼロ**。Tok, SExpr, IrNode, LoopBound, Program, ContainerKind, Expr/Term/Factor, Analysis 系 | 260 |
| `src/lib/complexity/lexer.ts` | ファミリ共通トークナイザ `tokenize(code, rules)`。sticky 正規表現/charCodeAt のみ(`slice(i)` 禁止) | 500 |
| `src/lib/complexity/sexpr.ts` | `parseSExpr`(Pratt、深さ上限 200)、`evalConst`、`sexprText`、キャスト剥がし | 300 |
| `src/lib/complexity/langs/<key>.ts`(19ファイル) | 言語ごとの `spec: LangSpec`(lex 規則・キーワード・型名→`ContainerKind`・入力マーカー・canon・postTokenize・BlockProfile/IndentProfile)と `builtins`(§5.5/§7.6 の表) | 各 80〜500、計 4,500 |
| `src/lib/complexity/langTable.ts` | 19キーを全部並べる `LANG_SPECS`、`FRONTEND_OF`(`langs/*` を束ねるだけ) | 60 |
| `src/lib/complexity/macro.ts` | c/cpp の `#define` 収集・関数形式マクロの字句展開・未定義 `rep` フォールバック | 150 |
| `src/lib/complexity/braceFrontend.ts` | 波括弧系(cpp, c, java, csharp, rust, go, js, ts, d, perl, php)のブロック抽出。波括弧なし単文本体・`interpretList`・blockBuiltins フック | 950 |
| `src/lib/complexity/indentFrontend.ts` | インデント系(python, pypy, nim)。`IndentProfile` 駆動。内包表記・ネスト def・デコレータ・セクション | 550 |
| `src/lib/complexity/endFrontend.ts` | end 系(ruby, lua, julia, bash)。`BlockProfile` 駆動(§7.2) | 300 |
| `src/lib/complexity/haskellFrontend.ts` | Haskell 専用「反復の源」抽出(§7.5)。confidence low 固定 | 800 |
| `src/lib/complexity/inputVars.ts` | 入力変数の検出(由来ラベル用) | 120 |
| `src/lib/complexity/frontend.ts` | `parseProgram(code, langKey)` 入口。try/catch の砦・サイズ上限・警告上限 | 90 |
| `src/lib/complexity/expr.ts` | 計算量式の代数(add/mul/logOfExpr/rename/normalize/simplify/format) | 380 |
| `src/lib/complexity/bounds.ts` | `SymbolEnv`、`boundOf(SExpr)→Expr`、`unwrapIter`、`inferLoop`(L 規則) | 650 |
| `src/lib/complexity/builtins.ts` | `TABLE_OF`(19キー)、`CONTAINER_OPS`、`UNKNOWN_OPS`、`METHOD_ALIAS`、ACL、`lookupBuiltin`(言語別 FREE_FUNCS は `langs/*` から束ねる) | 300 |
| `src/lib/complexity/recursion.ts` | 引数分類、`estimateRecursion`(R 規則)、`resolveOrder`(呼び出しグラフの循環検出) | 320 |
| `src/lib/complexity/analyze.ts` | `analyze(program)`: 関数表・walk・harmonic/amortized/adjacency 合成・領域・variables/warnings/confidence | 750 |
| `src/lib/complexity/evaluate.ts` | `parseBoundValue`、`SPEED`(19キー)、`evaluate`、`formatOps` | 200 |
| `src/lib/complexity/index.ts` | `analyzeCode`、`isSupported`、`LANG_NOTES`、`BASIC_LANGS`、re-export(型は `export type`) | 60 |
| `tests/complexity/helpers.ts` | `skeleton(program)`、`analyzeSnippet(lang, code)`、`expectO` | 80 |
| `tests/complexity/{lexer,sexpr,brace,indent,end,haskell,expr,bounds,evaluate}.test.ts` | ユニット | 1,200 |
| `tests/complexity/golden.test.ts` | 主要11言語のスニペット → `time.text`/`space.text`(§10 の75本) | 900 |
| `tests/complexity/<key>.test.ts`(ruby, lua, julia, bash, nim, haskell, perl, php) | 追加8言語のゴールデン(§7.7)と字句・パスの単体テスト | 1,300 |
| `tests/complexity/perf.test.ts` | 1万行・深い括弧1万段・rep 5,000 回。上限は各 1 秒(CI の揺れを吸収しつつ、正規表現の暴走のような桁違いの遅さを捕まえる。ローカルの目安は 200ms) | 60 |
| `tsconfig.test.json` | `tsconfig.node.json` と同じ形(`tsBuildInfoFile: ./node_modules/.tmp/tsconfig.test.tsbuildinfo`、`lib: ["ES2023"]`、`types: ["node"]`、`module: nodenext`、`allowImportingTsExtensions`、`noEmit`)で `include: ["tests", "src/lib/complexity"]` | 25 |
| `tsconfig.json` / `package.json` | references に `./tsconfig.test.json` を追加 / `"test": "node --test --experimental-strip-types \"tests/**/*.test.ts\""` | +2 |
| `src/pages/ComplexityPage.tsx` | ページ(状態・localStorage・RangeTable・BreakdownTable を同一ファイルに) | 450 |
| `src/index.css` | `.cx-*`、`.exit-chip.warn`、`.run-btn:disabled`、`.error-text` ダーク、`.editor-cx-link`、nav コメント修正 | +110 |
| `src/App.tsx` | NavLink「計算量」+ Route | +3 |
| `src/pages/EditorPage.tsx` | 「計算量を調べる →」Link | +6 |
| `src/data/updates.ts` | `2026-09-27a` を先頭に | +12 |
| `README.md` | 機能表に `#/complexity`(+ `#/editor`) | +2 |
| `.github/workflows/deploy.yml` | `npm ci` の後に `npm test`。`if: github.event_name != 'schedule'` を付け、6時間ごとのデータ更新はテストの結果に左右させない | +2 |
| `docs/complexity-analyzer-plan.md` | この計画(C0) | — |

---

## 3. 公開 API と型(`ir.ts`)

```ts
export type Confidence = "high" | "medium" | "low";
export interface Loc { line: number; endLine: number }   // 1始まり、endLine は inclusive

// ---- 字句 ----
export type TokKind = "ident" | "num" | "str" | "op" | "punct" | "newline" | "indent" | "dedent" | "pp" | "eof";
export interface Tok { k: TokKind; v: string; line: number; col: number }

// ---- 構文式(フロントが作る。意味付けはしない) ----
export type SExpr =
  | { kind: "num"; value: number }
  | { kind: "sym"; name: string }
  | { kind: "size"; of: SExpr }                     // a.size()/len(a)/a.length/a.len()/#a/sz(a)/strlen(s)/count($a)/scalar(@a)
  | { kind: "index"; of: SExpr; idx: SExpr[] }      // g[v], dp[i][j]
  | { kind: "member"; of: SExpr; name: string; args: SExpr[] | null }  // args null = プロパティ
  | { kind: "call"; name: string; args: SExpr[] }   // 名前空間は "." 付きで畳む(heapq.heappush)
  | { kind: "bin"; op: "+"|"-"|"*"|"/"|"//"|"%"|"**"|"<<"|">>"|"&"|"|"|"^"; l: SExpr; r: SExpr }
  | { kind: "neg"; e: SExpr }
  | { kind: "cmp"; op: "<"|"<="|">"|">="|"=="|"!="; l: SExpr; r: SExpr }
  | { kind: "logic"; op: "&&"|"||"; l: SExpr; r: SExpr }
  | { kind: "not"; e: SExpr }
  | { kind: "assign"; op: "="|"+="|"-="|"*="|"/="|"//="|">>="|"<<="|"%="|"++"|"--"; target: SExpr; value: SExpr | null }
  | { kind: "list"; count: number }                 // リテラル列(要素数)
  | { kind: "range"; from: SExpr | null; to: SExpr; step: SExpr | null; inclusive: boolean } // range()/a..b/1:n/0..<n を統一。負 step は from/to 入替済み
  | { kind: "unknown"; text: string };

export type ContainerKind =
  | "array" | "oset" | "omap" | "hset" | "hmap" | "pq" | "deque" | "stack" | "string" | "linkedlist"
  | "acl" | "user" | "scalar" | "unknown";

// ---- ブロック木 ----
export type LoopBound =
  | { form: "for-c"; var: string | null; init: SExpr | null; cond: SExpr | null; update: SExpr | null }
  | { form: "for-range"; var: string | null; range: Extract<SExpr, { kind: "range" }> }
  | { form: "for-in"; var: string | null; coll: SExpr }
  | { form: "while"; cond: SExpr | null; doWhile: boolean };   // cond null = 無限(while(true)/for(;;)/loop)

export type IrNode =
  | { kind: "func"; name: string; params: string[]; decorators: string[]; body: IrNode[]; loc: Loc; isLambda: boolean; selfParam: string | null }
  | { kind: "loop"; bound: LoopBound; body: IrNode[]; hasBreak: boolean; loc: Loc }
  | { kind: "branch"; conds: (SExpr | null)[]; branches: IrNode[][]; loc: Loc }   // else は null、switch/match/try は全部 null
  | { kind: "call"; callee: string; recv: SExpr | null; args: SExpr[]; loc: Loc } // Python の `x in a` は callee "in"。omap/hmap への添字は callee "[]"
  | { kind: "assign"; target: SExpr; op: string; value: SExpr | null; loc: Loc }
  | { kind: "decl"; name: string; typeName: string; container: ContainerKind; dims: SExpr[]; init: SExpr | null; isGlobal: boolean; costsTime: boolean; loc: Loc }
  | { kind: "return"; value: SExpr | null; loc: Loc }
  | { kind: "stmt"; loc: Loc };

export interface Program {
  lang: string;
  nodes: IrNode[];                                          // トップレベル(関数定義 + トップレベル文)
  consts: Record<string, { value: number; line: number }>; // 定数式に評価できたものだけ。後勝ち。入力で上書きされたら削除
  inputVars: { name: string; line: number; via: string }[];
  warnings: FrontWarning[];
  lineCount: number;
}
export interface FrontWarning { line: number; code: "unbalanced"|"unterminated"|"bad-indent"|"macro-fallback"|"macro-limit"|"truncated"|"internal-error"|"callback"; message: string }

// ---- 計算量式 ----
export interface Factor { v: string; pow: number; log: number; exp: number; fact: number }  // v^pow · log^log(v) · (2^v)^exp · (v!)^fact
export interface Term { coef: number; factors: Factor[] }
export type Expr = Term[];   // 和。正規化済みなら同じ factors 集合の項は1つ

// ---- 出力 ----
export interface Variable { name: string; origin: string; line: number; value?: number }
export interface BreakdownItem { axis: "time"|"space"; kind: "loop"|"call"|"recursion"|"alloc"|"builtin"|"func"; loc: Loc; label: string; expr: Expr; text: string; reason: string; conf: Confidence; unused?: boolean }
export interface AnalysisWarning { line?: number; message: string; level: "info"|"warn" }
export interface Analysis {
  lang: string;
  status: "ok" | "unsupported" | "error";
  time: { expr: Expr; full: Expr; text: string };   // text = formatO(expr)
  space: { expr: Expr; full: Expr; text: string };
  variables: Variable[];
  breakdown: BreakdownItem[];
  warnings: AnalysisWarning[];
  confidence: Confidence;
  entries: string[];                                  // "main" / "<module>" / 個別評価した関数名
}
export type TimeVerdict = "ok" | "tight" | "tle";
export interface EvalResult { ops: number | null; opsText: string; missing: string[]; budget: number; ratio: number | null; verdict: TimeVerdict | null }
```

モジュール別シグネチャ(v1 で読まない引数はシグネチャに入れない。`noUnusedParameters` 対策):

```ts
// lexer.ts
export interface LexRules { lineComment: readonly string[]; blockComment: readonly (readonly [string,string])[]; nestedBlockComment: boolean;
  strings: readonly { open: string; close: string; escape: boolean; multiline: boolean; prefixes?: readonly string[]; doubledQuoteEscape?: boolean }[];
  cppRaw: boolean; jsTemplate: boolean; preprocessor: boolean; significantIndent: boolean; regexLiteral: boolean; lifetimes: boolean;
  digitSeparators: readonly string[]; identSuffix: string /* ruby/julia は "?!"、haskell は "'" */; sigils: boolean; heredoc: boolean; luaLongBracket: boolean;
  interpolation: "none"|"ruby"|"julia"|"shell"|"perl"|"php" }   // 数値の "." は直後が数字のときだけ小数点(全言語共通。1..n を壊さない)
export function tokenize(code: string, rules: LexRules): { tokens: Tok[]; warnings: FrontWarning[] };

// sexpr.ts
export interface SExprCtx { sizeMembers: ReadonlySet<string>; sizeFuncs: ReadonlySet<string>; sizePrefixOps: readonly string[]; castWords: ReadonlySet<string>; namespaces: ReadonlySet<string> }
export function parseSExpr(tokens: Tok[], ctx: SExprCtx): SExpr;   // 投げない。壊れていれば unknown
export function evalConst(e: SExpr, consts: Record<string, { value: number }>): number | null;  // 10**5, 2e5+5, 1<<20, 1'000'000'007
export function sexprText(e: SExpr): string;

// langTable.ts
export interface LangSpec { key: string; family: "brace"|"indent"|"end"|"haskell"; lex: LexRules; expr: SExprCtx;
  keywords: ReadonlySet<string>; loopWords: ReadonlySet<string>; funcWords: ReadonlySet<string>; containerWords: ReadonlySet<string>;
  typeKind: Readonly<Record<string, ContainerKind>>; inputMarkers: ReadonlySet<string>; addressArgs: ReadonlySet<string>;
  loopMacroFallback: ReadonlySet<string>;
  canon?: (toks: Tok[]) => Tok[];                                          // 演算子の正規化(§7.1)。ヘッダ・本体・自己呼び出し引数の全域に適用
  postTokenize?: readonly { name: string; run: (toks: Tok[]) => Tok[] }[];  // 名前付きパス。順序はテストで固定
  blocks?: BlockProfile;                                                   // end 系のみ(§7.2)
  indent?: IndentProfile;                                                  // インデント系のみ(§7.3)
  branchChain: { start: ReadonlySet<string>; cont: ReadonlySet<string> };   // F14
}
export const LANG_SPECS: Record<string, LangSpec>;            // 19キー
export const FRONTEND_OF: Record<string, LangSpec["family"]>; // 19キー

// macro.ts / *Frontend.ts / frontend.ts
export function collectMacros(tokens: Tok[]): { macros: Map<string, { params: string[] | null; body: Tok[] }>; consts: Program["consts"] };
export function expandMacros(tokens: Tok[], macros: …, fallback: ReadonlySet<string>): { tokens: Tok[]; warnings: FrontWarning[] };  // 深さ ≤3、総数 ≤10000
export function parseBrace(tokens: Tok[], spec: LangSpec): Program;   // parseIndent / parseEnd / parseHaskell も同型
export function parseProgram(code: string, langKey: string): Program; // 必ず返す。想定外例外は internal-error 警告 + 空 nodes

// expr.ts
export const ONE: Expr; export const COEF_KEEP = 10;
export function lit(n: number): Expr; export function sym(v: string): Expr; export function powOf(v: string, k: number): Expr;
export function logOf(v: string): Expr; export function exp2Of(v: string): Expr; export function factOf(v: string): Expr;
export function mul(a: Expr, b: Expr): Expr; export function add(a: Expr, b: Expr): Expr;
export function logOfExpr(e: Expr): Expr;      // 単項 c·v^k → log v、積 → 各 log の和、和 → 各項 log の和、数値 c → lit(ceil(log2 c))
export function rename(e: Expr, from: string, to: Expr): Expr;   // 記号に式を代入し分配・再正規化
export function normalize(e: Expr): Expr; export function simplify(e: Expr): Expr; export function dominates(a: Term, b: Term): boolean;
export function vars(e: Expr): string[]; export function format(e: Expr, order: readonly string[]): string; export function formatO(e: Expr, order: readonly string[]): string;
export function equals(a: Expr, b: Expr): boolean;

// bounds.ts
export interface SymbolEnv { consts; alias: Record<string, Expr>; outer: { var: string; bound: Expr; node: IrNode }[]; symbolOrder: string[];
  symbolOf(id: string): string;  // /^[a-z]\d*$/ → 大文字、consts は数値、それ以外はそのまま
  declaredBefore(name: string, loc: Loc, loopNode: IrNode): boolean; declKind(name: string): ContainerKind; declDims(name: string): Expr[] | null;
  pushesInto(name: string): Expr | null; isInput(e: SExpr): boolean }
export interface Bound { expr: Expr; dividedBy?: string }
export function boundOf(e: SExpr, env: SymbolEnv, seen?: Set<string>): Bound | null;   // consts 展開は seen + 深さ ≤16
export function unwrapIter(coll: SExpr, env: SymbolEnv): { size: Expr | null; special?: "product"|"permutations"|"combinations"|"adjacency"|"input"; adjacencyOf?: string; args?: SExpr[] };
export interface LoopFactor { expr: Expr; conf: Confidence; reason: string; warn?: string;
  harmonic?: { outerVar: string; bound: Expr }; amortized?: { total: Expr }; adjacency?: { of: string; edges: Expr }; vertices?: Expr; multiTest?: boolean }
export function inferLoop(node: Extract<IrNode, { kind: "loop" }>, env: SymbolEnv): LoopFactor;

// builtins.ts
export interface CallCtx { recv: SExpr | null; recvKind: ContainerKind; typeName: string; args: SExpr[]; size(e: SExpr): Expr; bound(e: SExpr): Expr | null }
export interface BuiltinRule { cost: (c: CallCtx) => Expr; space?: (c: CallCtx) => Expr; grows?: boolean; conf: Confidence; note: string; warn?: string }
export type BuiltinTable = "cpp"|"python"|"java"|"other"|"ruby"|"lua"|"julia"|"bash"|"nim"|"haskell"|"perl"|"php";
export const TABLE_OF: Record<string, BuiltinTable>;  // 19キー(c→cpp, pypy→python, js/ts/rust/go/csharp/d→other)
export const CONTAINER_OPS: Partial<Record<ContainerKind, Record<string, BuiltinRule>>>;
export const UNKNOWN_OPS: Record<string, BuiltinRule>;
export const FREE_FUNCS: Record<BuiltinTable, Record<string, BuiltinRule>>;
export const METHOD_ALIAS: Record<string, string>;
export function lookupBuiltin(table: BuiltinTable, callee: string, recvKind: ContainerKind, typeName: string): BuiltinRule | null;

// recursion.ts
export type ArgClass = "step"|"half"|"graph"|"uf"|"other";
export interface RecInfo { fn; selfCalls: { args: SExpr[]; loc: Loc; insideLoop: boolean; insideAdjacency: boolean }[];
  memo: { source: "decorator"|"array"|"dict"; table: string | null } | null; hasVisitedCheck: boolean; hasParentSkip: boolean; hasPruneReturn: boolean; baseCaseBounds: Record<string, Expr> }
export interface RecEstimate { time: Expr; depth: Expr; conf: Confidence; reason: string; warn?: string }
export function classifyArg(arg: SExpr, params: string[]): ArgClass;
export function estimateRecursion(info: RecInfo, bodyCost: Expr, adjBody: Expr | null, env: SymbolEnv): RecEstimate;
export function resolveOrder(graph: Map<string, Set<string>>): { order: string[]; cyclic: Set<string> };

// analyze.ts / evaluate.ts / index.ts
export function analyze(program: Program): Analysis;
export function parseBoundValue(s: string): { lo: number | null; hi: number } | null;  // §8。評価には hi を使う
export const SPEED: Record<string, number>;  export const TIGHT_RATIO = 0.3;
export function evaluate(e: Expr, values: Record<string, number>, lang: string, timeLimitSec: number): EvalResult;
export function formatOps(n: number): string;
export function analyzeCode(code: string, langKey: string): Analysis;
export function isSupported(langKey: string): boolean;       // 19言語すべて true(未知キーだけ false)
export const LANG_NOTES: Record<string, string | undefined>; // ページ注記(§7.8)
export const BASIC_LANGS: ReadonlySet<string>;               // 簡易対応の言語(haskell, bash)。select の表示に使う
```

### `analyze()` の流れ

1. `nodes` を再帰走査して関数表(ネスト・ラムダ含む)と decl 表(名前 → kind/dims/loc/isGlobal)を作る。
2. 前パスで「`g[..]` への push/append 回数」「成長のみコンテナの挿入回数」を、囲むループ因子の素朴な積で集計(`pushesInto`)。
3. 呼び出しグラフ → `resolveOrder` → 逆順に各関数のコスト・深さを確定(自己呼び出しは `estimateRecursion`)。
4. 入口: `main` があれば main。Python/JS/Go/Rust 等でトップレベル文があれば `<module>`。どちらも無ければ全トップレベル関数を個別入口として `add`(info「main が無いので各関数を個別に評価しました」)。
5. `walk(nodes)`: 逐次 `add`、`loop` は `inferLoop` × 本体(harmonic/amortized/adjacency は親側で合成、branch は透過)、`branch` は分岐の `add`、`call` は「ユーザー定義 → user 型メソッド → builtins → 未知」、`decl` は dims の積を空間に(`costsTime` なら時間にも)。
6. alias を `rename` で代入 → `"?"` を主記号(生成した記号のうち出現最多)に `rename` → `normalize`(full)→ `simplify`(expr)→ `format(symbolOrder)`。
7. `variables`(alias 済み記号は出さない、consts 由来は `value` 付き)、`warnings`(未知関数はまとめて1件)、`confidence` = 支配項に寄与した breakdown の conf の最小値(Haskell は low 固定)。

---

## 4. フロントエンドの義務(全ファミリ共通。ゴールデンで担保)

- **F1** c/cpp: 関数形式 `#define`(rep/FOR/all/sz 等)を1行・非再帰(深さ ≤3)で字句展開してから IR を作る。オブジェクト形式(`#define int long long`)は展開しない(数値なら consts へ)。展開できなかった `rep|REP|rep1|FOR|rrep` は「最後の引数を上限、第1引数を変数」の `for-c` にフォールバックし `macro-fallback` 警告。
- **F2** 変数に束縛された関数を `func` に: `auto f = [&](auto&& self, …){…}` / `[&](this auto&& self, …)` / `std::function<…> f = [&]…` / JS `const f = (…) => {…}` / Python ネスト `def` / Ruby `f = ->(x){}` / Lua `local f = function()`。`selfParam` で `self(self,…)` を自己呼び出しに。`Thread(target=f)` / `setTimeout(f)` は f への `call`。
- **F3** `class/struct/impl/namespace/module` 内のメソッドは `func` として平坦化(`decl.typeName` で user 型を保持)。`template<…>`/`operator`/`constexpr`/`inline`/`static`/`public static` 前置を受理。
- **F4** 文に含まれる全呼び出しを、その文の直前に `call` ノードとして左から展開(decl の init / assign の value / 条件 / return / 引数内も)。名前空間らしい receiver(`std::`, `heapq.`, `Arrays.`, `Math.`, `bisect.`, `sort.`, `table.`, `List::Util::`)は callee に畳んで `recv=null`。`X.begin(), X.end()` / `all(X)` の引数ペアは `size(X)` 1個に畳む。
- **F5** Python/Ruby/Julia/Nim/Perl/PHP の `x in a` / `a.include?(x)` / `in_array` は `call{callee:"in", recv:a}`。oset/omap/hset/hmap と分かっている名前への添字は `call{callee:"[]"}`(array への添字は出さない)。
- **F6** `decl` は言語別の宣言形から `container`/`dims` を決める(§7 の表)。サイズ付き宣言は `dims` を持つ1ノード。`resize/assign/reserve` は `call` のまま。グローバル/静的は `isGlobal:true`。
- **F7** 内包表記(Python/Julia/Nim/Haskell)は各 `for` 節を外側から `loop` としてネストし、要素式の呼び出しを最内 body に置く。**純粋な確保内包**(要素が `[lit]*E`・リテラル・`None`・ネストした純粋確保内包)で名前に代入されるときは loop を出さず `decl{dims:[…], costsTime:true}` だけ出す。
- **F8** `hasBreak` は子ループ・子関数を跨がずに到達できる `break/return/goto/exit/throw/last`(if/switch/plain の中を含む)。`switch/match/case` フレームも break の受け皿。
- **F9** ループ形の写像: `for(init;cond;update)` → for-c(`&&` は logic のまま)。Python `range` / Rust `a..b`/`a..=b`/`.rev()`/`.step_by(k)` / Go 1.22 `range n` / D `a..b` / Nim `0..<n`/`0..n`/`countup` / Julia `1:n` / Ruby `n.times`/`(a..b).each`/`a.upto(b)` / Lua `for i=a,b,s` / Bash `for ((…))`/`seq a b` / Perl `for my $i (a..b)` → for-range(負 step リテラルは from/to 入替 + abs)。`for x in a` 系 / range-for / foreach / for-of / `a.each`/`each_with_index`/`map`/`select` 等ブロック付き / `pairs/ipairs` / `for _, x := range a` → for-in。`while`/`until`(cond を not で包む)/`do{}while`/`repeat…until`/`loop`/`for {}`/`while let Some(v)=q.pop_front()`(cond は `member{of:q,name:"pop_front"}`)→ while。Go の `for/if/switch` ヘッダは `{` までを1文とし `;` を境界にしない。
- **F10** c/cpp の数字間 `'` は桁区切り。未終端文字列/コメントは警告して行末(複数行は EOF)まで消費、投げない。余分な閉じは無視+警告。EOF で開いたままのブロックは全部閉じる。
- **F11** サイズ上限: 入力 1MB 超は先頭だけ解析して `truncated`。マクロ展開 ≤10,000 回・深さ ≤3。`warnings` 合計 200 件で打ち切り。lexer は `slice(i)` 禁止、Pratt は深さ 200 で unknown。`.*` を含む正規表現は使わない(括弧深さカウント)。
- **F12** コールバックの扱い: 言語側でループ構文として定義したもの(Ruby のブロック付き `each`/`map`/`times` など、Julia の `do` ブロック、Perl の `map {}`/`grep {}`/`sort {}`、PHP の `array_map`/`usort` など、Haskell の `forM_`/`mapM_` など。§7 で列挙)はループにする。それ以外のコールバック(JS/TS の `forEach/map/filter/reduce`、Java の `stream()`、C# の LINQ、Rust の `.iter().map` など)は v1 では**ループにしない**。`call` として出して builtins が `|a|` を付け、ブロックは plain として開き、`callback` 警告「行 L: コールバック内のコストは掛け合わせていません」を1回だけ出す。
- **F13** 波括弧なし単文本体: `for (…) stmt;` / `while (…) stmt;` / `if (…) stmt; else stmt;` は次の1文(`;` まで、またはネストした制御文1つ)を本体にする(C/C++/Java/C#/JS/TS/D/PHP。Go/Rust/Perl は常に波括弧)。
- **F14** 分岐チェーン: `if/elif/else`、`if/else if/else`、`case/of/else`、`when`、`try/except/finally`、`switch/case` は1つの `branch` ノードにまとめる(分岐のコストは max)。開始語と継続語は言語プロファイルの `branchChain` が持つ。

---

## 5. ルール表(v1 確定)

### 5.1 ループ上限(`inferLoop`)

照合は `SExpr` 構造で行う。`<`/`<=`/`!=` は同じ扱い、`>`/`>=` は向きを反転。上限 E は `boundOf(E)`。

| # | パターン | 因子 | 信頼度 | 警告 |
| --- | --- | --- | --- | --- |
| L1 | for-c `i=c; i<E; i++/i+=1/--` | E(init が変数でも E) | high | — |
| L1' | cond が `i+c<E` / `i-c<E` / `i*2<E` | E | high | — |
| L2 | `i<n*m` / `i<n+m` | N·M / N+M | high | — |
| L3 | for-in `coll` を `unwrapIter` で剥く: `enumerate/reversed/sorted/set/list/tuple/iter(X)`、`X.items()/keys()/values()/iter()/chars()/bytes()/rev()/enumerate()/each_with_index`、`X[::-1]`/`X[1:]`、`zip(X,Y)`、for-c の `it != X.end()` | \|X\|。リテラル列は lit(要素数)、`input().split()`/`sys.stdin` は記号 N | high(入力由来は low) | — |
| L4 | for-range `range(E)` / `range(a,E)` / `range(a,E,k)`(k 定数)/ `a..b` / `1:n` / `n.times` 等 | E(a が定数)。a が外側変数 → L9 | high | — |
| L4' | `range(int(input()))` 等 `isInput` → 記号 **T**(origin「入力値(行 L)」、`multiTest`) | T | medium | info「マルチテストです。範囲指定の N は1ケースあたりの値にしてください」(1回) |
| L5 | `i+=k`(k 定数) | E | high | — |
| L6 | `i+=k`(k 変数、外側ループ変数でない) | E | medium | 「行 L: ステップ幅 k が変数なので反復回数を E とみなしました」 |
| L7 | `i*=2`/`i<<=1`/`i*=c`/`i/=2`/`i>>=1`/`i//=2` | log(E)(`logOfExpr`) | high | — |
| L8 | `i*i<=n` / `i<=sqrt(n)` / `range(int(n**0.5)+1)` / `isqrt(n)` | √N | high | — |
| L9 | 上限が外側ループ変数(`j<i`, `range(i)`, `range(i,n)`) | 外側の上限を代入 | high | — |
| L10 | **調和級数**: update が `j+=i`(i は外側変数)または上限が `E/i`(`dividedBy`)。init 不問。Python `range(a,E,i)` | `harmonic:{i,E}`(合成は §5.2) | high | info「篩なら実際は N log log N です」(init=i*i のとき) |
| L11 | while `l<r`/`l+1<r`/`lo<=hi`/`hi-lo>1`/`r-l>1`/`ok-ng>1`/`abs(ok-ng)>1` + 本体に `mid` の assign と `l=mid`/`r=mid` 系 | log(E)。E = r/hi/ok の初期値(decl init / 直前 assign)。不明なら log N(medium) | high/medium | 「行 L: 二分探索の範囲上限が分かりません。log N とみなしました」 |
| L12 | while で本体に `x/=c`, `x//=c`, `x>>=c`, `x=x/c`(c≥2 のリテラルまたは変数)。cond 不問 | log(X) | high | — |
| L12' | `while(b)` で本体に `a%=b` / `a,b=b,a%b` / `swap` を伴う `%` | log A | medium | — |
| L12'' | `while(A[x]!=x) x=A[x]` / `while(A[x]>=0)`(Union-Find 反復) | log \|A\| | medium | — |
| L13 | while `x` / `x>0` で本体に `x-=k`(定数)/`x--` | X | high | — |
| L13' | `while(r<E)` + 本体 `r++`/`r+=c`(償却でない) | E | high | — |
| L13'' | `while(t--)` / `while(t-- > 0)` | T(`multiTest`) | high | — |
| L14 | **BFS/キュー**: `while(!q.empty())`/`while q:`/`while(q.size())`/`while(len(q))`/`while(q.length)`/`while let Some(..)=q.pop_front()`/`while(!pq.empty())`。頂点数 V = `visited/seen/dist/used/vis` 系 decl の dims の積、無ければ主記号 | V(本体の adjacency 子は §5.2) | medium | 「行 L: キューの総 push 回数を推定できないので N 回とみなしました」(V が主記号のとき) |
| L15 | **償却**(L14 より先): 内側 while の本体が、外側ループより前(for-init 含む)で宣言された変数/コンテナへの単調操作(`r++`/`r+=c`/`st.pop()`/`q.pop_front()`/`popleft()`)だけで、外側本体で再初期化も clear もしない | `amortized:{total:E}` | medium | 「行 L: 尺取り/単調スタックとして償却 O(N) にしました。r が外側ループ内でリセットされる場合は O(N²) です」 |
| L16 | `while(next_permutation(all(a)))` / `do{}while(next_permutation)` / `for p in permutations(a)` / `permutations(range(E))` / Ruby `a.permutation` | \|a\|! / E! | high | — |
| L17 | `range(1<<n)` / `s<(1<<n)` / `product((0,1), repeat=n)` / `product(X, repeat=E)` | 2^N(`1<<E` の E が単一変数でなければ疑似記号 `2^(H·W)` を `sym` で持つ)。\|X\| がリテラル k>2 なら 2^E 上界 + warn「実際は k^E」 | high | — |
| L17' | `combinations(range(E), k)` / `combinations(a, k)`(k リテラル)/ Ruby `a.combination(k)` | E^k / \|a\|^k | high | — |
| L18 | `for s=mask; s>0; s=(s-1)&mask`(部分集合列挙) | 子 2^N(表示 4^N) | low | 「行 L: 部分集合列挙の正確な合計は 3^N です(表示は上界)」 |
| L19 | `while(true)`/`for(;;)`/`loop` および当たらない while | `"?"`(主記号) | low | 「行 L: while の反復回数を推定できません。N 回とみなしました。範囲指定で N に上限を与えるか、内訳を確認してください」 |
| L19' | cond が `cin >> x` / `scanf(...) != EOF` / `getline` / `sys.stdin` / `input()` / `br.readLine()) != null` / `while read` / `while (<STDIN>)` / `fgets(STDIN)` | 記号 N(origin「入力行数(行 L)」) | medium | — |
| L20 | `hasBreak` | 因子は変えない。内訳に「break/return あり(最悪ケースでは影響なし)」 | — | — |
| L21 | cond が `A && B` | 各項を L1〜L13 で試し、解釈できた方(両方なら小さい方、不能なら左) | medium | — |
| L22 | 上限が未知の関数呼び出し `i<f(n)` / `range(solve())` | `"?"` | low | 「行 L: 上限 `f(n)` を評価できません」 |

while 規則の優先順位: **L16 → L11 → L13'' → L12 / L12' / L12'' → L13 → L15 → L13' → L14 → L19' → L21 → L19**。

`unwrapIter` で coll が `index{of: sym g, idx:[v]}` かつ v が「直前に pop/front/popleft した変数」または関数の仮引数のとき `special:"adjacency", adjacencyOf:"g"`。

### 5.2 特殊合成(親側 `walk` で行う。branch ノードは透過)

| 合成 | 子の条件 | 親の因子 | 子の因子 | 追加項 |
| --- | --- | --- | --- | --- |
| 調和級数 | 子 `harmonic:{i,E}`、親が i を回す最近祖先ループ | **E に置換**(親が √E でも Σ E/i = E log E) | log E | — |
| 償却 | 子 `amortized:{total}` | そのまま | **1** | `total` を親の合計に add |
| 隣接走査 | 子 `adjacency:{of:g, edges:E}`、親が L14 while または R8 再帰 | V(頂点数) | **1**(子本体は親の本体和から除外) | `E × 子本体`。E = `pushesInto(g)`(木の入力 `for i<n-1` なら N、`for i<m` なら M)、無ければ記号 M(origin「辺数(g への追加が見つからず)」) |
| Dijkstra | 隣接走査の子本体に `pq.push`(log \|pq\|) | 同上 | 同上 | \|pq\| は成長のみコンテナなので alias ≡ E → `O(N log N + M log M)` |

### 5.3 再帰(`estimateRecursion`)

引数分類 `classifyArg`: `p±リテラル` → step、`p/2`/`p>>1`/`(l+r)/2`/`mid`/`mid±1` → half、`A[p]`(A は array)→ uf 候補、`p` 以外の識別子/添字/`p±非リテラル` → graph、その他 → other。呼び出し1個の分類 = 引数クラスの優先順位 **uf > half > step > graph > other**。

適用順: **R11(循環)→ R7(memo)→ R-UF → R8/R9(graph)→ R3'/R3(half)→ R2 → R1/R6(step)→ R10**。a = 自己呼び出し数(`insideLoop` なら K 分岐扱い、`insideAdjacency` なら R8)。

| # | 形 | T | 深さ | 信頼度 | 警告 |
| --- | --- | --- | --- | --- | --- |
| R11 | `resolveOrder` の cyclic(相互再帰) | 各関数 N(`"?"`) | N | low | 「f と g が相互再帰しています。合計 N 回の呼び出しとみなしました」 |
| R7 | memo: `@lru_cache`/`@cache`/`@functools.` 前方一致、または本体先頭付近の branch cond に `memo[..] != -1`/`>= 0`/`~memo[..]`/`is not None`/`key in memo`/`(i,j) in memo`/`seen[i][j]` があり、その分岐に return | **状態数 × 遷移**。状態数 = 各仮引数 p の上限の積。p の上限 = `baseCaseBounds[p]`(`p==E`/`p>=E`/`p>E`/`p==len(a)`)→ 無ければ memo 配列 dims → 無ければ記号 P(low)。遷移 = 本体コスト(自己呼び出しを1として) | 各次元の最大 | high/medium/low | 「行 L: 状態数を仮引数の記号の積 I·J とみなしました。範囲指定で実際の上限を与えてください」(記号のとき) |
| R-UF | a=1、引数が `A[p]`、本体に `A[p]==p`/`A[p]<0`/`A[p]==-1` 判定 | log \|A\| | log N | medium | note「経路圧縮前提。実際は α(N)」 |
| R8 | graph 引数、`hasVisitedCheck` or `hasParentSkip`、または隣接走査の中で呼ばれる | V × (本体 − 隣接ループ) + E × (隣接ループ本体、自己呼び出しは1)。グリッド(`dfs(x+dx[k], y+dy[k])` + visited 2次元)は V = dims の積 | V | high | — |
| R9 | graph 引数、visited も parent skip も無し | 同上(low) | V | low | 「行 L: DFS に訪問済みチェックが見つかりません。木なら O(N+M)、そうでなければ指数時間になりえます」 |
| R3' | a=2 half、`hasPruneReturn`(自己呼び出しより前に `\|\|` 付き条件の return) | log N × 本体 | log N | medium | note「区間クエリの枝刈りとみなしました」 |
| R3 | a=2 half | 本体 O(1) → N、本体 O(N) → N log N | log N | high | info「2分割再帰を N と見積もりました。区間クエリなら log N です」 |
| R2 | a=1 half | log N × 本体 | log N | high | — |
| R1 | a=1 step | N × 本体 | N | high | — |
| R6 | a≥2 step(fib、部分和2分岐) | 2^N(a=3 も 2^N + 注記) | N | medium | 「行 L: 指数時間の再帰です。メモ化があれば見落としている可能性があります」 |
| R10 | other | N(`"?"`) | N | low | 「行 L: 再帰の引数の変化を解釈できません。N 回の呼び出しとみなしました」 |

非再帰の呼び出し: callee の式をそのまま使い、**実引数が単一識別子または `boundOf` 可能なら `rename(calleeExpr, 仮引数記号, boundOf(実引数))`**(解釈不能なら仮引数記号のまま variables に出る)。到達しない関数は `breakdown` に `kind:"func", unused:true`(UI で折り畳み)、info「未使用の関数 12 個を無視しました」。

### 5.4 領域(合算方式: 入力配列も含む総確保量の目安)

| # | 構文 | 領域 | 信頼度 |
| --- | --- | --- | --- |
| S1 | decl dims 1次元(`vector<T> a(n)`, `new int[n]`, `make([]int,n)`, `vec![0;n]`, `[0]*n`, `Array(n)`, `Array.new(n)`, `zeros(n)`, `newSeq[int](n)`, `array_fill(0,$n,0)`, `(0) x $n`) | N | high |
| S2 | decl dims 多次元 | dims の積(N·M) | high |
| S3 | 静的配列 `int a[MAX]` / `int dp[2005][2005]` | dims の積(数値なら数値。時間 alias には使わない) | high |
| S4 | 成長: `push/insert/emplace/add/append/heappush/offer/[k]=v/push!/<<`、omap/hmap への `m[k]`(読み書き問わず) | 囲むループ因子の積の和(再帰内なら呼び出し回数)。警告「行 L: `s` への挿入回数の上限をループ回数 N とみなしました」 | medium |
| S4' | 確保されていないコンテナへの添字代入(Perl `$cnt{$_}++`・`$dp[$i][$j] = …`、Lua `dp[i][j] = 0`、Bash `a[$i]=x`、Ruby/Julia `h[k] = v`) | 成長として扱い、添字の段数ぶん囲むループ因子を掛ける。明示的に確保済みの受け手は無視(二重計上しない)。push の値に `sizeOf` が効けばそのサイズ(`$g[] = str_split(…)` → W) | medium |
| S5 | 再帰の深さ(§5.3 depth) | depth | R の conf |
| S6 | `sorted(a)`, `list(a)`, `a[:]`, `a.copy()`, `vector<int> b = a`, `a + b`(list), `a.dup`, `copy(a)` | \|a\| | high |
| S7 | `list(range(n))`, 内包 → decl dims(F7) | N / N·M | high |
| S8 | `resize(n)`/`assign(n,x)`/`reserve(n)`/`setLen(n)`/`resize!` | N | high |
| S10 | 隣接リスト `vector<int> g[MAX]` / `defaultdict(list)`: 静的 MAX + 挿入回数 | MAX + M | medium |
| S11 | decl がループ内 | **max**(毎反復解放)。外側コンテナに append されていれば S4 が積む。警告「行 L: ループ内の確保は毎回解放される前提で M にしました」 | medium |
| 時間側 | decl(`costsTime`)は dims の積を**時間にも**積む(`memset`、`vector<int> vis(n)` が T ループ内にある対策) | | medium |

alias 規則(上から順に当てる):

- (a) decl dims[0] が `boundOf` できれば `|a| ≡ その値`(静的配列は除く)。
- (b) 成長(S4/S4')でしかサイズが決まらないコンテナは `|c| ≡ S4 の合計`(pq の `log|pq|` が `log(N+M)` になる経路)。
- (c) サイズを保つ別名: `b = a`(右辺が識別子1個)、サイズを保つ builtin(sorted/reversed/map/dup/copy/sort_by/array_map など)の戻り値 → `|b| ≡ |a|`。長さの取得を代入した変数(`n = len(a)`、`my $n = @a`、`$n = count($a)`、`let n = s.len`)→ `N ≡ |a|`。
- (d) 定数添字でしか参照されない入力配列(`v[0] + v[1]` だけ)は長さを定数とみなす(テンプレートの A+B が O(1) になる)。
- (e) 入力配列 a の長さは、同じブロックで a より前に読まれたスカラ入力のうち、まだ別の配列に割り当てていない最初のものとみなす(`N M` → `A_1…A_N` → `B_1…B_M` で a ≡ N、b ≡ M)。info「a の長さを N とみなしました」を出す。
- (f) それ以外は `|a|` を記号として variables に出す(origin「配列 a のサイズ(確保箇所が見つからず)」)。

### 5.5 builtins(v1)

**METHOD_ALIAS(言語共通)**: push_back/emplace_back/append/push/add/offer/Add/push!/`<<` → `push`、pop_back/pop/pop! → `pop`、erase/remove/delete/Remove/delete! → `erase`、find/count/contains/has/get/containsKey/Contains/include?/haskey → `find`、size/length/len/Count/Length/empty/isEmpty/empty? → `size`、top/peek/front/back/first/last/begin → `peek`、sort/sort_unstable/Sort/sort!/sort_by/table.sort → `sort`、lower_bound/upper_bound/floorKey/ceilingKey/bisect_left/bisect_right/BinarySearch/binary_search/bsearch/searchsortedfirst/binarySearch → `lower_bound`。

| kind | push | pop/peek/size | find/`[]`/erase | sort | その他 |
| --- | --- | --- | --- | --- | --- |
| array | 1(grows) | 1 | `[]` 1、`find`/`in`/index/count/includes/indexOf/Contains/include?/in_array → \|a\|、erase(中)/insert(中)/pop(0)/shift/unshift/insert(0)/array_shift/table.insert(t,1,x) → \|a\| | \|a\| log \|a\| | reverse/sum/max/min/copy/slice/join/`+`/fill/extend/uniq/flatten/inject/array_sum/array_merge/implode → \|a\|、substr(i,k) → K(第2引数無しなら \|s\|) |
| oset/omap | insert/`[]`/erase/find/lower_bound → log \|s\|(grows) | begin/first/last 1 | | | |
| hset/hmap | 1(grows、medium、note「最悪 O(N) だが平均で扱う」) | 1 | 1 | | |
| pq | push/pop/poll/offer/heappush/heappop/insert/extract → log \|q\|(grows) | top/peek 1 | | | heapify → \|a\| |
| deque | 両端 1(grows) | 1 | `[]` 1、`in` → \|d\| | | |
| stack | 1 | 1 | | | |
| string | `+= ch` 1(C++/JS/Ruby/Perl/PHP。Python/Java/Haskell は warn「文字列の += は O(N) になりえます」) | | find/substr/replace/split/join/count/strpos/index → \|s\| | | |
| linkedlist | 1 | `get(i)` → \|l\| | | | |
| acl | segtree/lazy_segtree/fenwick_tree: set/get/prod/apply/add/sum/max_right/min_left → log N(N = decl dims[0])、all_prod → 1。dsu: merge/same/leader/size → log N、groups → N。mf_graph.flow / scc_graph.scc → N·M(warn) | | | | |
| unknown(`UNKNOWN_OPS`) | push/pop/peek/size → 1、find/`[]`/erase/insert → log \|s\|、sort → \|s\| log \|s\|、index/remove/`in` → \|s\|(medium、warn「型が分からないので set/map と仮定しました」) | | | | |

**FREE_FUNCS**(要旨。実装時は表として19言語分を並べる):
- cpp(c 共有): `sort/stable_sort/partial_sort` → n log n(n = `size(X)` に畳まれた第1引数、`a, a+n` → N)/ `lower_bound/upper_bound/binary_search/equal_range` → log n(第1引数が oset/omap の size なら warn「std::lower_bound を set に使うと O(N) です」)/ `reverse/accumulate/max_element/min_element/fill/count/find/iota/unique/copy/all_of/any_of/nth_element/memset/memcpy/next_permutation` → n / `__builtin_popcount*/abs/swap/min/max/to_string/stoi/printf/scanf` → 1 / `gcd/__gcd/lcm` → log N / `pow` → 1(ユーザー定義があればそちら)。
- python(pypy 共有): `sorted` → n log n(space \|a\|)/ `sum/max/min/all/any/list/tuple/set/dict/reversed/enumerate/zip/map/filter/Counter/accumulate/join` → 引数がコンテナなら \|a\| / `len/abs/print/input/int/str/ord/chr/divmod/range` → 1 / `math.gcd` → log / `heapq.heappush/heappop/heappushpop`(`from heapq import` 形も)→ log \|q\|、`heapify` → \|a\| / `bisect.*` → log \|a\|、`insort` → \|a\| / `pow(x,y,m)` → log Y / `itertools.*` → 生成1(for の coll なら L16/L17)。
- java: `Arrays.sort/Collections.sort/list.sort` → n log n / `Arrays.fill/asList/stream().sum` → n / `Math.*`, `Integer.parseInt`, `sb.append`, `println`, `nextInt` → 1。
- other(js/ts/rust/go/csharp/d 共有): `sort/sort_unstable/sort.Ints/sort.Slice/Array.Sort/List.Sort/sort_by/sort_by_key` → n log n / `binary_search/BinarySearch/sort.Search` → log n / `contains/includes/indexOf/Contains/iter().position` → n / `forEach/map/filter/reduce/some/every/Select/Where/Sum/Max/Min/for_each` → \|a\|(F12 警告付き)/ `push/append/Add/insert/len/Math.*/parseInt/Number/strconv.*` → 1。
- ruby / lua / julia / bash / nim / haskell / perl / php: §7 の追加8言語で確定。

未知の呼び出し: O(1)。info「未知の関数 f, g, h を O(1) とみなしました」を1件にまとめる。

### 5.6 入力の扱い

- **I1** 入力を読む文(入力マーカーを含む文)の中で、入力由来の値にかける分割・変換・収集の呼び出し(`split`/`split_whitespace`/`words`/`lines`/`map`/`Select`/`int`/`parse`/`parseInt`/`Number`/`to_i`/`list`/`tuple`/`collect`/`ToArray`/`toList`/`read`/`readInt`)は時間に数えない。同じ文でも `sorted`/`sum` などは通常どおり数える。読み取りのループ(`for i<n: cin >> a[i]`、`while(cin >> x)`)はループとして数える。
- **I2** 分割代入(`a, b = …`、`[a, b] <- …`、`my ($x, $y) = …`、`[$a, $b] = …`、`let (n, m) = (v[0], v[1])`)の各名前はスカラの入力変数。固定長パターンは確保を出さない。
- **I3** 入力変数を右辺に含む代入の左辺も入力変数(1段伝播)。本体に入力プリミティブを含む関数は入力関数とし、時間・領域とも O(1) に固定して内部の while は解析しない(Nim の `scan()`、Haskell の `readInts`)。
- **I4** 入力配列の長さは §5.4 alias の (d)(e) で決める。19言語のテンプレート(A+B)はこの規則で O(1)/O(1) になる。

### 5.7 v2 送り

L18 の 3^N(`Factor.base`)、ループ変数の再代入、R4(a=4)/R5(マスター定理一般形)/順列再帰、Python 文字列 `+=` の O(N²)、コールバックループの積(F12)、`break` 条件からの上限縮小、hset の最悪 O(N) 切替、`EvalResult.perTerm`、Prism ハイライト層の重ね合わせ(貼り付け専用なので素の textarea で足りる)。

---

## 6. 式の簡約・フォーマット規則(確定版)

**正規化(`normalize`)**
1. `mul`: 項ごとに因子を合併(同じ v の pow/log/exp/fact を加算、coef は積)。
2. `add`: **factors 集合が同じ**項は係数を **max** で合併(`N + N → N`、`1000·N + N → 1000·N`)。
3. 係数1の定数項(O(1))は他の項があれば落とす。
4. **数値だけの項で coef < 10** は他の項があれば落とす(`N + 5 → N`)。coef ≥ 10 は残す(`N + 1000 → N + 1000`)。
5. `rename`: 置換後に同一 v の因子をマージして再正規化(`N·|a|` に `|a|≡N` → `N²`)。

**支配(`dominates(a,b)`、`simplify` で b を落とす条件)**
- 両者に現れる全変数 v について growth_a(v) ≥ growth_b(v)。growth は (fact, exp, pow, log) の辞書順。
- かつ **b.coef ≥ COEF_KEEP(10) なら a.coef ≥ b.coef も必要**。
- 例: `N² + N → N²`、`N² + 5·N → N²`、`N² + 1000·N → N² + 1000·N`、`N + 1000 → N + 1000`、`10^5 + 1000 → 10^5`、`N·M + N → N·M`、`N² と N·M は比較不能で両方`、`2^N + N^100 → 2^N`、`N! + 2^N → N!`、`N log N + 26·N → N log N + 26·N`。

**表示(`format(e, symbolOrder)`)**
- 項の並び: 支配の強さ(fact, exp, pow 合計, log 合計 の降順)→ 同順位は**項の先頭変数の初出順**(`symbolOrder`)→ 数値だけの項は最後。区切り ` + `。
- 項内: `係数·` → 変数因子(初出順)→ log 因子 → 2^v → v!。異なる原子の間は `·`、`log` の前だけ空白。例: `1000·N`, `N·M`, `N log N`, `log² N`, `N·2^N`, `N·N!`, `(N!)²`, `4^N`。
- 冪: `N²`, `N³`, `N^4`(4以上は `^`)。`pow=0.5` → `√N`、`1.5` → `N√N`、非整数 → `N^1.59`。底は書かない。
- 係数: 変数因子を持つ項は **coef ≥ 10 のときだけ表示**。数値だけの項は常に表示。`< 10^4` は整数(`1000`)、`≥ 10^4` は有効2桁 `2×10^5`(仮数1なら `10^5`、`.0` は落とす)。
- 空は `O(1)`。`"?"` が残っていたらバグ。

`expr.test.ts` に仕様として固定: `N+5→N`、`N+1000→N+1000`、`N²+10^6·N→N²+10^6·N`、`N²+10^6→N²+10^6`、`2·N→N`(表示)、`N·2^N` の順、`|a|` rename、`log(N·M) → log N + log M`、`log(10^18) → 60`。

---

## 7. 言語ファミリと追加8言語のフロントエンド

追加8言語は、既存の抽出器にプロファイルを足す(perl/php は波括弧系、nim はインデント系)か、抽出器を新しく足す(ruby/lua/julia/bash の end 系、haskell 専用)。

| ファミリ | 言語 | 抽出器 | 備考 |
| --- | --- | --- | --- |
| brace | cpp, c, java, csharp, rust, go, js, ts, d, **perl, php** | `braceFrontend.ts` | perl/php は sigil(`$@%`)識別子・正規表現リテラル・ヒアドキュメント・PHP 代替構文(`endfor;` 等)を LexRules/LangSpec で吸収 |
| indent | python, pypy, **nim** | `indentFrontend.ts` | Nim は `:` または `=` で終わる行がブロック開始、`#[ ]#` コメント、`{.pragma.}` |
| end | **ruby, lua, julia, bash** | `endFrontend.ts` | `BlockProfile` 駆動(§7.2) |
| haskell | **haskell** | `haskellFrontend.ts` | `forM_/mapM_/replicateM_/for_` と内包表記をループ、`map/filter/fold*/sum/length` を builtins、トップレベル再帰を `func` に。confidence low 固定 |

### 7.1 配置と共通側への追加要求(8言語の設計で判明したもの)

- 言語ごとの定義は `src/lib/complexity/langs/<key>.ts` に置く(19ファイル。各ファイルが `spec: LangSpec` と `builtins: Record<string, BuiltinRule>` を export)。`langTable.ts` と `builtins.ts` は19キーを並べて束ねるだけにする(抜けを目視できる流儀を保つ)。
- 全言語共通の lexer 規則: **数値の `.` は直後が数字のときだけ小数点**(`1..n` `0..$n-1` `[1..n]` `1:n` を壊さない)。数値内 `_` は桁区切り。記号は最長一致(`..<` `..^` `..` `->` `=>` `<=>` `**=` `??=` `?->` `...` `&&=` `||=`)。
- `LexRules` に追加: `identSuffix`(Ruby/Julia `?!`、Haskell `'`)、`sigils`(bash/perl/php: `$@%&` 付き識別子。canonical 名は sigil を剥いだもの + 名前空間 scalar/array/hash)、`heredoc`、`luaLongBracket`、`interpolation`、`regexLiteral` の判定に `prevKind`(var/num/str/closeParen/closeBracket/ident/keyword/op)を使う。**記号ごとに述語を分ける**(Perl の `%` は「直後空白なし + 次が `[A-Za-z_{$:^]` + 直前が値でない」で sigil、`/` は「識別子=値、ただし split/grep/map/join/return/print/push/and/or/not/if/unless/while/until/=~ の直後は正規表現」、`<<` は直前が値なら常にシフト)。
- `postTokenize`: 言語プロファイルが「名前付きパスの配列」を持ち、順序をテストで固定する(Perl: 添字 `{`→`[` → `@{…}` 畳み込み → `x` 演算子化 → ハッシュ構成子 `{}`→`()` → `=>` 左の裸語を str → ラベル除去。PHP: タグ → 代替構文 → `array(`/`list(`→`[` → キャスト除去 → `$this->`/`self::$` 剥がし → `&$` 除去)。
- `canon`(言語別の演算子正規化。ヘッダ・本体・自己呼び出し引数の全域に適用): `^`→`**`(Lua/Julia/Nim。Nim は `[` 内単項の `^` は末尾添字)、`÷`→`//`、`div`→`/`、`shl`/`shr`→`<<`/`>>`、`-lt`/`-le`/`-gt`/`-ge`/`-eq`/`-ne`→比較、`NUM IDENT`→`NUM * IDENT`(Julia)、`int()/floor()/ceil()/intval()/(int)/.int/.float/int(...)` の透過、`intdiv(a,b)`→`a / b`、語演算子(`and or not xor eq ne lt gt le ge cmp x`)→op。二分探索・対数更新・√・`t--`・`1<<n` の**判定はコア(L 規則)で行い、言語側は正規化だけ**を持つ。
- 既存規則への対応付け(8言語側の要求 → 主設計): 定数畳み込み → `evalConst`/`consts`(0引数束縛・`const`/`let x = <数値式>` も consts へ)。`g[u]` の添字コレクション → `SExpr.index`(L3/adjacency)。キュー while / 入力行 while → L14 / L19'。入力変数の伝播 → `inputVars.ts` に「右辺に入力変数/入力関数を含む代入の左辺も入力変数」「本体に入力プリミティブを含む関数は入力関数(時間・領域 O(1) 固定、内部の while は解析しない)」を追加。**成長の一般化(S4')**: 未確保コンテナへの添字代入(`$cnt{$_}++` `$dp[$i][$j] =` `dp[i][j] = 0`(Lua)`a[i]=x`(Bash)`h[k] = v`)は成長扱い(添字段数ぶん囲むループ因子を掛ける。明示確保済みの受け手は無視)。push の値に `sizeOf` が効けばそのサイズ(`$g[] = str_split(...)` → W)。ループ内の `dp[i] = newSeq[int](m)` は「外側コンテナへの追加」として N·M。サイズ別名 → §5.4 の alias (c)〜(e)。仮引数↔実引数の置換 → §5.3 の `rename`。波括弧なし単文本体 → F13。分岐チェーン → F14。入力の読み取り → §5.6。
- `analyze` の入口決定に追加: `main()`/`main`/`when isMainModule: main()`/`(new Main)->run()`/`Main.new.run` のトップレベル呼び出しは通常の call 解決(関数表)で main 本体に置換される(既存の規則で足りる。Nim/Perl/PHP/Ruby のゴールデンで担保)。

### 7.2 end 系(`endFrontend.ts`、ruby / lua / julia / bash)

`BlockProfile { openers: Record<string, BlockKind>; closerOf(opener): string; separators: Set<string>; headerEnd(opener, tok): boolean; isOpener(tok, ctx): boolean; isCloser(tok, ctx): boolean; braceBlock?(tok, ctx): "call-block"|"func"|"plain"|null; splitLoopHeader?(header): Tok[][]; postfixLoop?(stmt): {kw, body, cond}|null; callBlock?(call, blockArgs): loop|plain|null; branchChain: {start, cont} }` を各言語が実装し、抽出器本体(約290行)は共通。ctx = 行頭か / 直前トークン / 各括弧深さ / pendingHeader(for/while が do/then を待つ) / Bash の commandStart・casePattern。

| 言語 | 開き語 → 閉じ語 | ループ → LoopBound | 関数 / 再帰 | サイズ・確保・入力 | 必須の落とし穴対策 |
| --- | --- | --- | --- | --- | --- |
| Ruby | def/class/module/if/unless/while/until/for/case/begin/do → `end`。`{ }` は直前が識別子/`)`/`?`付きメソッドなら call-block、それ以外はハッシュ(plain)。`then`/`when`/`in`/`else`/`elsif`/`rescue`/`ensure` は separator(文頭のみ) | `n.times`/`(a..b).each`/`(a...b).each`/`upto`/`downto`/`step` → for-range、`a.each`/`each_with_index`/`each_char`/`each_slice`/`map`/`select`/`sum`/`count`/`any?`/`all?`/`inject`… → for-in(callBlock)、`for i in a..b`、`while`/`until`/`loop do`、**修飾子 while/until と `begin…end while`** は postfixLoop で Loop 化、`combination(k)`/`permutation(k)`/`repeated_permutation(k)` → \|a\|^k(k リテラル)、`product(b)` → \|a\|·\|b\|、`bsearch` → log | `def`(`def self.f`、`def ==(o)`、endless `def f = expr` は1行本体)、`f = ->(x){}`/`lambda do` は F2 | `.size/.length/.count`、`Array.new(n)`/`Array.new(n){Array.new(m,0)}`/`[0]*n`/`(1..n).to_a`、`a << x`/push/unshift/`h[k]=v` は成長、入力 `gets`/`STDIN`/`$stdin`/`readline(s)`/`ARGF`、`gets.to_i.times` は L4'(入力由来 T) | **修飾子 if/unless/while/until の判定**: 直前トークンが「式の始まりを許す」集合(`= ( [ , ; \|\|= &&= += -= then do else elsif and or not ! && \|\| ? : <<`)または行頭なら開く、それ以外(識別子・リテラル・`)`・`end`)は修飾子。`return/break/next/redo/raise/yield` 直後は常に修飾子。直前が `.`/`&.`/`::` のキーワード(`x.class` `r.end`)とハッシュラベル `end:` は開閉しない。`?` 吸収の次文字に `{` `[` を含める(`all?{…}`)。`%w[]`/`/re/`/`<<~EOS`(`<<"` は直後が識別子+閉じ引用+行末のときだけ)/`#{…}`(入れ子込みスキップ、内部の式は未解析と警告)/`=begin…=end`/`__END__` |
| Lua | function/if/for/while/do → `end`、repeat → `until`(閉じた後、行末までを cond として loop に後付け)。`do` は pendingHeader 中は開かない。`elseif`/`else`/`then` は separator | `for i=a,b[,s]` → for-range(負 step は入替)、`for k,v in pairs/ipairs(t)`/`s:gmatch`/`io.lines()` → for-in、while、repeat-until | `function f(`/`local function`/`t.f`/`t:m`/`name = function(`(F2。`local f; f = function` の後付けも) | `#t`(sizePrefixOps)、`string.len`、`{}` は 0、`table.insert(t,x)`/`t[#t+1]=x` 成長、`t[i]=x`/`t[i][j]=x` は S4'、`string.rep(s,n)` → [n]、入力 `io.read`/`io.lines`/`io.stdin:read`、`line:match(...)` は伝播で入力変数 | 長文字列 `[[ ]]`/`[==[ ]==]`、コメント `--[[ ]]`、`10^5` の `^`→`**`、`i = i / 2` の log(コア L12) |
| Julia | function/for/while/if/begin/let/quote/macro/module/struct/try/do → `end`。**角括弧深さ ≥1 では開閉語を評価しない**(`a[end]` `a[begin]`)。丸括弧深さ ≥1 の for/if は生成式(loop)。`elseif`/`else`/`catch`/`finally` は separator | `for i in/= 1:n`/`a:s:b`/`n:-1:1`(入替)→ for-range、`for x in a`/`eachindex(a)` → for-in、**`for i in 1:n, j in 1:m`** は splitLoopHeader で k 個の loop を push し1つの end で k 個 pop、内包表記 `[f(i) for i in 1:n]`(F7)、`map(a) do x` → for-in、`while !eof(stdin)` → L19' | `function f(`、**短縮形 `f(x) = …`**(文頭 IDENT `(`…`)` [::型] [where] 単独 `=`。右辺が begin/if/let なら通常の func ブロック)、`Base.f` | `length/size/lastindex`、`zeros/ones/fill/falses/trues/Vector{T}(undef,n)/Matrix/Array{T}(undef,…)/collect(1:n)`(型引数と `undef` を読み飛ばし、`fill`/`repeat` は第1引数を無条件に値扱い)、`push!/append!/pushfirst!/d[k]=v/get!` 成長、入力 `readline/readlines/read(stdin)/readchomp/eachline/parse.(Int, split(readline()))` | 予約語は `'`(転置)判定の「値」に含めない(`for c in 'a':'z'` `return ']'`)。`"…$(expr)…"` の補間は括弧深さで、`"""`、`r"…"`、`@macro` は無視。`2n`→`2*n`、`÷`→`//`、`≤ ≥ ≠ ∈` を正規化 |
| Bash | for/while/until → `done`、if → `fi`、case → `esac`、`f() {`/`function f {` → `}`。**予約語は command position でのみ有効**。`NAME=`/`NAME+=`/`NAME[...]=` は assignWord に畳み直後の語は値(`x=done`)。識別子に密着した `[` は添字(`dp[i*w+j]=0`)、test の `[` は語頭単独のみ。case のパターン位置で最初の非改行トークンが `esac` なら即閉じ、パターン読み飛ばしは同一論理行内 | `for x in …`(`$(seq a b)` → for-range、`{a..b}` → for-range、`"${a[@]}"` → for-in、リテラル列 → lit)、`for ((init;cond;step))`(`;` 無し `do` も可)→ for-c、`while [ $i -lt $n ]`/`(( ))`/`[[ ]]` → while(canon で比較を正規化)、`while read -r` → L19'、`until` → while(not) | `f() {`、`function f`、`$(f …)` も呼び出し(subOpen 直後は command position) | `${#a[@]}`/`${#s}` → size、`read -a`/`-ra`/`mapfile`/`readarray`/`a=($(cat))` → [\|stdin\|]、`a=($(seq 1 $n))` → [n]、`a=( $var )` → [\|var\|]、`a+=(x)`/`a[${#a[@]}]=x` 成長、`a[$i]=x` は S4'、入力 `read`/`mapfile`/`$(cat)`/`< /dev/stdin` | 引用符外の `\` は次の1文字をリテラル、`$(…)`/`<(…)`/`>(…)` は subOpen(引用状態リセット)、`$((…))` 算術、`"…"` 内は展開だけトークン化、ヒアドキュメント `<<EOF`/`<<-EOF`/`<<'EOF'`(`<<` 後の空白許容、`<<<` を先判定)。**パイプ段のサイズ伝播**: 左端(`printf "${a[@]}"` → \|a\|、`echo "$s"` → \|s\|、`cat` → \|stdin\|、`seq 1 $n` → n)から右へ、サイズ保存フィルタ(tr/sed/awk/grep/cut/uniq/rev/tac/paste)は維持、縮小系(head/tail/wc/grep -c)は 1。`sort` → S log S。解決不能は N + 警告 |

閉じ語の不一致: 語の閉じ語(end/done/fi/esac/until)は警告して pop 続行(復旧優先)、記号閉じ(`)` `}` `]`)は stack top の種別が一致するときだけ pop。

### 7.3 インデント系への追加(`indentFrontend.ts` を `IndentProfile` 駆動にし Nim を足す)

`IndentProfile { blockKeywords; isBlockStart(line): {kind, header, inlineBody?, anonymousFunc?}|null; continuesLine(line, next): boolean; sectionKeywords; sectionChild(kw, line): Tok[]|null; normalizeIdent(name): string; branchChain; commandCall(stmt): call|null }`。

- Nim のブロック開始: `:` 終端(proc/func/iterator/template/if/elif/else/for/while/case/of/block/try/except/finally/when)、ルーチンの `=` 終端(`proc f(x: int): int =`、前方宣言 `proc f(x: int)` は開かない)、**非キーワード行の末尾 `:`**(do 記法 `ps.sort do (p, q) -> int:`、テンプレート呼び出し `rep(i, n):`)は plain ブロック(ラムダ本体は1回分 + 警告)、**ブロック開始行でないのに次行のインデントが増えた**(`type` の object 本体、`case x` 非終端の下の `of`)も plain ブロック。**throw しない**。
- 継続行: 括弧深さ + 行末演算子(`,` `=` `and` `or` …)。行内に proc/func/iterator/template があれば継続にせず無名 func ブロックを開く(`let f = proc(x: int): int =` の多行ラムダ)。連結後は元の行のインデントで判定。
- `var`/`let`/`const` セクション: 子行を先頭にキーワードを補った1文として通常経路へ(入力変数・確保・呼び出し・定数すべて抽出)。`type` セクションは plain。
- ループ: `for i in a..b`/`a..<b`/`countup`/`countdown`/`a.low..a.high` → for-range、`for x in a`/`for i, x in a`/`items`/`pairs`/`mitems`/`for u in g[v]` → for-in(添字式受け手可)、`while`。`in`/`notin` → `call{callee:"in"}` は **for 頭パース後**にループ頭以外へ適用し、右辺が範囲式・`{}` set リテラル・文字列リテラル・`Digits`/`Letters` 等の定数集合なら生成しない(O(1))。受け手が `initHashSet/toHashSet/initTable/newTable/toTable/initCountTable/initOrderedTable` で初期化、または型注釈 `HashSet[`/`Table[`/`CountTable[`/`OrderedTable[`/`set[` なら hset/hmap。
- 関数: proc/func/iterator/method/template/macro/converter。params は `a, b: int` の複数宣言を展開して名前配列で出す。UFCS/コマンド構文(`dfs u`、`inc x`、`a.add x`、`g[u].add v`、`(k-1).f`)を call に。識別子の正規化(先頭1文字 + 残り小文字・`_` 除去)を builtins 照合とユーザー変数の同一性判定の両方に使う。
- サイズ・確保・入力: `a.len/len(a)/a.high/high(a)/a.card`(`a.high + 1` も size)、`newSeq[T](n)`/`newSeqOfCap`/`newString`/`newSeqWith(n, X)`(X が確保なら連結 → [n, m])/`repeat`/`toSeq`/`array[N, int]`/`array[0..N-1, …]`(consts 畳み込み)/`setLen`、`add/incl/inc(CountTable)/[]=/push/addLast/addFirst/mgetOrPut/hasKeyOrPut/&=` 成長、`&=`/`add`/`insert` の第2引数がスライス(`[` 内に `..`)・配列入力変数・N を返す呼び出しなら時間 N(`res &= s[0..i]` → N²)。入力 `stdin`/`readLine`/`readAll`/`readChar`/`readLines`/`readLineFromStdin`/`scanf`、**入力関数**(`proc scan(): int` の readChar ループ)は O(1) 固定、`newSeqWith(n, scan())` → [n] + 入力変数。
- lexer(単一パス、同じ位置での優先順): 文字リテラル `'a'`/`'\n'`(数値サフィックス `1'i32` を先に)→ 数値(`.` は次が数字のときだけ、`_` 許可)→ 識別子(直後 `"` なら raw 文字列 `r"…"`/`fmt"…"` に接続、`\` 非エスケープ、`""` のみ)→ `"…"`/`"""…"""` → `#[ ]#`(入れ子、未閉鎖は EOF 警告)→ `#` 行コメント(`##` doc 含む)→ `{. .}` プラグマ(丸ごと捨てる)→ バッククォート識別子 → 記号最長一致。`$` は演算子として分離(識別子に含めない)。`1 shl e`/`(1 shl e)`/`1 shl e - 1`/`2^e`/`pow(2, e).int` は canon で `1 << e` に、`.float/.int/float()/int()/.toInt` を剥いだ残りが `sqrt(x)`/`x.sqrt` なら L8。

### 7.4 sigil 付き波括弧系(braceFrontend に perl / php を足す)

- 共通: `sigils: true`(`$x` `@a` `%h` `$a[0]` `$#a` `@{$r}` `$$x`、PHP `$a`)。Token に `sigil` と `ns`(scalar/array/hash: `$x[`→array、`$x{`→hash、`$#x`/`scalar(@x)`→array)を持ち、入力変数・確保・コレクション名は ns 付き。文字列外の `\` は読み捨て(Perl 参照 `\@a`、PHP 名前空間 `\count(`)。波括弧なし単文本体は F13 で扱う(Perl は常に波括弧)。キーワード集合を明示: Perl if=`{if,unless,elsif,else}` loop=`{for,foreach,while,until}` func=`{sub}` wordOps=`{and,or,not,xor,eq,ne,lt,gt,le,ge,cmp,x}`、PHP if=`{if,elseif,"else if",else}` loop=`{for,foreach,while,do}` func=`{function,fn}` 修飾子=`{public,private,protected,static,abstract,final,readonly}`。
- **`interpretList`**(for 頭・後置ループ・map/grep/sort・foreach 共用): `sort/reverse/map/grep/uniq/shuffle/keys/values/first/any/all`(Perl)、`array_keys/array_values/array_reverse/array_unique/array_slice/array_map/array_filter/range/str_split/explode/file("php://stdin")`(PHP)の前置チェーンを再帰的に剥き、最内の LIST のサイズを bound、剥いた各段をループの**直前の兄弟** call/loop として置く(入れ子にしない)。`sort { } @a`/`usort($a, fn)` の比較ブロックは `loop(|a|){ loop(log |a|){ 本体 } }` + call sort。
- **`sizeOf(expr)`**(builtins のサイズ引数と確保の両方で使う): var → \|var\|、S コストで配列/文字列を返す builtin 呼び出し → sizeOf(そのサイズ引数)、result 指定(explode/preg_split/str_split/split)→ \|lhs\| または \|s\|、`...$a` → \|a\|、リストリテラル → 要素数、`qw(…)` → 語数。
- Perl: ループ `for my $i (0..$n-1)`/`for (1..$n)`/`(0..$#a)` → for-range、`foreach my $x (@a)`/`for (@a)`/`for (keys %h)` → for-in、C 形式(`my` を除去)、while/until、do-while、後置 `for`/`while`(postfixLoops)、`map { } @a`/`grep { } @a` → loop。関数 `sub f {`(プロトタイプ `($$)` は無視。params は signature か `my (…) = @_` か**本体先頭の連続する `my $x = shift;`**)、`my $f = sub {` は F2。再帰 `f(`/`&f(`/`$f->(`/`__SUB__->(`。サイズ `scalar(@a)`/`@a` 数値文脈(`..` 含む)/`$#a + 1`/`keys %h`/`length($s)`。確保 `(0) x $n`/`"0" x $n`/`[ (0) x $m ]`(`x` は postTokenize で演算子化)→ [n]、`$#a = $n - 1`、`(1..$n)`、`my @a = @b` → [\|b\|]、`map { [(0) x $m] } 0..$n` → [n, m]、リストリテラル `(e1, e2, …)` → [k]。成長 `push @a, $x`/unshift(値に sizeOf)、S4' の要素代入。入力 `<STDIN>`/`<>` は readline トークン(`<` 直後が `$?[A-Za-z_][\w:]*>` か `<>` で直前が値でない)、**slurp `do { local $/; <STDIN> }`** は1トークンに畳む(`local $/;` 単独文の後の `<STDIN>` も)、`split` の最後の引数が入力なら左辺 `@a` は入力配列、`shift @in`/`splice @in, 0, $n`/`$in[$p++]` の左辺も入力変数。`q qq qw m s tr y qr`(直後が区切り文字)、`/re/`、`<<EOS`(直前が値なら常にシフト)、行頭 POD、`__END__`。
- PHP: ループ for(C 形式)、`foreach ($a as $x)`/`($a as $k => $v)` → for-in、while/do-while、代替構文 `for (…): … endfor;`/`endforeach;`/`endwhile;`/`endif;` → `{ }` に書換、`array_map/array_filter/array_walk/array_reduce/usort` のコールバック → loop(F12 の例外として PHP はループ化)。関数 `function f(`、`fn(`、クロージャ `$f = function … use (&$f)`(F2)、メソッド(修飾子読み飛ばし)、`class` は plain、`$this->m(`/`self::f(`/`call_user_func`。サイズ `count/sizeof/strlen/mb_strlen/$a->count()/count($a[$i])`。確保 `array_fill(0,$n,v)`(v が array_fill/range/str_repeat なら再帰連結 → [n, m])、`array_fill_keys(range)`、`range(a,b)` → [b-a+1]、`str_repeat` → [n]、`new SplFixedArray($n)`、`str_split/explode/preg_split` → [\|s\|]、`[1,2,3]` → [3]。成長 `$a[] = x`/array_push/`$a[$u][] = v`/array_unshift(値に sizeOf)、S4' の要素代入。入力 `STDIN`/`php://stdin`/`readline(`/`fscanf(STDIN, fmt, $n, $m)`(第3引数以降が入力変数)/`sscanf($line,…)`/`stream_get_contents`/`file_get_contents`/`file`/`fread`、`$in = fopen("php://stdin")` のハンドル経由、`foreach (file("php://stdin") as $line)` → L19'、`while ($t--)` → L13''。`<?php…?>`(外の HTML は無視)、`<<<EOS`/nowdoc、`#[` 属性、`?>` 後の HTML。

### 7.5 関数型(`haskellFrontend.ts`、confidence low 固定)

ブロック木に無理に落とさず「反復の源」を loop に合成する専用フロント(約 800 行)。

- lexer: 識別子 `[A-Za-z_][A-Za-z0-9_']*`(`$` を含めない)、`M.insert` の修飾名は `qualifier`、バッククォート中置、コメント `--`(`-` の連続を読み切って次が記号文字 `!#$%&*+./<=>?@\^|~:` でなければ行コメント。`-----` 区切り線対応)/`{- -}`(入れ子)/`{-# #-}`、文字リテラル `'x'`/`'\''`/`'"'`(失敗時は `'` を捨てる)、`[1..n]` の `1.` 保護、演算子文字クラスの `-` は末尾。`\` は単独トークン。
- レイアウト: 行 col + 括弧深さで近似。**行頭の深さ0 `where` の col が現在の do の文インデント以下なら do を閉じ**、直近の節の局所定義に。深さ0 `in` で let を閉じる。内包表記 `[ ]` 内とパターンガード(`|` と `=` の間)の `let` はブロックを開かない。BlockArguments(`forM_ [1..n] \i -> do`、`when c do`)も受理。
- ループ相当: `forM_/for_/mapM_/forM/mapM/replicateM_/replicateM/foldM/zipWithM_` + `[a..b]`(→ for-range。**下端が非定数なら上端のみ**、降順/ステップ付き `[n, n-1 .. 1]` は max(a,b))/リスト引数(→ for-in)/`replicateM n`(→ lit/記号)、`$` 以降または次の1原子の直後の `\pat -> do` を本体。内包表記 `[f x y | x <- xs, y <- ys]`(ネスト = 積、`if` フィルタ無視)。`map/filter/foldl/foldr/foldl'/zipWith/sortBy/sortOn`(loopBody 引数)は builtins で \|xs\| × 本体。`iterate f x !! k`/`take k (iterate f x)` → loop{k}[call f]。`zip/zip3/zipWith` のサイズは「最初に unknown 以外になる引数」、`[k..]` は候補から外す。
- 関数と再帰: `f p1 p2 = …` の節(同名節を束ねる)、ガード `|`、where/let の局所関数(`親.名前` で平坦化)、**0引数束縛の RHS は置かれたブロックの plain 子として展開**(`let dp = runSTUArray $ do …`、`let bs = sort as`、`readInts = …`)。仮引数の分割で `!`/`~` を剥ぎ、`name@pat` は両方登録、`(x:y:rest)` は最後の `:` の右を線形候補。自己呼び出しの引数打ち切りは `$`/`$!`/`>>`/`>>=`/`=<<`/`seq`。分類: 線形(`p - k`/`xs` パターン)、対数(`div 2`/`(mid ± k)`: `(name ± リテラル)` は name で分類し直す)、不変。合成は「1つでも線形なら線形、対数と不変だけなら対数、全て不変なら unknown」。分岐度(ガード/if/case の代替ごと)× 進み方 → R 規則に写像。
- 入力: `getLine/getContents/readLn/interact/BS.getLine/T.getLine/hGetLine` + 1段伝播(`read/words/lines/readInt`)。**本体に入力プリミティブを含む top-level 関数(`readInts`)も入力プリミティブ**(1段の不動点)。固定長パターン `[a, b] <- …`/`(a, b)` は確保を出さない。`replicateM n X`/`forM [1..n]`/`mapM` を `<-` で束縛したら確保 [n]。
- 0引数束縛の純数値 RHS(`let lim = 1000`、`modulo = 10^9+7 :: Int`)は consts へ。`:: 型` は深さ0で捨てる。
- サイズが取れない builtin(point-free 鎖の `sort`/`nub`/`words`)はサイズ unknown(N)で計算量を適用する(`sort` → N log N、`nub` → N²)。
- 領域: `listArray/array/accumArray/newArray/newListArray`(境界タプル)、`V.replicate/VM.new/V.generate`、`M.fromList/S.fromList/V.fromList` → [listSize]。ループ内 `M.insert/S.insert/V.snoc/|>` は S4(成長)。visited 付き DFS 再帰は R9 の警告付き過大評価で受容。

### 7.6 追加8言語の builtins(要旨。`langs/<key>.ts` に表として持つ)

| 言語 | S log S | log S | S(サイズ引数) | 1(persistent=成長) | 確保 |
| --- | --- | --- | --- | --- | --- |
| ruby | sort/sort!/sort_by/min_by/max_by(uniq/tally/group_by は S) | bsearch/bsearch_index | each 系/map/select/reject/sum/count/any?/all?/find/inject/zip/flatten/compact/reverse/join/include?/index/min/max/take/drop/dup/to_a、unshift/insert/delete_at/slice!/`a + b`、String の `+`/`* n`/reverse/chars/split/include?/index/gsub、Hash/Set の keys/values/to_a/sort | push/`<<`/pop/last/first/`[]`/`[]=`/size/shift、Hash/Set の `[]`/`[]=`/key?/include?/add/`<<`/delete、Integer の digits/pow/gcd(log)、puts/print/p | Array.new(n)/`[0]*n`/(a..b).to_a |
| lua | table.sort(比較子は loop(S){loop(log S)}) | — | table.insert(t,pos,x)/table.remove(t,pos)/table.concat/unpack/move/pack、`s:sub/find/match/gsub/upper/lower/reverse/byte`、string.format | table.insert(t,x)/`t[#t+1]=x`/table.remove(t)/`t[i]`/`#t`/next/rawget/rawset、math.*、tonumber/tostring/type、`a .. b`(O(1) + 注記)、io.read/io.write/print | string.rep(s,n) → [n] |
| julia | sort/sort!/sortperm/unique/partialsort | searchsortedfirst/searchsortedlast/searchsorted/insorted | sum/prod/maximum/minimum/extrema/argmax/count/any/all/in/findfirst/findall/reverse/cumsum/accumulate/map/filter/foreach/reduce/mapreduce/zip/enumerate/collect/copy/similar/fill!/join/split/occursin/replace/vcat/hcat/`.+`/`f.(a)`/view/union/intersect/setdiff、pushfirst!/popfirst!/insert!/deleteat!/splice!、Set(a)/Dict(pairs)/collect(keys(d)) | push!/pop!/append!/resize!/length/size/isempty/first/last/getindex/setindex!/lastindex、Dict/Set の `d[k]`/`d[k]=v`/haskey/get/get!/delete!/in、div/mod/gcd/lcm/abs/floor/ceil/sqrt/isqrt/powermod(log)/digits(log)/binomial、println/print/parse/string、マクロは 0 | zeros/ones/fill/falses/trues/Vector{T}(undef,n)/Matrix/Array{T}(undef,…)/collect(1:n)/BitVector |
| bash | `sort`(pipe) | — | tr/sed/awk/grep/cut/uniq/rev/tac/paste/nl/fold/cat/tee/column/xargs/comm/join(サイズ保存)、head/tail/wc/grep -c/uniq -c(縮小 → 1)、`seq a b` → n、`"${a[@]}"`/`${a[@]:i:k}`/`${s//x/y}`/`${s#pat}`/`${s^^}`/`[[ "$s" == *"$x"* ]]`/`echo "${a[@]}"`/`printf '%s\n' "${a[@]}"` | read/`${#a[@]}`/`${a[i]}`/`a[i]=x`/`(( ))`/`$(( ))`/let/`[ ]`/`[[ ]]`/test/local/declare/shift/unset、`a+=(x)`(成長)、`$(cmd)`(1 + cmd、注記「ループ内の fork は要注意」) | read -a/mapfile/readarray/`a=($(cat))` → [\|stdin\|] |
| nim | sort/sorted/sortedByIt | binarySearch/lowerBound/upperBound、HeapQueue push/pop/del/replace | reverse/reversed/fill/isSorted/nextPermutation/rotateLeft、add(seq/string)/`&=`(seq/string/スライス)/`a & b`/insert/delete(i)、contains/in/notin/find/rfind/count(x)(hash 受け手なら 1)、max(a)/min(a)/sum/prod/maxIndex/cumsummed/foldl/foldr/map/mapIt/filter/filterIt/keepIf/apply/zip/concat/countIt/anyIt/allIt/toSeq/join/split/splitWhitespace/strip/toUpperAscii/replace/substr/`a[i..j]`/repr、toTable/toHashSet/toCountTable/union/intersection/difference、deduplicate(S²、警告) | add(要素)/`&=`(要素)/incl/excl/inc/`[]=`/hasKey/getOrDefault/mgetOrPut/hasKeyOrPut/del/pop/addFirst/addLast/popFirst/popLast/peekFirst/card/len/high/low、max(a,b)/min/abs/gcd/lcm/pow/sqrt/ord/chr/swap/inc/dec/parseInt/echo/isDigit/startsWith/toBin/toHex、readLine/readAll/readChar | newSeq[T](n)/newSeqOfCap/newSeqUninit/newString/newSeqWith(n,x)/repeat(x,n)(n·S)/cycle、initTable/newTable/initHashSet/initHeapQueue/initDeque/`@[]` → [] |
| haskell | list: sort/sortBy/sortOn(loopBody)、map: fromList/fromListWith、set: fromList | map: insert/insertWith/lookup/member/notMember/delete/findWithDefault/adjust/alter/update/`!`/`!?`/lookupMin/Max/findMin/Max/deleteMin/Max/lookupLT/GT/LE/GE/split、set: insert/member/notMember/delete/findMin/Max/…、seq: index/lookup/update/adjust/splitAt/take/drop/insertAt/deleteAt/`><` | list: length/sum/product/maximum/minimum/reverse/elem/notElem/`!!`/`++`/concat/concatMap/map/filter/foldl/foldr/foldl'/foldl1/zip/zip3/zipWith/unzip/takeWhile/dropWhile/span/break/lines/words/unlines/unwords/last/init/and/or/any/all/lookup/scanl/scanr/partition/transpose/group/groupBy/isPrefixOf/isSuffixOf/insert/delete/catMaybes/mapMaybe/sequence、take k/drop k/splitAt k/replicate n(→ k/n)、nub/nubBy/union/intersect/`\\`/isInfixOf(S²、警告)、permutations(S!)/subsequences(2^S)、map/set の fromAscList/toList/elems/keys/toAscList/foldr/foldl/foldrWithKey/map/mapWithKey/filter/unionWith/union/intersection/difference、array: listArray/array/accumArray/newArray/newListArray/freeze/thaw/runSTUArray/getElems/elems/assocs/`//`(警告)、vector: replicate/new/generate(loopBody)/fromList/toList/map/imap/filter/foldl'/sum/maximum/zipWith/enumFromN/enumFromTo/thaw/freeze/`//`/cons/snoc/concat/reverse/unfoldrN/iterateN/scanl、vector sort、bytestring/text: getLine/getContents/words/lines/unpack/pack/putStr/concat/split/filter/map/reverse/take/drop/length | list: head/tail/null/fst/snd/show/read/print/putStrLn/getLine/when/unless/void/min/max/abs/mod/div/fromIntegral/printf/Data.Bits/Data.Char/Data.Maybe/comparing/on、map/set: size/empty/singleton/null、array: `!`/bounds/readArray/writeArray/modifyArray/unsafeRead/unsafeWrite/indices、vector: `!`/`!?`/unsafeIndex/length/head/last/slice/read/write/modify/unsafeRead/unsafeWrite、seq: `\|>`/`<\|`/viewl/viewr/length/empty/singleton、bytestring: readInt/readInteger/length/index/head/last/null/cons/uncons、ref: newIORef/readIORef/writeIORef/modifyIORef(')/newSTRef/readSTRef/writeSTRef/modifySTRef(')/runST | listArray/array/accumArray/newArray/newListArray、V.replicate/VM.new/V.generate、M.fromList/S.fromList/V.fromList、replicateM n |
| perl | sort(ブロック付きは loop(S){loop(log S)} も) | — | reverse/join/split/keys/values、grep/map/first/any/all/none/sum/sum0/product/min/max/minstr/maxstr/reduce/uniq/shuffle/pairs(List::Util/MoreUtils。同名ユーザー sub があればそちら)、unshift/splice、index/rindex/lc/uc/reverse(文字列)、print/say(引数に `@x`/join)、`x` 演算子(右辺)、`@a = @b`/`%h = %g` | push/pop/shift、exists/delete/defined/scalar/ref/bless/abs/int/sqrt/ord/chr/sprintf/printf/print/say/chomp/chop/length/substr/lc/uc/pack/unpack/POSIX::floor/ceil/fmod、`@_`/`$#_`/`scalar @_`(呼び出し側の引数個数 or \|a\|) | `(0) x $n`/`"0" x $n`/`[ (0) x $m ]`、`(1..$n)`、`my @a = @b`、リストリテラル/qw |
| php | sort/rsort/usort/uasort/uksort/asort/arsort/ksort/krsort/natsort/array_multisort/array_unique/array_intersect(usort 系は loop(S){loop(log S)} も) | `->insert`/`->extract`(SplPriorityQueue/SplMinHeap/SplMaxHeap) | array_search/in_array/array_sum/array_product/array_keys/array_values/array_flip/array_reverse/array_merge/array_slice/array_splice/array_diff/array_diff_key/array_intersect_key/array_combine/array_column/array_count_values/array_pad/array_chunk/array_fill/array_fill_keys/range/array_map/array_filter/array_walk/array_reduce/shuffle/iterator_to_array/max(配列1個 or `...$a`)/min、array_unshift/array_shift、implode/join、explode/preg_split/str_split/mb_str_split(result)、strrev/strpos/stripos/strrpos/str_contains/str_starts_with/str_ends_with/substr_count/str_replace/strtr/preg_match/preg_match_all/preg_replace/strtolower/strtoupper/json_encode/json_decode/var_dump/print_r/str_repeat/str_pad | array_pop/array_push/array_key_first/last/count/sizeof/isset/unset/empty/array_key_exists/is_array/is_numeric/intval/floatval/strval/intdiv/abs/floor/ceil/round/sqrt/pow/max(スカラー2個以上)/min/mt_rand/ord/chr/strlen/mb_strlen/substr/sprintf/printf/echo/print/fwrite/fputs/number_format/trim/gmp_*/bc*、`->enqueue/dequeue/push/pop/shift/unshift/top/bottom/isEmpty/count/valid/current/next/rewind/attach/offsetSet/offsetGet/getSize`(SplQueue/SplStack/SplObjectStorage/SplFixedArray)、call_user_func(解決先へ) | array_fill/array_fill_keys/range/str_repeat/new SplFixedArray/explode/str_split/`[1,2,3]` |

### 7.7 追加8言語のゴールデン(`tests/complexity/<key>.test.ts`。各言語のテンプレート(A+B)は O(1)/O(1))

| 言語 | 必須ケース(期待 time / space) |
| --- | --- |
| ruby | R1 `n.times do \|i\|` + `(i + 1...n).each do \|j\|` + `cnt += 1 if …` → O(N²)/O(N)(修飾子 if、入力配列)。R2 `a = gets.split.map(&:to_i).sort` + `q.times do` + `a.bsearch_index { }` → O(N log N + Q log N)/O(N)。R3 `def fib(n) return n if n < 2; fib(n-1) + fib(n-2)` → O(2^N)/O(N)。R4 `dp = Array.new(h) { Array.new(w, 0) }` + h.times/w.times → O(H·W)/O(H·W)。R5 `%w[end do if]` + `/end\|do/` + `"#{s} end" if s.include?("end")` + `s.each_char do` → O(N)/O(N)。R6 木の入力 `(n-1).times { … adj[u] << v; adj[v] << u }` + `def dfs(u, p)` + `adj[u].each do \|v\|` + `next if v == p` + `dfs(v, u)` + `n /= 10 while n > 0` + `begin … end while y > 0` → O(N)/O(N)、警告なし。R7 `puts x.class` + `(l..r).end` + `a.all?{\|x\| x > 0}` + `a.combination(2) { }` + `until STDIN.eof?` → O(N²)/O(1)。R8 テンプレート |
| lua | L1 1行 `for i = 1, n do a[i] = io.read("*n") end` + 二重 for + 1行 if → O(N²)/O(N)。L2 table.sort + `for _ = 1, q` + `while lo < hi do mid = (lo + hi) // 2 …` → O(N log N + Q log N)/O(N)。L3 `local function fib(n)` → O(2^N)/O(N)。L4 `dp[i] = {}` + `dp[i][j] = 0` → O(H·W)/O(H·W)(S4')。L5 長文字列 `[[ end do while ]]` + `--[[ for … ]]` + repeat-until → O(N)/O(1)。L6 `for i = 1, 10^5 do` + `while n > 0 do n = n / 2 end` + `local n, m = line:match(…)` → O(10^5 + log N)/O(1)。L7 `table.sort(a, function(x, y) … end)` + `local dfs; dfs = function(v) for _, u in ipairs(adj[v]) do dfs(u) end end` → 非指数 + 警告。L8 テンプレート |
| julia | J1 `for i in 1:n, j in i+1:n` → O(N²)/O(N)。J2 `sort(parse.(Int, split(readline())))` + `searchsortedfirst` × q → O(N log N + Q log N)/O(N)。J3 短縮形 `fib(n) = n < 2 ? n : fib(n-1) + fib(n-2)` → O(2^N)/O(N)。J4 `dp = zeros(Int, h, w)` + `dp[i, j] = …` + `dp[end, end]` → O(H·W)/O(H·W)。J5 `b = a[2:end]` + `"$(a[end])"` + `@inbounds for i in eachindex(b)` + `[x * 2 for x in b if x > 0]` → O(N)/O(N)。J6 `for _ in 1:10^5` + `for i in 1:2n` + `for c in 'a':'z'` + `while !eof(stdin)` + `x = a[begin]` + `return ']'` → O(10^5 + N + \|stdin\|)/O(1)。J7 `sort!(a, by = x -> begin x[2] end)` + `fill(typemax(Int), n)` + `for i in n:-1:1` → O(N log N)/O(N)。J8 テンプレート |
| bash | B1 `read -a a` + `for ((i=0; i<n; i++))` × 2 → O(N²)/O(N)。B2 `mapfile -t s < <(printf "%s\n" "${a[@]}" \| sort -n)` + `while (( lo < hi ))` × q → O(N log N + Q log N)/O(N)。B3 `fib() { … $(fib $((n-1))) … }` → O(2^N)/O(N)。B4 `dp[i*w+j]=0` + `${#dp[@]}` → O(H·W)/O(H·W)。B5 `echo "done $x fi"` + `echo done` + `case "$1" in a) … ;; *) … ;; esac` + for → O(N)/O(1)。B6 `read -ra a` + `read -r line; b=($line)` + `state=done` + `for x in "${a[@]}"; do … done` → O(N)/O(N)。B7 `echo "${a[@]}" \| tr " " "\n" \| sort -n \| head -1` + `for ((…)) do` + `while [ $i -lt $n ]; do i=$((i+1)); done` → O(N log N)/O(N)。B8 テンプレート |
| nim | T1 `let v = stdin.readLine.split.map(parseInt)` + `let (n, m) = (v[0], v[1])` + `for i in 0..<n:` + `for j in 0 ..< m:` → O(N·M)/O(1)。T2 `a.sort()` + `for _ in 0..<q:` + `a.lowerBound(x)` → O(N log N + Q log N)/O(N)。T3 `while i <= n: i *= 2` + `while d * d <= n:` → O(√N)/O(1)。T4 `#[ … ]#` + `const MOD = 1_000_000_007` + `newSeqWith(n + 1, newSeq[int](m + 1))` + `proc step(x: int): int {.inline.} =` + case/of 同インデント + `for i in 1..n:` → O(N·M)/O(N·M)。T5 `var a: array[1000, int]` + `for i in 0..<1000:` + `for j in i+1..<1000:` → O(10^6)/O(1000)。T6 `initHashSet` + `if x in seen` + `seen.incl x` + `proc fact(k)` → O(N)/O(N)。T7 `proc main() =` 包み + 二重三角ループ + `main()` → O(N²)/O(1)。T8 グリッド BFS(`while q.len > 0` + `for d in 0..<4` + `nx in 0..<h and ny in 0..<w` + `newSeqWith(h, newSeqWith(w, -1))`)→ O(H·W)/O(H·W)(L14、V = dist の dims)。T9 let セクション + `var b = a` + `sort b` + `let c = a.sortedByIt(-it)` + `for x in c: echo b.lowerBound(x)` → O(N log N)/O(N)。T10 隣接リスト DFS(`g[e[0]-1].add e[1]-1` + 前方宣言 + `for u in g[v]:` + `dfs u`)→ O(N + M)/O(N + M)。T11 `proc scan(): int`(readChar ループ)+ `newSeqWith(n, scan())` → O(N)/O(N)。T12 `1..n`/`0..n-1`/`0 .. n`/`2..n div 2` + 試し割り + `var t = n; while t > 0: t = t div 10` → O(N)/O(1)、警告なし。T13 `newSeq[int](1 shl n)` + `for s in 0..<(1 shl n):` + `dp[2^n - 1]` + `w[^1]` → O(N·2^N)/O(2^N)。T14 do 記法 `ps.sort do (p, q: (int, int)) -> int:` + `a.map(x => x * 2)` + `block search:` 二重ループ → O(N²)/O(N)。T15 コメント/文字列混入(ネスト `#[`、`discard """…"""`、`'#'`、`r"C:\"`、`fmt"{cnt}"`、`&"{cnt}"`)→ O(\|s\|)/O(1)。T16 テンプレート |
| haskell | H1 `forM_ [1..n] $ \i -> do` × 2 + `when` → O(N²)/O(1)。H2 `as <- map read . words <$> getLine` + `let bs = sort as` + `foldl' (\acc x -> M.insertWith (+) x 1 acc) M.empty bs` → O(N log N)/O(N)。H3 (a) `fact n = n * fact (n - 1)` → O(N)、(b) `go i acc \| i > n = acc \| otherwise = go (i + 1) (acc + i)` → O(N)、(c) `bs lo hi … bs lo mid / bs (mid + 1) hi where mid = …` → O(log N)、(d) fib → O(2^N)。H4 `[n, m] <- …` + `length [() \| i <- [1..n], j <- [1..m], …]` → O(N·M)/O(1)。H5 `let dp = runSTUArray $ do` + `newArray (0, n) 0` + `forM_` + readArray/writeArray → O(N)/O(N)。H6 `mapM_ print (nub as)` + `as !! i` → O(N²)/O(N) + 警告。H7 テンプレート → O(1)/O(1)、confidence low(固定長パターンと §5.6 の I1/I2)。H8 `let lim = 1000` + `forM_ [1..lim] $ \i -> forM_ [1..i]` → O(10^6)/O(1)。H9 `forM_ [1..n] $ \i -> forM_ [i+1..n]` + `forM_ [n, n-1 .. 1]` → O(N²)/O(1)。H10 `readInts = map (fst . fromJust . BS.readInt) . BS.words <$> BS.getLine` + `[n, m] <- readInts` + `replicateM q readInts` + lowerBound の go → O(N log N + Q log N)/O(N)。H11 `main = do … loop n` + 同列 `where` + `loop 0 = return ()` + `loop i = print i >> loop (i - 1)` + `-----` 区切り → O(N)/O(1)。H12 `forM_ (zip [0..] as) $ \(i, a) -> …` + `go !acc (x:xs) = …` + `let ys = sort xs in …` + `forM_ [1..n] \i -> do` → O(N log N)/O(N)、警告なし |
| perl | P1 `chomp(my $n = <STDIN>)` + `my @a = split / /, <STDIN>` + `for my $i (0..$n-1)` + `for my $j ($i+1..$n-1)` + `$cnt++ if …` → O(N²)/O(N)(`1..$n` `0..$#a` もサブテスト)。P2 `my ($n, $m) = split ' ', <STDIN>` + `map { } split` + `sort { $a <=> $b } @a` + `grep { } @b` → O(N log N)/O(N)。P3 `for (my $i = 1; $i * $i <= $n; $i++)` + `while ($k > 0) { $k = int($k / 2) }` → O(√N + log N)/O(1)。P4 `my @memo = (0) x ($n + 1)` + `sub fact { my ($k) = @_; return 1 if $k <= 1; … fact($k - 1) }` + `print "$_\n" for @memo` → O(N)/O(N)。P5 `my @a = (3, 1, 2)` + `"a{b"` + `<<'EOS' … } for (;;) { … EOS` + `s{a}{b}g` + `until ($i >= $n)` + `print for @a` → O(1000)/O(1)、警告なし。P6 `my @in = split /\s+/, do { local $/; <STDIN> };` + `my $n = shift @in;` + `my @a = splice @in, 0, $n;` + `sub dfs { my $u = shift; my $p = shift; … }` + `for (sort keys %h)` + `$cnt{$_}++ for @a` → O(N log N)/O(N)。P7 `if/elsif/else` + `my %h = (for => 1, sort => 2); print $h{sort}` + `my $full = 1 << $n; for my $m (0 .. $full - 1)` + `push @rows, \@f` → O(2^N)/O(N)。P8 テンプレート |
| php | Q1 `fscanf(STDIN, "%d", $n)` + `array_map("intval", explode(" ", trim(fgets(STDIN))))` + 二重 for + `if (…) $cnt++;` → O(N²)/O(N)。Q2 `[$h, $w] = …` + `array_fill(0, $h, array_fill(0, $w, 0))` + `foreach ($grid as $i => $row)` + `for ($j …) $grid[$i][$j] = …;` + `sort($a)` → O(H·W + N log N)/O(H·W + N)。Q3 代替構文 `for (…): … endfor;`/`endwhile;`/`endif;` + `intdiv($k, 2)` + `?>` → O(N log N)/O(1)。Q4 `$fact = function (int $k) use (&$fact): int { … $fact($k - 1) }` + `usort($a, fn($x, $y) => $x <=> $y)` + `<<<EOS … } while ( … EOS` → O(N + N log N)/O(N)。Q5 BFS(`$adj = array_fill(0, $n, [])` + `$adj[$u][] = $v` + `new SplQueue` + `while (!$q->isEmpty())` + `foreach ($adj[$u] as $v)`)→ O(N + M)/O(N + M)。Q6 `echo array_sum(array_map(fn($x) => $x * 2, $a));` + `echo max(...$a);` + `for ($i = 1; $i <= sqrt($n); $i++)` + `$len <<= 1` + `$k = (int)($k / 2)` → O(N + √N + log N)/O(1)。Q7 `class Main { private array $adj = []; … foreach ($this->adj[$u] as $v) … $this->dfs($v) … } (new Main)->run();` + `$g[] = str_split(trim(fgets(STDIN)))` × H + `foreach (file("php://stdin") as $line)` + `while ($t--)` → O(H·W + T·…)/O(H·W)。Q8 字句(`<?php` 無し / shebang / `?>` 後の HTML / `array(` `list(` / `(int)` / `#` `//` `/* */` / `else if` / `\count(`)→ Loop 0、Call が期待どおり |

### 7.8 言語別の注記(`LANG_NOTES`。`.editor-note` の末尾に選択言語分を表示)

| 言語 | 注記 |
| --- | --- |
| ruby | 文字列補間 `#{…}` 内の式は未解析。`sort { }` の比較ブロックは N log N として概算 |
| lua | `..` 連結は O(1) として数える(ループ内で連結すると実際は O(N) ずつ)。自作イテレータ `for x in f(t)` は \|t\| と仮定。goto/メタテーブルは未対応 |
| julia | 同名関数の多重定義は最初の定義のみ。Iterators.product、DataStructures.jl、@threads は未対応 |
| bash | 簡易対応。配列の添字アクセスは O(1) として数える。`$(…)` の fork コストは無視。awk/sed の内部プログラム、select、`$(expr …)` による更新は N とみなす |
| nim | `while q.len > 0` はキュー駆動として扱う。自作 iterator は N 扱い。template/do 記法の本体は1回分として数える。`in` は受け手が HashSet/Table なら O(1)、seq なら O(N) |
| haskell | 反復の源(forM_/map/再帰)から推定する簡易対応(推定: 低)。遅延評価の thunk と中間リストは見積もらない。相互再帰、明示レイアウト `{ ; }`、MultiWayIf/LambdaCase は未対応。visited 付き DFS 再帰は過大評価される |
| perl | `$a` と `@a` は別変数として扱う。`for my ($k, $v)`、`&f;`、OO(bless)、配列スライス、`s///e` は未対応。`@_` のサイズは呼び出し側の引数から推定 |
| php | クラスは `$this->` を変数として扱い、型は追跡しない。配列のコピーオンライトは無視。2変数 for は警告 |

---

## 8. 範囲評価(`evaluate.ts`)

**`parseBoundValue(s)` の受理文法**(戻り値 `{ lo, hi }`。最悪ケースの評価には `hi` を使い、`lo` は表示だけに使う)

1. `s.normalize("NFKC")` → 小文字化 → 空白・`,`・`_`・`'` を削除 → `×`/`·` → `*`、`**` → `^`、`≦`/`=<` → `<=`。
2. `A<<B`(A, B は数字)を `A*2^B` に書き換える。範囲区切りの `<` と取り違えないよう、区切りの判定より先に行う。
3. 範囲表記: `lo<=X<=hi` / `lo≤X≤hi` / `lo<X<hi`(X は任意の変数名で無視)、`lo〜hi`、`lo~hi`、`lo..hi`。両端を下の単一値の文法で読み、`lo ≤ hi` でなければ null。区切りが無ければ全体を `hi` とし、`lo` は null。
4. 単一値: 空 → null。`*` で分割し各因子が `/^(\d+(?:\.\d+)?(?:e[+-]?\d+)?)(?:\^(\d+))?$/` でなければ null。値 = Π base^exp。`0 < 値 < 1e30` かつ有限でなければ null。

- 受理: `2e5`、`2*10^5`、`2×10^5`、`2·10^5`、`10^9`、`200000`、`2,000`、`2 * 10 ** 5`、`1e18`、`２０００００`、`1<<20`、`2_00_000`、`1.5`、`1 ≤ N ≤ 2×10^5`、`1<=N<=200000`、`1〜2e5`、`1..2e5`。
- 拒否: `N`、`10^`、`-5`、`1/2`、`0`、`5 ≤ N ≤ 3`。

**評価**: 項 = `coef × Π v^pow × log2(max(v,2))^log × 2^(exp·v) × (v!)^fact`。`v!` は `Σ log2 k` を累積し 1024 bit 超で打ち切り `Infinity`。`2^(exp·v)` は `exp·v ≥ 1024` で `Infinity`。疑似記号 `2^(H·W)` は名前をパースして計算。log の底は 2。`missing` があれば `ops:null`。

**速度係数(1秒あたりの単純演算回数の目安、19キー)**

| 係数 | 言語 |
| --- | --- |
| 1e8 | cpp, c, rust, go, d, nim, java, csharp |
| 3e7 | js, ts, pypy, julia, haskell |
| 1e7 | python, ruby, php, perl, lua |
| 1e5 | bash |

**判定**: `budget = SPEED[lang] × timeLimitSec`、`ratio = ops / budget`。`≤ 0.3` → 余裕(ok)、`≤ 1.0` → 厳しい(tight)、`> 1.0` → TLEの恐れ(tle)。`TIGHT_RATIO = 0.3` を定数で1箇所(本体を1演算と数える過小評価の補正)。

**`formatOps(n)`**: `< 10^4` は `Math.round` 後カンマ区切り(`1,235`)、`≥ 10^4` は有効2桁 `3.5×10^6`(`.0` は落とす)、丸めて 10^4 に達したら指数表記に繰り上げ、`Infinity` → `10^300 以上`。テスト: 999.6→`1,000`、1234.5→`1,235`、9999.9→`10^4`、200000→`2×10^5`、3.49e6→`3.5×10^6`、1e18→`10^18`。

---

## 9. UI

### 9.1 ヘッダーとルート(`src/App.tsx`)
- `<NavLink to="/complexity">計算量</NavLink>` を「エディター」の直後。`<Route path="/complexity" element={<ComplexityPage />} />`。
- モバイル: 5項目は約 **410px 以上**で収まり、360〜393px は既存設計どおり横スクロール(末尾「DS倶楽部 ↗」が途中で切れてスクロールの手掛かりになる)。CSS 値は変えず、[src/index.css:271](../src/index.css#L271) のコメントを「4項目なら360pxでも収まる。5項目(計算量)は約410px以上で収まり、それ未満は横スクロール」に修正。

### 9.2 ページ構成(`.page` 直下は常に **6個で固定**。条件付き要素はカード内に閉じる — nth-child の時間差アニメがずれないため)

| # | 要素 | 中身 |
| --- | --- | --- |
| 1 | `div.editor-toolbar` | `label.editor-lang` + select(`EDITOR_LANGS` の順。`BASIC_LANGS` の言語は「Haskell (GHC)(簡易対応)」のように表示)/ `button.run-btn`「解析 ▶」/ `button.linklike`「エディターのコードを読み込む」/ `.muted.editor-hint`「Ctrl+Enterで解析」 |
| 2 | `section.card.cx-code-card` | 先頭に条件付き `p.error-text`(エラー)/ `p.muted`「コードが変更されています。もう一度解析してください」→ `textarea.io-area.cx-code`(`wrap="off" spellCheck={false} autoCapitalize="off" autoCorrect="off" aria-label="解析するコード" placeholder="ここにコードを貼り付けて「解析 ▶」"`) |
| 3 | `div.stat-grid.cx-stats` | `StatCard` 2枚: 時間計算量(value=`time.text`、sub=§9.4)/ 領域計算量(value=`space.text`、sub=式のみ)。未解析時は value `—` |
| 4 | `section.card`「解析メモ」 | `card-head` に `.exit-chip`(high→`ok`「推定: 高」/ medium→`warn`「推定: 中」/ low→`ng`「推定: 低」)+ 視覚的に隠した `p.visually-hidden[role="status"]`「解析しました: O(N²)」(aria-live はここだけ)/ `ul.cx-warn-list`(warn は琥珀、info は muted。「12行目: …」)/ 未解析「「解析 ▶」を押すと結果がここに出ます。」/ `status:"error"` or breakdown 空かつ low なら「推定できませんでした。警告を確認してください」 |
| 5 | `div.two-col` | 左 `section.card`「変数の範囲」(§9.3)/ 右 `section.card`「内訳」(`.table-scroll > table.data-table`: 行 / 種別(時間・領域)/ 項 `<code>` / 理由。行は `button.linklike`「12–18」で textarea の該当行へジャンプ。`unused` 行は `<details>`「未使用の関数 12 個」に折り畳む) |
| 6 | `p.muted.editor-note` | §12 の注意書き + 言語別注記 |

### 9.3 「変数の範囲」カード
- `card-head`: 見出し + `.card-sub`「範囲を入れると回数を概算」+ `button.linklike`「範囲をクリア」(表示中の変数だけ消す)。
- `table.data-table`: 変数(`<code>N</code>`)/ 由来(`button.linklike`「12行目 cin >> n」→ 行ジャンプ)/ 範囲(`input.cx-bound` `inputMode="text"` `placeholder="例: 2e5"` `aria-label="N の範囲"` `aria-invalid` `aria-describedby="cx-total"`)/ 値(`≤ 200,000` または `1 〜 200,000`、無効なら `.cx-bound-bad`「無効」、未入力は `.muted`「—」。保存値が復元された直後は `.muted`「前回の値」)。
- 表の直下に `.muted` のヒント「上限だけ(2e5)でも、制約の書き方(1 ≤ N ≤ 2×10^5)でも入れられます」。
- その下: `label.editor-lang`「制限時間」+ `input.cx-bound` +「秒」(既定 "2")。合計行 `#cx-total`「合計演算回数の概算 ≒ 3.5×10^6 回」+ `.exit-chip` の `ok`/`warn`/`ng`(余裕 / 厳しい / TLEの恐れ)。`missing` があれば「N, M の範囲を入れると概算します」。記号変数0個なら表を出さず「記号変数はありません(計算量はリテラルだけで決まります)」。
- 注記「{label} は約 {formatOps(SPEED[lang])} 回/秒として概算(粗い目安)」。

### 9.4 stat-sub の規則

| 状況 | value | sub |
| --- | --- | --- |
| 記号変数なし | `O(1000)` | `≒ 1,000 回` |
| 全部入力済み | `O(N log N)` | `≒ 3.5×10^6 回` |
| 一部不足 | `O(N log N + M)` | `M の上限を入力すると回数を概算` |
| 未解析 | `—` | `「解析 ▶」で推定` |

### 9.5 状態と localStorage(getItem/setItem/JSON.parse は try/catch)

| state | キー | 備考 |
| --- | --- | --- |
| `langKey` | `shojin:complexity:lang` | 初期値: これ ?? `shojin:editor:lang` ?? `EDITOR_LANGS[0].key` |
| `code` | `shojin:complexity:code:<lang>` | 400ms デバウンス保存(EditorPage と同じ)。`switchLang` は「保存 → 切替先を読む」 |
| `result`/`analyzedCode` | 保存しない | `analyzeNow()` でのみ更新。`code !== analyzedCode` で「変更されています」 |
| `error` | — | 空入力/読み込み失敗/status:error |
| `rawBounds` | `shojin:complexity:ranges`(JSON、言語横断) | 生文字列を保存。`bounds = useMemo(parse)` |
| `rawTl` | `shojin:complexity:tl` | 既定 "2" |
| 派生 `est` | — | `useMemo(() => evaluate(result.time.full, bounds, langKey, tl))`。範囲変更は解析し直さない |

- `analyzeNow()` はボタンと Ctrl+Enter(EditorPage 265-284 行と同じ `useEffectEvent` + document キャプチャ)の両方が通る唯一の入口。先頭で `code.trim()===""` → error「コードを貼り付けてください」+ focus。`analyzeCode` は try/catch で包み例外は error に。
- `importFromEditor()`(`?from=editor` の useEffect と「読み込む」ボタンが共用): (1) `code.trim()!=="" && code !== 読み込む内容` なら `confirm("現在のコードを消してエディターのコードを読み込みます。よろしいですか?")`、(2) 現在言語の code を同期保存、(3) `setLangKey(editorLang)` と `setCode(editorCode)` を同一イベントで呼ぶ(switchLang は通さない)、(4) `shojin:complexity:lang` を即時保存、(5) `setParams({}, {replace:true})`。保存が無ければ error「エディターに保存されたコードがありません」。開発時の StrictMode では `?from=editor` の useEffect が2回走り confirm も2回出るので、`useRef` で1回に限定する。
- 行ジャンプ `jumpTo(lineFrom, lineTo)`: 行頭/行末オフセットを計算 → `ta.focus(); ta.setSelectionRange(s, e); ta.scrollTop = Math.max(0, (lineFrom-1)*lineHeight - ta.clientHeight/3)`(`getComputedStyle(ta).lineHeight` を数値化。Chrome/Safari は選択位置へ自動スクロールしないため)。

### 9.6 CSS 追加(`index.css`。新色は「リテラル + `:root[data-theme="dark"]` 上書き」の作法)
- `.editor-io .io-area, .cx-code { … }`(1391行のセレクタに追加)。`.cx-code { min-height: 260px; overflow: auto; tab-size: 4 }`。
- `.run-btn:disabled { opacity: .5; cursor: not-allowed; transform: none; filter: none }`。
- `.cx-stats .stat-value { font-family: var(--font-mono); font-variant-ligatures: none; font-feature-settings: "liga" 0, "calt" 0; font-size: clamp(20px, 5vw, 28px); overflow-wrap: anywhere; min-width: 0 }`、`@media (max-width:560px) { .cx-stats { grid-template-columns: 1fr } }`。
- `.cx-warn-list { … color: #a15c00 }` + dark `#e0a34a`。`.cx-warn-list .info { color: var(--muted) }`。
- `.exit-chip.warn { color: #a15c00; background: color-mix(in srgb, #e0a34a 18%, transparent) }` + dark `color: #e0a34a`。
- `.cx-bound { width: 120px; font: inherit; font-family: var(--font-mono); font-size: 13px; … }`、`.cx-bound[aria-invalid="true"], .cx-bound-bad { border-color: #d03b3b; color: #d03b3b }` + dark `#ff7a79`、`@media (max-width:560px) { .cx-bound { width: 88px; font-size: 16px } }`(iOS ズーム対策)。
- `:root[data-theme="dark"] .error-text { color: #ff7a79 }`(既存ページにも効く視認性改善)。
- `.editor-cx-link { font-size: 12px; font-weight: 600; white-space: nowrap }`(エディターのツールバーに置く導線)。
- `.visually-hidden`。

### 9.7 エディターからの導線(最小)
[src/pages/EditorPage.tsx:739-741](../src/pages/EditorPage.tsx#L739-L741) のヒント直後に `<Link className="editor-cx-link" to="/complexity?from=editor" onClick={() => localStorage.setItem(CODE_KEY(langKey), code)}>計算量を調べる →</Link>`(デバウンス中の入力を即時フラッシュ)。

---

## 10. ゴールデンテスト(`tests/complexity/golden.test.ts`)

`analyzeSnippet(lang, code)` → `assert.equal(a.time.text, …)`、`assert.equal(a.space.text, …)`、必要なら warnings の部分一致と `confidence`。全ケースで `assert(!text.includes("?"))`。

| # | 言語 | スニペット要旨 | time | space | 狙い |
| --- | --- | --- | --- | --- | --- |
| 1 | cpp | `for(i<n)` 1本(`cin>>n`) | O(N) | O(1) | 基本・由来 |
| 2 | cpp | `for i<n` × `for j<m` | O(N·M) | O(1) | 初出順 |
| 3 | py | `for i in range(n): for j in range(n)` | O(N²) | O(1) | 同変数 |
| 4 | cpp | `for(i<1000) for(j<n)` | O(1000·N) | O(1) | リテラル |
| 5 | py | `for i in range(n): for j in range(1000)` | O(1000·N) | O(1) | 内側リテラル |
| 6 | cpp | `for(k<5){…}` の後に `for i<n` | O(N) | O(1) | N+5 → N |
| 7 | cpp | `for i<n for j<1000` の後に `for i<n for j<m` | O(N·M + 1000·N) | O(1) | 係数保護 |
| 8 | cpp | `#define rep(i,n) for(int i=0;i<(int)(n);i++)` + `rep(i,n) rep(j,m)` | O(N·M) | O(1) | F1 |
| 9 | cpp | 定義無しの `rep(i,n) rep(j,n)` | O(N²) + warning | O(1) | フォールバック |
| 10 | cpp | `sort(all(a)); for i<n lower_bound(all(a), x)`(`vector<int> a(n)`) | O(N log N) | O(N) | size 畳み + alias |
| 11 | cpp | `for(j=i+1; j<n)` | O(N²) | O(1) | L9 |
| 12 | cpp | 篩 `for(i=2;i*i<=n;i++) if(!np[i]) for(j=i*i;j<=n;j+=i)` | O(N log N) | O(N) | L10(branch 透過、親 √N) |
| 13 | cpp | `for(i=1;i<=n;i++) for(j=1;j<=n/i;j++)` | O(N log N) | O(1) | dividedBy |
| 14 | py | `for i in range(1, n+1): for j in range(i, n+1, i)` | O(N log N) | O(1) | Python 調和 |
| 15 | py | `while i < n: i *= 2` | O(log N) | O(1) | L7 |
| 16 | cpp | `for(i=1; i*i<=n; i++)` | O(√N) | O(1) | L8 |
| 17 | cpp | `for(k=1;k<n*m;k*=2)` | O(log N + log M) | O(1) | logOfExpr |
| 18 | cpp | `hi=1e18; while(hi-lo>1){mid=…; if(ok(mid)) hi=mid; else lo=mid;}`(ok は `for i<n`) | O(60·N) | O(1) | L11 + 数値 log |
| 19 | cpp | `while(l<r){mid=(l+r)/2; …}`(r=n) | O(log N) | O(1) | L11 |
| 20 | py | 尺取り(`r=0` 外側、`for l in range(n): while r<n and …: r+=1`) | O(N) | O(1) | L15 |
| 21 | cpp | `for(int l=0,r=0;l<n;l++){ while(r<n && …) r++; }` | O(N) | O(1) | L15(for-init) |
| 22 | cpp | `for(l<n){ int r=l; while(r<n && …) r++; }` | O(N²) | O(1) | L13' |
| 23 | cpp | 単調スタック `for(i<n){ while(!st.empty() && …) st.pop(); st.push(i); }` | O(N) | O(N) | L15 スタック |
| 24 | cpp | `while(cond)` 不明 | O(N) + warning、low | O(1) | L19 |
| 25 | cpp | 二重ループ内 `if(x) break;` | O(N²) | O(1) | L20/F8 |
| 26 | py | `for i in range(n)` の後に `for i in range(m)` | O(N + M) | O(1) | 逐次 |
| 27 | py | `def solve()` 定義だけ + トップレベル `for i in range(n)` | O(N) | O(1) | 未使用関数 |
| 28 | cpp | `int solve(vector<int>& a){ for i<\|a\| for j<\|a\| }` のみ(main 無し) | O(\|a\|²) + info | O(1) | 個別入口 |
| 29 | cpp | `// for (i<n*n)` コメント + 実ループ1本 | O(N) | O(1) | コメント |
| 30 | py | `print("for i in range(n*n)")` + 実ループ1本 | O(N) | O(1) | 文字列 |
| 31 | cpp | `const int MOD = 1'000'000'007;` + `for i<n` | O(N) | O(1) | 桁区切り |
| 32 | cpp | `int f(int n){ if(n==0) return 0; return f(n-1)+1; }` | O(N) | O(N) | R1 |
| 33 | py | 素朴 fib | O(2^N) + warning | O(N) | R6 |
| 34 | py | `@lru_cache(maxsize=None) def rec(i, j): if i == n: …; if j > m: …` | O(N·M) | O(N·M) | R7 base case |
| 35 | cpp | `int dp[2005][2005]; int rec(int i,int j){ if(i==n) return 0; if(dp[i][j]!=-1) return …; }` | O(N·M) | O(4×10^6) | R7 + S3 |
| 36 | cpp | `if (~memo[i]) return memo[i];` | O(N) | O(N) | memo `~` |
| 37 | py | DFS 再帰 + `seen[v]`、`for to in g[v]`(`for _ in range(m): g[a].append(b)`) | O(N + M) | O(N + M) | R8 + adjacency |
| 38 | cpp | ラムダ再帰 `auto dfs = [&](auto&& self, int v, int p) -> void {…}; dfs(dfs, 0, -1);`(木 `for i<n-1`) | O(N) | O(N) | F2 + parent skip、E=N |
| 39 | py | `def main(): … dfs …; threading.Thread(target=main).start()` | O(N + M) | O(N + M) | Thread |
| 40 | cpp | UF `find(x){ return par[x]==x ? x : par[x]=find(par[x]); }` + `for i<q: unite(a,b)` | O(Q log N) | O(N) | R-UF |
| 41 | cpp | 反復 UF `while(par[x]!=x) x=par[x];` in `for i<q` | O(Q log N) | O(N) | L12'' |
| 42 | cpp | マージソート(2分割 + O(n) マージ) | O(N log N) | O(N) | R3 |
| 43 | cpp | セグ木 `query(a,b,k,l,r)` with `if(r<=a\|\|b<=l) return e;` を `for i<q` から | O(Q log N) | O(N) | R3' |
| 44 | cpp | `vector<vector<ll>> dp(n+1, vector<ll>(m+1))` + 二重 for | O(N·M) | O(N·M) | S2 |
| 45 | cpp | `set<int> s; for i<n: s.insert(a[i]); for i<q: s.count(x)` | O(N log N + Q log N) | O(N) | 成長 alias |
| 46 | cpp | `map<int,int> mp; for i<n: mp[a[i]]++;` | O(N log N) | O(N) | `[]` 成長 |
| 47 | py | `for _ in range(q): if x in a`(a サイズ不明) | O(Q·\|a\|) | O(1) | `in` |
| 48 | py | `for _ in range(q): print(sum(a[l:r]))` | O(Q·\|a\|) | O(1) | スライス上界 |
| 49 | cpp | `for(s=0; s<(1<<n); s++) for(i<n)` | O(N·2^N) | O(1) | L17 |
| 50 | py | `for bits in product((0,1), repeat=n)` | O(2^N) | O(1) | product |
| 51 | py | `for p in permutations(range(n)): for i in range(n)` | O(N·N!) | O(1) | L16 |
| 52 | cpp | `do{…}while(next_permutation(all(p)))` 本体 `for i<n` | O(N·N!) | O(N) | do-while |
| 53 | cpp | `const int MAX=200005; int a[MAX];` + `for i<n` | O(N) | O(2×10^5) | S3 |
| 54 | py | BFS `while q: v=q.popleft(); for to in g[v]: …` | O(N + M) | O(N + M) | L14 |
| 55 | py | heapq ダイクストラ | O(N log N + M log M) | O(N + M) | pq alias |
| 56 | go | BFS(`for len(q) > 0 { … for _, to := range g[v] {…} }`、`g[a] = append(g[a], b)`) | O(N + M) | O(N + M) | Go |
| 57 | rust | `while let Some(v) = q.pop_front() { for &to in &g[v] {…} }` | O(N + M) | O(N + M) | Rust |
| 58 | cpp | `int t; cin>>t; while(t--) solve();`(solve は `for i<n`) | O(T·N) + info | O(1) | L13'' |
| 59 | py | `for _ in range(int(input())): solve()` | O(T·N) | O(1) | L4' |
| 60 | py | `for i in range(n-1, -1, -1)` / `reversed(range(n))` | O(N) | O(1) | 逆順 |
| 61 | py | `for i, x in enumerate(a)` + `for dx, dy in [(0,1),(1,0),(0,-1),(-1,0)]` | O(\|a\|) | O(1) | unwrap + リテラル列 |
| 62 | cpp | `for(i=2;i*i<=x;i++) while(x%i==0){ x/=i; }` | O(√X) | O(1) | L12 |
| 63 | cpp | `while(b){ a%=b; swap(a,b); }` in `for i<n` | O(N log A) | O(1) | L12' |
| 64 | cpp | ユーザー定義 `ll pow(ll a, ll b){ … b>>=1 … }` を `for i<n` 内で | O(N log B) | O(1) | 解決順 |
| 65 | cpp | `for(int i=0;i+1<n;i++)` / `for(auto it=s.begin(); it!=s.end(); it++)` | O(N + \|s\|) | O(1) | L1'/L3 |
| 66 | py | `dp = [[[0]*k for _ in range(m)] for _ in range(n)]` | O(N·M·K) | O(N·M·K) | F7 |
| 67 | py | `b = [f(x) for x in a]`(f は `for i in range(n)`) | O(\|a\|·N) | O(\|a\|) | 内包時間 |
| 68 | cpp | `segtree<S,op,e> seg(n); for i<q { seg.set(p,x); seg.prod(l,r); }` | O(Q log N) | O(N) | ACL |
| 69 | java | `Arrays.sort(a)` + `TreeMap` put in loop(Scanner) | O(N log N) | O(N) | Java |
| 70 | js | `for (let i=0;i<n;i++) for (const x of a)` + `a.sort((x,y)=>x-y)` | O(N·\|a\| + \|a\| log \|a\|) | O(1) | JS |
| 71 | ts | `a.forEach(x => { for (let j=0;j<n;j++) … })` | O(\|a\| + N) + info | O(1) | F12 |
| 72 | csharp | `for` × `foreach` | O(N·\|a\|) | O(1) | C# |
| 73 | d | `foreach (i; 0 .. n) foreach (j; 0 .. m)` | O(N·M) | O(1) | D |
| 74 | cpp | 同名 `n` を内側スコープで再宣言、`for i<n` | O(N) | O(1) | スコープ無視 |
| 75 | cpp | 括弧不一致(`}` 過多、EOF 未閉鎖)の二重ループ | O(N²) + warning「unbalanced」 | O(1) | 堅牢性 |
| 76+ | ruby/lua/julia/bash/nim/haskell/perl/php | §7 で確定(各言語4本以上) | | | 追加8言語 |

`perf.test.ts`: 1万行の `for` 連結、`min(a, min(b, …))` 1万段、`rep` 5,000回 → 各 1 秒以内(ローカルの目安は 200ms。CI の揺れで落ちないよう上限は緩め、桁違いの遅さだけを捕まえる)。

---

## 11. 実装順序(コミット単位)と検証

コミットは日本語、本文に理由と「検証:」節(既存ログと同じ流儀)。各段階で `npm run build`(tsc -b + vite build)・`npm test`・`npm run lint` を通してから main に直接 push する。`package-lock.json` は含めない。

| # | コミット | 内容 | 検証 |
| --- | --- | --- | --- |
| C0 | 計算量解析タブの実装計画を docs に追加 | `docs/complexity-analyzer-plan.md` | リンクが `docs/` から辿れること、表が GitHub で崩れないこと |
| C1 | テスト基盤と IR 型を追加 | `tsconfig.test.json`、`tsconfig.json` references、`package.json` test、`ir.ts`、`tests/complexity/helpers.ts`、空の `index.ts` | `npm test`(0件でも緑)、`npm run build` |
| C2 | 字句解析と式パーサ | `lexer.ts`、`sexpr.ts`、`lexer.test.ts`、`sexpr.test.ts` | 桁区切り・raw 文字列・template・lifetime・未終端・sigil・ヒアドキュメント |
| C3 | 計算量式の代数と範囲評価 | `expr.ts`、`evaluate.ts`、`expr.test.ts`、`evaluate.test.ts` | §6 の仕様表・§8 の受理/拒否・formatOps |
| C4 | C/C++ フロントエンド | `langTable.ts`(19キー、cpp/c を埋める)、`macro.ts`、`braceFrontend.ts`、`frontend.ts`、`inputVars.ts`、`brace.test.ts`(cpp 分) | 骨格テスト(マクロ・関数検出・ラムダ・decl) |
| C5 | Python フロントエンド | `indentFrontend.ts`、`indent.test.ts` | 内包・ネスト def・デコレータ・不正 dedent |
| C6 | 解析コア(ループ・呼び出し・領域) | `bounds.ts`、`builtins.ts`(cpp/python)、`analyze.ts`(再帰は「未対応 → N」の暫定)、`bounds.test.ts`、golden #1〜31, 44〜55, 58〜63, 65〜67, 74〜75 | `npm test` |
| C7 | 再帰・メモ化・グラフ・UF | `recursion.ts`、analyze の合成規則(harmonic/amortized/adjacency)、golden #32〜43, 64, 68 | `npm test` 全緑、perf.test |
| C8 | 残りの brace 言語 | langTable に java/rust/go/js/ts/csharp/d、builtins の java/other、golden #56, 57, 69〜73 | `npm test` |
| C9 | 計算量ページとルート | `ComplexityPage.tsx`、`App.tsx`、`index.css` | `npm run build`、`npm run dev` でブラウザ確認(下記) |
| C10 | end 系抽出器 + Lua + Ruby | `endFrontend.ts`、`langs/lua.ts`、`langs/ruby.ts`、`end.test.ts`、golden L1〜L8 / R1〜R8 | `npm test`(Lua で抽出器を固め、Ruby の修飾子まわりを R6/R7 で先に通す) |
| C11 | Julia + Bash | `langs/julia.ts`、`langs/bash.ts`、golden J1〜J8 / B1〜B8 | `npm test` |
| C12 | Perl + PHP(brace + sigil) | `langs/php.ts` → `langs/perl.ts`、lexer の sigil/prevKind/heredoc、braceFrontend の `interpretList`/blockBuiltins/波括弧なし本体、golden Q1〜Q8 / P1〜P8 | `npm test`(Perl の lexHook 述語表は単体テストで固めてから postTokenize へ) |
| C13 | Nim(indent) | `langs/nim.ts`、indentFrontend の `IndentProfile` 化、golden T1〜T16 | `npm test` |
| C14 | Haskell | `haskellFrontend.ts`、`langs/haskell.ts`、`haskell.test.ts`、golden H1〜H12、`LANG_NOTES` | `npm test` |
| C15 | 付随 | `updates.ts`(`2026-09-27a`)、README、EditorPage の Link、deploy.yml に `npm test`(schedule では走らせない) | `npm run build`、トップにバナーが出る、push 後の Actions で `npm test` が緑 |

C9 は C8 の直後に置き、ページを早く触れる状態にしてから残り言語を足す(C10〜C14 はページ側の変更なしで `LANG_NOTES` に自動反映)。各言語とも「ゴールデン → spec → builtins」の順(テスト先行)。

**ブラウザ確認(`npm run dev` → `http://localhost:5173/#/complexity`)**
1. ヘッダーに「計算量」が出て active 下線が出る。DevTools 360px と 390px で nav が横スクロールし、ヘッダー本体は溢れない。
2. C++ の `rep(i,n) rep(j,m)` を貼って解析 → `O(N·M)`、内訳2行(時間)、由来「3行目 cin >> n」。範囲 `2e5`/`2*10^5`/`2×10^5`/`1 ≤ N ≤ 2×10^5` が同じ上限になり、`abc` と `5 ≤ N ≤ 3` は赤枠+「無効」。N=M=2e5 で「TLEの恐れ」、N=M=2,000 で「余裕」。
3. `for(int i=0;i<1000;i++)` だけ → `O(1000)` / `≒ 1,000 回`、範囲表「記号変数はありません」。
4. 制限時間 2→4 でチップだけ変わる(解析ボタン不要)。
5. 空欄で解析 → 「コードを貼り付けてください」。Haskell を選ぶと注記「簡易対応」が出て解析はできる。
6. エディターで Ruby を選び「計算量を調べる →」→ Ruby+コードが引き継がれ URL から `?from=editor` が消える。貼り付け済みなら confirm が出る。
7. 1文字変えると「コードが変更されています」。リロードで言語・コード・上限・制限時間が復元。前回の上限には「前回の値」。
8. 内訳の「12–18」で textarea の該当行が選択され、長いコードでもスクロールして見える。
9. ダーク固定で3種のチップ・警告リスト・赤枠・`.error-text` が読める。360px で結果カードが1列、範囲表は表内スクロール。
10. 1万行貼り付けで固まらない(解析 <200ms)。
11. 19言語それぞれのテンプレート(A+B)を貼って、時間・領域とも `O(1)` と出ること(全言語のスモーク。§5.6 の I1〜I4 の確認)。

**予算超過時の削減順**(規模の見込みは lib 約 11,000 行、テスト約 3,500 行、UI 約 600 行。19言語対応は決定事項なので言語は削らない): (1) ACL 表・L12''・R-UF 反復版、(2) `other` 以降の builtins を sort/探索/挿入削除だけに、(3) L16/L17'(順列・組合せ)、(4) `inputVars.ts`(由来ラベルを「ループ上限(行 L)」だけに)、(5) 領域の S10/S11。ページ側は削らない。

---

## 12. 既知の限界と注意書き

**ページに書く注意書き(`.editor-note`)**
> 計算量はブラウザ内の静的解析による推定で、コードは実行もどこかへ送信もしません。while の終了条件・ライブラリ関数の内部・コールバック内の処理・文字列連結の実コストは推定できないことがあります。領域計算量は入力配列と再帰スタックを含む総確保量の目安です。入力の読み取り(1行の分割・数値変換)そのものは時間に数えません。「余裕/厳しい/TLEの恐れ」はループ本体を1演算と数えた粗い目安で、実際の判定は提出して確かめてください。(言語別注記: `LANG_NOTES[lang]` があれば続けて表示)

**既知の限界(README と `index.ts` 冒頭コメントにも書く)**
- 篩は上界 N log N(真は N log log N)、部分集合列挙は 4^N 表示(真は 3^N)、`k^N` は 2^N 上界。
- unordered_map/dict は平均 O(1) 扱い。Python/Java の文字列 `+=` は O(1) 扱い + 警告。
- コールバック(forEach/map/stream/LINQ)内のループは外側と掛け合わせない(警告)。
- 分割統治は a=1,2 の half のみ。a=4 や一般のマスター定理は N² 上界 + 警告。
- 関数の実引数代入は「単一識別子/定数式」のみ。それ以外は仮引数名の記号が範囲表に出る。
- スコープを見ない(同名変数は同一視)。サイズの別名は §5.4 の alias (c)〜(e) に当たる形だけ追う。入力配列の長さの推定(alias (e))は外れることがあり、そのときは info で分かる。
- 範囲の下限は表示だけに使い、評価は上限で行う。
- マルチテストの Σ N 制約は反映しない(info で案内)。
- Haskell は反復の源(forM_/map/再帰)からの簡易推定(confidence low 固定)。Bash はパイプ先コマンドの入力サイズで近似。
- 出力に `"?"` が残ったらバグ(主記号への置換漏れ)。

---

## 13. 実装の記録(計画との違い)

2026-09-27 に C0〜C15 を実装した。計画から変えたところと、その理由を残しておく。

**構成**

- 言語の定義は `src/lib/complexity/langs/` の16ファイル(cpp/c、python/pypy、js/ts はそれぞれ1ファイルで2言語)。組み込みの表は言語ファイルではなく [builtins.ts](../src/lib/complexity/builtins.ts) に言語ごとの表として並べた(自由関数の表 `FREE` が19キーを束ねる)。
- end 系(Ruby / Lua / Julia)は `endFrontend.ts` を作らず、字句の後で `then` / `do` … `end` を波括弧の形に書き換えてから([endRewrite.ts](../src/lib/complexity/endRewrite.ts))波括弧系のフロントエンドで読む。文の区切り・else の連鎖・ラムダの本体を共有できるため。Ruby の修飾子の if / while は書き換えず、文末の修飾として読む。`BlockProfile` は使っていない。
- Bash はコマンドを式に直してから(`canonBash`)同じ書き換えを通す。PHP は代替構文と `array(`、Perl は式の途中の `my` と `do { … }` の値を字句の後で直す。
- Haskell は [haskellFrontend.ts](../src/lib/complexity/haskellFrontend.ts) が生のブロック木を経ずに IR を直接作る。
- IR に `call` ノードは作らず、呼び出しは `expr` / `assign` / `return` の式の中から解析器が数える。
- 計算量ページは解析器ごと別のチャンクにして遅延読み込みする(ほかのページの読み込みは変わらない。計算量ページで gzip 約 79KB)。
- エディターからの導線「計算量を調べる →」は、ツールバーではなくコード欄の右上(「テンプレートに戻す」の隣)に置いた。コードに対する操作をまとめるため。
- コード欄は §9.2 の素の textarea をやめ、エディターと同じ [CodeEditor.tsx](../src/components/CodeEditor.tsx)(ハイライト・行番号・自動インデント・括弧の補完・識別子の補完・Ctrl+/ のコメント・高さのつまみ)を使う。エディターのコードを読み込んで直しながら調べる使い方が多く、2つのタブで入力の感触をそろえるため(2026-09-27 に変更)。インデント幅はエディターの設定に従い、高さは計算量タブだけで覚える。

**規則の追加・変更**

- F12(コールバックはループにしない)を変えた: `forEach` / `map` / LINQ / Ruby のブロックなどのコールバックは、組み込みの規則の `loopArg` / `cmpArg` で要素数ぶん掛ける。さらに、ブロック付きの反復を文として書いたもの(`n.times do |i|` / `a.each { }` / `a.forEach(x => { })` / `loop do` / Haskell の `forM_`)はループのノードにし、隣接リストの走査や償却の規則を効かせる。
- 再帰: 別々の分岐(if / else・ガード・三項演算子)にある自己呼び出しは1回の実行で1本と数える。再帰の二分探索が N ではなく log N になる。メモ化は「表の値を返す分岐」があるときだけと判定する。
- 別名の追加: `resize(n)` / `assign(n, x)` の大きさ、1回だけ代入した変数(`m = n - 1` / `k = min(n, 20)`)、入力配列の長さの推定で「分割の元の変数(`b = line.split()` の line)」と「確保の大きさやループの回数に使った入力(グリッドの H・W)」を候補から外す。
- 表示: 10未満の定数だけの式は `O(1)`。ふつうの記号を `|a|` より先に並べる(`O(Q·|a|)`)。記号は入力を読んだ順に並べる(`O(N + M)`)。内訳の式も総計と同じく簡約する。
- 入力の読み取りの関数(`sc.nextInt()` / `fmt.Scan` / `Console.ReadLine` など)は未知の関数として数えない。

**テスト**

- 性能テストは経過時間の1秒ではなく、同じプロセスで入力を10倍にしたときの CPU 時間の伸び方で判定する(40倍未満。2乗なら100倍になるところ、実測は3〜6倍)。混んだ機械では経過時間も CPU 時間も数倍に揺れたため。絶対値の上限は5秒。
- ゴールデンは [golden.test.ts](../tests/complexity/golden.test.ts)(C/C++・Python・波括弧系の7言語)と、追加8言語の `<key>.test.ts`(各8〜16本)。エディターの19言語のテンプレートが O(1)/O(1) になることを [templates.test.ts](../tests/complexity/templates.test.ts) で確かめる。合計246件。
- 計画の期待値を直したもの: #40 / #41 / #43 / #68 は O(N) の初期化を含めて `O(Q log N + N)`、#35 の領域は再帰の深さを含めて `O(N + M + 4×10^6)`、#70 / #72 は入力配列の長さの推定(alias (e))で `O(N²)`、#71 はコールバックを掛けて `O(N·|a|)`。
