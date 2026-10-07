// 計算量チェッカーの検証: AtCoder の公式解説の実装例(C++/Python)をチェッカーに通し、
// 解説の計算量から決めた期待値(scripts/verify-complexity.expected.json)と比べる。
//
//   node scripts/verify-complexity.mjs                    期待値表のコンテストを全部調べて集計と × を出す
//   node scripts/verify-complexity.mjs --only abc380_b    1問(abc380 なら1回分)だけ詳しく(解説の文・内訳・警告。--code でコードも)
//   node scripts/verify-complexity.mjs --contests abc479  コンテストを足す(期待値の無いケースは「未レビュー」)
//   node scripts/verify-complexity.mjs --skeleton         期待値の無いケースを期待値表に足す(time は null)
//   node scripts/verify-complexity.mjs --report <path>    問題ごとの表を Markdown で書く
//   node scripts/verify-complexity.mjs --json <path>      ケースごとの結果を JSON で書く(修正の前後を比べる用)
//
// 判定: ◎ time.text が期待値と同じ / ○ accept(設計どおりの差、理由は note)/ × それ以外。
// もう1つの基準として、問題文の制約と実行時間制限で evaluate() し、AC 解なのに TLE と出たら数える。
//
// 取得した HTML は .cache/verify-complexity/ に置き、無いときだけ 1 秒に 1 件取りに行く。
// 解説のコードは AtCoder の著作物なので、期待値表にもテストにもコードは入れない(ハッシュだけ持つ)。
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeCode, evaluate, parseBoundValue } from "../src/lib/complexity/index.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, ".cache/verify-complexity");
const EXPECTED = join(ROOT, "scripts/verify-complexity.expected.json");
const UA = "shojin-dashboard complexity verifier (https://github.com/R1kU169/shojin-dashboard)";

// ---- 引数 ---------------------------------------------------------------------

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const only = opt("--only");
const reportPath = opt("--report");
const jsonPath = opt("--json");
const extraContests = (opt("--contests") ?? "").split(",").filter(Boolean);
const skeleton = args.includes("--skeleton");

const expected = existsSync(EXPECTED) ? JSON.parse(readFileSync(EXPECTED, "utf8")) : { contests: [], cases: {} };
const contests = only ? [only.replace(/_[a-z]+$/, "")] : [...new Set([...expected.contests, ...extraContests])];

// ---- 取得(キャッシュ付き)-------------------------------------------------------

let lastFetch = 0;
async function get(url) {
  const file = join(CACHE, url.replace(/^https:\/\//, "").replace(/[^a-zA-Z0-9._-]/g, "_") + ".html");
  if (existsSync(file)) return readFileSync(file, "utf8");
  const wait = lastFetch + 1000 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetch = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${res.status}: ${url}`);
  const html = await res.text();
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(file, html);
  return html;
}

// ---- HTML から取り出す -----------------------------------------------------------

const ENTITY = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'", nbsp: " " };
function decode(s) {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&(lt|gt|amp|quot|apos|nbsp);/g, (_, n) => ENTITY[n]);
}

/** 解説一覧から、問題ごとの公式の日本語解説の id を取る */
function officialEditorials(listHtml, contest) {
  const out = [];
  for (const sec of listHtml.split(/<h3>/).slice(1)) {
    const task = /\/tasks\/([a-z0-9_]+)"/.exec(sec)?.[1];
    if (!task || !task.startsWith(contest + "_")) continue;
    const ids = [];
    for (const li of sec.split(/<li[ >]/).slice(1)) {
      if (!/label-default">(公式|Official)</.test(li) || /en_translator/.test(li)) continue;
      const m = new RegExp(`href="/contests/${contest}/editorial/(\\d+)"[^>]*>([^<]*)<`).exec(li);
      if (m && m[2].trim() !== "Editorial" && !ids.includes(m[1])) ids.push(m[1]);
    }
    out.push({ task, ids });
  }
  return out;
}

/** コードブロックの言語。class は language-cpp / language-C++ / language-Python3 などの揺れがある */
function guessLang(cls, code) {
  const c = /language-([\w+#]+)/.exec(cls)?.[1].toLowerCase();
  if (c && /^(cpp|c\+\+|c|cc|cxx)/.test(c)) return "cpp";
  if (c && /^(python|py)/.test(c)) return "python";
  if (c && !/^(text|plain|plaintext|none|txt)$/.test(c)) return null;
  if (/#include|\bint\s+main\s*\(/.test(code)) return "cpp";
  if (/\bdef |\binput\(\)|\bprint\(|^import |^from \w+ import/m.test(code)) return "python";
  return null;
}

/** 解説ページの本文から、コードブロックと計算量に触れた文を取る */
function parseEditorial(html) {
  const start = html.indexOf('<hr class="mt-1">');
  const end = html.indexOf('<div class="clearfix">', start);
  const body = html.slice(start, end > 0 ? end : undefined);
  const blocks = [];
  for (const m of body.matchAll(/<pre([^>]*)>([\s\S]*?)<\/pre>/g)) {
    const cls = m[1] + (/<code([^>]*)>/.exec(m[2])?.[1] ?? "");
    const code = decode(m[2]).replace(/^\n/, "");
    const lang = guessLang(cls, code);
    if (lang) blocks.push({ lang, code, hash: createHash("sha1").update(code).digest("hex").slice(0, 8) });
  }
  const text = decode(body.replace(/<pre[\s\S]*?<\/pre>/g, ""));
  const stated = [...text.matchAll(/[^。\n]*O\([^。\n]*/g)]
    .map((m) => m[0].trim())
    .filter((s) => /計算量|時間|全体|解け|十分/.test(s));
  // 実装例が提出へのリンクだけのもの(提出ページは取得できない)
  const submissionLinks = (body.match(/\/submissions\/\d+/g) ?? []).length;
  return { blocks, stated, text, submissionLinks };
}

/** LaTeX の制約の1行を素の文字にする */
function untex(s) {
  return s
    .replace(/\\\(|\\\)|\$/g, "")
    .replace(/\\(?:leq|leqq|le)(?![a-z])/g, "≤")
    .replace(/\\(?:geq|geqq|ge)(?![a-z])/g, "≥")
    .replace(/\\lt(?![a-z])/g, "<")
    .replace(/\\gt(?![a-z])/g, ">")
    .replace(/\\(?:times|cdot)(?![a-z])/g, "×")
    .replace(/\\(?:mathrm|text|mathit|operatorname)\{([^}]*)\}/g, "$1")
    .replace(/\\[,;! ]/g, " ")
    .replace(/\^\s*\{\s*([^}]*)\}/g, "^$1")
    .replace(/_\s*\{\s*([^}]*)\}/g, "_$1")
    .replace(/\s*([_^])\s*/g, "$1")
    .replace(/\\vert/g, "|")
    .replace(/\s+/g, " ")
    .trim();
}

/** 問題ページから制約(変数 → 上限)と実行時間制限を取る */
function parseTask(html) {
  const tl = Number(/実行時間制限:\s*([\d.]+)\s*sec/.exec(html)?.[1] ?? 2);
  const values = {};
  const i = html.indexOf("<h3>制約</h3>");
  if (i < 0) return { tl, values, lines: [] };
  const sec = html.slice(i, html.indexOf("</section>", i));
  const lines = [...sec.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => untex(decode(m[1])));
  // 「100 を満たす偶数」のような後ろの説明は落として数だけ読む
  const valueOf = (s) => {
    const t = s.replace(/\s/g, "");
    const num = /^[\d×^.,*]+/.exec(t)?.[0];
    return (num ? parseBoundValue(num)?.hi : undefined) ?? values[t.toUpperCase()];
  };
  for (const line of lines) {
    // H,W は 1 以上 500 以下の整数
    const range = /^([A-Za-z]\w*(?:\s*,\s*[A-Za-z]\w*)*) は\s*\S+\s*以上\s*(\S+?)\s*以下/.exec(line);
    if (range) {
      const hi = valueOf(range[2]);
      if (hi !== undefined) for (const v of range[1].split(",")) values[v.trim().toUpperCase()] ??= hi;
    }
    // 1≤ A_i≤ N (1≤ i≤ N) の添字の範囲は読まない。「N は 2 ≤ N ≤ 100 を満たす」の前置きも落とす
    const parts = line.replace(/\([^)]*\)/g, "").replace(/^[A-Za-z]\w* は\s*/, "").replace(/≥/g, "≤").split(/≤|</).map((p) => p.trim());
    if (parts.length >= 3) {
      const hi = valueOf(parts.at(-1));
      if (hi === undefined) continue;
      for (const mid of parts.slice(1, -1)) {
        for (const v of mid.split(",")) {
          const name = v.trim();
          if (/^(\|[A-Za-z]\w*\||[A-Za-z]\w*)$/.test(name) && values[name.toUpperCase()] === undefined) values[name.toUpperCase()] = hi;
        }
      }
    }
    // S は長さ 1 以上 2×10^5 以下の文字列 / S は長さ N の文字列
    const len = /([A-Z][A-Za-z\d]*)(?:_i)? は.*?長さ\s*(?:\S+\s*以上\s*)?(\S+?)\s*(?:以下|の)/.exec(line);
    if (len) {
      const v = valueOf(len[2]);
      if (v !== undefined && values[`|${len[1].toUpperCase()}|`] === undefined) values[`|${len[1].toUpperCase()}|`] = v;
    }
  }
  return { tl, values, lines };
}

// ---- 調べる ---------------------------------------------------------------------

const results = [];
const missingEditorial = [];
for (const contest of contests) {
  const list = await get(`https://atcoder.jp/contests/${contest}/editorial?lang=ja`);
  for (const { task, ids } of officialEditorials(list, contest)) {
    if (only && task !== only && contest !== only) continue;
    if (ids.length === 0) missingEditorial.push(task);
    const taskInfo = parseTask(await get(`https://atcoder.jp/contests/${contest}/tasks/${task}?lang=ja`));
    for (const id of ids) {
      const ed = parseEditorial(await get(`https://atcoder.jp/contests/${contest}/editorial/${id}?lang=ja`));
      if (ed.blocks.length === 0) missingEditorial.push(`${task}@${id}(${ed.submissionLinks ? "提出へのリンクのみ" : "コードなし"})`);
      ed.blocks.forEach((b, bi) => {
        const key = `${task}@${id}#${bi}`;
        const a = analyzeCode(b.code, b.lang);
        const exp = expected.cases[key];
        const values = {};
        for (const v of a.variables) {
          const val = exp?.values?.[v.name] ?? taskInfo.values[v.name.toUpperCase()];
          if (val !== undefined) values[v.name] = val;
        }
        const ev = evaluate(a.time.full, values, b.lang === "python" ? "pypy" : b.lang, taskInfo.tl);
        let status;
        if (!exp || exp.time === null) status = "unreviewed";
        else if (exp.hash !== b.hash) status = "changed";
        else if (a.time.text === exp.time) status = "match";
        else if ((exp.accept ?? []).includes(a.time.text)) status = "accept";
        else status = "mismatch";
        results.push({ key, task, id, block: b, ed, taskInfo, a, ev, exp, status });
      });
    }
  }
}

// ---- 出力 -----------------------------------------------------------------------

const MARK = { match: "◎", accept: "○", mismatch: "×", unreviewed: "?", changed: "!" };
const verdictText = (ev) => (ev.verdict ? `${ev.verdict} (${ev.opsText} 回, 予算比 ${ev.ratio.toFixed(2)})` : `値なし: ${ev.missing.join(", ")}`);

if (only) {
  for (const r of results) {
    console.log(`\n==== ${r.key} [${r.block.lang}] ${MARK[r.status]} ${r.status}  https://atcoder.jp/contests/${r.task.replace(/_[a-z]+$/, "")}/editorial/${r.id}`);
    console.log(`解説: ${r.ed.stated.join(" / ") || "(計算量の記述なし)"}`);
    console.log(`制約: ${r.taskInfo.lines.join(" / ")}  (TL ${r.taskInfo.tl} sec)`);
    console.log(`期待: ${r.exp?.time ?? "-"}${r.exp?.accept?.length ? ` (許容: ${r.exp.accept.join(", ")})` : ""}${r.exp?.note ? `  ${r.exp.note}` : ""}`);
    console.log(`結果: time ${r.a.time.text} / space ${r.a.space.text} / 推定 ${r.a.confidence} / 判定 ${verdictText(r.ev)}`);
    for (const b of r.a.breakdown) console.log(`  ${b.axis} L${b.loc.line} ${b.label} = ${b.text}  (${b.reason})`);
    for (const w of r.a.warnings) console.log(`  [${w.level}] ${w.line ? `L${w.line} ` : ""}${w.message}`);
    if (args.includes("--code")) console.log(r.block.code.split("\n").map((l, i) => `${String(i + 1).padStart(3)}| ${l}`).join("\n"));
  }
} else {
  const count = (s) => results.filter((r) => r.status === s).length;
  const tle = results.filter((r) => r.ev.verdict === "tle");
  console.log(`ケース ${results.length} 件: ◎ ${count("match")} / ○ ${count("accept")} / × ${count("mismatch")} / 未レビュー ${count("unreviewed")} / 要再レビュー ${count("changed")}`);
  console.log(`AC 解なのに TLE 判定: ${tle.length} 件${tle.length ? ` (${tle.map((r) => r.key).join(", ")})` : ""}`);
  if (missingEditorial.length) console.log(`公式解説・コードなし: ${missingEditorial.join(", ")}`);
  for (const r of results.filter((r) => r.status === "mismatch" || r.status === "changed" || r.status === "unreviewed")) {
    console.log(`  ${MARK[r.status]} ${r.key} [${r.block.lang}] 結果 ${r.a.time.text}  期待 ${r.exp?.time ?? "-"}  解説 ${r.exp?.stated ?? r.ed.stated.at(-1) ?? "-"}`);
  }
}

if (skeleton) {
  for (const r of results) {
    if (expected.cases[r.key]) continue;
    expected.cases[r.key] = { lang: r.block.lang, hash: r.block.hash, stated: null, source: null, time: null, accept: [], note: "" };
  }
  expected.contests = [...new Set([...expected.contests, ...contests])];
  const sorted = Object.fromEntries(Object.entries(expected.cases).sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true })));
  writeFileSync(EXPECTED, JSON.stringify({ contests: expected.contests, cases: sorted }, null, 2) + "\n");
  console.log(`期待値表を更新しました: ${EXPECTED}`);
}

if (reportPath) {
  const esc = (s) => String(s ?? "").replace(/\|/g, "\\|");
  const rows = results.map((r) => {
    const url = `https://atcoder.jp/contests/${r.task.replace(/_[a-z]+$/, "")}/editorial/${r.id}`;
    const v = r.ev.verdict ?? "—";
    return `| [${r.task.toUpperCase().replace("_", " ")}](${url}) | ${r.block.lang} | ${esc(r.exp?.stated ?? "—")} | ${esc(r.exp?.time ?? "—")} | ${esc(r.a.time.text)} | ${MARK[r.status]} | ${v} | ${esc(r.exp?.note)} |`;
  });
  const head = "| 問題 | 言語 | 解説の計算量 | 期待 | チェッカー | 判定 | 制約での見積もり | メモ |\n| --- | --- | --- | --- | --- | --- | --- | --- |";
  writeFileSync(reportPath, head + "\n" + rows.join("\n") + "\n");
  console.log(`表を書きました: ${reportPath}`);
}

if (jsonPath) {
  const out = Object.fromEntries(results.map((r) => [r.key, { status: r.status, time: r.a.time.text, space: r.a.space.text, verdict: r.ev.verdict }]));
  writeFileSync(jsonPath, JSON.stringify(out, null, 1) + "\n");
}
