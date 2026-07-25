import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { CHART_CHROME, TIER_COLORS } from "../lib/colors";
import type { RatePoint } from "../lib/types";
import { useTheme } from "../theme";

interface Row {
  label: string;
  r: number;
}

// 帯の境界(このレートで色が変わる)。境界線を帯色で薄く引いて色帯を示す。
const TIER_BOUNDS = [400, 800, 1200, 1600, 2000, 2400, 2800];

function ymd(t: number): string {
  const d = new Date(t * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function RatingTip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: Row }[];
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="chart-tip">
      <div className="tip-value">{d.r}</div>
      <div className="tip-label">{d.label}</div>
    </div>
  );
}

export function RatingChart({
  history,
  color,
}: {
  history: RatePoint[];
  color?: string;
}) {
  const { resolved } = useTheme();
  const reduced = useReducedMotion();
  const chrome = CHART_CHROME[resolved];
  const line = color ?? chrome.accent;
  const data: Row[] = history.map((p) => ({ label: ymd(p.t), r: p.r }));
  const rs = history.map((p) => p.r);
  const min = Math.min(...rs);
  const max = Math.max(...rs);
  const bounds = TIER_BOUNDS.filter((b) => b > min && b < max);

  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart
        data={data}
        margin={{ top: 16, right: 12, left: -8, bottom: 0 }}
      >
        <CartesianGrid vertical={false} stroke={chrome.grid} />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={{ stroke: chrome.grid }}
          tick={{ fill: chrome.muted, fontSize: 11 }}
          tickFormatter={(d: string) => d.slice(0, 7)}
          minTickGap={48}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tick={{ fill: chrome.muted, fontSize: 11 }}
          allowDecimals={false}
          width={44}
        />
        {bounds.map((b) => (
          <ReferenceLine
            key={b}
            y={b}
            stroke={TIER_COLORS[resolved][b / 400]}
            strokeDasharray="3 3"
            strokeOpacity={0.5}
          />
        ))}
        <Tooltip
          content={<RatingTip />}
          cursor={{ stroke: chrome.muted, strokeWidth: 1 }}
        />
        <Line
          type="monotone"
          dataKey="r"
          stroke={line}
          strokeWidth={2}
          dot={{ r: 2, fill: line, strokeWidth: 0 }}
          activeDot={{ r: 4, stroke: chrome.surface, strokeWidth: 2 }}
          isAnimationActive={!reduced}
          animationDuration={1000}
          animationEasing="ease-out"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
