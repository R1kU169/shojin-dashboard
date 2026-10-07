// 既知の関数・メソッドの計算量(§5.5)。
//
// メソッドは受け手のコンテナの種類で引く(set の insert は log、vector の push_back は 1、
// list の insert は N)。受け手の種類が分からないときは UNKNOWN_METHODS の既定を使い、
// 警告で「set/map と仮定した」ことを伝える。自由関数は言語の系統ごとの表で引く。
import type { Confidence, ContainerKind, Expr, SExpr } from "./ir.ts";
import { add, logOfExpr, mul, ONE, vars } from "./expr.ts";

export interface CallCtx {
  args: SExpr[];
  recv: SExpr | null;
  recvKind: ContainerKind;
  /** コンテナの要素数(|a|) */
  size(e: SExpr | null): Expr;
  /** 数値としての上限(n / 10**5) */
  bound(e: SExpr | null): Expr;
  /** begin/end の組やポインタの組から範囲の長さ */
  rangeSize(args: SExpr[]): Expr;
}

export interface BuiltinRule {
  cost: (c: CallCtx) => Expr;
  /** 受け手(自由関数なら第1引数)に要素を1つ足す */
  grows?: boolean;
  /** この位置のラムダ引数を、受け手(自由関数なら第1引数)の要素数だけ回す */
  loopArg?: number;
  /** 比較関数のラムダを n log n 回呼ぶ(sort の比較子) */
  cmpArg?: number;
  /** 領域(resize(n) / assign(n, x) / reserve(n) の大きさ) */
  alloc?: (c: CallCtx) => Expr;
  conf?: Confidence;
  note?: string;
  warn?: string;
}

// ---- コストの部品 -------------------------------------------------------------

const one = (): Expr => ONE;
const S = (c: CallCtx) => c.size(c.recv);
const SlogS = (c: CallCtx) => {
  const s = S(c);
  return mul(s, logOfExpr(s));
};
const logS = (c: CallCtx) => logOfExpr(S(c));
const A = (i: number) => (c: CallCtx) => c.size(c.args[i] ?? null);
const AlogA = (i: number) => (c: CallCtx) => {
  const s = c.size(c.args[i] ?? null);
  return mul(s, logOfExpr(s));
};
const logA = (i: number) => (c: CallCtx) => logOfExpr(c.size(c.args[i] ?? null));
const R = (c: CallCtx) => c.rangeSize(c.args);
const RlogR = (c: CallCtx) => {
  const r = R(c);
  return mul(r, logOfExpr(r));
};
const logR = (c: CallCtx) => logOfExpr(R(c));
const B = (i: number) => (c: CallCtx) => c.bound(c.args[i] ?? null);
const logB = (i: number) => (c: CallCtx) => logOfExpr(c.bound(c.args[i] ?? null));

const r = (cost: (c: CallCtx) => Expr, extra: Partial<BuiltinRule> = {}): BuiltinRule => ({ cost, ...extra });

/** 2つの式が同じ形か(s:sub(i, i) は1文字) */
const sameExpr = (a: SExpr | undefined, b: SExpr | undefined) => !!a && !!b && JSON.stringify(a) === JSON.stringify(b);
/** s:sub(i, j) / string.sub(s, i, j) は長さ j - i + 1。同じ添字なら1文字、それ以外は |s| で見積もる */
const substr = (from: number) => (c: CallCtx) => (sameExpr(c.args[from], c.args[from + 1]) ? ONE : from === 0 ? S(c) : c.size(c.args[0] ?? null));

function table(entries: [string, BuiltinRule][]): Record<string, BuiltinRule> {
  const out: Record<string, BuiltinRule> = {};
  for (const [names, rule] of entries) for (const n of names.split(" ")) out[n] = rule;
  return out;
}

// ---- メソッド(受け手の種類ごと) ---------------------------------------------------

const ITERATE = "map filter select reject each each_with_index each_char each_slice each_cons forEach for_each every some any all find findIndex find_index findLast count_if flat_map flatMap filter_map map! select! reject! Select Where Any All ForEach FirstOrDefault Count Sum Max Min SelectMany TakeWhile SkipWhile mapIt filterIt anyIt allIt countIt apply keepIf keepItIf fold foldl foldr reduce inject each_with_object partition group_by tally_by min_by max_by sum_by sort_by sort_by_key sort_by_cached_key position any? all? none? one? count_by take_while drop_while scan";

const ARRAY_METHODS: Record<string, BuiltinRule> = {
  ...table([
    ["push_back emplace_back push append pop_back pop back front first last at get set size length len empty isEmpty is_empty add top peek swap begin end rbegin rend cbegin cend capacity reserve clear set_len Add Peek Last First Get Set PeekBack PeekFront getFirst getLast setLen high low", r(one, { grows: false })],
    ["insert emplace erase remove pop_front shift unshift prepend insert_at delete_at splice Insert RemoveAt Remove delete deleteAt remove_item", r(S)],
    ["index indexOf lastIndexOf rindex find count includes contains Contains include? member? IndexOf LastIndexOf find_index position rposition binary_search_linear", r(S)],
    ["reverse reversed reverse! sum max min minmax join copy clone dup slice concat fill extend to_a to_vec to_owned ToList ToArray toList toSeq uniq uniq! unique distinct dedup flatten compact rotate rotate_left rotate_right swap_remove iota tolist resize assign Reverse Sum Max Min Distinct Concat Fill Clone clone_from_slice copy_from_slice cumsum prod product sample shuffle shuffle! transpose zip deduplicate cycle", r(S)],
    ["sort sort! sort_unstable sorted Sort sortedByIt sort_unstable_by sort_by! OrderBy OrderByDescending sorted! nth_element select_nth_unstable", r(SlogS, { cmpArg: 0 })],
    ["lower_bound upper_bound binary_search bsearch bsearch_index partition_point BinarySearch binarySearch lowerBound upperBound searchsortedfirst searchsortedlast", r(logS)],
  ]),
  ...table([[ITERATE, r(S, { loopArg: 0 })]]),
};
// 先頭への追加・削除・挿入は配列では O(N)
for (const n of ["append", "push", "push_back", "Add", "add", "emplace_back", "<<"]) ARRAY_METHODS[n] = r(one, { grows: true });
// Ruby の take(k) / drop(k) / first(k) / last(k) は k 個(引数が無ければ1)
for (const n of ["take", "first", "last"]) ARRAY_METHODS[n] = r((c) => (c.args[0] ? c.bound(c.args[0]) : ONE));
ARRAY_METHODS.drop = r(S);
ARRAY_METHODS.pop = r((c) => (c.args.length > 0 && !(c.args[0].kind === "un" && c.args[0].op === "-") && !(c.args[0].kind === "num" && c.args[0].value < 0) ? S(c) : ONE));
ARRAY_METHODS.extend = r(A(0), { grows: true });
ARRAY_METHODS.concat = r(S);
ARRAY_METHODS.resize = r(B(0), { alloc: B(0) });
ARRAY_METHODS.assign = r(B(0), { alloc: B(0) });
ARRAY_METHODS.reserve = r(one, { alloc: B(0) });

const ORDERED_METHODS: Record<string, BuiltinRule> = table([
  ["insert emplace erase find count contains lower_bound upper_bound at add remove discard get put containsKey containsValue floorKey ceilingKey higherKey lowerKey floor ceiling higher lower floorEntry ceilingEntry pollFirst pollLast pollFirstEntry pollLastEntry range range_mut Add Remove Contains ContainsKey TryGetValue bisect_left bisect_right bisect index irange islice Get GetViewBetween delete", r(logS)],
  ["begin rbegin end rend size empty first last firstKey lastKey first_key_value last_key_value len is_empty clear Count Min Max", r(one)],
  ["keys values items entries iter to_a", r(one)],
]);
for (const n of ["insert", "emplace", "add", "put", "Add", "set", "insert_or_assign", "try_emplace", "entry"]) ORDERED_METHODS[n] = r(logS, { grows: true });

const HASH_METHODS: Record<string, BuiltinRule> = table([
  ["insert emplace erase find count contains at add remove discard get put containsKey has delete Add Remove Contains ContainsKey TryGetValue getOrDefault get_or_insert entry or_insert setdefault pop key? has_key? hasKey getOrDefault mgetOrPut hasKeyOrPut del excl incl inc fetch dig store haskey get! delete! push! set", r(one, { conf: "medium", note: "ハッシュは平均 O(1)(最悪 O(N))" })],
  ["size empty len is_empty clear Count keys values items entries iter", r(one)],
]);
for (const n of ["insert", "emplace", "add", "put", "Add", "set", "setdefault", "entry", "incl", "inc", "store", "push!", "get!", "mgetOrPut", "hasKeyOrPut", "try_emplace", "insert_or_assign", "<<", "add?"]) HASH_METHODS[n] = r(one, { grows: true, conf: "medium" });
// Ruby の h.keys / h.values / h.to_a は配列を作る
for (const n of ["to_a", "sort_by", "min_by", "max_by", "sum", "count", "map", "select", "reject", "each", "each_pair", "each_key", "each_value", "sort", "group_by", "find", "any?", "all?"]) HASH_METHODS[n] = r(S, { loopArg: 0 });

const PQ_METHODS: Record<string, BuiltinRule> = table([
  ["push emplace pop add offer poll remove insert extract Enqueue Dequeue TryDequeue push_back pushpop replace del", r(logS)],
  ["top peek size empty len is_empty isEmpty Count Peek clear", r(one)],
]);
for (const n of ["push", "emplace", "add", "offer", "insert", "Enqueue", "push_back"]) PQ_METHODS[n] = r(logS, { grows: true });

const DEQUE_METHODS: Record<string, BuiltinRule> = table([
  ["push_back push_front pop_front pop_back append appendleft popleft pop push offer poll addFirst addLast pollFirst pollLast offerFirst offerLast removeFirst removeLast peekFirst peekLast front back enqueue dequeue shift unshift Enqueue Dequeue Peek size empty len is_empty isEmpty Count clear add remove element addLast popFirst popLast", r(one)],
  ["rotate", r(B(0))],
  ["index count contains remove_item", r(S)],
]);
for (const n of ["push_back", "push_front", "append", "appendleft", "push", "offer", "addFirst", "addLast", "offerFirst", "offerLast", "enqueue", "Enqueue", "add", "unshift"]) DEQUE_METHODS[n] = r(one, { grows: true });

const STRING_METHODS: Record<string, BuiltinRule> = table([
  ["find rfind replace split join count strip lstrip rstrip upper lower reverse reversed startswith endswith index rindex indexOf lastIndexOf contains includes starts_with ends_with trim chars bytes lines split_whitespace to_string to_owned substr substring slice repeat Replace Split Contains IndexOf Substring ToUpper ToLower Trim ToCharArray each_char gsub sub tr scan to_s capitalize swapcase center ljust rjust zfill format encode decode count_chars toCharArray charAt? toUpperCase toLowerCase", r(S)],
  ["size length len empty at back front push_back pop_back charAt [] Length is_empty append", r(one)],
]);
for (const n of ["push_back", "append", "push", "push_str", "Append", "add"]) STRING_METHODS[n] = r(one, { grows: true });
STRING_METHODS.substr = r((c) => (c.args.length >= 2 ? c.bound(c.args[1]) : S(c)));
// Python の "o".join(xs) は区切りではなく xs の要素数
STRING_METHODS.join = r((c) => (c.args.length >= 1 ? c.size(c.args[0]) : S(c)));
STRING_METHODS.sub = r(substr(0));
STRING_METHODS.substring = r((c) => (c.args.length >= 2 ? c.bound(c.args[1]) : S(c)));

const LINKED_METHODS: Record<string, BuiltinRule> = table([
  ["add push pop addFirst addLast removeFirst removeLast getFirst getLast push_front push_back pop_front pop_back front back size empty isEmpty peek poll offer", r(one)],
  ["get set remove indexOf contains insert", r(S)],
]);

/** ACL(AtCoder Library)のデータ構造。要素数は宣言の引数 */
const ACL_METHODS: Record<string, BuiltinRule> = table([
  ["set get prod apply add sum max_right min_left leader same merge", r(logS, { note: "ACL のデータ構造は log N(DSU は α(N))" })],
  ["all_prod size", r(one)],
  ["groups", r(S)],
  ["flow", r((c) => mul(S(c), S(c)), { conf: "low", warn: "最大流は O(N²M) になりえます。ここでは粗く見積もっています" })],
  ["scc satisfiable", r(S)],
  ["add_edge add_clause get_edge change_edge answer", r(one)],
  ["min_cut edges", r(S)],
]);

/** ACL の convolution(a, b): (|a| + |b|) log(|a| + |b|) */
const convolution = (c: CallCtx): Expr => {
  const xs = c.args.filter((a) => a.kind !== "num");
  const n = add(c.size(xs[0] ?? null), c.size(xs[1] ?? null));
  return mul(n, logOfExpr(n));
};

/** 受け手の種類が分からないときの既定 */
export const UNKNOWN_METHODS: Record<string, BuiltinRule> = {
  ...table([
    ["push_back emplace_back push append pop_back pop back front first last size length len empty isEmpty is_empty top peek get at add offer poll popleft appendleft push_front pop_front begin end clear << key? has_key? include_key?", r(one)],
    ["insert erase find count remove lower_bound upper_bound contains containsKey has discard delete", r(logS, { conf: "medium", warn: "型が分からないので set/map と仮定しました" })],
    ["lowerBound upperBound binarySearch bsearch bsearch_index searchsortedfirst searchsortedlast", r(logS)],
    ["sortedByIt sortedBy sorted", r(SlogS, { cmpArg: 0 })],
    ["sort sort! sorted sort_unstable Sort", r(SlogS, { cmpArg: 0 })],
    ["index indexOf reverse sum max min join copy includes include? Contains dup clone to_a uniq", r(S)],
  ]),
  ...table([[ITERATE, r(S, { loopArg: 0 })]]),
};
for (const n of ["push_back", "emplace_back", "push", "append", "add", "offer", "appendleft", "push_front", "insert", "<<"]) {
  UNKNOWN_METHODS[n] = { ...UNKNOWN_METHODS[n], grows: true };
}
// 文字列らしいメソッド(Lua の s:sub(i, i) / s:byte(i)、Ruby の s.sub(a, b))
UNKNOWN_METHODS.sub = r(substr(0));
UNKNOWN_METHODS.byte = r(one);
UNKNOWN_METHODS.char = r(one);
for (const n of ["gsub", "gmatch", "upper", "lower", "reverse", "rep", "format", "split", "strip", "rstrip", "lstrip", "replace", "splitlines", "startswith", "endswith"]) UNKNOWN_METHODS[n] = r(S);

export const METHODS: Partial<Record<ContainerKind, Record<string, BuiltinRule>>> = {
  array: ARRAY_METHODS,
  oset: ORDERED_METHODS,
  omap: ORDERED_METHODS,
  hset: HASH_METHODS,
  hmap: HASH_METHODS,
  pq: PQ_METHODS,
  deque: DEQUE_METHODS,
  stack: DEQUE_METHODS,
  string: STRING_METHODS,
  linkedlist: LINKED_METHODS,
  acl: ACL_METHODS,
};

// ---- 自由関数(言語の系統ごと) --------------------------------------------------------

export type FreeTable = "cpp" | "python" | "java" | "other" | "ruby" | "lua" | "julia" | "bash" | "nim" | "haskell" | "perl" | "php";

const CPP_FREE = table([
  ["sort stable_sort partial_sort sort_heap make_heap", r(RlogR, { cmpArg: 2 })],
  ["lower_bound upper_bound binary_search equal_range partition_point", r(logR)],
  ["reverse accumulate max_element min_element minmax_element fill count count_if find find_if find_if_not iota unique copy copy_if all_of any_of none_of for_each transform replace replace_if rotate inner_product partial_sum adjacent_difference exclusive_scan inclusive_scan merge is_sorted equal mismatch remove remove_if next_permutation prev_permutation shuffle random_shuffle generate set_union set_intersection set_difference set_symmetric_difference includes reduce is_permutation nth_element", r(R, { loopArg: 2 })],
  // memset(dp, -1, sizeof(dp)) はバイト数(第3引数)で数える。読めなければ第1引数の要素数
  ["memset memcpy memmove", r((c) => {
    const n = c.args[2] ? c.bound(c.args[2]) : null;
    return n && !vars(n).includes("?") ? n : c.size(c.args[0] ?? null);
  })],
  ["fill_n", r(B(1))],
  ["strlen", r(A(0))],
  ["gcd __gcd lcm", r((c) => logOfExpr(c.bound(c.args[1] ?? c.args[0] ?? null)), { conf: "medium" })],
  ["__builtin_popcount __builtin_popcountll __builtin_ctz __builtin_ctzll __builtin_clz __builtin_clzll popcount __lg bit_width countr_zero countl_zero abs llabs fabs swap min max pow sqrt sqrtl cbrt exp log log2 log10 floor ceil round to_string stoi stol stoll stoull stod atoi atol printf scanf puts getchar putchar exit assert make_pair make_tuple tie get setprecision fixed endl hypot atan2 sin cos tan", r(one)],
]);
CPP_FREE.nth_element = r(R);
for (const n of ["convolution", "convolution_ll", "convolution_int"]) CPP_FREE[n] = r(convolution);

const PY_FREE = table([
  ["sorted", r(AlogA(0), { cmpArg: 1 })],
  ["map filter", r((c) => c.size(c.args[1] ?? c.args[0] ?? null), { loopArg: 0 })],
  ["sum max min all any list tuple set frozenset dict reversed enumerate zip Counter accumulate deque bytearray defaultdict", r((c) => (c.args.length === 1 || (c.args.length >= 1 && c.args[0].kind === "lambda") ? c.size(c.args[c.args[0]?.kind === "lambda" ? 1 : 0] ?? null) : ONE), { loopArg: 0 })],
  ["len abs print input int float str ord chr divmod range bin hex oct round isinstance type id hash bool iter next open exit quit sqrt isqrt floor ceil log log2 log10 exp comb perm factorial setrecursionlimit", r(one)],
  ["gcd lcm", r((c) => logOfExpr(c.bound(c.args[1] ?? c.args[0] ?? null)), { conf: "medium" })],
  ["pow", r((c) => (c.args.length === 3 ? logOfExpr(c.bound(c.args[1])) : ONE))],
  ["heappush", r(logA(0), { grows: true })],
  // 1つ入れて1つ出すので大きさは変わらない
  ["heappushpop heapreplace", r(logA(0))],
  ["heappop", r(logA(0))],
  ["heapify nlargest nsmallest deepcopy copy", r(A(0))],
  ["bisect_left bisect_right bisect", r(logA(0))],
  ["insort insort_left insort_right", r(A(0), { grows: true })],
  ["permutations combinations product combinations_with_replacement groupby chain islice count cycle repeat", r(one)],
]);
for (const n of ["convolution", "convolution_int"]) PY_FREE[n] = r(convolution);

const JAVA_FREE = table([
  ["sort parallelSort", r(AlogA(0), { cmpArg: 1 })],
  ["binarySearch", r(logA(0))],
  ["fill asList reverse shuffle max min frequency copyOf copyOfRange stream toString deepToString sum addAll", r(A(0))],
  ["max min abs pow sqrt floor ceil log round parseInt parseLong parseDouble valueOf println print printf format exit gcd floorMod floorDiv toBinaryString bitCount", r(one)],
]);
JAVA_FREE.max = r(one);
JAVA_FREE.min = r(one);

const OTHER_FREE = table([
  ["Ints Strings Float64s Slice SliceStable Sort Stable", r(AlogA(0), { cmpArg: 1 })],
  ["Search SearchInts SearchStrings BinarySearch", r(logA(0))],
  ["copy Join Repeat Split Fields Reverse Sum Max Min Contains Index", r(A(0))],
  ["len cap delete append make print println Println Printf Print Sprintf Sprint Atoi Itoa ParseInt FormatInt max min abs parseInt parseFloat Number String Boolean isNaN WriteLine Write ReadLine Parse ToInt32 ToInt64 Abs Max Min Pow Sqrt Floor Ceiling Round swap writeln write writefln readln to text", r(one)],
]);
OTHER_FREE.append = r(one, { grows: true });
// Math.max(...a) は展開した配列の要素数ぶん
const spreadSize = (c: CallCtx): Expr => {
  const s = c.args.find((a) => a.kind === "un" && a.op === "*");
  return s && s.kind === "un" ? c.size(s.e) : ONE;
};
OTHER_FREE.max = r(spreadSize);
OTHER_FREE.min = r(spreadSize);
OTHER_FREE.Max = r(spreadSize);
OTHER_FREE.Min = r(spreadSize);

// Lua の table.* / string.* / math.*(名前空間を畳んだ後の名前で引く)
const LUA_FREE = table([
  ["sort", r(AlogA(0), { cmpArg: 1 })],
  ["concat unpack", r(A(0))],
  ["rep", r(B(1))],
  ["gsub find match gmatch reverse upper lower", r(A(0))],
  ["format tonumber tostring type print pairs ipairs select next rawget rawset rawlen assert error pcall xpcall setmetatable getmetatable floor ceil abs max min sqrt random randomseed fmod modf exp log pow write read lines byte char len tointeger", r(one)],
]);
// table.insert(t, x) は末尾に足す(1)。table.insert(t, pos, x) は途中に挿入(|t|)
LUA_FREE.insert = r((c) => (c.args.length >= 3 ? c.size(c.args[0] ?? null) : ONE), { grows: true });
LUA_FREE.remove = r((c) => (c.args.length >= 2 ? c.size(c.args[0] ?? null) : ONE));
LUA_FREE.sub = r(substr(1));

// Julia(map(f, a) / map(a) do x … end / sum(f, a) は最後のコレクションの引数を回す)
const lastColl = (c: CallCtx): Expr => {
  const xs = c.args.filter((a) => a.kind !== "lambda" && !(a.kind === "assign" && a.value?.kind === "lambda"));
  return c.size(xs[xs.length - 1] ?? null);
};
const JULIA_FREE = table([
  ["sort sort! sortperm sortperm! unique partialsort partialsort!", r(AlogA(0), { cmpArg: 1 })],
  ["searchsortedfirst searchsortedlast searchsorted insorted", r(logA(0))],
  ["map map! filter filter! foreach count sum prod maximum minimum any all findfirst findlast findall reduce mapreduce foldl foldr extrema argmax argmin accumulate cumsum cumprod mapfoldl mapfoldr", r(lastColl, { loopArg: 0 })],
  ["reverse reverse! copy deepcopy join split replace unique! collect fill! circshift vcat hcat union intersect setdiff symdiff enumerate zip lstrip rstrip strip uppercase lowercase", r(A(0))],
  ["pushfirst! popfirst! deleteat! splice! insert!", r(A(0))],
  ["pop! length size isempty first last lastindex firstindex haskey get delete! div mod rem gcd lcm abs floor ceil round trunc sqrt isqrt cbrt min max println print parse string typemax typemin zero one eltype keys values pairs ntuple rand randn exp log log2 log10 sin cos tan zeros ones fill falses trues similar Vector Matrix Array Dict Set Int Int64 Float64 Char tuple repr show isdigit isletter isspace sizehint!", r(one)],
  ["powermod digits ndigits bitstring", r((c) => logOfExpr(c.bound(c.args[c.args.length - 1] ?? null)))],
]);
JULIA_FREE["push!"] = r(one, { grows: true });
JULIA_FREE["append!"] = r(A(1), { grows: true });
JULIA_FREE["get!"] = r(one, { grows: true });
JULIA_FREE.occursin = r(A(1));
JULIA_FREE.in = r(A(1));

// Bash(canonBash が作る呼び出し: パイプの sort / フィルタ / head、コマンド置換の中の外部コマンド)
const BASH_FREE = table([
  ["sort", r(AlogA(0))],
  ["scan_words replace", r(A(0))],
  ["head echo printf read readarray read_all len substr date bc expr test true false", r(one)],
]);

// PHP
/** max(...$a) / max($a) は配列の要素数、max($x, $y) は1 */
const maxMin = (c: CallCtx): Expr => {
  const s = c.args.find((a) => a.kind === "un" && a.op === "*");
  if (s && s.kind === "un") return c.size(s.e);
  return c.args.length === 1 ? c.size(c.args[0]) : ONE;
};
const PHP_FREE = table([
  ["sort rsort asort arsort ksort krsort natsort natcasesort array_multisort", r(AlogA(0))],
  ["usort uasort uksort", r(AlogA(0), { cmpArg: 1 })],
  ["array_sum array_product array_keys array_values array_flip array_reverse array_merge array_slice array_unique array_count_values array_column array_fill_keys array_diff array_diff_key array_intersect array_intersect_key array_combine array_pad array_chunk shuffle str_split array_filter array_walk array_reduce iterator_to_array strrev strtolower strtoupper str_replace preg_replace preg_match_all json_encode array_shift array_unshift array_splice", r(A(0), { loopArg: 1 })],
  ["in_array array_search implode join explode preg_split strpos stripos strrpos str_contains str_starts_with str_ends_with substr_count", r(A(1))],
  ["range str_repeat", r(B(1))],
  ["array_fill count sizeof strlen mb_strlen isset empty unset array_key_exists key_exists array_pop array_key_first array_key_last intval floatval strval boolval intdiv abs floor ceil round sqrt pow mt_rand rand random_int ord chr substr sprintf printf fwrite fputs number_format trim rtrim ltrim fgets fscanf sscanf readline is_numeric is_array is_int gettype var_dump print_r str_pad fopen fclose gmp_add gmp_mul gmp_mod bcadd bcmul bcmod", r(one)],
]);
PHP_FREE.array_map = r(lastColl, { loopArg: 0 });
PHP_FREE.array_push = r(one, { grows: true });
PHP_FREE.max = r(maxMin);
PHP_FREE.min = r(maxMin);

// Perl(sort { … } @a / map { … } @a / grep { … } @a はブロックを先に、リストを最後に書く)
const lastCollLog = (c: CallCtx): Expr => {
  const s = lastColl(c);
  return mul(s, logOfExpr(s));
};
const PERL_FREE = table([
  ["sort", r(lastCollLog, { cmpArg: 0 })],
  ["map grep first any all none sum sum0 max min maxstr minstr uniq shuffle reduce pairs", r(lastColl, { loopArg: 0 })],
  ["reverse join keys values", r(lastColl)],
  ["splice unshift", r(A(0))],
  ["index rindex lc uc", r(A(0))],
  ["pop shift scalar length exists delete defined abs int sqrt ord chr sprintf printf print say chomp chop die warn substr ref bless open close each wantarray exit", r(one)],
]);
PERL_FREE.push = r(one, { grows: true });

// Haskell(関数は最後の引数がリスト: map f xs / foldl' f z xs / elem x xs)
/** Map / Set の操作は log(要素数)。畳み込みの途中の map(foldl' の acc)は大きさが分からないので主記号の log */
const logMain = (): Expr => logOfExpr([{ coef: 1, factors: [{ v: "?", pow: 1, log: 0, exp: 0, fact: 0 }] }]);
const HASKELL_FREE = table([
  ["sort sortBy sortOn M.fromList M.fromListWith S.fromList", r(lastCollLog, { cmpArg: 0 })],
  ["map filter foldl foldl' foldr foldl1 foldr1 sum product length maximum minimum maximumBy minimumBy reverse concat concatMap and or any all scanl scanl' scanr takeWhile dropWhile span break partition zip zip3 zipWith zipWith3 unzip group groupBy lookup elem notElem !! words lines unwords unlines mapMaybe catMaybes M.toList M.elems M.keys M.toAscList M.foldr M.foldl M.foldrWithKey M.map M.filter M.union M.unionWith S.toList S.elems S.union V.fromList V.toList V.map V.sum V.maximum A.elems A.assocs listArray accumArray elems assocs BS.words BS.lines transpose isPrefixOf isSuffixOf", r(lastColl, { loopArg: 0 })],
  ["length", r(lastColl)],
  ["nub nubBy \\\\ isInfixOf union intersect", r((c) => {
    const s = lastColl(c);
    return mul(s, s);
  }, { warn: "nub / \\ / isInfixOf はリストの長さの2乗の時間です" })],
  ["++ !!", r(A(0))],
  ["take drop splitAt replicate V.replicate V.generate newArray newListArray", r(B(0))],
  ["M.insert M.insertWith M.lookup M.member M.notMember M.findWithDefault M.adjust M.alter M.update M.delete M.lookupMin M.lookupMax M.findMin M.findMax M.deleteMin M.deleteMax M.lookupLT M.lookupGT M.lookupLE M.lookupGE M.split M.elemAt S.insert S.member S.notMember S.delete S.findMin S.findMax S.deleteMin S.deleteMax S.lookupLT S.lookupGT S.lookupLE S.lookupGE S.split", r(logMain)],
  ["print putStrLn putStr show read fromIntegral toInteger fromEnum toEnum fst snd head last tail init null abs max min gcd lcm div mod quot rem even odd not succ pred cons fromJust fromMaybe maybe either id const flip when unless return pure mempty M.size M.empty M.singleton M.null S.size S.empty S.singleton S.null V.length V.head V.last readArray writeArray modifyArray unsafeRead unsafeWrite bounds BS.readInt BS.pack BS.unpack runST runSTUArray runSTArray newSTRef readSTRef writeSTRef modifySTRef modifySTRef' newIORef readIORef writeIORef modifyIORef modifyIORef' replicateM iterate cycle repeat seq", r(one)],
]);
HASKELL_FREE.permutations = r((c) => {
  const s = lastColl(c);
  return s;
}, { warn: "permutations はリストの長さの階乗の個数を作ります" });

/** 8言語の表は langs/*.ts から登録する(循環を避けるため後から入れる) */
export const FREE: Record<FreeTable, Record<string, BuiltinRule>> = {
  cpp: CPP_FREE,
  python: PY_FREE,
  java: JAVA_FREE,
  other: OTHER_FREE,
  ruby: {},
  lua: LUA_FREE,
  julia: JULIA_FREE,
  bash: BASH_FREE,
  nim: {},
  haskell: HASKELL_FREE,
  perl: PERL_FREE,
  php: PHP_FREE,
};

/** 言語 → 自由関数の表(19キー) */
export const TABLE_OF: Record<string, FreeTable> = {
  cpp: "cpp",
  c: "cpp",
  python: "python",
  pypy: "python",
  java: "java",
  csharp: "other",
  rust: "other",
  go: "other",
  js: "other",
  ts: "other",
  d: "other",
  ruby: "ruby",
  lua: "lua",
  julia: "julia",
  bash: "bash",
  nim: "nim",
  haskell: "haskell",
  perl: "perl",
  php: "php",
};

export function lookupMethod(kind: ContainerKind, name: string): BuiltinRule | null {
  const t = METHODS[kind];
  if (t && t[name]) return t[name];
  if (kind === "unknown" || kind === "user" || kind === "scalar") return UNKNOWN_METHODS[name] ?? null;
  return null;
}

export function lookupFree(lang: string, name: string): BuiltinRule | null {
  const t = FREE[TABLE_OF[lang] ?? "other"];
  return t[name] ?? null;
}

export const COST_PARTS = { one, S, SlogS, logS, A, AlogA, logA, R, RlogR, logR, B, logB, r, table };
