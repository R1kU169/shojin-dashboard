import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { CHART_CHROME } from "../lib/colors";
import { useTheme } from "../theme";

interface Point {
  date: string;
  total: number;
}

function PaceTip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: Point }[];
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="chart-tip">
      <div className="tip-value">{d.total.toLocaleString()} AC</div>
      <div className="tip-label">{d.date} 週</div>
    </div>
  );
}

export function PaceChart({ cumulative }: { cumulative: Point[] }) {
  const { resolved } = useTheme();
  const reduced = useReducedMotion();
  const chrome = CHART_CHROME[resolved];
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart
        data={cumulative}
        margin={{ top: 16, right: 12, left: -8, bottom: 0 }}
      >
        <CartesianGrid vertical={false} stroke={chrome.grid} />
        <XAxis
          dataKey="date"
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
        />
        <Tooltip
          content={<PaceTip />}
          cursor={{ stroke: chrome.muted, strokeWidth: 1 }}
        />
        <Area
          type="monotone"
          dataKey="total"
          stroke={chrome.accent}
          strokeWidth={2}
          fill={chrome.accent}
          fillOpacity={0.1}
          dot={false}
          activeDot={{ r: 4, stroke: chrome.surface, strokeWidth: 2 }}
          isAnimationActive={!reduced}
          animationDuration={1000}
          animationEasing="ease-out"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
