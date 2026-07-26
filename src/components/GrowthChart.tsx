import {
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { CHART_CHROME, TIER_COLORS, tierIndex } from "../lib/colors";
import { useTheme } from "../theme";

export interface GrowthPoint {
  /** 初AC時刻(epoch秒) */
  t: number;
  /** クリップ済み難易度 */
  d: number;
  title: string;
}

function ymd(t: number): string {
  const dt = new Date(t * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

function GrowthTip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: GrowthPoint }[];
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="chart-tip">
      <div className="tip-value">{p.title}</div>
      <div className="tip-label">
        難易度 {p.d} · {ymd(p.t)}
      </div>
    </div>
  );
}

/**
 * 成長グラフ: 初めてACした問題を 日付×難易度 の散布図で表示する。
 * 点の色はAtCoderの帯色(順序尺度のドメイン色)。難易度はy軸が同じ値を示す
 * 冗長符号化なので、識別を色だけに頼らない。
 */
export function GrowthChart({ points }: { points: GrowthPoint[] }) {
  const { resolved } = useTheme();
  const reduced = useReducedMotion();
  const chrome = CHART_CHROME[resolved];
  return (
    <ResponsiveContainer width="100%" height={240}>
      <ScatterChart margin={{ top: 16, right: 12, left: -8, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={chrome.grid} />
        <XAxis
          type="number"
          dataKey="t"
          domain={["dataMin", "dataMax"]}
          tickFormatter={(t: number) => ymd(t).slice(0, 7)}
          tickLine={false}
          axisLine={{ stroke: chrome.grid }}
          tick={{ fill: chrome.muted, fontSize: 11 }}
          minTickGap={48}
        />
        <YAxis
          type="number"
          dataKey="d"
          tickLine={false}
          axisLine={false}
          tick={{ fill: chrome.muted, fontSize: 11 }}
          allowDecimals={false}
          width={44}
        />
        <Tooltip
          content={<GrowthTip />}
          cursor={{ stroke: chrome.muted, strokeWidth: 1 }}
        />
        <Scatter
          data={points}
          isAnimationActive={!reduced && points.length <= 300}
        >
          {points.map((p, i) => (
            <Cell
              key={i}
              fill={TIER_COLORS[resolved][tierIndex(p.d)]}
              fillOpacity={0.75}
            />
          ))}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}
