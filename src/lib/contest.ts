import type {
  ClubContest,
  ContestProblem,
  KenkooooContest,
  KenkooooContestProblem,
  OfficialResult,
  OfficialResults,
  Submission,
} from "./types.ts";

// コンテストタブ(部員のコンテスト結果)の計算。React に依存しない純粋関数だけを置き、
// ブラウザ(ContestPage)とスナップショット作成(scripts/build-snapshot.mjs)の両方から使う。
// build-snapshot.mjs は Node の型ストリップでこのファイルを直接読むので、値の import はしない(型だけ)。

const DAY_SEC = 24 * 60 * 60;
/** 誤答1回ぶんのペナルティ(ABC・ARC・AGC は5分) */
export const PENALTY_SEC = 5 * 60;
/** コンテストタブで選べるのは、開始がこの日数以内のもの */
export const CONTEST_WINDOW_DAYS = 365;
/** これより長いもの(常設コンテスト・長期のマラソン)は順位表の形にならないので載せない */
const MAX_DURATION_SEC = 5 * 60 * 60;

/** "abc481.contest.atcoder.jp" → "abc481"(公式の参加履歴の ContestScreenName) */
export function contestIdOf(screenName: string): string {
  return screenName.replace(/\.contest\.atcoder\.jp$/, "");
}

/** abc481 → "ABC 481"(見出し・カードに出す短い名前)。ABC/ARC/AGC 以外は ID のまま */
export function shortContestName(id: string): string {
  const m = /^(abc|arc|agc)(\d+)$/.exec(id);
  return m ? `${m[1].toUpperCase()} ${m[2]}` : id;
}

/** 問題記号の並び: 短いほうが先、同じ長さは辞書順(A..H のあとに Ex) */
function compareIndex(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" };
const decodeEntities = (s: string) => s.replace(/&(amp|lt|gt|quot|#39);/g, (_, e: string) => ENTITIES[e]);

/** atcoder.jp/contests/ の表の1行 */
export interface ContestTableRow {
  id: string;
  title: string;
  /** 開始時刻(epoch秒) */
  start: number;
  /** 長さ(秒)。読めなければ無い */
  duration?: number;
  /** Rated 対象(例: "- 1999", "All", "-") */
  rate: string;
}

/**
 * atcoder.jp/contests/ の表から ABC/ARC/AGC の行を読む。table を渡せばその表(例: "upcoming")だけ、
 * 省略すれば常設以外のすべての表(開催中・予定・最近)から読む(開催中の表の名前は決め打ちしない)。
 * 行は「開始時刻・名前・時間(HH:MM)・Rated 対象」の4列。読めない行は飛ばす
 */
export function parseContestTable(html: string, table?: string): ContestTableRow[] {
  const rows = new Map<string, ContestTableRow>();
  for (const t of html.matchAll(/id="contest-table-([a-z-]+)"/g)) {
    if (table ? t[1] !== table : t[1] === "permanent") continue;
    let seg = html.slice(t.index);
    const end = seg.indexOf("</table>");
    if (end >= 0) seg = seg.slice(0, end);
    for (const row of seg.split("<tr>").slice(1)) {
      const tm = row.match(/fixtime-full[\x27">]+(\d{4}-\d{2}-\d{2} [\d:+]+)</);
      const lm = row.match(/\/contests\/((?:abc|arc|agc)\d+)"[^>]*>([^<]+)</);
      if (!tm || !lm) continue;
      const iso = tm[1].replace(" ", "T").replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
      // 開始時刻のセルは中にリンクがあるので、文字だけのセル(時間・Rated 対象)だけが拾える
      const cells = [...row.matchAll(/<td class="text-center">([^<]*)<\/td>/g)].map((m) => m[1].trim());
      const dm = /^(\d+):(\d{2})$/.exec(cells[0] ?? "");
      rows.set(lm[1], {
        id: lm[1],
        title: decodeEntities(lm[2].trim()),
        start: Math.floor(new Date(iso).getTime() / 1000),
        ...(dm ? { duration: (Number(dm[1]) * 60 + Number(dm[2])) * 60 } : {}),
        rate: cells[1] ?? "",
      });
    }
  }
  return [...rows.values()];
}

const isRated = (rate: string) => rate.trim() !== "-" && rate.trim() !== "";

export interface ContestIndexInput {
  /** kenkoooo resources/contests.json(開始済みのコンテスト) */
  contests: KenkooooContest[];
  /** kenkoooo resources/contest-problem.json */
  contestProblems: KenkooooContestProblem[];
  /** atcoder.jp/contests/ の表(kenkoooo にまだ無い開催中・直近のコンテストを補う) */
  tables: ContestTableRow[];
  /** 部員の提出(キーは小文字の ID) */
  lists: Record<string, Submission[]>;
  results: OfficialResults;
  /** 現在時刻(epoch秒) */
  now: number;
}

/**
 * コンテストタブで選べるコンテストの一覧(開始の新しい順)。載せるのは、直近1年に開始した 5 時間以内の
 * Rated のコンテスト(AHC を除く)のうち、部員が参加したもの(時間内の提出か公式成績がある)と、
 * 開始から7日以内・開催中・1日以内に始まるもの(終了直後で提出がまだ集まっていなくても選べるように)。
 * Rated 対象外でも公式成績があれば載せる
 */
export function buildContestIndex(input: ContestIndexInput): ClubContest[] {
  const { now } = input;
  const base = new Map<string, Omit<ClubContest, "joined" | "problems">>();
  for (const c of input.contests) {
    base.set(c.id, { id: c.id, title: c.title, start: c.start_epoch_second, duration: c.duration_second, rate: c.rate_change });
  }
  for (const r of input.tables) {
    if (!base.has(r.id) && r.duration) base.set(r.id, { id: r.id, title: r.title, start: r.start, duration: r.duration, rate: r.rate });
  }

  const joined = new Map<string, Set<string>>();
  const join = (cid: string, key: string) => {
    let s = joined.get(cid);
    if (!s) joined.set(cid, (s = new Set()));
    s.add(key);
  };
  for (const [key, list] of Object.entries(input.lists)) {
    for (const s of list) {
      const c = base.get(s.contest_id);
      if (c && c.start <= s.epoch_second && s.epoch_second < c.start + c.duration) join(c.id, key);
    }
  }
  for (const [cid, byMember] of Object.entries(input.results)) {
    for (const key of Object.keys(byMember)) join(cid, key);
  }

  const picked: Omit<ClubContest, "problems">[] = [];
  for (const c of base.values()) {
    if (/^ahc/.test(c.id) || c.duration > MAX_DURATION_SEC) continue;
    if (c.start < now - CONTEST_WINDOW_DAYS * DAY_SEC || c.start > now + DAY_SEC) continue;
    const hasResult = input.results[c.id] != null;
    if (!isRated(c.rate) && !hasResult) continue;
    const n = joined.get(c.id)?.size ?? 0;
    if (n === 0 && !(isRated(c.rate) && c.start >= now - 7 * DAY_SEC)) continue;
    picked.push({ ...c, joined: n });
  }

  const ids = new Set(picked.map((c) => c.id));
  const problems = new Map<string, ContestProblem[]>();
  for (const p of input.contestProblems) {
    if (!ids.has(p.contest_id)) continue;
    let l = problems.get(p.contest_id);
    if (!l) problems.set(p.contest_id, (l = []));
    l.push({ id: p.problem_id, index: p.problem_index });
  }
  return picked
    .map((c) => ({ ...c, problems: (problems.get(c.id) ?? []).sort((a, b) => compareIndex(a.index, b.index)) }))
    .sort((a, b) => b.start - a.start);
}

/**
 * スナップショットの一覧に無い(スナップショットの後に始まった)コンテストを、予定の一覧(upcoming.json)から足す。
 * 長さが分かって、もう始まっているものだけ。問題は部員の提出から作る(contestProblems)
 */
export function mergeUpcoming(
  list: ClubContest[],
  upcoming: { id: string; title: string; start: number; duration?: number; rate?: string }[],
  now: number,
): ClubContest[] {
  const have = new Set(list.map((c) => c.id));
  const extra: ClubContest[] = [];
  for (const u of upcoming) {
    if (have.has(u.id) || !u.duration || u.start > now) continue;
    extra.push({ id: u.id, title: u.title, start: u.start, duration: u.duration, rate: u.rate ?? "", joined: 0, problems: [] });
  }
  return extra.length > 0 ? [...list, ...extra].sort((a, b) => b.start - a.start) : list;
}

export const contestEnd = (c: { start: number; duration: number }) => c.start + c.duration;

/**
 * 部員が参加したかもしれないコンテストか。スナップショットで参加人数を数えていればそれを信じる。
 * 問題セットがまだ無い(スナップショットが開催中の様子をまだ見ていない)ものは、終わって6時間以内なら参加したかもしれないとみなす
 * (終了直後に開いた人のため。開催中のスナップショットで 0 人と分かっている Rated 範囲外の ARC などは選ばない)
 */
export function mayHaveMembers(c: ClubContest, now: number): boolean {
  return c.joined > 0 || (c.problems.length === 0 && now - contestEnd(c) < 6 * 60 * 60);
}

/** 最初に開くコンテスト: 終了したもののうち最も新しい、部員が参加したかもしれないもの */
export function pickDefaultContest(list: ClubContest[], now: number): ClubContest | undefined {
  const ended = list.filter((c) => contestEnd(c) <= now).sort((a, b) => b.start - a.start);
  return ended.find((c) => mayHaveMembers(c, now)) ?? ended[0];
}

/** その提出がコンテストの時間内に、そのコンテストに出したものか(開始ちょうどは時間内、終了ちょうどは時間外) */
export function inContest(s: Submission, c: { id: string; start: number; duration: number }): boolean {
  return s.contest_id === c.id && c.start <= s.epoch_second && s.epoch_second < contestEnd(c);
}

/** 問題IDの末尾から記号を作る(abc481_a → A) */
function indexFromId(id: string): string {
  return id.slice(id.lastIndexOf("_") + 1).toUpperCase();
}

/**
 * 表に並べる問題。スナップショットの問題セットに、部員の時間内の提出にだけ出てくる問題を足す
 * (開始の直後で問題セットがまだ無いとき、提出のあった問題だけでも出せるように)
 */
export function contestProblems(c: ClubContest, lists: Iterable<Submission[]>): ContestProblem[] {
  const out = [...c.problems];
  const have = new Set(out.map((p) => p.id));
  for (const list of lists) {
    for (const s of list) {
      if (have.has(s.problem_id) || !inContest(s, c)) continue;
      have.add(s.problem_id);
      out.push({ id: s.problem_id, index: indexFromId(s.problem_id) });
    }
  }
  return out.sort((a, b) => compareIndex(a.index, b.index));
}

// ペナルティに数えない結果(コンパイルエラーと、判定が終わっていないもの)
const NOT_PENALTY = new Set(["AC", "CE", "IE", "WJ", "WR"]);
const isPending = (r: string) => r === "WJ" || r === "WR" || /^\d+\/\d+$/.test(r);
const isWrong = (r: string) => !NOT_PENALTY.has(r) && !isPending(r);

/** 結果の色分け: AC / 誤答(ペナルティになる) / それ以外(CE・判定中など) */
export function resultKind(r: string): "ok" | "ng" | "warn" {
  return r === "AC" ? "ok" : isWrong(r) ? "ng" : "warn";
}

/** 部員1人・1問ぶんの結果 */
export interface Cell {
  problem: ContestProblem;
  /** 時間内の提出(古い順) */
  subs: Submission[];
  /** 時間内の最高点(0 = 得点なし) */
  point: number;
  /** 最高点に最初に届いた提出 */
  scored?: Submission;
  /** scored の開始からの経過秒 */
  elapsed?: number;
  /** 誤答の数。得点した問題は scored より前の、得点していない問題は時間内のすべての誤答(CE は数えない) */
  wrong: number;
  /** 判定の終わっていない提出がある */
  pending: boolean;
  /** 時間内に AC しなかった問題を、終了後に AC した最初の提出(解き直し。別のコンテストでの提出も含む) */
  lateAc?: Submission;
  /** マスから開く提出: 得点した提出 → 時間内の最後の提出 → 解き直しの AC */
  link?: Submission;
}

/** 部員1人ぶんの結果 */
export interface MemberScore {
  cells: Cell[];
  /** 時間内に提出した */
  participated: boolean;
  score: number;
  /** 得点した問題の誤答の合計 */
  penalty: number;
  /** 最後に得点した提出の経過秒(得点なしは 0) */
  lastElapsed: number;
  /** AtCoder の順位表の「時間」: 最後に得点した時刻 + ペナルティ × 5 分 */
  time: number;
}

export function scoreMember(c: ClubContest, problems: ContestProblem[], subs: Submission[]): MemberScore {
  const end = contestEnd(c);
  const inside = new Map<string, Submission[]>();
  const lateAc = new Map<string, Submission>();
  let participated = false;
  // 提出は古い順に並んでいる(cache.ts の mergeById)が、念のため並べ直す
  for (const s of [...subs].sort((a, b) => a.epoch_second - b.epoch_second || a.id - b.id)) {
    if (inContest(s, c)) {
      participated = true;
      let l = inside.get(s.problem_id);
      if (!l) inside.set(s.problem_id, (l = []));
      l.push(s);
    } else if (s.epoch_second >= end && s.result === "AC" && !lateAc.has(s.problem_id)) {
      lateAc.set(s.problem_id, s);
    }
  }

  let score = 0;
  let penalty = 0;
  let lastElapsed = 0;
  const cells = problems.map((problem): Cell => {
    const list = inside.get(problem.id) ?? [];
    let point = 0;
    let scored: Submission | undefined;
    for (const s of list) {
      if (s.point > point) {
        point = s.point;
        scored = s;
      }
    }
    const before = scored ? list.slice(0, list.indexOf(scored)) : list;
    const wrong = before.filter((s) => isWrong(s.result)).length;
    const elapsed = scored ? scored.epoch_second - c.start : undefined;
    if (scored && elapsed != null) {
      score += point;
      penalty += wrong;
      lastElapsed = Math.max(lastElapsed, elapsed);
    }
    const late = list.some((s) => s.result === "AC") ? undefined : lateAc.get(problem.id);
    return {
      problem,
      subs: list,
      point,
      scored,
      elapsed,
      wrong,
      pending: list.some((s) => isPending(s.result)),
      lateAc: late,
      link: scored ?? list[list.length - 1] ?? late,
    };
  });
  return { cells, participated, score, penalty, lastElapsed, time: score > 0 ? lastElapsed + PENALTY_SEC * penalty : 0 };
}

export interface RankRow {
  score: MemberScore;
  official?: OfficialResult;
}

export interface Ranking<T extends RankRow> {
  /** official: 参加者全員の公式順位がそろっている / provisional: 提出から計算した暫定の順位 */
  mode: "official" | "provisional";
  /** 参加者(時間内に提出した人と、公式成績がある人)を順位順に。rank は同点を同じ順位にした部内の順位 */
  ranked: (T & { rank: number })[];
}

/**
 * 部内の順位。参加者全員に公式成績があれば公式の順位(AtCoder 全体の順位)の順に並べる。
 * そろっていなければ得点の高い順 → 時間の短い順の暫定の順位にし、提出が無く公式成績だけある人は後ろに公式の順位の順で置く
 */
export function rankMembers<T extends RankRow>(rows: T[]): Ranking<T> {
  const players = rows.filter((r) => r.score.participated || r.official);
  const official = players.length > 0 && players.every((r) => r.official);
  let sorted: T[];
  let key: (r: T) => string;
  if (official) {
    sorted = [...players].sort((a, b) => a.official!.place - b.official!.place);
    key = (r) => `p${r.official!.place}`;
  } else {
    const live = players.filter((r) => r.score.participated);
    const rest = players.filter((r) => !r.score.participated);
    live.sort((a, b) => b.score.score - a.score.score || a.score.time - b.score.time);
    rest.sort((a, b) => a.official!.place - b.official!.place);
    sorted = [...live, ...rest];
    key = (r) => (r.score.participated ? `s${r.score.score}/${r.score.time}` : `p${r.official!.place}`);
  }
  // 同点は同じ順位にする(1, 2, 2, 4)
  const ranked: (T & { rank: number })[] = [];
  sorted.forEach((r, i) => {
    const prev = ranked[i - 1];
    ranked.push({ ...r, rank: prev && key(sorted[i - 1]) === key(r) ? prev.rank : i + 1 });
  });
  return { mode: official ? "official" : "provisional", ranked };
}

/** AtCoder の提出ページ(その提出を出したコンテストのページで開く。ログインなしで見られる) */
export function submissionUrl(s: Submission): string {
  return `https://atcoder.jp/contests/${s.contest_id}/submissions/${s.id}`;
}

/** 経過秒 → "20:51"(分は60で折り返さない: "100:11") */
export function elapsedStr(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}
