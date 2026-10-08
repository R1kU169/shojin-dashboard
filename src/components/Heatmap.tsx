import { useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { HEAT_STEPS } from "../lib/colors";
import { epochDayToDateStr, todayEpochDay } from "../lib/stats";
import { useTheme } from "../theme";

const CELL = 12;
const PITCH = 14; // 12pxセル + 2pxサーフェスギャップ
const LEFT = 30;
const TOP = 18;
const RIGHT = 14; // 右端の列の月ラベル(「10月」)がはみ出さない余白
const DOW_LABELS: [number, string][] = [
  [1, "月"],
  [3, "水"],
  [5, "金"],
];

function bucket(count: number): number {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count === 2) return 2;
  if (count <= 4) return 3;
  return 4;
}

interface CellDatum {
  w: number;
  d: number;
  day: number;
  count: number;
}

export function Heatmap({
  dailyNewAc,
  weeks = 26,
}: {
  dailyNewAc: Map<number, number>;
  weeks?: number;
}) {
  const { resolved } = useTheme();
  const steps = HEAT_STEPS[resolved];
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(
    null,
  );
  // 狭い画面で横にスクロールするときは、最新の週(右端)が見える位置から始める
  const wrapRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [weeks]);

  const today = todayEpochDay();
  const dow = (today + 4) % 7; // 1970-01-01は木曜 → 0=日曜
  const start = today - dow - (weeks - 1) * 7; // 左端の列の日曜日

  const cells: CellDatum[] = [];
  const monthLabels: { x: number; label: string }[] = [];
  let prevMonth = "";
  for (let w = 0; w < weeks; w++) {
    const colFirstDate = epochDayToDateStr(start + w * 7);
    const month = colFirstDate.slice(5, 7);
    if (month !== prevMonth) {
      monthLabels.push({ x: LEFT + w * PITCH, label: `${Number(month)}月` });
      prevMonth = month;
    }
    for (let d = 0; d < 7; d++) {
      const day = start + w * 7 + d;
      if (day > today) continue;
      cells.push({ w, d, day, count: dailyNewAc.get(day) ?? 0 });
    }
  }

  return (
    <div>
      <div className="heatmap-wrap" ref={wrapRef}>
        <svg
          width={LEFT + weeks * PITCH + RIGHT}
          height={TOP + 7 * PITCH}
          role="img"
          aria-label={`直近${weeks}週間の精進ヒートマップ`}
        >
          {monthLabels.map((m) => (
            <text key={m.x} x={m.x} y={12} className="heatmap-label">
              {m.label}
            </text>
          ))}
          {DOW_LABELS.map(([d, l]) => (
            <text
              key={d}
              x={LEFT - 6}
              y={TOP + d * PITCH + CELL - 2}
              textAnchor="end"
              className="heatmap-label"
            >
              {l}
            </text>
          ))}
          {cells.map((c) => {
            const x = LEFT + c.w * PITCH;
            const y = TOP + c.d * PITCH;
            const date = epochDayToDateStr(c.day);
            const text = `${date} · ${c.count} AC`;
            return (
              <g key={c.day}>
                <rect
                  className="heatmap-cell"
                  style={{ "--w": c.w } as CSSProperties}
                  x={x}
                  y={y}
                  width={CELL}
                  height={CELL}
                  rx={2}
                  fill={steps[bucket(c.count)]}
                />
                {/* ヒット領域はギャップ込みでセルより一回り大きく */}
                <rect
                  x={x - 1}
                  y={y - 1}
                  width={PITCH}
                  height={PITCH}
                  fill="transparent"
                  onMouseEnter={() => setTip({ x: x + CELL / 2, y, text })}
                  onMouseLeave={() => setTip(null)}
                >
                  <title>{text}</title>
                </rect>
              </g>
            );
          })}
        </svg>
        {tip && (
          <div
            className="chart-tip heatmap-tip"
            style={{ left: tip.x, top: tip.y - 8 }}
          >
            {tip.text}
          </div>
        )}
      </div>
      {/* 凡例はスクロールの外に置く(右端までスクロールしても切れない) */}
      <div className="heatmap-legend">
        <span>少</span>
        {steps.map((s) => (
          <span key={s} className="legend-cell" style={{ background: s }} />
        ))}
        <span>多</span>
      </div>
    </div>
  );
}
