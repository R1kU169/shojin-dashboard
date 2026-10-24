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
import { buildContestIndex, contestIdOf, parseContestTable } from "../src/lib/contest.ts";

const BASE = "https://kenkoooo.com/atcoder";
const PAGE_SIZE = 500;
const PAGE_INTERVAL_MS = 1100; // API規約: アクセス間隔は1秒以上
const MEMBER_INTERVAL_MS = 1000;
// 差分は前回の最後の提出の1日前から取り直す(kenkoooo に遅れて載った提出・判定が変わった提出を拾う保険)
const OVERLAP_SEC = 24 * 60 * 60;
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
  // 利用規約の間隔(1秒以上)を守るため、並べずに順に取る
  const problems = await getJson(`${BASE}/resources/problems.json`);
  await sleep(PAGE_INTERVAL_MS);
  const models = await getJson(`${BASE}/resources/problem-models.json`);
  await sleep(PAGE_INTERVAL_MS);
  await writeFile(path.join(OUT, "problems.json"), JSON.stringify(problems));
  await writeFile(path.join(OUT, "problem-models.json"), JSON.stringify(models));
  console.log(
    `[snapshot] problems=${problems.length} models=${Object.keys(models).length}`,
  );

  // コンテストタブ用: コンテストの開始・長さと問題セット。取れなければ前回の contests.json で代用する
  let kContests = null;
  let kContestProblems = null;
  try {
    kContests = await getJson(`${BASE}/resources/contests.json`);
    await sleep(PAGE_INTERVAL_MS);
    kContestProblems = await getJson(`${BASE}/resources/contest-problem.json`);
    await sleep(PAGE_INTERVAL_MS);
  } catch (e) {
    kContests = null;
    kContestProblems = null;
    console.warn(`[snapshot] contests.json / contest-problem.json の取得失敗、前回分で代用 (${e})`);
  }

  const index = { builtAt: Date.now(), members: [] };
  // 部員の提出(コンテストタブの参加人数を数えるのに使う)
  const lists = {};
  const targets = MEMBERS.slice(0, LIMIT);
  for (const m of targets) {
    const key = m.id.toLowerCase();
    const prev = await readJson(`subs/${key}.json`);
    const fromSecond = prev?.watermark ? Math.max(0, prev.watermark - OVERLAP_SEC) : 0;
    let list;
    // 取れたときだけ「最新まで取れた時刻」を進める(失敗して前回分を使うときは前回の時刻のまま)
    let at = Date.now();
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
        at = prev.at ?? 0;
        console.warn(`[snapshot] ${m.id}: 取得失敗、前回分を維持 (${e})`);
      } else {
        console.warn(`[snapshot] ${m.id}: 取得失敗、スキップ (${e})`);
        index.members.push({ id: m.id, ok: false, count: 0 });
        await sleep(MEMBER_INTERVAL_MS);
        continue;
      }
    }
    lists[key] = list;
    const watermark = list.length > 0 ? list[list.length - 1].epoch_second : 0;
    await writeFile(
      path.join(OUT, `subs/${key}.json`),
      JSON.stringify({ at, watermark, list }),
    );
    index.members.push({ id: m.id, ok: true, count: list.length });
    await sleep(MEMBER_INTERVAL_MS);
  }

  // 公式レーティング(プロフィールのユーザー名の色)を取得し ratings.json に書き出す。
  // ホームのアバター色をこの色に合わせる(useMemberTiers.ts / rating.ts 参照)。
  // 未レートは 0(=灰)。一時的な失敗は前回分を維持する。
  // 同じ参加履歴から、コンテストタブの公式成績(順位・パフォ・レート変化。Unrated の参加も含む)も作る。
  const prevRatings = (await readJson("ratings.json")) ?? {};
  const prevHist = (await readJson("rating-history.json")) ?? {};
  const prevResults = (await readJson("contest-results.json")) ?? {};
  const ratings = {};
  const histories = {};
  const results = {};
  console.log("[snapshot] 公式レーティングを取得中…");
  for (const m of targets) {
    const key = m.id.toLowerCase();
    try {
      const hist = await getJson(
        `https://atcoder.jp/users/${encodeURIComponent(m.id)}/history/json`,
      );
      let r = 0;
      const pts = [];
      for (const h of hist) {
        (results[contestIdOf(h.ContestScreenName)] ??= {})[key] = {
          place: h.Place,
          perf: h.Performance,
          oldRating: h.OldRating,
          newRating: h.NewRating,
          rated: h.IsRated,
        };
        if (!h.IsRated) continue;
        r = h.NewRating;
        pts.push({ t: Math.floor(new Date(h.EndTime).getTime() / 1000), r: h.NewRating });
      }
      ratings[key] = r;
      histories[key] = pts;
    } catch (e) {
      for (const [cid, byMember] of Object.entries(prevResults)) {
        if (byMember[key]) (results[cid] ??= {})[key] = byMember[key];
      }
      if (prevRatings[key] != null) {
        ratings[key] = prevRatings[key];
        if (prevHist[key]) histories[key] = prevHist[key];
        console.warn(`[snapshot] ${m.id}: レート取得失敗、前回分を維持 (${e})`);
      } else {
        console.warn(`[snapshot] ${m.id}: レート取得失敗、スキップ (${e})`);
      }
    }
    await sleep(MEMBER_INTERVAL_MS);
  }
  await writeFile(path.join(OUT, "ratings.json"), JSON.stringify(ratings));
  await writeFile(
    path.join(OUT, "rating-history.json"),
    JSON.stringify(histories),
  );
  console.log(`[snapshot] ratings: ${Object.keys(ratings).length}人ぶん`);

  // 予定されているABC/ARC/AGCを atcoder.jp/contests/ の Upcoming テーブルから取得。
  // ホームの「次のABC/ARC/AGC」リンクに使う(番号は日付から計算できないので実データを見る)。
  // 同じページの開催中・最近の表は、kenkoooo にまだ無い直近のコンテストの開始・長さを補うのに使う。
  let tables = [];
  try {
    const res = await fetch("https://atcoder.jp/contests/", {
      headers: { "User-Agent": UA },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const upcoming = parseContestTable(html, "upcoming").sort((a, b) => a.start - b.start);
    tables = parseContestTable(html);
    await writeFile(path.join(OUT, "upcoming.json"), JSON.stringify(upcoming));
    console.log(`[snapshot] upcoming ABC/ARC/AGC: ${upcoming.length}件`);
  } catch (e) {
    console.warn(`[snapshot] 予定コンテストの取得失敗、スキップ (${e})`);
  }

  // コンテストタブ: 部員が参加したコンテストの一覧(contests.json)と、その公式成績(contest-results.json)
  if (!kContests) {
    const prev = await readJson("contests.json");
    if (prev) {
      kContests = prev.map((c) => ({
        id: c.id,
        start_epoch_second: c.start,
        duration_second: c.duration,
        title: c.title,
        rate_change: c.rate,
      }));
      kContestProblems = prev.flatMap((c) =>
        c.problems.map((p) => ({ contest_id: c.id, problem_id: p.id, problem_index: p.index })),
      );
    }
  }
  if (kContests) {
    const contests = buildContestIndex({
      contests: kContests,
      contestProblems: kContestProblems,
      tables,
      lists,
      results,
      now: Math.floor(Date.now() / 1000),
    });
    const ids = new Set(contests.map((c) => c.id));
    const kept = Object.fromEntries(Object.entries(results).filter(([cid]) => ids.has(cid)));
    await writeFile(path.join(OUT, "contests.json"), JSON.stringify(contests));
    await writeFile(path.join(OUT, "contest-results.json"), JSON.stringify(kept));
    console.log(`[snapshot] contests: ${contests.length}件 / 公式成績: ${Object.keys(kept).length}件`);
  } else {
    console.warn("[snapshot] コンテストの一覧を作れないため contests.json を更新しない");
  }

  await writeFile(path.join(OUT, "index.json"), JSON.stringify(index));
  const ok = index.members.filter((x) => x.ok).length;
  console.log(`[snapshot] 完了: ${ok}/${index.members.length} 人ぶんを書き出し`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
