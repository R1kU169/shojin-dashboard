import { AnimatedNumber } from "./AnimatedNumber";

export function StatCard({
  label,
  value,
  unit,
  sub,
}: {
  label: string;
  value: number | string;
  unit?: string;
  sub?: string;
}) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">
        {typeof value === "number" ? <AnimatedNumber n={value} /> : value}
        {unit && <span className="stat-unit">{unit}</span>}
      </div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}
