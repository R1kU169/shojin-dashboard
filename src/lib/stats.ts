import type { Submission, ProblemModels } from "./types";
import { clipDifficulty, tierIndex } from "./colors.ts";

const JST_OFFSET = 9 * 3600;

/** epoch秒 → JSTの日番号(1970-01-01からの日数) */
export function jstEpochDay(epochSecond: number): number {
  return Math.floor((epochSecond + JST_OFFSET) / 86400);
}

export function epochDayToDateStr(epochDay: number): string {
  return new Date(epochDay * 86400 * 1000).toISOString().slice(0, 10);
}

export function todayEpochDay(): number {
  return jstEpochDay(Math.floor(Date.now() / 1000));
}

export interface UserStats {
  totalAc: number;
  weeklyAc: number; // 直近7日(今日含む)の新規AC
  currentStreak: number;
  longestStreak: number;
  /** JST日番号 → その日の新規AC数 */
  dailyNewAc: Map<number, number>;
  /** 帯(灰..赤)ごとのAC数。難易度推定のない問題は含まない */
  tierCounts: number[];
  /** 週次の累計AC推移 */
  cumulative: { date: string; total: number }[];
  solved: Set<string>;
  attemptedNoAc: Set<string>;
}

export function computeStats(
  subs: Submission[],
  models: ProblemModels,
): UserStats {
  // 初AC時刻(subsはepoch昇順ソート済み)
  const firstAc = new Map<string, number>();
  const attempted = new Set<string>();
  for (const s of subs) {
    attempted.add(s.problem_id);
    if (s.result === "AC" && !firstAc.has(s.problem_id)) {
      firstAc.set(s.problem_id, s.epoch_second);
    }
  }
  const solved = new Set(firstAc.keys());
  const attemptedNoAc = new Set(
    [...attempted].filter((p) => !solved.has(p)),
  );

  const dailyNewAc = new Map<number, number>();
  for (const epoch of firstAc.values()) {
    const day = jstEpochDay(epoch);
    dailyNewAc.set(day, (dailyNewAc.get(day) ?? 0) + 1);
  }

  const today = todayEpochDay();
  let weeklyAc = 0;
  for (let d = today - 6; d <= today; d++) weeklyAc += dailyNewAc.get(d) ?? 0;

  // ストリーク: 新規ACのあった連続日数。今日まだACがなくても昨日まで続いていれば継続扱い
  const days = [...dailyNewAc.keys()].sort((a, b) => a - b);
  let longestStreak = 0;
  let run = 0;
  let prev = Number.NEGATIVE_INFINITY;
  for (const d of days) {
    run = d === prev + 1 ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
    prev = d;
  }
  let currentStreak = 0;
  let cursor = dailyNewAc.has(today) ? today : today - 1;
  while (dailyNewAc.has(cursor)) {
    currentStreak++;
    cursor--;
  }

  // 帯別AC数
  const tierCounts = new Array<number>(8).fill(0);
  for (const pid of solved) {
    const d = models[pid]?.difficulty;
    if (d === undefined) continue;
    tierCounts[tierIndex(clipDifficulty(d))]++;
  }

  // 週次累計(月曜始まり)
  const cumulative: { date: string; total: number }[] = [];
  const acEpochs = [...firstAc.values()].sort((a, b) => a - b);
  if (acEpochs.length > 0) {
    const mondayOf = (day: number) => day - ((day + 3) % 7); // 1970-01-01は木曜
    const firstWeek = mondayOf(jstEpochDay(acEpochs[0]));
    const lastWeek = mondayOf(today);
    let i = 0;
    let total = 0;
    for (let w = firstWeek; w <= lastWeek; w += 7) {
      while (i < acEpochs.length && jstEpochDay(acEpochs[i]) < w + 7) {
        total++;
        i++;
      }
      cumulative.push({ date: epochDayToDateStr(w), total });
    }
  }

  return {
    totalAc: solved.size,
    weeklyAc,
    currentStreak,
    longestStreak,
    dailyNewAc,
    tierCounts,
    cumulative,
    solved,
    attemptedNoAc,
  };
}
