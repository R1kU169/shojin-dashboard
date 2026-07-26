import { CATEGORICAL } from "../lib/colors";
import { useTheme } from "../theme";

export interface LangStat {
  name: string;
  n: number;
  pct: number;
}

/**
 * 使用言語の内訳(積み上げバー+凡例)。系列色は検証済みカテゴリカルパレット
 * (colors.ts CATEGORICAL)を固定順で使い、凡例に名前・件数・%を常設して
 * 識別を色だけに頼らない。セグメント間は2pxの地の隙間で区切る。
 */
export function LangBreakdown({ stats }: { stats: LangStat[] }) {
  const { resolved } = useTheme();
  if (stats.length === 0) {
    return <p className="muted">提出がありません。</p>;
  }
  return (
    <div className="lang-dist">
      <div className="lang-bar">
        {stats.map((s, i) => (
          <span
            key={s.name}
            style={{ flex: s.n, background: CATEGORICAL[resolved][i] }}
            title={`${s.name} ${s.n}件`}
          />
        ))}
      </div>
      <div className="tier-dist-legend">
        {stats.map((s, i) => (
          <span key={s.name}>
            <i style={{ background: CATEGORICAL[resolved][i] }} />
            {s.name} {s.n}件 ({Math.round(s.pct * 100)}%)
          </span>
        ))}
      </div>
    </div>
  );
}
