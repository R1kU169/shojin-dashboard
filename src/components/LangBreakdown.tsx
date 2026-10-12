import { CATEGORICAL } from "../lib/colors";
import { useTheme } from "../theme";

export interface LangStat {
  name: string;
  n: number;
  pct: number;
}

const R = 52;
const STROKE = 14;
const C = 2 * Math.PI * R;
// 環の切れ目(弧の長さ)。1言語だけのときは切れ目を入れない
const GAP = 3;

/**
 * 使用言語の内訳。solved.ac の難易度分布と同じく、左に環グラフ、右に1言語1行の表
 * (名前・割合のバー・件数・%)を並べる。系列色は検証済みカテゴリカルパレット
 * (colors.ts CATEGORICAL)を固定順で使い、名前と数を常に並べて識別を色だけに頼らない。
 */
export function LangBreakdown({ stats }: { stats: LangStat[] }) {
  const { resolved } = useTheme();
  if (stats.length === 0) {
    return <p className="muted">提出がありません。</p>;
  }
  const total = stats.reduce((s, x) => s + x.n, 0);
  const gap = stats.length > 1 ? GAP : 0;
  let offset = 0;
  const arcs = stats.map((s, i) => {
    const len = (s.n / total) * C;
    const arc = {
      key: s.name,
      color: CATEGORICAL[resolved][i],
      dash: `${Math.max(0.5, len - gap)} ${C}`,
      offset: -offset,
    };
    offset += len;
    return arc;
  });
  return (
    <div className="lang-wrap">
      <svg
        className="lang-ring"
        viewBox="0 0 132 132"
        role="img"
        aria-label={stats.map((s) => `${s.name} ${s.n}件`).join("、")}
      >
        <g transform="rotate(-90 66 66)">
          {arcs.map((a) => (
            <circle
              key={a.key}
              cx={66}
              cy={66}
              r={R}
              fill="none"
              stroke={a.color}
              strokeWidth={STROKE}
              strokeDasharray={a.dash}
              strokeDashoffset={a.offset}
            />
          ))}
        </g>
        <text x={66} y={66} textAnchor="middle" className="lang-ring-n">
          {total.toLocaleString()}
        </text>
        <text x={66} y={84} textAnchor="middle" className="lang-ring-label">
          提出
        </text>
      </svg>
      <ul className="lang-list">
        {stats.map((s, i) => (
          <li key={s.name}>
            <span className="lang-name">
              <i style={{ background: CATEGORICAL[resolved][i] }} />
              {s.name}
            </span>
            <span className="lang-track">
              <span
                className="lang-fill"
                style={{
                  width: `${Math.max(2, s.pct * 100)}%`,
                  background: CATEGORICAL[resolved][i],
                }}
              />
            </span>
            <span className="lang-n">{s.n.toLocaleString()}件</span>
            <span className="lang-pct">{Math.round(s.pct * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
