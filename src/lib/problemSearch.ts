// AtCoderの問題を「問題名」で引くための正規化・検索・並び替え。
// 問題一覧(getProblems)はスナップショット由来で9千件ほど。全件を素直に
// 走査しても1ms未満なので、転置インデックスのような仕掛けは持たない。
import type { LinkedProblem, Problem } from "./types";

/** 1コンテスト分の問題(章立て順に整列済み) */
export interface ContestGroup {
  /** 表示・リンクに使うコンテストID(解決後)。例: APG4b */
  id: string;
  /** 章立て順。ix.problems の要素を参照しているので書き換えないこと */
  problems: Problem[];
}

export interface SearchIndex {
  problems: Problem[];
  /** 正規化済みの問題名(problemsと同じ添字) */
  keys: string[];
  /** 表示順の序数。小さいほど上に出す(problemsと同じ添字) */
  order: number[];
  /** 一覧に出てくるコンテストID全部(連携先の決定に使う) */
  contests: Set<string>;
  /** 正規化したコンテストID → そのコンテストの問題。教材コンテストの目次に使う */
  byContest: Map<string, ContestGroup>;
  /** 正規化した問題記号 → problemsの添字。EX21のような数字入りだけ登録する */
  byIndex: Map<string, number[]>;
}

/**
 * 検索用に文字列を畳む。NFKC(全角英数→半角・半角カナ→全角) → 小文字化 →
 * カタカナ→ひらがな の順。
 *
 * 3つ目が要るのは、IMEで変換する前のひらがなのままカタカナの問題名を
 * 引けるようにするため(「びじゅあらいざ」→「ビジュアライザ」)。
 * 長音符(ー)は両側で同じ文字なので変換対象から外している。
 */
export function foldText(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0x60),
    );
}

const SERIES = ["abc", "arc", "agc", "ahc"];

// abc/arc/agc/ahc は回数が大きいほど新しいので、新しい方を上に出す。
// それ以外のコンテストは日付が分からないのでまとめて後ろへ。
// 正確な開催日時のために contests.json を新たに取りに行くほどの価値はない。
function orderOf(contestId: string): number {
  const m = /^(abc|arc|agc|ahc)(\d+)$/.exec(contestId);
  return m ? SERIES.indexOf(m[1]) * 1e6 - Number(m[2]) : 1e7;
}

/**
 * その問題が本来属するコンテストID。
 *
 * kenkooooのcontest_idは、同じ問題が後から常設のトレーニングコンテストに
 * 再利用されるとそちら側になることがある(abc212_a → adt_easy_20260819_1)。
 * AtCoderの問題IDは「コンテストID_記号」なので、接頭辞が実在するコンテストなら
 * 元のコンテストとして扱う。提出ページもそちらの方が素直に開ける。
 */
function hostOf(p: Problem, contests: Set<string>): string {
  const i = p.id.lastIndexOf("_");
  const prefix = i > 0 ? p.id.slice(0, i) : "";
  return prefix && prefix !== p.contest_id && contests.has(prefix)
    ? prefix
    : p.contest_id;
}

/**
 * 表示・整列に使う問題記号。
 *
 * 再掲載された問題の problem_index は再掲載先でふられた記号になっている
 * (abc300_a の index が "B")。そのままコンテストを並べると abc300 が
 * 「B D E G G H I Ex」と重複つきで壊れるので、問題IDの末尾から作り直す。
 */
function indexOf(p: Problem, host: string): string {
  return host === p.contest_id
    ? p.problem_index
    : p.id.slice(host.length + 1).toUpperCase();
}

/** 検索結果の行に出す問題記号 */
export function indexLabel(p: Problem, contests: Set<string>): string {
  return indexOf(p, hostOf(p, contests));
}

/**
 * 問題記号を章立て順に並べる。桁数の少ない方が先、同じ桁数なら辞書順。
 * A..Z → AA..AJ → AP1..AP4 → EX1..EX9 → EX10..EX26 の順になる
 * (辞書順だけだと EX10 が EX2 より前に来てしまう)。
 */
function byChapter(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}

export function buildIndex(problems: Problem[]): SearchIndex {
  const contests = new Set(problems.map((p) => p.contest_id));
  const keys: string[] = [];
  const order: number[] = [];
  const sortKeys: string[] = []; // 記号の整列キー。索引には残さない
  const rows = new Map<string, number[]>(); // 正規化コンテストID → 添字
  const hostId = new Map<string, string>(); // 正規化 → 表示用の生ID
  const byIndex = new Map<string, number[]>();

  for (let i = 0; i < problems.length; i++) {
    const p = problems[i];
    keys.push(foldText(p.name));
    const host = hostOf(p, contests);
    // 生のcontest_idではなく解決後で引く。再掲載されたABC/ARCが
    // 「表示はabc212なのに並びは不明扱い」になるのを防ぐ
    order.push(orderOf(host));
    const label = indexOf(p, host);
    sortKeys.push(label.toUpperCase());
    const k = foldText(host);
    let list = rows.get(k);
    if (!list) {
      rows.set(k, (list = []));
      hostId.set(k, host);
    }
    list.push(i);
    // "EX21"/"A01"/"090" のような記号だけ引けるようにする。
    // "A" や "Ex" は数千件に当たってノイズになるので、2文字以上かつ数字入りに限る
    if (label.length >= 2 && /\d/.test(label)) {
      const ik = foldText(label);
      const at = byIndex.get(ik);
      if (at) at.push(i);
      else byIndex.set(ik, [i]);
    }
  }

  const byContest = new Map<string, ContestGroup>();
  for (const [k, list] of rows) {
    list.sort(
      (a, b) =>
        byChapter(sortKeys[a], sortKeys[b]) ||
        (problems[a].id < problems[b].id ? -1 : 1),
    );
    byContest.set(k, {
      id: hostId.get(k) as string,
      problems: list.map((i) => problems[i]),
    });
  }
  return { problems, keys, order, contests, byContest, byIndex };
}

/** 問題を「連携中の問題」に変換する。連携先は hostOf の解決に従う。 */
export function toLinked(p: Problem, contests: Set<string>): LinkedProblem {
  const host = hostOf(p, contests);
  // 再掲載された問題のtitleも再掲載先の記号入りなので(abc300_a が "B. …")、
  // 記号を振り直して表示のちぐはぐを防ぐ
  const title =
    host === p.contest_id ? p.title : `${indexOf(p, host)}. ${p.name}`;
  return { contest: host, task: p.id, title };
}

// 語頭とみなす区切り。「伝説の団子職人 (Legendary Dango Maker)」のような
// 日英併記の問題名で、英語側の先頭にも語頭一致の順位を与えるために使う。
const BOUNDARY = /[\s(（「『[\-_.,:;/]/;

/**
 * 検索する意味のある長さか。ASCIIは2文字以上を要求する
 * (1文字だと "a" だけで5千件以上ヒットしてノイズにしかならない)。
 * 漢字・かなは1文字でも十分絞れるので許可する。
 */
export function isSearchable(query: string): boolean {
  const q = query.trim();
  return q.length >= 2 || (q.length === 1 && /[^\x20-\x7e]/.test(q));
}

/**
 * 問題名の部分一致で検索する。前方一致 → 語頭一致 → 部分一致の順に並べ、
 * 同順位はコンテストの新しい順、最後はIDで決定的にする。
 *
 * 照合は indexOf なのでクエリの正規表現エスケープは不要
 * (利用者が "(" や ".*" を打っても素直にその文字列として扱われる)。
 */
export function searchProblems(
  ix: SearchIndex,
  query: string,
  limit: number,
): Problem[] {
  if (!isSearchable(query)) return [];
  const q = foldText(query.trim());
  const hits: { i: number; rank: number }[] = [];
  for (let i = 0; i < ix.keys.length; i++) {
    const at = ix.keys[i].indexOf(q);
    if (at < 0) continue;
    const rank = at === 0 ? 0 : BOUNDARY.test(ix.keys[i][at - 1]) ? 1 : 2;
    hits.push({ i, rank });
  }
  // "EX21" のような問題記号でも引けるようにする。問題名の一致より後ろに置く
  const byIdx = ix.byIndex.get(q);
  if (byIdx) {
    const seen = new Set(hits.map((h) => h.i));
    for (const i of byIdx) if (!seen.has(i)) hits.push({ i, rank: 3 });
  }
  hits.sort(
    (a, b) =>
      a.rank - b.rank ||
      ix.order[a.i] - ix.order[b.i] ||
      ix.problems[a.i].id.localeCompare(ix.problems[b.i].id),
  );
  return hits.slice(0, limit).map((h) => ix.problems[h.i]);
}

/** 一度に出すコンテスト数の上限。apg4b → APG4b + APG4bPython が実例 */
const MAX_CONTESTS = 4;
/** 接頭一致に要る最短の長さ。完全一致(dpなど)はこの制限を受けない */
const MIN_CONTEST_PREFIX = 3;

/**
 * コンテストIDで問題一覧(目次)を引く。APG4bのような教材コンテストは
 * 練習問題の名前が「3.06」のような節番号だけで名前検索が効かないため、
 * コンテスト単位で章立て順に並べたものを出す。
 *
 * "abc" のような接頭辞は471コンテスト2850問に当たって目次にならないので、
 * 当たるコンテストが多すぎるときは何も返さない。
 */
export function searchContests(
  ix: SearchIndex,
  query: string,
  allowPrefix = true,
): ContestGroup[] {
  if (!isSearchable(query)) return [];
  const q = foldText(query.trim());
  const exact = ix.byContest.get(q);
  if (!allowPrefix || q.length < MIN_CONTEST_PREFIX) return exact ? [exact] : [];
  const keys: string[] = [];
  for (const k of ix.byContest.keys()) if (k.startsWith(q)) keys.push(k);
  if (keys.length > MAX_CONTESTS) return exact ? [exact] : [];
  // 完全一致を先頭に、あとは短い順。apg4b なら APG4b → APG4bPython の順になり、
  // ほぼ同名の行が交互に並ぶのを防げる
  keys.sort(
    (a, b) =>
      (a === q ? 0 : 1) - (b === q ? 0 : 1) ||
      a.length - b.length ||
      (a < b ? -1 : 1),
  );
  return keys.map((k) => ix.byContest.get(k) as ContestGroup);
}

/**
 * 問題IDで引く。kenkooooのIDは大文字を含むことがある(APG4b_a など)ので
 * 大小を無視して比べる。返すのは見つかった Problem 自身で、
 * リンクにはその生のIDを使うこと(AtCoderのタスク名は大小を区別する)。
 */
export function findById(problems: Problem[], id: string): Problem | undefined {
  const q = id.trim().toLowerCase();
  return problems.find((p) => p.id.toLowerCase() === q);
}

/** 問題URL(atcoder.jp/contests/x/tasks/y)からコンテストIDと問題IDを取り出す */
export function parseProblemUrl(s: string): LinkedProblem | null {
  const m = s.match(/atcoder\.jp\/contests\/([\w-]+)\/tasks\/([\w-]+)/);
  return m ? { contest: m[1], task: m[2] } : null;
}

/**
 * 問題IDらしき文字列(abc467_b / code_festival_2017_qualb_a など)。
 * コンテストIDは問題IDから機械的には決まらない(例: 問題 arc058_a はコンテスト
 * abc042 にもある)ので、ここでは形だけ判定し、実際の対応は問題一覧で引く。
 */
export const PROBLEM_ID = /^[a-z0-9_]+_[a-z0-9]+$/i;
