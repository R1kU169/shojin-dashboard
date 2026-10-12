import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { CHART_CHROME, TIER_COLORS, tierIndex } from "../lib/colors";
import type { RatePoint } from "../lib/types";
import { useTheme } from "../theme";
import { jstDateStr } from "../lib/stats";

interface Row {
  label: string;
  r: number;
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

/**
 * レーティング推移。AtCoder 公式・Codeforces と同じく、背景をレート帯の色で塗り分けて
 * 「いまどの色にいて、次の色まであとどれだけか」を線の位置で読めるようにする。
 * 上端は最高値の少し上(次の色の帯が少し見える)まで取る。
 */
export function RatingChart({ history }: { history: RatePoint[] }) {
  const { resolved } = useTheme();
  const reduced = useReducedMotion();
  const chrome = CHART_CHROME[resolved];
  const tiers = TIER_COLORS[resolved];
  const data: Row[] = history.map((p) => ({ label: jstDateStr(p.t), r: p.r }));
  const rs = history.map((p) => p.r);
  const lo = Math.max(0, Math.floor((Math.min(...rs) - 100) / 100) * 100);
  const hi = Math.ceil((Math.max(...rs) + 150) / 100) * 100;
  const bands: { t: number; y1: number; y2: number }[] = [];
  for (let t = tierIndex(lo); t <= tierIndex(hi); t++) {
    const y1 = Math.max(lo, t * 400);
    const y2 = t === 7 ? hi : Math.min(hi, (t + 1) * 400);
    if (y2 > y1) bands.push({ t, y1, y2 });
  }
  // 目盛りは帯の境目(400の倍数)を必ず含む刻みにする(自動だと 0/150/300/500 のように不揃いになる)
  const span = hi - lo;
  const step = span <= 600 ? 100 : span <= 1600 ? 200 : 400;
  const ticks: number[] = [];
  for (let y = Math.ceil(lo / step) * step; y <= hi; y += step) ticks.push(y);
  const bandOpacity = resolved === "dark" ? 0.2 : 0.13;
  const line = chrome.ink2;

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart
        data={data}
        // 右端の日付(2026-10 など)のラベルが切れないよう右に余白をとる
        margin={{ top: 8, right: 26, left: -8, bottom: 0 }}
      >
        {bands.map((b) => (
          <ReferenceArea
            key={b.t}
            y1={b.y1}
            y2={b.y2}
            fill={tiers[b.t]}
            fillOpacity={bandOpacity}
            stroke="none"
            ifOverflow="hidden"
          />
        ))}
        <CartesianGrid vertical={false} stroke={chrome.grid} strokeOpacity={0.6} />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={{ stroke: chrome.grid }}
          tick={{ fill: chrome.muted, fontSize: 11 }}
          tickFormatter={(d: string) => d.slice(0, 7)}
          minTickGap={48}
        />
        <YAxis
          domain={[lo, hi]}
          ticks={ticks}
          interval={0}
          tickLine={false}
          axisLine={false}
          tick={{ fill: chrome.muted, fontSize: 11 }}
          allowDecimals={false}
          allowDataOverflow
          width={44}
        />
        <Tooltip
          content={<RatingTip />}
          cursor={{ stroke: chrome.muted, strokeWidth: 1 }}
        />
        <Line
          type="linear"
          dataKey="r"
          stroke={line}
          strokeWidth={1.5}
          // 点はその回のレートの帯の色で塗る(線は帯の上で読めるよう中立色)
          dot={(p: { cx?: number; cy?: number; index?: number; payload?: Row }) =>
            p.cx == null || p.cy == null || !p.payload ? (
              <g key={`d${p.index}`} />
            ) : (
              <circle
                key={`d${p.index}`}
                cx={p.cx}
                cy={p.cy}
                r={3.5}
                fill={tiers[tierIndex(p.payload.r)]}
                stroke={chrome.surface}
                strokeWidth={1.5}
              />
            )
          }
          activeDot={{ r: 5, stroke: chrome.surface, strokeWidth: 2 }}
          isAnimationActive={!reduced}
          animationDuration={1000}
          animationEasing="ease-out"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
