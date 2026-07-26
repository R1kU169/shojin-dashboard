import { Link } from "react-router-dom";
import {
  CHART_CHROME,
  TIER_COLORS,
  clipDifficulty,
  tierIndex,
} from "../lib/colors";
import { useTheme } from "../theme";

export interface ReviewItem {
  id: string;
  title: string;
  contestId: string;
  url: string;
  difficulty?: number;
  /** 最終挑戦時刻(epoch秒) */
  second: number;
  /** 挑戦(非AC提出)回数 */
  count: number;
}

function ymd(sec: number): string {
  const d = new Date(sec * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function ReviewList({ items }: { items: ReviewItem[] }) {
  const { resolved } = useTheme();
  if (items.length === 0) {
    return (
      <p className="muted">未ACのまま残っている問題はありません 🎉</p>
    );
  }
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>問題</th>
          <th className="num">難易度</th>
          <th className="num">挑戦</th>
          <th className="num">最終挑戦日</th>
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
                <Link
                  className="to-editor"
                  to={`/editor?contest=${encodeURIComponent(it.contestId)}&task=${encodeURIComponent(it.id)}&title=${encodeURIComponent(it.title)}`}
                  title="エディターで解き直してAtCoderに提出する"
                >
                  ✎ エディターで解く
                </Link>
              </td>
              <td className="num">{clip ?? "—"}</td>
              <td className="num">{it.count}回</td>
              <td className="num">{ymd(it.second)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
