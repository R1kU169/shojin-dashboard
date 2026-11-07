// エディターが localStorage に置くもののうち、エディターとコーナーケースと取り込み(ブックマークレット)で
// 共有するもの: 連携中の問題・問題ごとの「入力」「制約」・取り込んだ問題の一覧。
import { splitStatement } from "./casegen";
import type { Overrides } from "./casegen";
import type { ImportPayload } from "./importPayload";
import { linkedTitle } from "./importPayload";
import { statementHtmlToText } from "./katexPaste";
import { readStore, writeStore } from "./storage";
import type { LinkedProblem } from "./types";

export const PROBLEM_KEY = "shojin:editor:problem";
const CASES_PREFIX = "shojin:editor:cases:";
const IMPORTED_KEY = "shojin:editor:imported";
/** 取り込んだ問題の一覧はコンテストいくつ分まで覚えるか */
const IMPORTED_KEEP = 5;

export function loadProblem(): LinkedProblem | null {
  try {
    const raw = readStore(PROBLEM_KEY);
    return raw ? (JSON.parse(raw) as LinkedProblem) : null;
  } catch {
    return null;
  }
}

export function saveProblem(p: LinkedProblem): void {
  writeStore(PROBLEM_KEY, JSON.stringify(p));
}

// ---- 問題ごとの「入力」「制約」と範囲の手直し ------------------------------------------

export interface SavedCases {
  format: string;
  constraints: string;
  overrides: Overrides;
}

export const EMPTY_CASES: SavedCases = { format: "", constraints: "", overrides: {} };

/** 問題ごとの保存キー(問題を連携していなければ共通の1つ) */
export const casesKey = (p: LinkedProblem | null) => `${CASES_PREFIX}${p ? `${p.contest}/${p.task}` : "-"}`;

function parseCases(raw: string | null): SavedCases | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as Partial<SavedCases>;
    return {
      format: typeof j.format === "string" ? j.format : "",
      constraints: typeof j.constraints === "string" ? j.constraints : "",
      overrides: j.overrides && typeof j.overrides === "object" ? j.overrides : {},
    };
  } catch {
    return null;
  }
}

/**
 * 保存した「入力」「制約」を読む。同じ問題を別のコンテスト(ADT など)のページから取り込んだときは
 * キーのコンテストが違うので、問題IDが同じものを探して使う
 */
export function loadCases(p: LinkedProblem | null): SavedCases {
  const own = parseCases(readStore(casesKey(p)));
  if (own || !p) return own ?? EMPTY_CASES;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(CASES_PREFIX) && k.endsWith(`/${p.task}`)) {
        const other = parseCases(readStore(k));
        if (other?.format) return other;
      }
    }
  } catch {
    // 読めなくても空で始める
  }
  return EMPTY_CASES;
}

// ---- 取り込んだ問題の一覧(問題の切り替えボタンに使う) -------------------------------

export interface ImportedContest {
  contest: string;
  at: number;
  tasks: { task: string; title: string }[];
}

export function loadImported(): ImportedContest[] {
  try {
    const raw = readStore(IMPORTED_KEY);
    const j = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(j) ? (j as ImportedContest[]).filter((c) => c && typeof c.contest === "string" && Array.isArray(c.tasks)) : [];
  } catch {
    return [];
  }
}

function rememberImported(contest: string, tasks: { task: string; title: string }[]): void {
  const list = loadImported();
  const prev = list.find((c) => c.contest === contest);
  // 問題ページで1問ずつ押したときも、同じコンテストの問題は1つの一覧にまとめる(記号の順に並べる)
  const merged = new Map((prev?.tasks ?? []).map((t) => [t.task, t]));
  for (const t of tasks) merged.set(t.task, t);
  const next: ImportedContest = {
    contest,
    at: Date.now(),
    tasks: [...merged.values()].sort((a, b) => a.title.localeCompare(b.title, "en")),
  };
  writeStore(IMPORTED_KEY, JSON.stringify([next, ...list.filter((c) => c.contest !== contest)].slice(0, IMPORTED_KEEP)));
}

// ---- 取り込み -------------------------------------------------------------------

export interface ImportResult {
  /** 連携した問題 */
  problem: LinkedProblem;
  /** 「入力」を読み取れた問題の数 */
  read: number;
  total: number;
}

/**
 * ブックマークレットから届いた問題文を保存し、連携する問題を決める。
 * 問題ページで押したときはその問題、「問題一括表示」で押したときは、いま連携中の問題が含まれていれば
 * そのまま、なければ最初の問題。
 */
export function applyImport(payload: ImportPayload, current: LinkedProblem | null): ImportResult {
  let read = 0;
  for (const t of payload.tasks) {
    const parts = splitStatement(statementHtmlToText(t.html));
    if (parts.format === null) continue;
    read++;
    const p = { contest: payload.contest, task: t.task };
    const format = parts.format;
    const constraints = parts.constraints ?? "";
    const prev = parseCases(readStore(casesKey(p)));
    // 同じ問題文を取り込み直したときは、範囲の手直しを残す
    const same = prev && prev.format === format && prev.constraints === constraints;
    writeStore(casesKey(p), JSON.stringify({ format, constraints, overrides: same ? prev.overrides : {} }));
  }
  const tasks = payload.tasks.map((t) => ({ task: t.task, title: linkedTitle(t.title) || t.task }));
  rememberImported(payload.contest, tasks);
  const kept = payload.current === null && current?.contest === payload.contest ? tasks.find((t) => t.task === current.task) : undefined;
  const pick = kept ?? tasks.find((t) => t.task === payload.current) ?? tasks[0];
  const problem: LinkedProblem = { contest: payload.contest, task: pick.task, title: pick.title };
  saveProblem(problem);
  return { problem, read, total: payload.tasks.length };
}
