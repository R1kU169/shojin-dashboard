import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { StatCard } from "../components/StatCard";
import { MEMBERS } from "../data/members";
import { getRating, peekSubmissions, refreshSubmissions } from "../lib/cache";
import { TIER_COLORS, TIER_LABELS, tierIndex } from "../lib/colors";
import { computeStats, todayEpochDay } from "../lib/stats";
import type { UserStats } from "../lib/stats";
import type { Member, ProblemModels } from "../lib/types";
import { useTheme } from "../theme";

interface Row {
  member: Member;
  status: "pending" | "loading" | "done" | "error";
  progress: number;
  stats?: UserStats;
  rating?: number | null;
  /** 手元のデータで表示しながら、最新の提出を取っている(取る順番を待っている) */
  refreshing?: boolean;
  /** 最新の提出を取れず、手元のデータで表示している */
  stale?: boolean;
}

type Period = "week" | "month" | "all";
type SortKey = "ac" | "streak" | "rating";

const RANK_BADGES = ["🥇", "🥈", "🥉"];
const PERIODS: { key: Period; label: string; note: string }[] = [
  { key: "week", label: "今週", note: "今日を含む直近7日" },
  { key: "month", label: "今月", note: "今日を含む直近30日" },
  { key: "all", label: "全期間", note: "これまでの累計" },
];
// ランキングで使うのは AC 数・ストリークだけで、難易度(帯別の内訳)は使わない。
// 難易度データ(数MB)を待たず、取れなくても表示できるよう空のまま渡す
const NO_MODELS: ProblemModels = {};

// 期間内の新規AC数(週=7日/月=30日/全期間=累計)。dailyNewAc から集計する。
function periodAc(stats: UserStats, period: Period): number {
  if (period === "all") return stats.totalAc;
  const days = period === "week" ? 7 : 30;
  const from = todayEpochDay() - (days - 1);
  let sum = 0;
  for (const [day, n] of stats.dailyNewAc) if (day >= from) sum += n;
  return sum;
}

export function ClubPage() {
  const { resolved } = useTheme();
  const [rows, setRows] = useState<Row[]>(
    MEMBERS.map((m) => ({ member: m, status: "pending", progress: 0 })),
  );
  const [period, setPeriod] = useState<Period>("week");
  const [sortKey, setSortKey] = useState<SortKey>("ac");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");

  useEffect(() => {
    let cancel = false;
    // ページを離れたら kenkoooo からの取得を打ち切る(残りの部員の分まで順番を待たせない)
    const ctl = new AbortController();
    const update = (id: string, patch: Partial<Row>) =>
      setRows((rs) =>
        rs.map((r) => (r.member.id === id ? { ...r, ...patch } : r)),
      );
    // 公式レーティングは届いた人から出す
    for (const m of MEMBERS) {
      getRating(m.id)
        .then((rating) => {
          if (!cancel) update(m.id, { rating });
        })
        .catch(() => {});
    }
    (async () => {
      // 1. 手元のデータ(IndexedDB のキャッシュか、6時間ごとに更新するスナップショット)で、読めた人からすぐ並べる。
      //    kenkoooo を1人ずつ待つと、応答の遅い人のところで後ろの全員が止まってしまう
      const locals = await Promise.all(
        MEMBERS.map(async (m) => {
          const local = await peekSubmissions(m.id).catch(() => null);
          if (!cancel && local) {
            update(m.id, {
              status: "done",
              stats: computeStats(local.list, NO_MODELS),
              refreshing: !local.fresh && !local.cooldown,
              stale: local.cooldown,
            });
          }
          return local;
        }),
      );
      // 2. 古い人だけ、kenkoooo から最新の提出を順に取って差し替える(リクエストの間隔は api.ts が1秒以上あける)
      for (const [i, m] of MEMBERS.entries()) {
        if (cancel) break;
        const local = locals[i];
        if (local?.fresh) continue;
        if (!local) update(m.id, { status: "loading" });
        try {
          const r = await refreshSubmissions(
            m.id,
            (n) => {
              if (!cancel && !local) update(m.id, { progress: n });
            },
            ctl.signal,
          );
          if (!cancel) update(m.id, { status: "done", stats: computeStats(r.list, NO_MODELS), refreshing: false, stale: !r.live });
        } catch {
          if (!cancel) update(m.id, local ? { refreshing: false, stale: true } : { status: "error" });
        }
      }
    })();
    return () => {
      cancel = true;
      ctl.abort();
    };
  }, []);

  const acLabel =
    period === "week" ? "今週AC" : period === "month" ? "今月AC" : "累計AC";

  const metric = (r: Row): number => {
    if (!r.stats) return -1;
    if (sortKey === "ac") return periodAc(r.stats, period);
    if (sortKey === "streak") return r.stats.currentStreak;
    return r.rating ?? -1; // rating(未取得はnull)は最下位へ
  };

  const done = rows
    .filter((r) => r.status === "done")
    .sort((a, b) => {
      const d = metric(b) - metric(a);
      return sortDir === "desc" ? d : -d;
    });
  const rest = rows.filter((r) => r.status !== "done");
  const ordered = [...done, ...rest];
  // 同点は同じ順位にする(1, 2, 2, 4)。昇順は先頭が最下位なので並び順の番号のまま
  const rankOf = (i: number): number => {
    if (sortDir === "asc") return i + 1;
    let k = i;
    while (k > 0 && metric(ordered[k - 1]) === metric(ordered[i])) k--;
    return k + 1;
  };

  const sortBy = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const ind = (key: SortKey) =>
    sortKey === key ? (
      <span className="sort-ind" aria-hidden="true">{sortDir === "desc" ? "▼" : "▲"}</span>
    ) : null;
  const ariaSort = (key: SortKey) =>
    sortKey === key ? (sortDir === "desc" ? "descending" : "ascending") : undefined;

  // 部全体サマリー(読み込み済みの部員から集計。期間トグルに連動)
  const periodWord =
    period === "week" ? "今週" : period === "month" ? "今月" : "全期間";
  const loadedRows = rows.filter((r) => r.status === "done" && r.stats);
  const refreshingCount = rows.filter((r) => r.refreshing).length;
  const staleCount = rows.filter((r) => r.stale).length;
  const periodSum = loadedRows.reduce((s, r) => s + periodAc(r.stats!, period), 0);
  const activeCount = loadedRows.filter(
    (r) => periodAc(r.stats!, period) > 0,
  ).length;
  const ratedRows = loadedRows.filter((r) => (r.rating ?? 0) > 0);
  const avgRating = ratedRows.length
    ? Math.round(
        ratedRows.reduce((s, r) => s + (r.rating ?? 0), 0) / ratedRows.length,
      )
    : null;
  const tierDist = Array<number>(8).fill(0);
  for (const r of loadedRows) if (r.rating != null) tierDist[tierIndex(r.rating)]++;
  const distTotal = tierDist.reduce((a, b) => a + b, 0);

  return (
    <div className="page">
      <h1>クラブ内ランキング</h1>
      <p className="muted">名前をタップで個人ページへ。列見出しで並び替え。</p>

      <div className="rank-toolbar">
        <span className="muted rank-toolbar-label">期間</span>
        <div className="seg">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={period === p.key ? "on" : undefined}
              onClick={() => {
                setPeriod(p.key);
                setSortKey("ac");
                setSortDir("desc");
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <span className="muted rank-toolbar-label">{PERIODS.find((p) => p.key === period)?.note}</span>
      </div>

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">部全体サマリー</h2>
          <span className="card-sub">
            読み込み済み {loadedRows.length}/{MEMBERS.length} 人
            {refreshingCount > 0 && `・最新の提出を確認中(残り ${refreshingCount} 人)`}
            {refreshingCount === 0 && staleCount > 0 && `・${staleCount} 人は最新の提出を取得できず、保存済みのデータで表示`}
          </span>
        </div>
        <div className="stat-grid">
          <StatCard
            label={`${periodWord}の合計AC`}
            value={periodSum}
            unit="問"
          />
          <StatCard
            label="アクティブ"
            value={activeCount}
            unit="人"
            sub={`${periodWord}に1問以上AC`}
          />
          <StatCard
            label="平均レート"
            value={avgRating ?? "—"}
            sub="レート保持者の平均"
          />
          <StatCard label="部員数" value={MEMBERS.length} unit="人" />
        </div>
        {distTotal > 0 && (
          <div className="tier-dist">
            <div className="tier-dist-bar">
              {tierDist.map((c, i) =>
                c > 0 ? (
                  <span
                    key={i}
                    style={{
                      flex: c,
                      background: TIER_COLORS[resolved][i],
                    }}
                  />
                ) : null,
              )}
            </div>
            <div className="tier-dist-legend">
              {tierDist.map((c, i) =>
                c > 0 ? (
                  <span key={i}>
                    <i style={{ background: TIER_COLORS[resolved][i] }} />
                    {TIER_LABELS[i]} {c}
                  </span>
                ) : null,
              )}
            </div>
          </div>
        )}
      </section>

      <section className="card">
        {/* 5列の数値表はmin-contentが366pxあり、狭い幅ではページ全体を横に広げて
            スティッキーヘッダーごと横パンさせてしまう。表の中だけでスクロールさせる */}
        <div className="table-scroll">
          <table className="data-table rank-table">
            <thead>
              <tr>
                <th className="num">#</th>
                <th>部員</th>
                {/* 並び替えはキーボードでも操作できるよう見出しの中のボタンで行う */}
                <th className="num sortable" aria-sort={ariaSort("ac")}>
                  <button type="button" className="th-sort" onClick={() => sortBy("ac")}>
                    {acLabel}
                    {ind("ac")}
                  </button>
                </th>
                <th className="num sortable" aria-sort={ariaSort("streak")}>
                  <button type="button" className="th-sort" onClick={() => sortBy("streak")}>
                    {/* スマホ幅では名前の列に幅を回すため短い見出しにする */}
                    <span className="wide-only">ストリーク</span>
                    <span className="narrow-only">連続</span>
                    {ind("streak")}
                  </button>
                </th>
                <th className="num sortable" aria-sort={ariaSort("rating")}>
                  <button type="button" className="th-sort" onClick={() => sortBy("rating")}>
                    レート
                    {ind("rating")}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((r, i) => {
                // 昇順(sortDir="asc")では先頭が最下位なので、メダルもMVPも付けない。
                // 0問・0日・未レートの人にもメダルは付けない(全員0のときに上から3人が表彰されないように)
                const ranked = sortDir === "desc" && r.status === "done" && metric(r) > 0;
                const rank = rankOf(i);
                const isTop =
                  ranked &&
                  rank === 1 &&
                  sortKey === "ac" &&
                  period !== "all";
                return (
                  <tr
                    key={r.member.id}
                    className={isTop ? "first-place" : undefined}
                  >
                    <td className="num rank-cell">
                      {r.status !== "done"
                        ? "—"
                        : ranked
                          ? (RANK_BADGES[rank - 1] ?? rank)
                          : rank}
                    </td>
                    <td>
                      <Link to={`/u/${r.member.id}`}>{r.member.name}</Link>
                      {isTop && (
                        <span className="best-chip">
                          👑 {period === "month" ? "今月" : "今週"}のMVP
                        </span>
                      )}
                      {r.refreshing && (
                        <span
                          className="sync-spinner rank-sync"
                          title="最新の提出を確認中"
                          aria-label="最新の提出を確認中"
                        />
                      )}
                      {r.stale && (
                        <span
                          className="muted rank-stale"
                          title="AtCoder Problems から最新の提出を取得できなかったため、保存済みのデータで表示しています"
                        >
                          {" "}
                          保存済み
                        </span>
                      )}
                      {r.status === "loading" && (
                        <span className="muted">
                          {" "}
                          取得中…
                          {r.progress > 0
                            ? `${r.progress.toLocaleString()}件`
                            : ""}
                        </span>
                      )}
                      {r.status === "error" && (
                        <span className="error-text"> 取得失敗</span>
                      )}
                    </td>
                    <td className="num">
                      {r.stats ? periodAc(r.stats, period).toLocaleString() : ""}
                    </td>
                    <td className="num">
                      {r.stats ? `${r.stats.currentStreak}日` : ""}
                    </td>
                    <td className="num">
                      {r.rating != null && (
                        <>
                          <span
                            className="tier-dot"
                            style={{
                              background:
                                TIER_COLORS[resolved][tierIndex(r.rating)],
                            }}
                          />
                          {r.rating > 0 ? (
                            r.rating
                          ) : (
                            <>
                              <span className="wide-only">未レート</span>
                              <span className="narrow-only" title="未レート">
                                —
                              </span>
                            </>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
