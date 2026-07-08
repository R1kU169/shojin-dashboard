// 全部員のデータを kenkoooo から取得し public/snapshot/ に静的JSONとして書き出す。
//   node scripts/build-snapshot.mjs
// ねらい: 訪問者のブラウザに kenkoooo を直接叩かせない。同一オリジンのスナップショットを
// 先に読ませることで、CORS/レート制限/コンテンツブロッカーによる fetch 失敗
// (Chrome=「Failed to fetch」/ Safari=「Load failed」= TypeError)を根本から避ける。
//
// 前回のスナップショットが public/snapshot/ に残っていれば、各部員は watermark 以降だけを
// 取得して差分マージする(CIでは actions/cache で前回分を復元する)。
// Node の fetch は gzip を送るので kenkoooo の gzip 必須制限(未対応は403)を通る。
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MEMBERS } from "../src/data/members.ts";

const BASE = "https://kenkoooo.com/atcoder";
const PAGE_SIZE = 500;
const PAGE_INTERVAL_MS = 1100; // API規約: アクセス間隔は1秒以上
const MEMBER_INTERVAL_MS = 1000;
const UA = "shojin-dashboard-snapshot (+https://github.com/R1kU169/shojin-dashboard)";

// ローカル確認用: SNAPSHOT_LIMIT=1 で先頭N人だけ取得する
const LIMIT = Number(process.env.SNAPSHOT_LIMIT) || MEMBERS.length;

const OUT = fileURLToPath(new URL("../public/snapshot/", import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

async function readJson(rel) {
  const p = path.join(OUT, rel);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(await readFile(p, "utf8"));
  } catch {
    return null;
  }
}

// fromSecond 以降の提出を全ページ取得(api.ts の fetchSubmissionsSince と同じロジック)
async function fetchSubsSince(user, fromSecond) {
  const byId = new Map();
  let from = fromSecond;
  for (;;) {
    const page = await getJson(
      `${BASE}/atcoder-api/v3/user/submissions?user=${encodeURIComponent(user)}&from_second=${from}`,
    );
    let added = 0;
    for (const s of page) {
      if (!byId.has(s.id)) {
        byId.set(s.id, s);
        added++;
      }
    }
    if (page.length < PAGE_SIZE) break;
    const last = page[page.length - 1].epoch_second;
    if (added === 0 && last <= from) break;
    from = last;
    await sleep(PAGE_INTERVAL_MS);
  }
  return [...byId.values()];
}

async function main() {
  await mkdir(path.join(OUT, "subs"), { recursive: true });

  console.log("[snapshot] problems.json / problem-models.json を取得中…");
  const [problems, models] = await Promise.all([
    getJson(`${BASE}/resources/problems.json`),
    getJson(`${BASE}/resources/problem-models.json`),
  ]);
  await writeFile(path.join(OUT, "problems.json"), JSON.stringify(problems));
  await writeFile(path.join(OUT, "problem-models.json"), JSON.stringify(models));
  console.log(
    `[snapshot] problems=${problems.length} models=${Object.keys(models).length}`,
  );

  const index = { builtAt: Date.now(), members: [] };
  const targets = MEMBERS.slice(0, LIMIT);
  for (const m of targets) {
    const key = m.id.toLowerCase();
    const prev = await readJson(`subs/${key}.json`);
    const fromSecond = prev?.watermark ?? 0;
    let list;
    try {
      const fresh = await fetchSubsSince(m.id, fromSecond);
      const byId = new Map();
      for (const s of prev?.list ?? []) byId.set(s.id, s);
      for (const s of fresh) byId.set(s.id, s);
      list = [...byId.values()].sort((a, b) => a.epoch_second - b.epoch_second);
      console.log(`[snapshot] ${m.id}: +${fresh.length}件 (計 ${list.length}件)`);
    } catch (e) {
      if (prev) {
        // 一時的な失敗なら前回分を維持してビルドは続行する
        list = prev.list;
        console.warn(`[snapshot] ${m.id}: 取得失敗、前回分を維持 (${e})`);
      } else {
        console.warn(`[snapshot] ${m.id}: 取得失敗、スキップ (${e})`);
        index.members.push({ id: m.id, ok: false, count: 0 });
        await sleep(MEMBER_INTERVAL_MS);
        continue;
      }
    }
    const watermark = list.length > 0 ? list[list.length - 1].epoch_second : 0;
    await writeFile(
      path.join(OUT, `subs/${key}.json`),
      JSON.stringify({ at: Date.now(), watermark, list }),
    );
    index.members.push({ id: m.id, ok: true, count: list.length });
    await sleep(MEMBER_INTERVAL_MS);
  }

  await writeFile(path.join(OUT, "index.json"), JSON.stringify(index));
  const ok = index.members.filter((x) => x.ok).length;
  console.log(`[snapshot] 完了: ${ok}/${index.members.length} 人ぶんを書き出し`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
