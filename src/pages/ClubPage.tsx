import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { MEMBERS } from "../data/members";
import { getProblemModels, loadSubmissions } from "../lib/cache";
import { TIER_COLORS, clipDifficulty, tierIndex } from "../lib/colors";
import { collectIrtItems, estimateTheta } from "../lib/irt";
import { computeStats } from "../lib/stats";
import type { UserStats } from "../lib/stats";
import type { Member } from "../lib/types";
import { useTheme } from "../theme";

interface Row {
  member: Member;
  status: "pending" | "loading" | "done" | "error";
  progress: number;
  stats?: UserStats;
  thetaClip?: number | null;
}

const RANK_BADGES = ["🥇", "🥈", "🥉"];

export function ClubPage() {
  const { resolved } = useTheme();
  const [rows, setRows] = useState<Row[]>(
    MEMBERS.map((m) => ({ member: m, status: "pending", progress: 0 })),
  );

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
          const theta = estimateTheta(
            collectIrtItems(models, stats.solved, stats.attemptedNoAc),
          );
          if (!cancel) {
            update(m.id, {
              status: "done",
              stats,
              thetaClip: theta === null ? null : clipDifficulty(theta),
            });
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

  const done = rows
    .filter((r) => r.status === "done")
    .sort((a, b) => (b.stats?.weeklyAc ?? 0) - (a.stats?.weeklyAc ?? 0));
  const rest = rows.filter((r) => r.status !== "done");
  const ordered = [...done, ...rest];

  return (
    <div className="page">
      <h1>クラブランキング</h1>
      <p className="muted">
        今週(直近7日)の新規AC数順。名前をタップすると個人ページへ。
      </p>
      <section className="card">
        <table className="data-table">
          <thead>
            <tr>
              <th className="num">#</th>
              <th>部員</th>
              <th className="num">今週AC</th>
              <th className="num">累計AC</th>
              <th className="num">ストリーク</th>
              <th className="num">推定内部レート</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((r, i) => {
              const isMvp =
                r.status === "done" && i === 0 && (r.stats?.weeklyAc ?? 0) > 0;
              return (
              <tr
                key={r.member.id}
                className={isMvp ? "first-place" : undefined}
              >
                <td className="num rank-cell">
                  {r.status === "done" ? (RANK_BADGES[i] ?? i + 1) : "—"}
                </td>
                <td>
                  <Link to={`/u/${r.member.id}`}>{r.member.name}</Link>
                  {isMvp && <span className="best-chip">👑 今週のMVP</span>}
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
                <td className="num">{r.stats?.weeklyAc ?? ""}</td>
                <td className="num">
                  {r.stats ? r.stats.totalAc.toLocaleString() : ""}
                </td>
                <td className="num">
                  {r.stats ? `${r.stats.currentStreak}日` : ""}
                </td>
                <td className="num">
                  {r.thetaClip != null && (
                    <>
                      <span
                        className="tier-dot"
                        style={{
                          background:
                            TIER_COLORS[resolved][tierIndex(r.thetaClip)],
                        }}
                      />
                      {r.thetaClip}
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
