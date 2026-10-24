export interface Submission {
  id: number;
  epoch_second: number;
  problem_id: string;
  contest_id: string;
  user_id: string;
  language: string;
  point: number;
  length: number;
  result: string;
  execution_time: number | null;
}

export interface Problem {
  id: string;
  contest_id: string;
  problem_index: string;
  name: string;
  title: string;
}

/** エディターに連携中のAtCoder問題 */
export interface LinkedProblem {
  contest: string;
  task: string;
  title?: string;
}

/** kenkoooo problem-models.json の1エントリ。難易度推定がない問題はフィールド欠落 */
export interface ProblemModel {
  slope?: number;
  intercept?: number;
  variance?: number;
  difficulty?: number;
  discrimination?: number;
  irt_loglikelihood?: number;
  irt_users?: number;
  is_experimental?: boolean;
}

export type ProblemModels = Record<string, ProblemModel>;

export interface Member {
  id: string;
  name: string;
}

/** 公式レーティング履歴の1点(レート付きコンテスト) */
export interface RatePoint {
  /** コンテスト終了時刻(epoch秒) */
  t: number;
  /** その時点の NewRating */
  r: number;
}

/** 予定されているコンテスト(ホームの「次のABC」表示用) */
export interface UpcomingContest {
  /** コンテストID(例: abc468) */
  id: string;
  /** コンテスト名 */
  title: string;
  /** 開始時刻(epoch秒) */
  start: number;
  /** 長さ(秒)。atcoder.jp の表から読めなかったときは無い */
  duration?: number;
  /** Rated 対象(例: "- 1999", "All", "-") */
  rate?: string;
}

/** コンテストの問題(記号順に並べて持つ) */
export interface ContestProblem {
  /** 問題ID(例: abc481_a) */
  id: string;
  /** 記号(例: A, Ex) */
  index: string;
}

/** コンテストタブで選べるコンテスト(スナップショットの contests.json の1件) */
export interface ClubContest {
  /** コンテストID(例: abc481) */
  id: string;
  title: string;
  /** 開始時刻(epoch秒) */
  start: number;
  /** 長さ(秒) */
  duration: number;
  /** Rated 対象(例: "~ 1999", "All", "-") */
  rate: string;
  /** スナップショットを作った時点で参加していた部員の数(時間内に提出した人と、公式成績がある人) */
  joined: number;
  /** 問題(記号順)。開始の直後などでまだ分からないときは空 */
  problems: ContestProblem[];
}

/** 公式の成績(atcoder.jp のコンテスト参加履歴の1行) */
export interface OfficialResult {
  /** AtCoder 全体での順位 */
  place: number;
  /** パフォーマンス(Unrated の参加は 0) */
  perf: number;
  oldRating: number;
  newRating: number;
  rated: boolean;
}

/** 公式成績: { コンテストID: { 部員ID(小文字): 成績 } } */
export type OfficialResults = Record<string, Record<string, OfficialResult>>;

/** kenkoooo resources/contests.json の1件 */
export interface KenkooooContest {
  id: string;
  start_epoch_second: number;
  duration_second: number;
  title: string;
  rate_change: string;
}

/** kenkoooo resources/contest-problem.json の1件 */
export interface KenkooooContestProblem {
  contest_id: string;
  problem_id: string;
  problem_index: string;
}
