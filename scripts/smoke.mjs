// 実APIに対するロジックのスモークテスト(ブラウザ外で確認する用):
//   node scripts/smoke.mjs [atcoder_id]
// NodeのfetchはAccept-Encoding: gzipを送るのでkenkoooo APIのgzip必須制限を通る
import { fetchSubmissionsSince } from "../src/lib/api.ts";
import { computeStats } from "../src/lib/stats.ts";
import { collectIrtItems, estimateTheta, recommend } from "../src/lib/irt.ts";
import { clipDifficulty } from "../src/lib/colors.ts";

const user = process.argv[2] ?? "chokudai";

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status}: ${url}`);
  return res.json();
}

console.log("[smoke] 静的リソースを取得中…");
const models = await getJson(
  "https://kenkoooo.com/atcoder/resources/problem-models.json",
);
const problems = await getJson(
  "https://kenkoooo.com/atcoder/resources/problems.json",
);
console.log(
  `[smoke] problems=${problems.length} models=${Object.keys(models).length}`,
);

console.log(`[smoke] ${user} の提出を取得中…`);
const subs = await fetchSubmissionsSince(user, 0, (n) =>
  process.stdout.write(`\r  ${n}件`),
);
console.log(`\n[smoke] 提出 ${subs.length}件`);

const stats = computeStats(subs, models);
console.log(
  `[smoke] AC ${stats.totalAc} / 今週 ${stats.weeklyAc} / streak ${stats.currentStreak} (最長 ${stats.longestStreak})`,
);
console.log(`[smoke] 帯別AC(灰→赤): ${stats.tierCounts.join(", ")}`);

const theta = estimateTheta(
  collectIrtItems(models, stats.solved, stats.attemptedNoAc),
);
console.log(
  `[smoke] θ=${theta?.toFixed(0)} (内部レート換算 ${theta === null ? "-" : clipDifficulty(theta)})`,
);

if (theta !== null) {
  for (const r of recommend(theta, problems, models, stats.solved, 5)) {
    console.log(
      `  → ${r.problem.title} (diff ${r.clippedDifficulty}, P=${(r.probability * 100).toFixed(0)}%) ${r.url}`,
    );
  }
}
console.log("[smoke] OK");
