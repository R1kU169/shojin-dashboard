import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { CHART_CHROME, TIER_COLORS, TIER_LABELS } from "../lib/colors";
import { useTheme } from "../theme";

const RANGES = [
  "1-399",
  "400-799",
  "800-1199",
  "1200-1599",
  "1600-1999",
  "2000-2399",
  "2400-2799",
  "2800+",
];

interface Datum {
  label: string;
  range: string;
  count: number;
  fill: string;
}

function TierTip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: Datum }[];
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="chart-tip">
      <div className="tip-value">{d.count.toLocaleString()} AC</div>
      <div className="tip-label">
        <span className="tier-dot" style={{ background: d.fill }} />
        {d.label} ({d.range})
      </div>
    </div>
  );
}

export function DifficultyBars({ tierCounts }: { tierCounts: number[] }) {
  const { resolved } = useTheme();
  const reduced = useReducedMotion();
  const chrome = CHART_CHROME[resolved];
  const data: Datum[] = TIER_LABELS.map((label, i) => ({
    label,
    range: RANGES[i],
    count: tierCounts[i],
    fill: TIER_COLORS[resolved][i],
  }));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 24, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={chrome.grid} />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={{ stroke: chrome.grid }}
          tick={{ fill: chrome.muted, fontSize: 12 }}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tick={{ fill: chrome.muted, fontSize: 11 }}
          allowDecimals={false}
        />
        <Tooltip content={<TierTip />} cursor={{ fill: "transparent" }} />
        <Bar
          dataKey="count"
          maxBarSize={24}
          radius={[4, 4, 0, 0]}
          isAnimationActive={!reduced}
          animationDuration={800}
          animationEasing="ease-out"
        >
          {data.map((d) => (
            <Cell key={d.label} fill={d.fill} />
          ))}
          <LabelList
            dataKey="count"
            position="top"
            fill={chrome.ink2}
            fontSize={11}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
