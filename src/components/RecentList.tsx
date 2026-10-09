import { CHART_CHROME, TIER_COLORS, clipDifficulty, tierIndex } from "../lib/colors";
import { jstDateTimeStr } from "../lib/stats";
import { useTheme } from "../theme";

export interface RecentSolved {
  id: string;
  title: string;
  contestId: string;
  url: string;
  difficulty?: number;
  second: number;
}

export function RecentList({ items }: { items: RecentSolved[] }) {
  const { resolved } = useTheme();
  if (items.length === 0) {
    return <p className="muted">ACした問題がまだありません。</p>;
  }
  return (
    <table className="data-table stack-table">
      <thead>
        <tr>
          <th>問題</th>
          <th className="num">難易度</th>
          <th className="num">解いた日時</th>
        </tr>
      </thead>
      <tbody>
        {items.map((it) => {
          const clip =
            it.difficulty != null ? clipDifficulty(it.difficulty) : null;
          const dot =
            clip != null
              ? TIER_COLORS[resolved][tierIndex(clip)]
              : CHART_CHROME[resolved].muted;
          return (
            <tr key={it.id}>
              <td>
                <span className="tier-dot" style={{ background: dot }} />
                <a href={it.url} target="_blank" rel="noreferrer">
                  {it.title}
                </a>
                <span className="muted contest-id">{it.contestId}</span>
              </td>
              <td className="num" data-label="難易度">{clip ?? "—"}</td>
              <td className="num" data-label="解いた日時">{jstDateTimeStr(it.second)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
