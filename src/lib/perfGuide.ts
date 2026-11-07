// パフォーマンスの目安: 「このパフォなら、最近の ABC の各問題をどれくらい解けるか」。
// レート予測(RatingEstimator)で、パフォの数字だけでは分かりにくいのを言い換えるのに使う。
//
// AtCoder Problems の難易度(problem-models.json の difficulty / discrimination)は、
// 「そのくらいの実力の人がコンテスト中に解ける確率」の 2PL ロジスティックモデル(irt.ts と同じ)。
// パフォを実力 θ とみなして、最近の ABC の A〜G ごとに解ける確率を平均する。
// 実際のパフォは解いた問題の数に加えて早さやペナルティでも変わるので、あくまで目安。
import { solveProbability } from "./irt.ts";
import type { ProblemModels } from "./types.ts";

export const ABC_LETTERS = ["A", "B", "C", "D", "E", "F", "G"] as const;
/** 平均を取る最近の ABC の回数 */
export const RECENT_ABC_COUNT = 20;

interface Item {
  b: number;
  a: number;
}

/** 記号(A〜G)ごとの、最近の ABC の問題の難易度モデル */
export interface AbcTable {
  /** 使った ABC の番号の範囲(ABC464〜483 のように出す) */
  from: number;
  to: number;
  byLetter: Map<string, Item[]>;
}

/**
 * 最近の ABC(A〜G の7問の回)を新しい順に count 回選び、記号ごとに難易度モデルを集める。
 * 難易度がまだ仮(is_experimental)の回は飛ばす。足りなければ null
 */
export function recentAbcTable(models: ProblemModels, count = RECENT_ABC_COUNT): AbcTable | null {
  const nums = new Set<number>();
  for (const id of Object.keys(models)) {
    const m = /^abc(\d+)_g$/.exec(id);
    if (m) nums.add(Number(m[1]));
  }
  const byLetter = new Map<string, Item[]>(ABC_LETTERS.map((l) => [l, []]));
  const used: number[] = [];
  for (const n of [...nums].sort((a, b) => b - a)) {
    const items = ABC_LETTERS.map((l) => models[`abc${n}_${l.toLowerCase()}`]);
    if (items.some((m) => !m || m.difficulty === undefined || m.discrimination === undefined || m.is_experimental)) continue;
    items.forEach((m, i) => byLetter.get(ABC_LETTERS[i])!.push({ b: m!.difficulty!, a: m!.discrimination! }));
    used.push(n);
    if (used.length >= count) break;
  }
  if (used.length < Math.min(5, count)) return null;
  return { from: Math.min(...used), to: Math.max(...used), byLetter };
}

export interface LetterChance {
  letter: string;
  /** 解ける確率(0〜1) */
  p: number;
}

/** パフォ perf の人が、最近の ABC の各記号の問題を解ける確率(平均) */
export function solveChances(table: AbcTable, perf: number): LetterChance[] {
  return ABC_LETTERS.map((letter) => {
    const items = table.byLetter.get(letter) ?? [];
    const p = items.reduce((s, it) => s + solveProbability(perf, it.b, it.a), 0) / Math.max(1, items.length);
    return { letter, p };
  });
}

/** 「ほぼ解ける」とみなす確率 */
const SOLID = 0.8;

/**
 * 確率を一言にする。例: 「C までほぼ解けて、D が半々くらい」
 * ほぼ解ける(80% 以上)いちばん後ろの記号と、その次の記号の確率で言い分ける
 */
export function describeChances(chances: readonly LetterChance[]): string {
  let last = -1;
  while (last + 1 < chances.length && chances[last + 1].p >= SOLID) last++;
  if (last === chances.length - 1) return `${chances[last].letter} までほぼ解けるくらい`;
  const next = chances[last + 1];
  const tail =
    next.p >= 0.6
      ? `${next.letter} も解けることが多い`
      : next.p >= 0.35
        ? `${next.letter} が半々くらい`
        : next.p >= 0.15
          ? `${next.letter} はときどき解ける`
          : `${next.letter} はまだ難しい`;
  if (last < 0) return next.p >= 0.35 ? `${next.letter} が解けるかどうかくらい` : `${next.letter} もまだ難しいくらい`;
  return `${chances[last].letter} までほぼ解けて、${tail}`;
}
