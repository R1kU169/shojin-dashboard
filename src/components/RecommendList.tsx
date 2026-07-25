import { Link } from "react-router-dom";
import { TIER_COLORS, tierIndex } from "../lib/colors";
import type { Recommendation } from "../lib/irt";
import { useTheme } from "../theme";

export function RecommendList({ recs }: { recs: Recommendation[] }) {
  const { resolved } = useTheme();
  if (recs.length === 0) {
    return <p className="muted">条件に合う未AC問題が見つかりませんでした。</p>;
  }
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>問題</th>
          <th className="num">難易度</th>
          <th className="num">AC確率</th>
        </tr>
      </thead>
      <tbody>
        {recs.map((r, i) => (
          <tr key={r.problem.id}>
            <td>
              <span
                className="tier-dot"
                style={{
                  background:
                    TIER_COLORS[resolved][tierIndex(r.clippedDifficulty)],
                }}
              />
              <a href={r.url} target="_blank" rel="noreferrer">
                {r.problem.title}
              </a>
              {i === 0 && <span className="best-chip">⭐ ベストマッチ</span>}
              <span className="muted contest-id">{r.problem.contest_id}</span>
              <Link
                className="to-editor"
                to={`/editor?contest=${encodeURIComponent(r.problem.contest_id)}&task=${encodeURIComponent(r.problem.id)}&title=${encodeURIComponent(r.problem.title)}`}
                title="エディターで解いてAtCoderに提出する"
              >
                ✎ エディターで解く
              </Link>
            </td>
            <td className="num">{r.clippedDifficulty}</td>
            <td className="num prob-cell">
              <span className="prob-meter">
                <span
                  className="prob-fill"
                  style={{ width: `${Math.round(r.probability * 100)}%` }}
                />
              </span>
              {Math.round(r.probability * 100)}%
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
