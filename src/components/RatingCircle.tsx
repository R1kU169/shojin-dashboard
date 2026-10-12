import { TIER_COLORS, TIER_LABELS, tierIndex } from "../lib/colors";
import { useTheme } from "../theme";

/**
 * AtCoder Problems・CLIST と同じレート円。帯の色の輪の中を、帯の中での位置(0〜400)だけ下から塗る。
 * 3200 以上は帯の中の位置がないので塗りつぶす。未レート(0)は空の灰色の輪。
 */
export function RatingCircle({
  rating,
  size = 12,
}: {
  rating: number;
  size?: number;
}) {
  const { resolved } = useTheme();
  const tier = tierIndex(rating);
  const color = TIER_COLORS[resolved][tier];
  const pct = rating >= 3200 ? 100 : Math.round(((rating % 400) / 400) * 100);
  return (
    <span
      className="rating-circle"
      role="img"
      aria-label={rating > 0 ? `${TIER_LABELS[tier]}色 ${rating}` : "未レート"}
      style={{
        width: size,
        height: size,
        borderColor: color,
        background: `linear-gradient(to top, ${color} ${pct}%, transparent ${pct}%)`,
      }}
    />
  );
}
