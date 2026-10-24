// コンテストタブの計算(得点・時間・ペナルティ・部内順位・コンテスト一覧)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildContestIndex,
  contestIdOf,
  contestProblems,
  elapsedStr,
  mergeUpcoming,
  parseContestTable,
  pickDefaultContest,
  rankMembers,
  scoreMember,
  shortContestName,
  submissionUrl,
} from "../src/lib/contest.ts";
import type { MemberScore } from "../src/lib/contest.ts";
import type { ClubContest, OfficialResult, Submission } from "../src/lib/types.ts";

// ABC481: 2026-10-24 21:00 JST から 100 分
const START = 1792843200;
const ABC481: ClubContest = {
  id: "abc481",
  title: "SMBCプログラミングコンテスト #2(AtCoder Beginner Contest 481)",
  start: START,
  duration: 6000,
  rate: "~ 1999",
  joined: 1,
  problems: ["a", "b", "c", "d", "e", "f", "g"].map((x) => ({ id: `abc481_${x}`, index: x.toUpperCase() })),
};

let nextId = 1;
function sub(problem: string, at: number, result: string, point = result === "AC" ? 100 : 0, contest = "abc481"): Submission {
  return {
    id: nextId++,
    epoch_second: START + at,
    problem_id: `abc481_${problem}`,
    contest_id: contest,
    user_id: "u",
    language: "C++ 23",
    point,
    length: 1000,
    result,
    execution_time: 1,
  };
}

const cell = (s: MemberScore, index: string) => s.cells.find((c) => c.problem.index === index)!;

test("contestIdOf / shortContestName / elapsedStr / submissionUrl", () => {
  assert.equal(contestIdOf("abc481.contest.atcoder.jp"), "abc481");
  assert.equal(shortContestName("abc481"), "ABC 481");
  assert.equal(shortContestName("arc233"), "ARC 233");
  assert.equal(shortContestName("tessoku-book"), "tessoku-book");
  assert.equal(elapsedStr(51), "0:51");
  assert.equal(elapsedStr(1251), "20:51");
  assert.equal(elapsedStr(6011), "100:11");
  const s = { ...sub("a", 0, "AC"), id: 80297366, contest_id: "adt_easy_20261101_1" };
  assert.equal(submissionUrl(s), "https://atcoder.jp/contests/adt_easy_20261101_1/submissions/80297366");
});

// atcoder.jp/contests/ の実際の行(2026-10-25 取得)
const HTML = `
<div id="contest-table-permanent"><table><tbody>
<tr>
<td ><a href="/contests/practice">practice contest</a></td>
<td class="text-center">-</td>
</tr>
</tbody></table></div>
<div id="contest-table-upcoming"><table><thead><tr><th>Start Time</th></tr></thead><tbody>
<tr>
				<td class="text-center"><a href='http://www.timeanddate.com/worldclock/fixedtime.html?iso=20261025T2100&p1=248' target='blank'><time class='fixtime fixtime-full'>2026-10-25 21:00:00+0900</time></a></td>
				<td ><span aria-hidden='true' data-toggle='tooltip' data-placement='top' title="Algorithm">Ⓐ</span><span class="div1-target">◉</span> <a href="/contests/arc233">AtCoder Regular Contest++ 233</a></td>
				<td class="text-center">02:30</td>
				<td class="text-center">1600 - 2999</td>
			</tr>
</tbody></table></div>
<div id="contest-table-recent"><table><thead><tr><th>Start Time</th></tr></thead><tbody>
<tr>
				<td class="text-center"><a href='http://www.timeanddate.com/worldclock/fixedtime.html?iso=20261024T2100&p1=248' target='blank'><time class='fixtime fixtime-full'>2026-10-24 21:00:00+0900</time></a></td>
				<td ><span aria-hidden='true' data-toggle='tooltip' data-placement='top' title="Algorithm">Ⓐ</span><span class="user-blue">◉</span> <a href="/contests/abc481">SMBC Programming Contest #2 (AtCoder Beginner Contest 481) &amp; more</a></td>
				<td class="text-center">01:40</td>
				<td class="text-center"> - 1999</td>
			</tr>
<tr>
				<td class="text-center"><time class='fixtime fixtime-full'>2026-10-17 15:00:00+0900</time></td>
				<td ><a href="/contests/ahc073">AtCoder Heuristic Contest 073</a></td>
				<td class="text-center">04:00</td>
				<td class="text-center">All</td>
			</tr>
</tbody></table></div>`;

test("parseContestTable: 予定の表だけ / 常設以外のすべての表", () => {
  const up = parseContestTable(HTML, "upcoming");
  assert.deepEqual(up, [
    { id: "arc233", title: "AtCoder Regular Contest++ 233", start: START + 86400, duration: 9000, rate: "1600 - 2999" },
  ]);
  const all = parseContestTable(HTML);
  assert.deepEqual(
    all.map((r) => [r.id, r.duration, r.rate]),
    [
      ["arc233", 9000, "1600 - 2999"],
      ["abc481", 6000, "- 1999"],
    ],
  );
  assert.equal(all[1].title, "SMBC Programming Contest #2 (AtCoder Beginner Contest 481) & more");
  assert.equal(all[1].start, START);
});

test("scoreMember: 時間の境界(開始ちょうどは時間内・終了ちょうどは時間外)", () => {
  // mocaluna の ABC481: A〜C は時間内、D は終了の 11 秒後
  const subs = [sub("a", 51, "AC"), sub("b", 645, "AC", 200), sub("c", 1251, "AC", 300), sub("d", 6011, "AC", 400)];
  const s = scoreMember(ABC481, ABC481.problems, subs);
  assert.equal(s.participated, true);
  assert.equal(s.score, 600);
  assert.equal(s.penalty, 0);
  assert.equal(s.time, 1251);
  assert.equal(cell(s, "C").elapsed, 1251);
  const d = cell(s, "D");
  assert.equal(d.point, 0);
  assert.equal(d.subs.length, 0);
  assert.equal(d.lateAc?.id, subs[3].id);
  assert.equal(d.link?.id, subs[3].id);

  const edge = scoreMember(ABC481, ABC481.problems, [sub("a", 0, "AC"), sub("b", 6000, "AC", 200)]);
  assert.equal(edge.score, 100);
  assert.equal(cell(edge, "A").elapsed, 0);
  assert.equal(cell(edge, "B").subs.length, 0);
  assert.equal(cell(edge, "B").lateAc != null, true);
});

test("scoreMember: ペナルティは AC より前の誤答だけ(CE・IE・WJ は数えない)", () => {
  const subs = [
    sub("a", 100, "WA"),
    sub("a", 200, "CE"),
    sub("a", 250, "IE"),
    sub("a", 300, "TLE"),
    sub("a", 400, "AC"),
    sub("a", 500, "WA"), // AC のあとの誤答は数えない
    sub("b", 600, "RE"),
    sub("b", 700, "WA"), // 解けなかった問題の誤答は時間・ペナルティに入らない
  ];
  const s = scoreMember(ABC481, ABC481.problems, subs);
  assert.equal(cell(s, "A").wrong, 2);
  assert.equal(cell(s, "B").wrong, 2);
  assert.equal(cell(s, "B").point, 0);
  assert.equal(cell(s, "B").link?.id, subs[7].id);
  assert.equal(s.penalty, 2);
  assert.equal(s.lastElapsed, 400);
  assert.equal(s.time, 400 + 2 * 300);
});

test("scoreMember: 判定中の提出は誤答に数えず、印を付ける", () => {
  const s = scoreMember(ABC481, ABC481.problems, [sub("a", 100, "WJ"), sub("a", 120, "3/10")]);
  assert.equal(cell(s, "A").wrong, 0);
  assert.equal(cell(s, "A").pending, true);
  assert.equal(s.score, 0);
  assert.equal(s.participated, true);
});

test("scoreMember: 部分点は最高点に最初に届いた提出で数える", () => {
  const subs = [sub("f", 1000, "WA", 300), sub("f", 1500, "WA", 300), sub("f", 2000, "WA"), sub("f", 3000, "AC", 600)];
  const s = scoreMember(ABC481, ABC481.problems, subs);
  const f = cell(s, "F");
  assert.equal(f.point, 600);
  assert.equal(f.scored?.id, subs[3].id);
  assert.equal(f.wrong, 3);
  const partial = scoreMember(ABC481, ABC481.problems, subs.slice(0, 3));
  assert.equal(cell(partial, "F").point, 300);
  assert.equal(cell(partial, "F").scored?.id, subs[0].id);
  assert.equal(cell(partial, "F").wrong, 0);
  assert.equal(partial.time, 1000);
});

test("scoreMember: 別のコンテストへの提出は時間内でも数えず、解き直しは ADT での AC も拾う", () => {
  const adt = sub("e", 7000, "AC", 100, "adt_hard_20261101_1");
  const subs = [sub("e", 1000, "AC", 500, "adt_hard_20261024_1"), sub("e", 2000, "WA"), adt];
  const s = scoreMember(ABC481, ABC481.problems, subs);
  const e = cell(s, "E");
  assert.equal(e.subs.length, 1);
  assert.equal(e.point, 0);
  assert.equal(e.lateAc?.id, adt.id);
  // 時間内に提出があればマスはその提出を開く。解き直しは別に持つ
  assert.equal(e.link?.id, subs[1].id);
  assert.equal(submissionUrl(e.lateAc!), `https://atcoder.jp/contests/adt_hard_20261101_1/submissions/${adt.id}`);

  const none = scoreMember(ABC481, ABC481.problems, [subs[0]]);
  assert.equal(none.participated, false);
});

test("scoreMember: 時間内に AC した問題には解き直しを付けない", () => {
  const s = scoreMember(ABC481, ABC481.problems, [sub("a", 10, "AC"), sub("a", 7000, "AC")]);
  assert.equal(cell(s, "A").lateAc, undefined);
});

test("contestProblems: 問題セットが無ければ提出から作る(Ex は最後)", () => {
  const empty: ClubContest = { ...ABC481, problems: [] };
  const subs = [sub("h", 100, "WA"), sub("b", 100, "AC"), { ...sub("a", 100, "AC"), problem_id: "abc481_ex" }];
  assert.deepEqual(
    contestProblems(empty, [subs]).map((p) => p.index),
    ["B", "H", "EX"],
  );
  // 問題セットがあればそれに足すだけ(A〜G に H と EX)
  assert.deepEqual(
    contestProblems(ABC481, [subs]).map((p) => p.index),
    ["A", "B", "C", "D", "E", "F", "G", "H", "EX"],
  );
});

const off = (place: number, perf = 1000): OfficialResult => ({ place, perf, oldRating: 800, newRating: 820, rated: true });
const row = (name: string, s: Partial<MemberScore>, official?: OfficialResult) => ({
  name,
  score: { cells: [], participated: true, score: 0, penalty: 0, lastElapsed: 0, time: 0, ...s },
  official,
});

test("rankMembers: 全員の公式成績がそろえば公式の順位の順", () => {
  const r = rankMembers([
    row("a", { score: 600, time: 1251 }, off(5494)),
    row("b", { score: 1000, time: 3000 }, off(2000)),
    row("c", { participated: false }),
  ]);
  assert.equal(r.mode, "official");
  assert.deepEqual(r.ranked.map((x) => [x.name, x.rank]), [["b", 1], ["a", 2]]);
});

test("rankMembers: 一部しか公式成績が無ければ得点・時間の暫定順位。同点は同じ順位", () => {
  const r = rankMembers([
    row("a", { score: 600, time: 1251 }, off(5494)),
    row("b", { score: 600, time: 1251 }),
    row("c", { score: 1000, time: 4000 }),
    row("d", { score: 600, time: 900 }),
    row("e", { participated: false }, off(9000)), // 提出がまだ読めていない人は後ろに公式の順位の順
    row("f", { participated: false }),
  ]);
  assert.equal(r.mode, "provisional");
  assert.deepEqual(
    r.ranked.map((x) => [x.name, x.rank]),
    [["c", 1], ["d", 2], ["a", 3], ["b", 3], ["e", 5]],
  );
});

test("rankMembers: 参加者がいなければ暫定・空", () => {
  const r = rankMembers([row("a", { participated: false })]);
  assert.equal(r.mode, "provisional");
  assert.equal(r.ranked.length, 0);
});

const NOW = START + 7200; // ABC481 の終了から 20 分後

test("buildContestIndex: 部員が参加した Rated のコンテストと、直近の Rated のコンテスト", () => {
  const k = (id: string, start: number, duration: number, rate: string) => ({
    id,
    start_epoch_second: start,
    duration_second: duration,
    title: id,
    rate_change: rate,
  });
  const contests = [
    k("abc480", START - 7 * 86400, 6000, "~ 1999"),
    k("abc470", START - 70 * 86400, 6000, "~ 1999"), // 誰も出ていない古い ABC は載せない
    k("abc300", START - 400 * 86400, 6000, "~ 1999"), // 1 年より前は載せない
    k("adt_easy_20261020_1", START - 4 * 86400, 3600, "-"), // Rated 対象外
    k("ahc073", START - 7 * 86400 - 21600, 14400, "All"),
    k("practice_contest", 1e9, 3e9, "-"),
    k("arc232", START - 6 * 86400, 7200, "1200 - 2399"), // 参加者はいないが開始から 7 日以内
  ];
  const contestProblems = [
    { contest_id: "abc480", problem_id: "abc480_b", problem_index: "B" },
    { contest_id: "abc480", problem_id: "abc480_h", problem_index: "Ex" },
    { contest_id: "abc480", problem_id: "abc480_a", problem_index: "A" },
    { contest_id: "abc470", problem_id: "abc470_a", problem_index: "A" },
  ];
  const at = (cid: string, t: number): Submission => ({ ...sub("a", 0, "AC"), contest_id: cid, problem_id: `${cid}_a`, epoch_second: t });
  const lists = {
    m1: [
      at("abc480", START - 7 * 86400 + 100),
      at("abc300", START - 400 * 86400 + 100),
      at("adt_easy_20261020_1", START - 4 * 86400 + 100),
      at("ahc073", START - 7 * 86400),
    ],
    m2: [at("abc480", START - 7 * 86400 + 7000)], // 終了後の提出は参加に数えない
  };
  const results = { abc480: { m2: off(3000) } };
  const tables = parseContestTable(HTML); // abc481(kenkoooo にまだ無い)と arc233(明日)
  const list = buildContestIndex({ contests, contestProblems, tables, lists, results, now: NOW });
  assert.deepEqual(
    list.map((c) => [c.id, c.joined]),
    [
      ["arc233", 0],
      ["abc481", 0],
      ["arc232", 0],
      ["abc480", 2],
    ],
  );
  assert.deepEqual(list[3].problems.map((p) => p.index), ["A", "B", "Ex"]);
  assert.equal(list[1].duration, 6000);
  assert.equal(list[1].problems.length, 0);
});

test("mergeUpcoming と pickDefaultContest", () => {
  const older: ClubContest = { ...ABC481, id: "abc480", start: START - 7 * 86400, joined: 3 };
  const list = mergeUpcoming(
    [older],
    [
      { id: "abc481", title: "ABC481", start: START, duration: 6000, rate: "- 1999" },
      { id: "arc233", title: "ARC233", start: START + 86400, duration: 9000 }, // まだ始まっていない
      { id: "agc080", title: "AGC080", start: START - 86400 }, // 長さが分からない
    ],
    NOW,
  );
  assert.deepEqual(list.map((c) => c.id), ["abc481", "abc480"]);
  // 終了から 6 時間以内なら参加人数 0 でも選ぶ
  assert.equal(pickDefaultContest(list, NOW)?.id, "abc481");
  assert.equal(pickDefaultContest(list, NOW + 7 * 3600)?.id, "abc480");
  // 開催中のものは選ばない
  assert.equal(pickDefaultContest(list, START + 100)?.id, "abc480");
  assert.equal(pickDefaultContest([], NOW), undefined);
  // 開催中のスナップショットで問題セットがあり 0 人と分かっているもの(Rated 範囲外の ARC など)は、終了直後でも選ばない
  const arc: ClubContest = { ...ABC481, id: "arc233", start: START + 60, joined: 0 };
  assert.equal(pickDefaultContest([arc, older], NOW + 200)?.id, "abc480");
});
