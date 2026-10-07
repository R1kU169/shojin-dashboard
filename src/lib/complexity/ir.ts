// 計算量解析の中間表現(IR)と出力の型。
//
// フロントエンド(言語ごとの字句・構文の読み取り)と解析コア(言語に依らない計算量の合成)は
// この型だけで繋がる。型しか置かず import もしないのは、どちらの側からも循環せずに
// 参照できるようにするため(型の循環は、誰かが値として import した瞬間に実行時の循環になる)。

export type Confidence = "high" | "medium" | "low";

/** ソース上の範囲。1始まり、endLine は含む */
export interface Loc {
  line: number;
  endLine: number;
}

// ---------------------------------------------------------------------------
// 字句

export type TokKind = "ident" | "num" | "str" | "op" | "pp";

export interface Tok {
  k: TokKind;
  /** 識別子名・記号・文字列の中身・数値の元表記・前処理行の全文 */
  v: string;
  /** k === "num" のときの値 */
  num?: number;
  line: number;
  /** 見た目の桁(0始まり、タブは8桁ごと)。インデントとレイアウト規則に使う */
  col: number;
  /** 直前に空白(改行を含む)があるか */
  sp: boolean;
  /** その行の最初のトークンか */
  nl: boolean;
  /** perl/php/bash の変数の印($ @ %)。名前 v からは剥がしてある */
  sigil?: string;
  /** qw() や %w[] のような語のリスト(要素数を数えるため) */
  words?: number;
}

// ---------------------------------------------------------------------------
// 構文式。フロントエンドが作り、意味付け(計算量としての解釈)は解析コアがやる

export type SExpr =
  | { kind: "num"; value: number }
  | { kind: "str"; value: string }
  /** sigil は perl/php/bash の変数の印(@a は数値の文脈ではサイズになる) */
  | { kind: "sym"; name: string; sigil?: string }
  /** a.size() / len(a) / a.length / #a / count($a) などを1つにまとめたもの */
  | { kind: "size"; of: SExpr }
  | { kind: "index"; of: SExpr; idx: SExpr[] }
  | { kind: "slice"; of: SExpr; from: SExpr | null; to: SExpr | null }
  /** args が null ならプロパティ参照、配列なら呼び出し */
  | { kind: "member"; of: SExpr; name: string; args: SExpr[] | null }
  /** ns は std:: や heapq. のような名前空間(畳み込み済み) */
  | { kind: "call"; name: string; ns: string | null; args: SExpr[] }
  | { kind: "bin"; op: string; l: SExpr; r: SExpr }
  | { kind: "un"; op: string; e: SExpr }
  | { kind: "cmp"; op: string; l: SExpr; r: SExpr }
  | { kind: "logic"; op: "&&" | "||"; l: SExpr; r: SExpr }
  | { kind: "not"; e: SExpr }
  /** ++ / -- は value が null */
  | { kind: "assign"; op: string; target: SExpr; value: SExpr | null }
  | { kind: "cond"; c: SExpr; a: SExpr; b: SExpr }
  /** brace: { } で書いたハッシュ(key: value)・集合のリテラル(Python / Ruby / JS)。無ければ配列・タプル */
  | { kind: "list"; items: SExpr[]; brace?: "hash" | "set" }
  /** range()/a..b/1:n/0..<n を統一したもの。負の刻みは from/to を入れ替えて正にしてある */
  | { kind: "range"; from: SExpr | null; to: SExpr; step: SExpr | null; inclusive: boolean }
  /** 内包表記。gens は外側から */
  | { kind: "comp"; elem: SExpr; gens: { vars: string[]; iter: SExpr }[]; conds: SExpr[]; brace?: "hash" | "set" }
  /** ラムダ。本体が文なら body、式なら expr */
  | { kind: "lambda"; params: string[]; body: IrNode[]; expr: SExpr | null; loc: Loc }
  /** new T[n][m] / new T(args) */
  | { kind: "new"; type: string; dims: SExpr[]; args: SExpr[] }
  | { kind: "unknown"; text: string };

export type ContainerKind =
  | "array"
  | "oset"
  | "omap"
  | "hset"
  | "hmap"
  | "pq"
  | "deque"
  | "stack"
  | "string"
  | "linkedlist"
  | "acl"
  | "user"
  | "scalar"
  | "unknown";

// ---------------------------------------------------------------------------
// ブロック木

export type LoopBound =
  | { form: "for-c"; var: string | null; init: SExpr | null; cond: SExpr | null; update: SExpr | null }
  | { form: "for-range"; var: string | null; from: SExpr | null; to: SExpr; step: SExpr | null; inclusive: boolean }
  | { form: "for-in"; var: string | null; coll: SExpr }
  /** cond が null なら無限ループ(while(true) / for(;;) / loop) */
  | { form: "while"; cond: SExpr | null; doWhile: boolean; bind?: string[] }
  /** 回数だけが分かるもの(Ruby の n.times、Haskell の replicateM_ n など) */
  | { form: "count"; var: string | null; count: SExpr };

export type IrNode =
  | {
      kind: "func";
      name: string;
      params: string[];
      decorators: string[];
      body: IrNode[];
      loc: Loc;
      isLambda: boolean;
      /** C++ の auto&& self のような、自分自身を受け取る仮引数 */
      selfParam: string | null;
    }
  | { kind: "loop"; bound: LoopBound; body: IrNode[]; hasBreak: boolean; loc: Loc; src: string }
  /** else 節は条件 null。switch/match/try は全部 null */
  | { kind: "branch"; conds: (SExpr | null)[]; branches: IrNode[][]; loc: Loc }
  /**
   * 式だけの文(呼び出し・出力など)。呼び出しの抽出はしない: 解析コアが式を歩いて
   * 呼び出し・in・添字・内包表記のコストを数えるので、フロントエンドは式をそのまま渡せばよい
   */
  | { kind: "expr"; e: SExpr; loc: Loc; src: string; reading?: boolean }
  /** reading は入力を読む文(1行の分割・数値変換そのものは時間に数えない) */
  | { kind: "assign"; target: SExpr; op: string; value: SExpr | null; loc: Loc; src: string; reading?: boolean }
  | {
      kind: "decl";
      name: string;
      typeName: string;
      container: ContainerKind;
      /** vector<int> a(n) → [n]、int dp[N][M] → [N, M] */
      dims: SExpr[];
      init: SExpr | null;
      isGlobal: boolean;
      /** 確保と同時に全要素を初期化する(=要素数ぶんの時間がかかる)か */
      costsTime: boolean;
      /** 要素もコンテナなら、その種類([FenwickTree(n) for _ in …] の要素は acl、[set() for _ in …] は hset) */
      elem?: ContainerKind;
      loc: Loc;
      reading?: boolean;
    }
  | { kind: "return"; value: SExpr | null; loc: Loc }
  /** 入力の読み取り。scalars はスカラ、arrays は配列として読んだ変数。lens は長さが分かる配列 */
  /** refs: 読み取りの式が使っている、前に読んだ入力の名前(b = line.split() の line)。配列の長さの推定から外す */
  | { kind: "input"; scalars: string[]; arrays: string[]; lens: Record<string, SExpr>; loc: Loc; via: string; refs?: string[] }
  | { kind: "stmt"; loc: Loc };

export interface FrontWarning {
  line: number;
  code:
    | "unbalanced"
    | "unterminated"
    | "bad-indent"
    | "macro-fallback"
    | "macro-limit"
    | "truncated"
    | "internal-error"
    | "unsupported-syntax";
  message: string;
}

export interface Program {
  lang: string;
  nodes: IrNode[];
  /** 定数式に評価できたものだけ。後勝ち。入力で上書きされたら消す */
  consts: Record<string, { value: number; line: number }>;
  warnings: FrontWarning[];
  lineCount: number;
}

// ---------------------------------------------------------------------------
// 計算量の式。v^pow · log(v)^log · (2^v)^exp · (v!)^fact の積に係数を掛けた項の和

export interface Factor {
  v: string;
  pow: number;
  log: number;
  exp: number;
  fact: number;
}

export interface Term {
  coef: number;
  /** v の文字列順に並べ、同じ v は1つにまとめてある */
  factors: Factor[];
}

/** 項の和。正規化済みなら同じ factors の項は1つ */
export type Expr = Term[];

// ---------------------------------------------------------------------------
// 出力

export interface Variable {
  name: string;
  /** どこから来た記号か(「入力(3行目 cin >> n)」など) */
  origin: string;
  line: number;
  /** 定数から来た記号なら値 */
  value?: number;
}

export interface BreakdownItem {
  axis: "time" | "space";
  kind: "loop" | "call" | "recursion" | "alloc" | "builtin" | "func";
  loc: Loc;
  /** 何の項か(「for (i < n)」など) */
  label: string;
  expr: Expr;
  /** expr を表示用に整形したもの(「×N」「O(N log N)」など) */
  text: string;
  /** そう判断した理由 */
  reason: string;
  conf: Confidence;
  /** 入口から呼ばれない関数(UI で折り畳む) */
  unused?: boolean;
}

export interface AnalysisWarning {
  line?: number;
  message: string;
  level: "info" | "warn";
}

export interface Analysis {
  lang: string;
  status: "ok" | "unsupported" | "error";
  /** expr は表示用(支配される項を落としたもの)、full は範囲評価用(落とす前) */
  time: { expr: Expr; full: Expr; text: string };
  space: { expr: Expr; full: Expr; text: string };
  variables: Variable[];
  breakdown: BreakdownItem[];
  warnings: AnalysisWarning[];
  confidence: Confidence;
  /** 評価の入口("main" / "<module>" / 個別に評価した関数名) */
  entries: string[];
  /** 記号を表示する順(初出順) */
  symbolOrder: string[];
}

export type TimeVerdict = "ok" | "tight" | "tle";

export interface EvalResult {
  ops: number | null;
  opsText: string;
  /** 値が入っていない記号 */
  missing: string[];
  budget: number;
  ratio: number | null;
  verdict: TimeVerdict | null;
}
