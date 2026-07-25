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
}
