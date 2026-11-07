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

/** 解ける度合いの区分。確率がこの下限以上の問題を入れる(これより低い問題は出さない) */
export const LEVELS = [
  { min: 0.8, label: "ほぼ毎回解ける", short: "ほぼ毎回" },
  { min: 0.35, label: "2回に1回くらい", short: "2回に1回" },
  { min: 0.1, label: "たまに解ける", short: "たまに" },
] as const;

export interface ChanceGroup {
  label: string;
  short: string;
  letters: string[];
}

/**
 * 問題を解ける度合いで分ける。例(パフォ 433): ほぼ毎回解ける A・B / 2回に1回くらい C / たまに解ける D。
 * 空の区分は出さない。10% 未満の問題はどこにも入れない
 */
export function groupChances(chances: readonly LetterChance[]): ChanceGroup[] {
  const out: ChanceGroup[] = [];
  for (let i = 0; i < LEVELS.length; i++) {
    const { min, label, short } = LEVELS[i];
    const max = i === 0 ? Infinity : LEVELS[i - 1].min;
    const letters = chances.filter((c) => c.p >= min && c.p < max).map((c) => c.letter);
    if (letters.length > 0) out.push({ label, short, letters });
  }
  return out;
}
