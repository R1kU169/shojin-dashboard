import { CHART_CHROME, TIER_COLORS, clipDifficulty, tierIndex } from "../lib/colors";
import { useTheme } from "../theme";

export interface RecentSolved {
  id: string;
  title: string;
  contestId: string;
  url: string;
  difficulty?: number;
  second: number;
}

function ymd(sec: number): string {
  const d = new Date(sec * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function RecentList({ items }: { items: RecentSolved[] }) {
  const { resolved } = useTheme();
  if (items.length === 0) {
    return <p className="muted">ACした問題がまだありません。</p>;
  }
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>問題</th>
          <th className="num">難易度</th>
          <th className="num">解いた日</th>
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
              <td className="num">{clip ?? "—"}</td>
              <td className="num">{ymd(it.second)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
