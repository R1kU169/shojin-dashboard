import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { StatCard } from "../components/StatCard";
import { MEMBERS } from "../data/members";
import { getProblemModels, getRating, loadSubmissions } from "../lib/cache";
import { TIER_COLORS, TIER_LABELS, tierIndex } from "../lib/colors";
import { computeStats, todayEpochDay } from "../lib/stats";
import type { UserStats } from "../lib/stats";
import type { Member } from "../lib/types";
import { useTheme } from "../theme";

interface Row {
  member: Member;
  status: "pending" | "loading" | "done" | "error";
  progress: number;
  stats?: UserStats;
  rating?: number | null;
}

type Period = "week" | "month" | "all";
type SortKey = "ac" | "streak" | "rating";

const RANK_BADGES = ["🥇", "🥈", "🥉"];
const PERIODS: { key: Period; label: string; days: number }[] = [
  { key: "week", label: "今週", days: 7 },
  { key: "month", label: "今月", days: 30 },
  { key: "all", label: "全期間", days: 0 },
];

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
    const update = (id: string, patch: Partial<Row>) =>
      setRows((rs) =>
        rs.map((r) => (r.member.id === id ? { ...r, ...patch } : r)),
      );
    (async () => {
      const models = await getProblemModels().catch(() => null);
      if (!models || cancel) return;
      // API礼儀のため部員を並列ではなく順番に取得する
      for (const m of MEMBERS) {
        if (cancel) break;
        update(m.id, { status: "loading" });
        try {
          const subs = await loadSubmissions(m.id, (n) => {
            if (!cancel) update(m.id, { progress: n });
          });
          const stats = computeStats(subs, models);
          const rating = await getRating(m.id).catch(() => null);
          if (!cancel) {
            update(m.id, { status: "done", stats, rating });
          }
        } catch {
          if (!cancel) update(m.id, { status: "error" });
        }
      }
    })();
    return () => {
      cancel = true;
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
      <span className="sort-ind">{sortDir === "desc" ? "▼" : "▲"}</span>
    ) : null;

  // 部全体サマリー(読み込み済みの部員から集計。期間トグルに連動)
  const periodWord =
    period === "week" ? "今週" : period === "month" ? "今月" : "全期間";
  const loadedRows = rows.filter((r) => r.status === "done" && r.stats);
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
      </div>

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">部全体サマリー</h2>
          <span className="card-sub">
            読み込み済み {loadedRows.length}/{MEMBERS.length} 人
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
        <table className="data-table">
          <thead>
            <tr>
              <th className="num">#</th>
              <th>部員</th>
              <th className="num sortable" onClick={() => sortBy("ac")}>
                {acLabel}
                {ind("ac")}
              </th>
              <th className="num sortable" onClick={() => sortBy("streak")}>
                ストリーク
                {ind("streak")}
              </th>
              <th className="num sortable" onClick={() => sortBy("rating")}>
                レート
                {ind("rating")}
              </th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((r, i) => {
              const isTop =
                r.status === "done" &&
                i === 0 &&
                sortKey === "ac" &&
                period !== "all" &&
                metric(r) > 0;
              return (
                <tr
                  key={r.member.id}
                  className={isTop ? "first-place" : undefined}
                >
                  <td className="num rank-cell">
                    {r.status === "done" ? (RANK_BADGES[i] ?? i + 1) : "—"}
                  </td>
                  <td>
                    <Link to={`/u/${r.member.id}`}>{r.member.name}</Link>
                    {isTop && (
                      <span className="best-chip">
                        👑 {period === "month" ? "今月" : "今週"}のMVP
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
                        {r.rating > 0 ? r.rating : "未レート"}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
