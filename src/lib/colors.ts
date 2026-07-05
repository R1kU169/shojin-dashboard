export type Mode = "light" | "dark";

// AtCoderのレート帯色はコミュニティ標準のドメイン色(意味を持つ順序尺度)。
// 色覚多様性下で黄↔橙が近接するため、色は常に帯ラベル・値ラベルと併記し、
// 色単独で情報を伝えない(dataviz検証: light時の黄は2.72:1 → 値ラベルで救済)。
export const TIER_LABELS = ["灰", "茶", "緑", "水", "青", "黄", "橙", "赤"] as const;

export const TIER_COLORS: Record<Mode, string[]> = {
  light: [
    "#808080", // 灰
    "#804000", // 茶
    "#008000", // 緑
    "#00A0A0", // 水
    "#0000FF", // 青
    "#A0A000", // 黄
    "#E06D00", // 橙
    "#E00000", // 赤
  ],
  dark: [
    "#9E9E9E",
    "#B06030",
    "#3CB43C",
    "#00C0C0",
    "#5C7CFA",
    "#D0D000",
    "#FF8000",
    "#FF4D4D",
  ],
};

/** チャート用の非データ色(dataviz reference palette のクロームトークン) */
export const CHART_CHROME: Record<
  Mode,
  { ink: string; ink2: string; muted: string; grid: string; surface: string; accent: string }
> = {
  light: {
    ink: "#0b0b0b",
    ink2: "#52514e",
    muted: "#898781",
    grid: "#e1e0d9",
    surface: "#fcfcfb",
    accent: "#2a78d6",
  },
  dark: {
    ink: "#ffffff",
    ink2: "#c3c2b7",
    muted: "#898781",
    grid: "#2c2c2a",
    surface: "#1a1a19",
    accent: "#3987e5",
  },
};

/** ヒートマップ: 0 =サーフェス1段落ち、1〜 =検証済み単色ブルーランプ(暗面では明るい方が高値) */
export const HEAT_STEPS: Record<Mode, string[]> = {
  light: ["#ebeae4", "#9ec5f4", "#5598e7", "#256abf", "#104281"],
  dark: ["#242423", "#184f95", "#2a78d6", "#5598e7", "#9ec5f4"],
};

/**
 * kenkoooo/AtCoder 共通の低難易度クリップ。
 * 生の推定難易度は負値になりうるため、400未満は 400/exp((400-d)/400) に写す。
 */
export function clipDifficulty(d: number): number {
  return d >= 400 ? Math.round(d) : Math.round(400 / Math.exp((400 - d) / 400));
}

/** クリップ済み難易度(>=0) → 帯インデックス 0..7 */
export function tierIndex(clipped: number): number {
  return Math.max(0, Math.min(7, Math.floor(clipped / 400)));
}
