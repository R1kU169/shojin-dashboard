import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { RatingCircle } from "../components/RatingCircle";
import { StatCard } from "../components/StatCard";
import { MEMBERS } from "../data/members";
import { useReducedMotion } from "../hooks/useReducedMotion";
import {
  getContestList,
  getOfficialResults,
  getRating,
  peekSubmissions,
  refreshSubmissions,
} from "../lib/cache";
import { TIER_COLORS, tierIndex } from "../lib/colors";
import {
  contestEnd,
  contestProblems,
  elapsedStr,
  pickDefaultContest,
  rankMembers,
  resultKind,
  scoreMember,
  shortContestName,
  submissionUrl,
} from "../lib/contest";
import type { Cell, MemberScore } from "../lib/contest";
import { jstDateStr, jstDateTimeStr } from "../lib/stats";
import type { ClubContest, Member, OfficialResult, OfficialResults, Submission } from "../lib/types";
import { useTheme } from "../theme";

interface Row {
  member: Member;
  status: "pending" | "loading" | "done" | "error";
  progress: number;
  list?: Submission[];
  rating?: number | null;
  /** 手元のデータで表示しながら、最新の提出を取っている(取る順番を待っている) */
  refreshing?: boolean;
  /** 最新の提出を取れず、手元のデータで表示している */
  stale?: boolean;
}

interface Scored {
  row: Row;
  score: MemberScore;
  official?: OfficialResult;
}

const RANK_BADGES = ["🥇", "🥈", "🥉"];
const ATCODER = "https://atcoder.jp/contests";
// 終了からこれだけたったあとに最新まで取れている部員は、このコンテストのために取り直さない
// (kenkoooo に提出が載るのは遅くとも数十分後。古いコンテストを開くたびに部員の数だけ問い合わせないように。
// そのかわり、それより後の解き直しの AC は次に取り直すまで出ない)
const COVER_SEC = 3 * 60 * 60;

const rateLabel = (rate: string) => (rate.trim() === "-" || rate.trim() === "" ? "Unrated" : `Rated ${rate.trim()}`);
// "2026-10-24" → "10/24"
const monthDay = (sec: number) => jstDateStr(sec).slice(5).replace("-", "/");

/**
 * コンテストタブ。部員全員の、終わったコンテストの結果(公式順位・得点・問題ごとの AC・提出へのリンク)を並べる。
 * /contest は、部員が参加した最新のコンテストへ移る
 */
export function ContestPage() {
  const { contestId } = useParams();
  const [list, setList] = useState<ClubContest[] | null>(null);
  const [listError, setListError] = useState(false);

  useEffect(() => {
    let cancel = false;
    getContestList()
      .then((l) => {
        if (!cancel) setList(l);
      })
      .catch(() => {
        if (!cancel) setListError(true);
      });
    return () => {
      cancel = true;
    };
  }, []);

  if (listError) {
    return (
      <div className="notice error-text">
        コンテストの一覧を読み込めませんでした。時間をおいて開き直してください。
        {import.meta.env.DEV && (
          <span className="muted">
            開発中は SNAPSHOT_LIMIT=10 node scripts/build-snapshot.mjs でスナップショットを作ってください。
          </span>
        )}
      </div>
    );
  }
  if (!list) {
    return (
      <div className="notice">
        <div className="spinner" />
        コンテストの一覧を読み込んでいます…
      </div>
    );
  }
  const now = Math.floor(Date.now() / 1000);
  if (!contestId) {
    const def = pickDefaultContest(list, now);
    return def ? (
      <Navigate to={`/contest/${def.id}`} replace />
    ) : (
      <div className="notice">部員が参加したコンテストはまだありません。</div>
    );
  }
  const contest = list.find((c) => c.id === contestId);
  if (!contest) {
    return (
      <div className="notice">
        <p>
          「{contestId}」は見つかりませんでした。載せているのは、直近1年に部員が参加した ABC・ARC・AGC などです。
        </p>
        <Link to="/contest">最新のコンテストへ</Link>
      </div>
    );
  }
  if (contestEnd(contest) > now) {
    return (
      <div className="notice">
        <p>
          {shortContestName(contest.id)} は{contest.start > now ? "まだ始まっていません" : "開催中です"}。
          終了後に部員の結果を表示します。
        </p>
        <a href={`${ATCODER}/${contest.id}`} target="_blank" rel="noreferrer">
          AtCoder で開く ↗
        </a>
        <Link to="/contest">前回のコンテストへ</Link>
      </div>
    );
  }
  return <ContestResults contest={contest} list={list} now={now} />;
}

function ContestResults({ contest, list, now }: { contest: ClubContest; list: ClubContest[]; now: number }) {
  const { resolved } = useTheme();
  const nav = useNavigate();
  const reduced = useReducedMotion();
  const [params, setParams] = useSearchParams();
  const panelHead = useRef<HTMLHeadingElement>(null);
  const [rows, setRows] = useState<Row[]>(
    MEMBERS.map((m) => ({ member: m, status: "pending", progress: 0 })),
  );
  const [results, setResults] = useState<OfficialResults | null>(null);
  const [resultsError, setResultsError] = useState(false);

  useEffect(() => {
    let cancel = false;
    getOfficialResults()
      .then((r) => {
        if (!cancel) setResults(r);
      })
      .catch(() => {
        if (!cancel) setResultsError(true);
      });
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    let cancel = false;
    // ページを離れたら kenkoooo からの取得を打ち切る(残りの部員の分まで順番を待たせない)
    const ctl = new AbortController();
    const update = (id: string, patch: Partial<Row>) =>
      setRows((rs) => rs.map((r) => (r.member.id === id ? { ...r, ...patch } : r)));
    const coveredAt = (contestEnd(contest) + COVER_SEC) * 1000;
    for (const m of MEMBERS) {
      getRating(m.id)
        .then((rating) => {
          if (!cancel) update(m.id, { rating });
        })
        .catch(() => {});
    }
    (async () => {
      // 1. 手元のデータ(IndexedDB のキャッシュか、スナップショット)で、読めた人からすぐ並べる
      const locals = await Promise.all(
        MEMBERS.map(async (m) => {
          const local = await peekSubmissions(m.id).catch(() => null);
          if (!cancel && local) {
            const covered = local.at >= coveredAt;
            update(m.id, {
              status: "done",
              list: local.list,
              refreshing: !local.fresh && !local.cooldown && !covered,
              stale: local.cooldown && !covered,
            });
          }
          return local;
        }),
      );
      // 2. このコンテストの提出がそろっていない人だけ、kenkoooo から最新の提出を順に取って差し替える
      for (const [i, m] of MEMBERS.entries()) {
        if (cancel) break;
        const local = locals[i];
        if (local?.fresh || (local && local.at >= coveredAt)) continue;
        if (!local) update(m.id, { status: "loading" });
        try {
          const r = await refreshSubmissions(
            m.id,
            (n) => {
              if (!cancel && !local) update(m.id, { progress: n });
            },
            ctl.signal,
          );
          if (!cancel) update(m.id, { status: "done", list: r.list, refreshing: false, stale: !r.live });
        } catch {
          if (!cancel) update(m.id, local ? { refreshing: false, stale: true } : { status: "error" });
        }
      }
    })();
    return () => {
      cancel = true;
      ctl.abort();
    };
  }, [contest]);

  const problems = useMemo(
    () => contestProblems(contest, rows.flatMap((r) => (r.list ? [r.list] : []))),
    [contest, rows],
  );
  const byMember = results?.[contest.id];
  const scored = useMemo<Scored[]>(
    () =>
      rows.map((row) => ({
        row,
        score: scoreMember(contest, problems, row.list ?? []),
        official: byMember?.[row.member.id.toLowerCase()],
      })),
    [contest, problems, rows, byMember],
  );
  const { mode, ranked } = useMemo(() => rankMembers(scored), [scored]);

  const inRanking = new Set(ranked.map((r) => r.row.member.id));
  // 提出をまだ読めていない人(参加したかどうか分からない)は表の後ろに状態だけ出す
  const waiting = scored.filter((s) => !inRanking.has(s.row.member.id) && s.row.status !== "done");
  const absent = scored.filter((s) => !inRanking.has(s.row.member.id) && s.row.status === "done");
  const loadedCount = rows.filter((r) => r.status === "done").length;
  const refreshingCount = rows.filter((r) => r.refreshing).length;
  const staleCount = rows.filter((r) => r.stale).length;

  const solvedBy = problems.map((_, i) => ranked.filter((r) => r.score.cells[i]?.scored?.result === "AC").length);
  const solvedProblems = solvedBy.filter((n) => n > 0).length;
  const ratedPerf = ranked.filter((r) => r.official?.rated);
  const avgPerf = ratedPerf.length
    ? Math.round(ratedPerf.reduce((s, r) => s + r.official!.perf, 0) / ratedPerf.length)
    : null;
  const top = ranked[0];
  const waitingOfficial = ranked.some((r) => r.score.participated && !r.official);
  // 誰も参加していなかったときの行き先(一覧は開始の新しい順)
  const lastJoined = list.find((c) => c.id !== contest.id && c.joined > 0 && contestEnd(c) <= now);

  const selIndex = problems.findIndex((p) => p.index === params.get("p"));
  const choose = (index: string, scroll: boolean) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("p", index);
        return next;
      },
      { replace: true },
    );
    if (!scroll) return;
    // 表の列見出しから選んだときは、比較のカードまで移って見出しにフォーカスを移す
    requestAnimationFrame(() => {
      const h = panelHead.current;
      h?.closest("section")?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
      h?.focus({ preventScroll: true });
    });
  };

  // 選べるのは終わったコンテストだけ。年ごとにまとめる
  const years = new Map<string, ClubContest[]>();
  for (const c of list) {
    if (contestEnd(c) > now) continue;
    const y = jstDateStr(c.start).slice(0, 4);
    years.set(y, [...(years.get(y) ?? []), c]);
  }

  // 名前・パフォは AtCoder と同じレートの色の文字にする(ランキングと同じ)
  const tierColor = (rating: number | null | undefined) =>
    rating != null && rating > 0 ? { color: TIER_COLORS[resolved][tierIndex(rating)] } : undefined;

  return (
    <div className="page">
      <section className="cr-head">
        <div className="cr-title">
          <h1>{shortContestName(contest.id)}</h1>
          <p className="muted">{contest.title}</p>
          <p className="muted cr-when">
            {jstDateTimeStr(contest.start)}〜{jstDateTimeStr(contestEnd(contest)).slice(11)}・
            {Math.round(contest.duration / 60)}分・{rateLabel(contest.rate)}
          </p>
          <div className="user-title-actions">
            <a className="profile-link" href={`${ATCODER}/${contest.id}/standings`} target="_blank" rel="noreferrer">
              AtCoder の順位表 ↗
            </a>
            <a className="profile-link" href={`${ATCODER}/${contest.id}/tasks`} target="_blank" rel="noreferrer">
              問題 ↗
            </a>
            <a className="profile-link" href={`${ATCODER}/${contest.id}/editorial`} target="_blank" rel="noreferrer">
              解説 ↗
            </a>
          </div>
        </div>
        <label className="editor-lang cr-pick">
          コンテスト
          <select value={contest.id} onChange={(e) => nav(`/contest/${e.target.value}`)}>
            {[...years].map(([y, cs]) => (
              <optgroup key={y} label={`${y}年`}>
                {cs.map((c) => (
                  <option key={c.id} value={c.id}>
                    {shortContestName(c.id)}({monthDay(c.start)}){c.joined > 0 ? `・${c.joined}人` : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      </section>

      <div className="stat-grid cr-stats">
        <StatCard label="参加人数" value={ranked.length} unit="人" sub={`部員 ${MEMBERS.length} 人中`} />
        <StatCard
          label="部内1位"
          value={top ? top.row.member.name : "—"}
          sub={
            top
              ? [
                  ...(top.score.participated ? [`${top.score.score}点`, elapsedStr(top.score.time)] : []),
                  top.official ? `${top.official.place.toLocaleString()}位` : "暫定",
                ].join("・")
              : undefined
          }
        />
        <StatCard
          label="平均パフォ"
          value={avgPerf ?? "—"}
          sub={avgPerf != null ? `Rated で参加した ${ratedPerf.length} 人` : ranked.length > 0 ? "レート更新待ち" : undefined}
        />
        <StatCard
          label="解かれた問題"
          value={solvedProblems}
          unit={`/ ${problems.length} 問`}
          sub="部員の誰かが時間内に AC"
        />
      </div>

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">部内順位</h2>
          {ranked.length > 0 &&
            (mode === "official" ? (
              <span className="exit-chip ok" title="AtCoder の公式の順位の順">公式</span>
            ) : (
              <span className="exit-chip warn" title="提出から計算した順位">暫定</span>
            ))}
          <span className="card-sub">
            読み込み済み {loadedCount}/{MEMBERS.length} 人
            {refreshingCount > 0 && `・最新の提出を確認中(残り ${refreshingCount} 人)`}
            {refreshingCount === 0 && staleCount > 0 && `・${staleCount} 人は最新の提出を取得できず、保存済みのデータで表示`}
          </span>
        </div>
        {resultsError ? (
          <p className="cr-wait">
            公式の順位を読み込めなかったため、提出から計算した暫定の順位で表示しています。
          </p>
        ) : (
          results &&
          waitingOfficial && (
            <p className="cr-wait">
              公式の順位・パフォーマンスは、レートの更新(終了の数十分後)のあとに反映されます。土日の夜は 22:45・23:00・23:15・0:00
              にも更新しています。いまは提出から計算した暫定の順位です。
            </p>
          )
        )}
        {ranked.length === 0 && waiting.length === 0 ? (
          <p className="muted cr-empty">
            このコンテストに参加した部員はいません。
            {lastJoined && (
              <Link to={`/contest/${lastJoined.id}`}>
                部員が参加した前回のコンテスト({shortContestName(lastJoined.id)})へ
              </Link>
            )}
          </p>
        ) : (
          <div className="table-scroll">
            <table className="data-table rank-table cr-table">
              <thead>
                <tr>
                  <th className="cr-member">部員</th>
                  <th className="num">順位</th>
                  <th className="num">得点</th>
                  {problems.map((p, i) => (
                    <th key={p.id} className="cr-prob">
                      <button
                        type="button"
                        className="th-sort"
                        onClick={() => choose(p.index, true)}
                        aria-controls="cr-panel"
                        aria-expanded={i === selIndex}
                        title={`${p.index} 問題の部員の提出を比べる`}
                      >
                        {p.index}
                      </button>
                      <span className="cr-solved" title={`時間内に AC した部員 ${solvedBy[i]} 人`}>
                        {solvedBy[i]}/{ranked.length}
                      </span>
                    </th>
                  ))}
                  <th className="num">パフォ</th>
                  <th className="num">レート</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((r) => {
                  const medal = r.rank <= 3 && (r.official != null || r.score.score > 0);
                  return (
                    <tr key={r.row.member.id} className={r.rank === 1 ? "first-place" : undefined}>
                      <td className="cr-member">
                        <span className="cr-rank">{medal ? RANK_BADGES[r.rank - 1] : r.rank}</span>
                        <MemberName row={r.row} style={tierColor(r.row.rating)} />
                      </td>
                      <td className="num">
                        {r.official ? r.official.place.toLocaleString() : <span className="muted" title="レート更新待ち">—</span>}
                      </td>
                      <td className="num cr-score">
                        {r.score.participated ? (
                          <>
                            <strong>{r.score.score}</strong>
                            {r.score.penalty > 0 && <span className="cr-pen"> ({r.score.penalty})</span>}
                            {r.score.score > 0 && <span className="cr-time">{elapsedStr(r.score.time)}</span>}
                          </>
                        ) : (
                          <span className="muted" title="提出をまだ読み込めていません">—</span>
                        )}
                      </td>
                      {r.score.cells.map((c) => (
                        <ProblemCell key={c.problem.id} cell={c} contest={contest} />
                      ))}
                      <td className="num">
                        {r.official?.rated && <strong style={tierColor(r.official.perf)}>{r.official.perf}</strong>}
                      </td>
                      <td className="num">
                        {r.official && <RateChange official={r.official} />}
                      </td>
                    </tr>
                  );
                })}
                {waiting.map((s) => (
                  <tr key={s.row.member.id}>
                    <td className="cr-member">
                      <span className="cr-rank">—</span>
                      <MemberName row={s.row} style={tierColor(s.row.rating)} />
                    </td>
                    <td colSpan={problems.length + 4} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {absent.length > 0 && (
          <details className="cr-absent">
            <summary>参加していない部員 {absent.length} 人</summary>
            <p>
              {absent.map((s, i) => (
                <span key={s.row.member.id}>
                  {i > 0 && "、"}
                  <Link to={`/u/${s.row.member.id}`}>{s.row.member.name}</Link>
                </span>
              ))}
            </p>
          </details>
        )}
      </section>

      <section className="card cr-panel" id="cr-panel">
        <div className="card-head">
          <h2 className="card-title" tabIndex={-1} ref={panelHead}>
            {selIndex >= 0 ? `${problems[selIndex].index} 問題の提出` : "問題ごとの提出"}
          </h2>
          {selIndex >= 0 && (
            <a
              className="profile-link"
              href={`${ATCODER}/${contest.id}/tasks/${problems[selIndex].id}`}
              target="_blank"
              rel="noreferrer"
            >
              問題文 ↗
            </a>
          )}
        </div>
        {problems.length > 0 && (
          <div className="seg cr-seg" role="group" aria-label="問題を選ぶ">
            {problems.map((p, i) => (
              <button
                key={p.id}
                type="button"
                className={i === selIndex ? "on" : undefined}
                aria-pressed={i === selIndex}
                onClick={() => choose(p.index, false)}
              >
                {p.index}
              </button>
            ))}
          </div>
        )}
        {selIndex >= 0 ? (
          <ProblemPanel index={selIndex} ranked={ranked} all={scored} contest={contest} />
        ) : (
          <p className="muted cr-hint">
            表の A・B・… の見出しか、上のボタンで問題を選ぶと、その問題への部員の提出(結果・言語・コード長・実行時間)を並べて比べられます。各行の「コード ↗」で AtCoder の提出ページが開きます。
          </p>
        )}
      </section>

      <p className="muted cr-note">
        提出は AtCoder Problems(kenkoooo)のデータで、AtCoder に出してから載るまで数分かかることがあります。
        時間は最後に得点した時刻にペナルティ(誤答1回につき5分。コンパイルエラーは数えない)を足したものです。
        順位・パフォーマンス・レートは AtCoder の公式の値で、レートの更新のあとに反映されます。
      </p>
    </div>
  );
}

function MemberName({ row, style }: { row: Row; style?: CSSProperties }) {
  return (
    <>
      <Link to={`/u/${row.member.id}`} style={style}>
        {row.member.name}
      </Link>
      {row.refreshing && (
        <span className="sync-spinner rank-sync" title="最新の提出を確認中" aria-label="最新の提出を確認中" />
      )}
      {row.stale && (
        <span
          className="muted rank-stale"
          title="AtCoder Problems から最新の提出を取得できなかったため、保存済みのデータで表示しています"
        >
          {" "}
          保存済み
        </span>
      )}
      {row.status === "loading" && (
        <span className="muted rank-stale">
          {" "}
          取得中…{row.progress > 0 ? `${row.progress.toLocaleString()}件` : ""}
        </span>
      )}
      {row.status === "pending" && <span className="muted rank-stale"> 読み込み中…</span>}
      {row.status === "error" && <span className="error-text rank-stale"> 取得失敗</span>}
    </>
  );
}

function RateChange({ official }: { official: OfficialResult }) {
  if (!official.rated) {
    return (
      <span className="muted" title="Unrated で参加">
        —
      </span>
    );
  }
  const d = official.newRating - official.oldRating;
  return (
    <span className="rating-cell cr-rate">
      <RatingCircle rating={official.newRating} />
      {official.oldRating} → {official.newRating}
      <span className={d >= 0 ? "cr-up" : "cr-down"}>
        {" "}
        ({d >= 0 ? "+" : ""}
        {d})
      </span>
    </span>
  );
}

/** 表の1マス。AtCoder の提出ページへのリンク(得点した提出 → 時間内の最後の提出 → 解き直しの AC) */
function ProblemCell({ cell: c, contest }: { cell: Cell; contest: ClubContest }) {
  if (!c.link) return <td className="cr-cell" />;
  const full = c.scored?.result === "AC";
  const parts: string[] = [];
  let main: ReactNode;
  let sub: ReactNode = null;
  if (c.scored && c.elapsed != null) {
    parts.push(full ? `${elapsedStr(c.elapsed)} に AC` : `${c.point}点(部分点)・${elapsedStr(c.elapsed)}`);
    main = full ? <span className="cr-ac">{elapsedStr(c.elapsed)}</span> : <span className="cr-part">{c.point}</span>;
    if (!full) sub = <span className="cr-time">{elapsedStr(c.elapsed)}</span>;
    if (c.wrong > 0) {
      parts.push(`ペナルティ ${c.wrong}`);
      sub = (
        <>
          {sub}
          <span className="cr-pen">({c.wrong})</span>
        </>
      );
    }
  } else if (c.subs.length > 0) {
    if (c.wrong > 0) {
      parts.push(`誤答 ${c.wrong}`);
      main = <span className="cr-ng">({c.wrong})</span>;
    } else if (c.pending) {
      parts.push("判定中");
      main = <span className="muted">…</span>;
    } else {
      parts.push("コンパイルエラーのみ");
      main = <span className="muted">CE</span>;
    }
  } else {
    main = null;
  }
  if (c.lateAc) {
    parts.push(`終了後に AC(${jstDateTimeStr(c.lateAc.epoch_second)})`);
    const late = <span className="cr-late">後 ✓</span>;
    if (main == null) main = late;
    else sub = late;
  }
  const s = c.link;
  const label = `${c.problem.index}: ${parts.join("・")}。${s.language}・${s.length.toLocaleString()} B — AtCoder で提出を開く`;
  return (
    <td className={`cr-cell${full ? " cr-cell-ac" : ""}`}>
      <a
        href={submissionUrl(s)}
        target="_blank"
        rel="noreferrer"
        title={label}
        aria-label={label}
        className={s.contest_id === contest.id ? undefined : "cr-other"}
      >
        <span className="cr-main">{main}</span>
        {sub && <span className="cr-sub">{sub}</span>}
      </a>
    </td>
  );
}

/** 比較のカードの中身: 選んだ問題への部員の時間内の提出と、コンテスト後の AC */
function ProblemPanel({
  index,
  ranked,
  all,
  contest,
}: {
  index: number;
  ranked: Scored[];
  all: Scored[];
  contest: ClubContest;
}) {
  const inside = ranked.flatMap((r) => {
    const c = r.score.cells[index];
    return (c?.subs ?? []).map((s) => ({ r, s, scored: s === c.scored }));
  });
  const late = all.flatMap((r) => {
    const s = r.score.cells[index]?.lateAc;
    return s ? [{ r, s }] : [];
  });
  late.sort((a, b) => a.s.epoch_second - b.s.epoch_second);
  const end = contestEnd(contest);

  return (
    <>
      {inside.length > 0 ? (
        <table className="data-table stack-table cr-subs">
          <thead>
            <tr>
              <th>部員</th>
              <th className="num">経過</th>
              <th>結果</th>
              <th>言語</th>
              <th className="num">コード長</th>
              <th className="num">実行時間</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {inside.map(({ r, s, scored }) => (
              <tr key={s.id} className={scored ? "cr-scored" : undefined}>
                <td>
                  <Link to={`/u/${r.row.member.id}`}>{r.row.member.name}</Link>
                </td>
                <td className="num" data-label="経過">
                  {elapsedStr(s.epoch_second - contest.start)}
                </td>
                <td className="num" data-label="結果">
                  <span className={`exit-chip ${resultKind(s.result)}`}>{s.result}</span>
                  {s.point > 0 && s.result !== "AC" && <span className="muted"> {s.point}点</span>}
                </td>
                <td className="num cr-lang" data-label="言語">
                  {s.language}
                </td>
                <td className="num" data-label="コード長">
                  {s.length.toLocaleString()} B
                </td>
                <td className="num" data-label="実行時間">
                  {s.execution_time != null ? `${s.execution_time} ms` : "—"}
                </td>
                <td className="num">
                  <a href={submissionUrl(s)} target="_blank" rel="noreferrer">
                    コード ↗
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted cr-hint">この問題に時間内に提出した部員はいません。</p>
      )}
      {late.length > 0 && (
        <>
          <h3 className="cr-sub-title">コンテスト後の AC(解き直し)</h3>
          <table className="data-table stack-table cr-subs">
            <thead>
              <tr>
                <th>部員</th>
                <th className="num">AC した日時</th>
                <th>言語</th>
                <th className="num">コード長</th>
                <th className="num">実行時間</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {late.map(({ r, s }) => (
                <tr key={s.id}>
                  <td>
                    <Link to={`/u/${r.row.member.id}`}>{r.row.member.name}</Link>
                  </td>
                  <td className="num" data-label="AC">
                    {s.epoch_second - end < 60 * 60
                      ? `終了の ${elapsedStr(s.epoch_second - end)} 後`
                      : jstDateTimeStr(s.epoch_second)}
                  </td>
                  <td className="num cr-lang" data-label="言語">
                    {s.language}
                  </td>
                  <td className="num" data-label="コード長">
                    {s.length.toLocaleString()} B
                  </td>
                  <td className="num" data-label="実行時間">
                    {s.execution_time != null ? `${s.execution_time} ms` : "—"}
                  </td>
                  <td className="num">
                    <a href={submissionUrl(s)} target="_blank" rel="noreferrer">
                      コード ↗
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
