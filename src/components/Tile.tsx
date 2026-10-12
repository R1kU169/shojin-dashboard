import type { CSSProperties } from "react";
import { AnimatedNumber } from "./AnimatedNumber";

// 線のアイコン(Lucide と同じ 24px グリッド・線幅 2)
const ICONS = {
  check: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </>
  ),
  flame: (
    <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
  ),
  trophy: (
    <>
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </>
  ),
};

/**
 * 数字のタイル。左上に色付きのアイコン、その下に大きな数字。
 * hot のときは炎の色で地を染める(ストリーク継続中)。
 */
export function Tile({
  icon,
  color,
  label,
  value,
  unit,
  sub,
  hot = false,
}: {
  icon: keyof typeof ICONS;
  color: string;
  label: string;
  value: number;
  unit?: string;
  sub?: string;
  hot?: boolean;
}) {
  return (
    <div className={hot ? "tile hot" : "tile"} style={{ "--c": color } as CSSProperties}>
      <div className="tile-head">
        <span className="tile-icon" aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {ICONS[icon]}
          </svg>
        </span>
        <span className="tile-label">{label}</span>
      </div>
      <div className="tile-value">
        <AnimatedNumber n={value} />
        {unit && <span className="tile-unit">{unit}</span>}
      </div>
      {sub && <div className="tile-sub">{sub}</div>}
    </div>
  );
}
