// AtCoderの問題を「問題名」で引くための正規化・検索・並び替え。
// 問題一覧(getProblems)はスナップショット由来で9千件ほど。全件を素直に
// 走査しても1ms未満なので、転置インデックスのような仕掛けは持たない。
import type { LinkedProblem, Problem } from "./types";

export interface SearchIndex {
  problems: Problem[];
  /** 正規化済みの問題名(problemsと同じ添字) */
  keys: string[];
  /** 表示順の序数。小さいほど上に出す(problemsと同じ添字) */
  order: number[];
  /** 一覧に出てくるコンテストID全部(連携先の決定に使う) */
  contests: Set<string>;
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

export function buildIndex(problems: Problem[]): SearchIndex {
  return {
    problems,
    keys: problems.map((p) => foldText(p.name)),
    order: problems.map((p) => orderOf(p.contest_id)),
    contests: new Set(problems.map((p) => p.contest_id)),
  };
}

/**
 * 問題を「連携中の問題」に変換する。
 *
 * kenkooooのcontest_idは、同じ問題が後から常設のトレーニングコンテストに
 * 再利用されるとそちら側になることがある(abc212_a → adt_easy_20260819_1)。
 * AtCoderの問題IDは「コンテストID_記号」なので、接頭辞が実在するコンテストなら
 * 元のコンテストとして扱う。提出ページもそちらの方が素直に開ける。
 */
export function toLinked(p: Problem, contests: Set<string>): LinkedProblem {
  const i = p.id.lastIndexOf("_");
  const prefix = i > 0 ? p.id.slice(0, i) : "";
  const contest =
    prefix && prefix !== p.contest_id && contests.has(prefix)
      ? prefix
      : p.contest_id;
  return { contest, task: p.id, title: p.title };
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
  hits.sort(
    (a, b) =>
      a.rank - b.rank ||
      ix.order[a.i] - ix.order[b.i] ||
      ix.problems[a.i].id.localeCompare(ix.problems[b.i].id),
  );
  return hits.slice(0, limit).map((h) => ix.problems[h.i]);
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
