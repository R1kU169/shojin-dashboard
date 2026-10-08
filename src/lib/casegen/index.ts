// エディターのコーナーケース生成。問題文の「入力」「制約」を読み、境界の入力を作る。
// 計算量チェッカー(complexity/)と同じく、ブラウザの中だけで動き、他の src/lib を import しない。
export { buildSpec } from "./spec.ts";
export type { Overrides, Preset, Slot, Spec } from "./spec.ts";
export { generateCase } from "./generate.ts";
export type { GeneratedCase } from "./generate.ts";
export { exprToString, formatBig } from "./expr.ts";
