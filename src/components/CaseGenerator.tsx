import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { ClipboardEvent } from "react";
import { buildSpec, exprToString, formatBig } from "../lib/casegen";
import type { GeneratedCase, Overrides, Slot, Spec } from "../lib/casegen";
import type { CaseGenMessage, CaseGenRequest } from "../lib/casegen.worker";
import { GODBOLT_LANGS } from "../lib/godbolt";
import { katexHtmlToText } from "../lib/katexPaste";
import { isWarningOnly, prefersGodbolt, runCase } from "../lib/run";
import type { RunOutcome } from "../lib/run";
import { readStore, removeStore, writeStore } from "../lib/storage";
import type { LinkedProblem } from "../lib/types";
import { WANDBOX_MAX_BODY } from "../lib/wandbox";
import type { EditorLang } from "../lib/wandbox";

// 問題ごとに「入力」「制約」と範囲の手直しを保存する(問題を連携していなければ共通の1つ)
const STORE_KEY = (p: LinkedProblem | null) => `shojin:editor:cases:${p ? `${p.contest}/${p.task}` : "-"}`;
const OPEN_KEY = "shojin:editor:cases:open";

/** Compiler Explorer に送る入力の上限(10MB まで通ることを実測。余裕を見て 8MB) */
const GODBOLT_MAX_BYTES = 8_000_000;
/** AtCoder のふつうの制限時間。これを超えたら時間を注意の色にする */
const TIME_LIMIT_MS = 2000;
/** ケースを作るのがこれより長くかかったら打ち切る(範囲の手直しで巨大な値を入れたときなど) */
const GEN_TIMEOUT_MS = 30_000;

interface Saved {
  format: string;
  constraints: string;
  overrides: Overrides;
}

const EMPTY: Saved = { format: "", constraints: "", overrides: {} };

function load(key: string): Saved {
  try {
    const raw = readStore(key);
    if (!raw) return EMPTY;
    const j = JSON.parse(raw) as Partial<Saved>;
    return {
      format: typeof j.format === "string" ? j.format : "",
      constraints: typeof j.constraints === "string" ? j.constraints : "",
      overrides: j.overrides && typeof j.overrides === "object" ? j.overrides : {},
    };
  } catch {
    return EMPTY;
  }
}

type Status = "pending" | "running" | "ok" | "re" | "tle" | "killed" | "ce" | "big" | "error" | "skipped" | "aborted";

interface CaseResult {
  status: Status;
  exit?: string;
  timeMs?: number;
  wallMs?: number;
  stdout?: string;
  stdoutLen?: number;
  stderr?: string;
  compiler?: string;
  message?: string;
}

interface Row extends GeneratedCase {
  selected: boolean;
  result?: CaseResult;
}

const STATUS: Record<Status, { label: string; cls: string }> = {
  pending: { label: "待ち", cls: "" },
  running: { label: "実行中…", cls: "" },
  ok: { label: "正常終了", cls: "ok" },
  re: { label: "実行時エラー", cls: "ng" },
  tle: { label: "時間切れ", cls: "ng" },
  killed: { label: "強制終了", cls: "ng" },
  ce: { label: "コンパイルエラー", cls: "ng" },
  big: { label: "出力が多すぎ", cls: "warn" },
  error: { label: "実行できず", cls: "warn" },
  skipped: { label: "未実行", cls: "" },
  aborted: { label: "中断", cls: "" },
};

const head = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n…(以下略)` : s);

/** 実行結果を分類する。コンパイルエラーは最初のケースでだけ判定する(一度動けば以降は同じコード) */
function classify(r: RunOutcome, wallMs: number, compiled: boolean): CaseResult {
  const base: CaseResult = {
    status: "ok",
    exit: r.signal || r.status,
    timeMs: r.timeMs,
    wallMs,
    stdout: head(r.stdout, 4000),
    stdoutLen: r.stdout.length,
    stderr: head(r.stderr, 2000),
  };
  // Compiler Explorer はビルドに失敗すると標準エラーに「Build failed」を入れて返すので、buildFailed で見る
  if (!compiled && (r.buildFailed || (r.compilerError && !isWarningOnly(r) && r.stdout === "" && r.stderr === "" && r.status !== "0"))) {
    return { ...base, status: "ce", compiler: head(r.compilerError, 4000) };
  }
  // Wandbox は出力が上限を超えると途中で切り、終了コードを返さない
  if (r.truncated) return { ...base, status: "big" };
  if (r.timedOut) return { ...base, status: "tle" };
  // Wandbox は時間(約30秒)かメモリの上限で SIGKILL する(128 + 9)
  if (r.backend === "wandbox" && r.status === "137") return { ...base, status: "killed" };
  if (r.status === "0" && !r.signal) return base;
  return { ...base, status: "re" };
}

function formatBytes(n: number): string {
  if (n < 1000) return `${n} B`;
  if (n < 1e6) return `${(n / 1000).toFixed(1)} KB`;
  return `${(n / 1e6).toFixed(2)} MB`;
}

/** 入力の先頭数行(長い行は切る) */
function preview(input: string, lines: number): string {
  const out: string[] = [];
  let i = 0;
  for (let k = 0; k < 6 && i < input.length; k++) {
    let j = input.indexOf("\n", i);
    if (j < 0) j = input.length;
    const line = input.slice(i, j);
    out.push(line.length > 120 ? `${line.slice(0, 120)}…` : line);
    i = j + 1;
  }
  if (lines > 6) out.push(`…(全 ${lines.toLocaleString()} 行)`);
  return out.join("\n");
}

// ---- 読み取った変数の表 -------------------------------------------------------------

const GROUPS: [string, string][] = [
  ["abcdefghijklmnopqrstuvwxyz", "英小文字"],
  ["ABCDEFGHIJKLMNOPQRSTUVWXYZ", "英大文字"],
  ["0123456789", "数字"],
];

function charsetText(cs: string[]): string {
  let rest = cs.join("");
  const parts: string[] = [];
  for (const [g, name] of GROUPS) {
    if ([...g].every((c) => rest.includes(c))) {
      parts.push(name);
      for (const c of g) rest = rest.replace(c, "");
    }
  }
  for (const c of rest) parts.push(c === " " ? "空白" : `「${c}」`);
  return parts.join("・");
}

function kindLabel(s: Slot): string {
  if (s.key.startsWith("|")) return "長さ";
  if (s.choices) return "選択肢";
  if (s.type === "char") return "文字";
  if (s.type === "str") return s.elem ? "文字列の並び" : "文字列";
  return s.elem ? "整数の並び" : "整数";
}

function boundText(s: Slot, dir: "lo" | "hi"): string {
  if (s[dir].length === 1) return exprToString(s[dir][0]);
  const v = s.hull[dir];
  return v === null ? "" : formatBig(v);
}

function slotNotes(s: Slot, spec: Spec): string[] {
  const out: string[] = [];
  if (s.perm) out.push("順列");
  if (s.distinct) out.push("相異なる");
  if (s.sorted) out.push(s.sorted === "lt" ? "狭義に昇順" : "昇順");
  if (s.parity) out.push(s.parity === "odd" ? "奇数" : "偶数");
  if (s.charset && (s.type === "str" || s.type === "char")) out.push(charsetText(s.charset));
  if (s.choices) out.push(s.choices.join(" / "));
  const g = spec.graph;
  if (g && (g.u === s.key || g.v === s.key)) out.push(g.tree ? "木の辺" : "グラフの辺");
  if (g?.parentList && s.key === `${g.parentList.k === "list" ? g.parentList.ref.base : ""}[]`) out.push("根付き木の親");
  if (s.assumed) out.push("範囲は仮");
  return out;
}

function SpecView({
  spec,
  overrides,
  onOverride,
  onReset,
}: {
  spec: Spec;
  overrides: Overrides;
  onOverride: (key: string, dir: "lo" | "hi", v: string) => void;
  onReset: () => void;
}) {
  const slots = [...spec.slots.values()];
  const g = spec.graph;
  return (
    <div className="cg-spec-view">
      {slots.length > 0 ? (
        <div className="table-scroll">
          <table className="data-table cg-var-table">
            <thead>
              <tr>
                <th>変数</th>
                <th>種類</th>
                <th>範囲(直せます)</th>
                <th>メモ</th>
              </tr>
            </thead>
            <tbody>
              {slots.map((s) => {
                const editable = s.type === "int" && !s.choices && !s.perm;
                const o = overrides[s.key] ?? {};
                return (
                  <tr key={s.key}>
                    <td className="cg-var-name">
                      <code>{s.label}</code>
                    </td>
                    <td className="cg-var-kind">{kindLabel(s)}</td>
                    <td className={editable || s.perm ? "cg-var-range" : "cg-var-range cg-none"}>
                      {editable ? (
                        <span className="cg-bounds">
                          <input
                            className="cg-bound"
                            value={o.lo ?? boundText(s, "lo")}
                            onChange={(e) => onOverride(s.key, "lo", e.target.value)}
                            aria-label={`${s.label} の下限`}
                            spellCheck={false}
                          />
                          <span className="muted">≤ {s.label} ≤</span>
                          <input
                            className="cg-bound"
                            value={o.hi ?? boundText(s, "hi")}
                            onChange={(e) => onOverride(s.key, "hi", e.target.value)}
                            aria-label={`${s.label} の上限`}
                            spellCheck={false}
                          />
                        </span>
                      ) : s.perm ? (
                        <span className="muted">{s.permFrom === 0n ? "0〜(個数−1)" : "1〜(個数)"} の並べ替え</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="cg-var-note muted">{slotNotes(s, spec).join("・")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">入力の形式から変数を読み取れませんでした。</p>
      )}
      {g && (
        <p className="muted cg-graph">
          グラフ: {g.tree ? "木" : [g.simple && "単純", g.connected && "連結"].filter(Boolean).join("・") || "グラフ"}
          (頂点数 {g.n})。一直線・スターなどの形も作ります。
        </p>
      )}
      {Object.keys(overrides).length > 0 && (
        <button type="button" className="linklike cg-reset" onClick={onReset}>
          範囲の手直しを元に戻す
        </button>
      )}
      {spec.warnings.length > 0 && (
        <ul className="cg-warn">
          {spec.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      {spec.unread.length > 0 && (
        <details className="cg-unread">
          <summary>
            読み取れなかった制約 {spec.unread.length} 件(作るケースではこの条件を考えません)
          </summary>
          <ul>
            {spec.unread.map((u, i) => (
              <li key={i}>{u}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

// ---- 本体 -----------------------------------------------------------------------

interface Props {
  lang: EditorLang;
  code: string;
  problem: LinkedProblem | null;
  /** 「標準入力に入れる」 */
  onUseInput: (input: string) => void;
}

export function CaseGenerator({ lang, code, problem, onUseInput }: Props) {
  const storeKey = STORE_KEY(problem);
  const [open, setOpen] = useState(() => readStore(OPEN_KEY) === "1");
  const [saved, setSaved] = useState<Saved>(() => load(storeKey));
  const [savedKey, setSavedKey] = useState(storeKey);
  const [rows, setRows] = useState<Row[]>([]);
  const [gen, setGen] = useState<{ done: number; total: number } | null>(null);
  const [genErrors, setGenErrors] = useState<string[]>([]);
  const [builtFrom, setBuiltFrom] = useState("");
  const [salt, setSalt] = useState(0);
  const [running, setRunning] = useState(false);
  const [runAt, setRunAt] = useState(-1);
  const workerRef = useRef<Worker | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // まとめて実行の回ごとの番号。問題を切り替えたら進め、前の回の結果を新しいケースの行に書かない
  const runToken = useRef(0);

  // 問題を切り替えたら、その問題の入力・制約を読み直す
  if (savedKey !== storeKey) {
    setSavedKey(storeKey);
    setSaved(load(storeKey));
    setRows([]);
    setGenErrors([]);
  }
  // 前の問題のケース作り・まとめて実行は止める(前の問題のケースが新しい問題の下に並ばないように)
  useEffect(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    abortRef.current?.abort();
    runToken.current++;
    setGen(null);
  }, [storeKey]);

  useEffect(() => {
    const t = setTimeout(() => {
      // 保存できなくても使える
      if (saved.format || saved.constraints) writeStore(savedKey, JSON.stringify(saved));
      else removeStore(savedKey);
    }, 400);
    return () => clearTimeout(t);
  }, [saved, savedKey]);

  useEffect(
    () => () => {
      workerRef.current?.terminate();
      abortRef.current?.abort();
    },
    [],
  );

  // 入力・制約を打つたびに読み直すと重い問題文もあるので、読み取りは入力に遅れてよいことにする
  const deferred = useDeferredValue(saved);
  const spec = useMemo(
    () => (deferred.format.trim() ? buildSpec(deferred.format, deferred.constraints, deferred.overrides) : null),
    [deferred],
  );
  const specText = `${saved.format}\n---\n${saved.constraints}\n---\n${JSON.stringify(saved.overrides)}`;
  const stale = rows.length > 0 && builtFrom !== specText;

  const toggle = () => {
    setOpen((o) => {
      writeStore(OPEN_KEY, o ? "0" : "1"); // 開閉は覚えられなくてもよい
      return !o;
    });
  };

  // 問題ページからの貼り付けは、HTML に入っている元の TeX を使う(プレーンテキストでは添字が別の行に割れる)
  const pasteInto = (field: "format" | "constraints") => (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const html = e.clipboardData.getData("text/html");
    const text = html ? katexHtmlToText(html) : null;
    if (!text) return;
    e.preventDefault();
    // insertText で入れると、ふつうの貼り付けと同じく Ctrl+Z で戻せ、カーソルも貼った後ろに来る
    // (onChange が走って保存される)。使えないブラウザでは値を直接書き換える
    if (document.execCommand?.("insertText", false, text)) return;
    const { selectionStart: a, selectionEnd: b, value } = e.currentTarget;
    const next = value.slice(0, a) + text + value.slice(b);
    setSaved((s) => ({ ...s, [field]: next }));
  };

  const setOverride = (key: string, dir: "lo" | "hi", v: string) =>
    setSaved((s) => ({ ...s, overrides: { ...s.overrides, [key]: { ...s.overrides[key], [dir]: v } } }));

  const useCE = prefersGodbolt(lang);

  const generate = (seedSalt: number) => {
    if (!spec) return;
    workerRef.current?.terminate();
    const w = new Worker(new URL("../lib/casegen.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = w;
    // Wandbox はコードと合わせて 1MiB まで(JSON で送るので改行は2文字に数える)
    const codeBytes = new TextEncoder().encode(JSON.stringify(code)).length;
    const req: CaseGenRequest = {
      format: saved.format,
      constraints: saved.constraints,
      overrides: saved.overrides,
      seed: `${specText}\n${seedSalt}`,
      maxBytes: useCE ? GODBOLT_MAX_BYTES : Math.max(1000, WANDBOX_MAX_BODY - codeBytes - 4096),
      newlineBytes: useCE ? 1 : 2,
    };
    setSalt(seedSalt);
    setRows([]);
    setGenErrors([]);
    setBuiltFrom(specText);
    setGen({ done: 0, total: spec.presets.length });
    const finish = () => {
      clearTimeout(timer);
      w.terminate();
      if (workerRef.current !== w) return;
      workerRef.current = null;
      setGen(null);
    };
    const timer = setTimeout(() => {
      if (workerRef.current !== w) return;
      setGenErrors((es) => [...es, `${GEN_TIMEOUT_MS / 1000}秒たっても作り終わらないので打ち切りました。範囲(上の表)を小さくしてみてください`]);
      finish();
    }, GEN_TIMEOUT_MS);
    w.onmessage = (e: MessageEvent<CaseGenMessage>) => {
      // 作り直し・問題の切り替えで捨てた worker から届いた分は使わない
      if (workerRef.current !== w) return;
      const m = e.data;
      if (m.type === "case") {
        setRows((rs) => [...rs, { ...m.case, selected: true }]);
        setGen({ done: m.index + 1, total: m.total });
      } else if (m.type === "error") {
        setGenErrors((es) => [...es, `${m.label}: ${m.message}`]);
        setGen({ done: m.index + 1, total: m.total });
      } else finish();
    };
    w.onerror = (ev) => {
      if (workerRef.current !== w) return;
      setGenErrors((es) => [...es, `ケースを作れませんでした: ${ev.message}`]);
      finish();
    };
    w.postMessage(req);
  };

  const stopGenerate = () => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setGen(null);
    setGenErrors((es) => [...es, "ケースを作るのを中断しました"]);
  };

  const patchFor = (token: number) => (id: string, result: CaseResult) => {
    if (runToken.current !== token) return;
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, result } : r)));
  };

  const runAll = async () => {
    if (running) {
      abortRef.current?.abort();
      return;
    }
    const targets = rows.filter((r) => r.selected && r.input !== "");
    if (targets.length === 0) return;
    const ac = new AbortController();
    abortRef.current = ac;
    const token = ++runToken.current;
    const patch = patchFor(token);
    setRunning(true);
    const ids = new Set(targets.map((t) => t.id));
    setRows((rs) => rs.map((r) => (ids.has(r.id) ? { ...r, result: { status: "pending" } } : r)));
    let compiled = false;
    for (const [i, t] of targets.entries()) {
      setRunAt(i);
      patch(t.id, { status: "running" });
      const t0 = performance.now();
      try {
        const r = await runCase(lang, code, t.input, ac.signal);
        const res = classify(r, performance.now() - t0, compiled);
        patch(t.id, res);
        if (res.status === "ce") {
          for (const rest of targets.slice(i + 1)) patch(rest.id, { status: "skipped" });
          break;
        }
        compiled = true;
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          for (const rest of targets.slice(i)) patch(rest.id, { status: "aborted" });
          break;
        }
        patch(t.id, { status: "error", message: (e as Error).message });
      }
    }
    setRunAt(-1);
    setRunning(false);
    if (abortRef.current === ac) abortRef.current = null;
  };

  const selected = rows.filter((r) => r.selected).length;
  // 実際に実行するケース(入力の空のケースは送らない)
  const runnable = rows.filter((r) => r.selected && r.input !== "").length;
  const counts = new Map<Status, number>();
  for (const r of rows) if (r.result) counts.set(r.result.status, (counts.get(r.result.status) ?? 0) + 1);
  const finished = [...counts.entries()].filter(([s]) => !["pending", "running"].includes(s));

  return (
    <section className="card cg-card">
      <div className="card-head">
        <h2 className="card-title">コーナーケース</h2>
        <span className="card-sub">問題の入力と制約から境界の入力を作り、まとめて実行します</span>
        <button type="button" className="mypage-toggle" onClick={toggle} aria-expanded={open}>
          {open ? "閉じる" : "開く"}
        </button>
      </div>
      {open && (
        <>
          <p className="muted cg-hint">
            問題ページの「入力」と「制約」を、表示されているままコピーして貼り付けてください(TeX のままでも、
            <code>A_1 A_2 ... A_N</code> / <code>1 ≤ N ≤ 2×10^5</code> のように手で書いても読めます)。
            {problem && (
              <>
                {" "}
                <a href={`https://atcoder.jp/contests/${problem.contest}/tasks/${problem.task}`} target="_blank" rel="noreferrer">
                  問題ページを開く ↗
                </a>
              </>
            )}
          </p>
          <div className="two-col cg-inputs">
            <label className="cg-field">
              <span className="io-label">入力</span>
              <textarea
                className="cg-area"
                value={saved.format}
                onChange={(e) => setSaved((s) => ({ ...s, format: e.target.value }))}
                onPaste={pasteInto("format")}
                spellCheck={false}
                placeholder={"N M\nA_1 A_2 ... A_N\nu_1 v_1\n:\nu_M v_M"}
              />
            </label>
            <label className="cg-field">
              <span className="io-label">制約</span>
              <textarea
                className="cg-area"
                value={saved.constraints}
                onChange={(e) => setSaved((s) => ({ ...s, constraints: e.target.value }))}
                onPaste={pasteInto("constraints")}
                spellCheck={false}
                placeholder={"1 ≤ N ≤ 2×10^5\n0 ≤ M ≤ 2×10^5\n1 ≤ A_i ≤ 10^9\n1 ≤ u_i < v_i ≤ N"}
              />
            </label>
          </div>

          {spec && (
            <SpecView
              spec={spec}
              overrides={saved.overrides}
              onOverride={setOverride}
              onReset={() => setSaved((s) => ({ ...s, overrides: {} }))}
            />
          )}

          <div className="cg-actions">
            <button type="button" className="run-btn cg-make" onClick={() => generate(salt)} disabled={!spec || !!gen || running}>
              ケースを作る
            </button>
            <button type="button" className="run-btn" onClick={() => void runAll()} disabled={!!gen || (!running && runnable === 0)}>
              {running ? "中断" : "まとめて実行 ▶"}
            </button>
            {rows.length > 0 && !gen && !running && (
              <button type="button" className="linklike" onClick={() => generate(salt + 1)}>
                乱数を変えて作り直す
              </button>
            )}
            {gen && (
              <span className="sync-note">
                <span className="sync-spinner" aria-hidden="true" />
                ケースを作っています({gen.done}/{gen.total})
                <button type="button" className="linklike" onClick={stopGenerate}>
                  中断
                </button>
              </span>
            )}
            {running && runAt >= 0 && (
              <span className="sync-note">
                <span className="sync-spinner" aria-hidden="true" />
                {runAt + 1}/{runnable} 件目を実行中
              </span>
            )}
          </div>
          <p className="muted cg-backend">
            {useCE
              ? `Compiler Explorer(${GODBOLT_LANGS[lang.key].version})で実行します。時間はプログラムの実行時間で、AtCoder とは環境が違うので目安です(20秒で打ち切り)。`
              : "Wandbox で実行します。時間は応答までの秒数で、コンパイルと通信を含みます(入力はコードと合わせて約1MBまで)。"}
            答えが正しいかは確かめません。異常終了・時間切れ・おかしな出力(オーバーフローした負の数など)を見つけるのに使ってください。
          </p>
          {stale && <p className="cg-stale">入力・制約・範囲が変わりました。「ケースを作る」で作り直してください。</p>}
          {genErrors.length > 0 && (
            <ul className="cg-warn">
              {genErrors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}

          {rows.length > 0 && (
            <>
              <div className="cg-list-head">
                <label className="cg-check-all">
                  <input
                    type="checkbox"
                    checked={selected === rows.length}
                    onChange={(e) => setRows((rs) => rs.map((r) => ({ ...r, selected: e.target.checked })))}
                    disabled={running}
                  />
                  すべて選ぶ({selected}/{rows.length})
                </label>
                {finished.length > 0 && (
                  <span className="muted cg-counts">{finished.map(([s, n]) => `${STATUS[s].label} ${n}`).join("・")}</span>
                )}
              </div>
              <ul className="cg-cases">
                {rows.map((r) => (
                  <CaseItem
                    key={r.id}
                    row={r}
                    disabled={running}
                    onSelect={(v) => setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, selected: v } : x)))}
                    onUse={() => onUseInput(r.input)}
                  />
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}

function CaseItem({ row, disabled, onSelect, onUse }: { row: Row; disabled: boolean; onSelect: (v: boolean) => void; onUse: () => void }) {
  const res = row.result;
  const st = res ? STATUS[res.status] : null;
  const slow = res?.timeMs !== undefined && res.timeMs > TIME_LIMIT_MS;
  return (
    <li className="cg-case">
      <label className="cg-case-check">
        <input type="checkbox" checked={row.selected} onChange={(e) => onSelect(e.target.checked)} disabled={disabled} aria-label={`${row.label} を実行する`} />
      </label>
      <div className="cg-case-main">
        <div className="cg-case-title">
          {row.label}
          <span className="muted cg-case-purpose">{row.purpose}</span>
        </div>
        <div className="muted cg-case-meta">
          {row.summary && `${row.summary} · `}
          {formatBytes(row.bytes)}
          {row.shrunk && (
            <span title="実行サービスに送れる大きさに合わせて、最大より小さくしています"> · 送れる大きさに縮めました</span>
          )}
          {row.notes.map((n, i) => (
            <span key={i}> · {n}</span>
          ))}
        </div>
      </div>
      <div className="cg-case-result">
        {st && <span className={`exit-chip ${st.cls}`}>{st.label}</span>}
        {res && (res.status === "re" || res.status === "killed") && res.exit && <span className="muted cg-exit">終了コード {res.exit}</span>}
        {res?.timeMs !== undefined ? (
          <span className={slow ? "cg-time slow" : "cg-time"} title={slow ? "AtCoder のふつうの制限時間(2秒)を超えています" : undefined}>
            {(res.timeMs / 1000).toFixed(2)} 秒{slow && "(2秒超)"}
          </span>
        ) : (
          res?.wallMs !== undefined && (
            <span className="cg-time" title="コンパイルと通信を含む、応答までの時間">
              応答 {(res.wallMs / 1000).toFixed(1)} 秒
            </span>
          )
        )}
      </div>
      <button type="button" className="mypage-toggle cg-use" onClick={onUse} disabled={row.input === ""}>
        標準入力に入れる
      </button>
      <details className="cg-case-detail">
        <summary>{res?.stdout !== undefined || res?.compiler || res?.message ? "入力と結果を見る" : "入力を見る"}</summary>
        <div className="io-label">入力(先頭)</div>
        <pre className="io-out">{preview(row.input, row.lines)}</pre>
        {res?.message && <p className="error-text">{res.message}</p>}
        {res?.compiler && (
          <>
            <div className="io-label">コンパイラメッセージ</div>
            <pre className="io-out io-err">{res.compiler}</pre>
          </>
        )}
        {res?.stdout !== undefined && res.status !== "ce" && (
          <>
            <div className="io-label">標準出力{res.stdoutLen && res.stdoutLen > 4000 ? `(先頭 / 全 ${formatBytes(res.stdoutLen)})` : ""}</div>
            <pre className="io-out">{res.stdout || "(出力なし)"}</pre>
          </>
        )}
        {res?.stderr && (
          <>
            <div className="io-label">標準エラー出力</div>
            <pre className="io-out io-err">{res.stderr}</pre>
          </>
        )}
      </details>
    </li>
  );
}
