// 計算量タブ。貼り付けたコードの最悪時間計算量と領域計算量を、ブラウザ内の静的解析で推定する。
// コードは実行もせず外部にも送らない(解析は src/lib/complexity)。
//
// 解析は「解析 ▶」か Ctrl+Enter のときだけ走らせ、変数の範囲や制限時間を変えたときは
// 解析結果の式(time.full)に値を入れて回数を計算し直すだけにする(解析し直さない)。
// .page 直下の子は常に6個に固定する(条件付きの要素はカードの中に閉じる)。
// nth-child の時間差アニメーションがずれないようにするため。
// コード欄はエディタータブと同じ CodeEditor(ハイライト・行番号・入力支援)を使い、インデント幅もエディターの設定に従う。
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type { ChangeEvent, ClipboardEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { CodeEditor } from "../components/CodeEditor";
import type { CodeEditorHandle } from "../components/CodeEditor";
import { StatCard } from "../components/StatCard";
import { EDITOR_LANGS } from "../lib/wandbox";
import { formatBig, splitStatement, statementBounds } from "../lib/casegen";
import type { NamedBound } from "../lib/casegen";
import { loadCases, loadProblem } from "../lib/editorStore";
import { katexHtmlToText, statementHtmlToText } from "../lib/katexPaste";
import { readStore, writeStore } from "../lib/storage";
import { analyzeCode, BASIC_LANGS, differentLanguage, evaluate, formatOps, guessLanguage, isSupported, LANG_NOTES, parseBoundValue, SPEED } from "../lib/complexity";
import type { Analysis, BreakdownItem, Confidence, TimeVerdict } from "../lib/complexity";

const LANG_KEY = "shojin:complexity:lang";
const CODE_KEY = (lang: string) => `shojin:complexity:code:${lang}`;
const RANGES_KEY = "shojin:complexity:ranges";
const TL_KEY = "shojin:complexity:tl";
const HEIGHT_KEY = "shojin:complexity:height";
// エディターの保存先(EditorPage と同じキー)
const EDITOR_LANG_KEY = "shojin:editor:lang";
const EDITOR_CODE_KEY = (lang: string) => `shojin:editor:code:${lang}`;
const EDITOR_INDENT_KEY = "shojin:editor:indent";

const load = readStore;
// 保存できなくても(プライベートモード・容量超過)ページは動かす
const save = (key: string, value: string): void => void writeStore(key, value);

/** 制限時間の入力(2 / 2.5 / 2,5 / 全角)を秒にする。読めなければ NaN */
function parseSeconds(raw: string): number {
  const s = raw.normalize("NFKC").trim().replace(/,/g, ".").replace(/秒$/, "");
  return s === "" ? NaN : Number(s);
}

const knownLang = (key: string | null): key is string => !!key && EDITOR_LANGS.some((l) => l.key === key);

function initialLang(): string {
  const own = load(LANG_KEY);
  if (knownLang(own)) return own;
  const editor = load(EDITOR_LANG_KEY);
  if (knownLang(editor)) return editor;
  return EDITOR_LANGS[0].key;
}

/** エディターで選んだインデント幅(EditorPage の INDENT_WIDTHS と同じ 2 / 4 / 8。既定 2) */
function loadIndentWidth(): number {
  const n = Number(load(EDITOR_INDENT_KEY));
  return [2, 4, 8].includes(n) ? n : 2;
}

function loadRanges(): Record<string, string> {
  try {
    const raw = load(RANGES_KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    if (!v || typeof v !== "object") return {};
    const out: Record<string, string> = {};
    for (const [k, s] of Object.entries(v as Record<string, unknown>)) if (typeof s === "string") out[k] = s;
    return out;
  } catch {
    return {};
  }
}

const CONF_CHIP: Record<Confidence, { cls: string; text: string }> = {
  high: { cls: "exit-chip ok", text: "推定: 高" },
  medium: { cls: "exit-chip warn", text: "推定: 中" },
  low: { cls: "exit-chip ng", text: "推定: 低" },
};
const VERDICT_CHIP: Record<TimeVerdict, { cls: string; text: string }> = {
  ok: { cls: "exit-chip ok", text: "余裕" },
  tight: { cls: "exit-chip warn", text: "厳しい" },
  tle: { cls: "exit-chip ng", text: "TLEの恐れ" },
};
const KIND_LABEL: Record<BreakdownItem["kind"], string> = {
  loop: "ループ",
  call: "呼び出し",
  recursion: "再帰",
  alloc: "確保",
  builtin: "組み込み",
  func: "関数",
};

/** よくある上限(範囲の入力欄の候補) */
const COMMON_BOUNDS = ["2×10^5", "10^5", "3×10^5", "5×10^5", "10^6", "2×10^6", "10^9", "10^18", "5000", "3000", "2000", "1000", "100"];

/** 範囲の入力欄に入れる文字列(1〜2×10^5。欄が狭いので短く)。parseBoundValue で読み戻せる形 */
function boundText(b: NamedBound): string {
  return b.lo !== null ? `${formatBig(b.lo)}〜${formatBig(b.hi)}` : formatBig(b.hi);
}

/** エディターで連携している問題と、読み込んである「入力」「制約」(無ければ null) */
function linkedStatement(): { title: string; format: string; constraints: string } | null {
  const p = loadProblem();
  if (!p) return null;
  const c = loadCases(p);
  if (!c.constraints.trim() && !c.format.trim()) return null;
  return { title: p.title ?? p.task, format: c.format, constraints: c.constraints };
}

/** 範囲の値の表示(1000万未満は桁区切り、それより大きければ 10^7 の形) */
function showValue(n: number): string {
  if (!Number.isInteger(n)) return String(n);
  return n < 1e7 ? n.toLocaleString("en-US") : formatOps(n);
}

/** 「12行目: …」の行番号を取り出す */
function splitLine(message: string): { line: number; rest: string } | null {
  const m = /^(\d+)行目: /.exec(message);
  return m ? { line: Number(m[1]), rest: message.slice(m[0].length) } : null;
}

export function ComplexityPage() {
  const [params, setParams] = useSearchParams();
  const [langKey, setLangKey] = useState(initialLang);
  const [code, setCode] = useState(() => load(CODE_KEY(initialLang())) ?? "");
  const [result, setResult] = useState<Analysis | null>(null);
  const [analyzed, setAnalyzed] = useState<{ code: string; lang: string } | null>(null);
  const [error, setError] = useState("");
  const [rawBounds, setRawBounds] = useState<Record<string, string>>(loadRanges);
  // 前回の保存から復元しただけで、このページでまだ触っていない範囲(「前回の値」と出す)
  const [restored, setRestored] = useState<Set<string>>(() => new Set(Object.keys(loadRanges())));
  // 問題の制約から入れた範囲(変数名 → どこから入れたか)。手で書き換えたら消す
  const [fromStatement, setFromStatement] = useState<Map<string, string>>(() => new Map());
  // エディターで連携している問題の制約(エディターから読み込むたびに読み直す)
  const [linked, setLinked] = useState(linkedStatement);
  const [statementText, setStatementText] = useState("");
  const [fillNote, setFillNote] = useState("");
  const [rawTl, setRawTl] = useState(() => load(TL_KEY) ?? "2");
  const [indentWidth] = useState(loadIndentWidth);
  const editorRef = useRef<CodeEditorHandle>(null);
  const importedRef = useRef(false);

  const lang = EDITOR_LANGS.find((l) => l.key === langKey) ?? EDITOR_LANGS[0];

  // コードは入力が止まってから保存する(EditorPage と同じ 400ms)
  useEffect(() => {
    const t = setTimeout(() => save(CODE_KEY(langKey), code), 400);
    return () => clearTimeout(t);
  }, [code, langKey]);
  // 保存待ちのうちにページを離れても、最後のコードを保存する
  const latest = useRef({ code, langKey });
  latest.current = { code, langKey };
  useEffect(() => () => save(CODE_KEY(latest.current.langKey), latest.current.code), []);
  useEffect(() => {
    save(RANGES_KEY, JSON.stringify(rawBounds));
  }, [rawBounds]);
  useEffect(() => {
    save(TL_KEY, rawTl);
  }, [rawTl]);

  /** 解析の唯一の入口(ボタン・Ctrl+Enter・エディターからの読み込み) */
  const analyzeNow = (src = code, key = langKey): Analysis | null => {
    if (src.trim() === "") {
      setError("コードを貼り付けてください");
      setResult(null);
      editorRef.current?.focus();
      return null;
    }
    let r: Analysis;
    try {
      r = analyzeCode(src, key);
    } catch (e) {
      setError(`解析に失敗しました: ${(e as Error).message}`);
      setResult(null);
      return null;
    }
    // 解析できなかった理由は解析メモの警告に出るので、ここでは二重に出さない
    setError(r.status === "error" && r.warnings.length === 0 ? "解析に失敗しました" : "");
    setResult(r);
    setAnalyzed({ code: src, lang: key });
    return r;
  };

  // Ctrl/Cmd+Enter はページのどこからでも効かせる(EditorPage と同じ作法)
  const onHotkey = useEffectEvent(() => analyzeNow());
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.repeat) return;
      if (!(e.ctrlKey || e.metaKey) || e.key !== "Enter") return;
      e.preventDefault();
      onHotkey();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);

  /**
   * 言語を切り替える。ふつうは切り替え先で前に書いていたコードを読み込む。keepCode なら今のコードのまま
   * 解析する(貼ったコードが別の言語だと分かったとき)。解析済みなら、切り替えた言語で解析し直す
   * (前の言語の解析結果に新しい言語の速さを掛けた概算を出さない)
   */
  const switchLang = (key: string, keepCode = false) => {
    save(CODE_KEY(langKey), code);
    const next = keepCode ? code : (load(CODE_KEY(key)) ?? "");
    setLangKey(key);
    setCode(next);
    save(LANG_KEY, key);
    if (keepCode) save(CODE_KEY(key), next);
    setError("");
    if ((result || keepCode) && next.trim() !== "") analyzeNow(next, key);
    else {
      setResult(null);
      setAnalyzed(null);
    }
  };

  const onCodeChange = (c: string) => {
    setCode(c);
    // 「コードを貼り付けてください」のような前の解析のエラーは、書き換えたら消す
    if (error) setError("");
  };

  // 貼ったコードが選んでいる言語と別のものに見えたら知らせる(勝手には切り替えない)
  const guessed = useMemo(() => guessLanguage(code), [code]);
  const suggest = differentLanguage(langKey, guessed) ? EDITOR_LANGS.find((l) => l.key === guessed) : undefined;

  /** エディターで書いているコードと言語を読み込んで、そのまま解析する */
  const importFromEditor = () => {
    const edLang = load(EDITOR_LANG_KEY);
    const key = knownLang(edLang) ? edLang : langKey;
    const edCode = load(EDITOR_CODE_KEY(key));
    if (!edCode || edCode.trim() === "") {
      setError("エディターに保存されたコードがありません");
      return;
    }
    if (code.trim() !== "" && code !== edCode && !confirm("現在のコードを消してエディターのコードを読み込みます。よろしいですか?")) {
      return;
    }
    save(CODE_KEY(langKey), code);
    setLangKey(key);
    setCode(edCode);
    save(LANG_KEY, key);
    const r = analyzeNow(edCode, key);
    // エディターで連携している問題の制約を読み込んであれば、空いている範囲(と前回の値)をそれで埋める
    const st = linkedStatement();
    setLinked(st);
    if (r && r.status === "ok" && st) {
      const res = fillFromStatement(st.format, st.constraints, `${st.title} の制約`, false, r.variables);
      if (res.filled.length > 0) setFillNote(fillMessage(res));
    }
  };

  // エディターの「計算量を調べる →」から来たら読み込む(StrictMode の2回実行でも1回だけ)
  const onFromEditor = useEffectEvent(() => {
    importFromEditor();
    setParams({}, { replace: true });
  });
  useEffect(() => {
    if (params.get("from") !== "editor" || importedRef.current) return;
    importedRef.current = true;
    onFromEditor();
  }, [params]);

  /** コード欄の lineFrom〜lineTo 行を選択して見える位置へ動かす */
  const jumpTo = (lineFrom: number, lineTo = lineFrom) => editorRef.current?.selectLines(lineFrom, lineTo);

  // ---- 範囲と回数の概算 ----
  const bounds = useMemo(() => {
    const out: Record<string, { lo: number | null; hi: number } | null> = {};
    for (const [k, v] of Object.entries(rawBounds)) out[k] = v.trim() === "" ? null : parseBoundValue(v);
    return out;
  }, [rawBounds]);
  const tl = parseSeconds(rawTl);
  const tlValid = Number.isFinite(tl) && tl > 0;
  const ok = result !== null && result.status === "ok";
  const est = useMemo(() => {
    if (!ok || !result) return null;
    const values: Record<string, number> = {};
    for (const v of result.variables) {
      const b = bounds[v.name];
      if (b) values[v.name] = b.hi;
    }
    return evaluate(result.time.full, values, langKey, tlValid ? tl : 2);
  }, [ok, result, bounds, langKey, tl, tlValid]);

  const setBound = (name: string, value: string) => {
    setRawBounds((prev) => ({ ...prev, [name]: value }));
    setRestored((prev) => {
      if (!prev.has(name)) return prev;
      const next = new Set(prev);
      next.delete(name);
      return next;
    });
    setFromStatement((prev) => {
      if (!prev.has(name)) return prev;
      const next = new Map(prev);
      next.delete(name);
      return next;
    });
  };

  /**
   * 問題の「入力」「制約」から分かる範囲を、解析した変数に入れる(N は N、|a| は配列 A の長さ。大文字小文字は区別しない)。
   * overwrite でなければ、空欄・前回の値・前に制約から入れた値だけを書き換え、手で入れた値は残す
   */
  const fillFromStatement = (format: string, constraints: string, source: string, overwrite: boolean, vars = result?.variables ?? []) => {
    const found = statementBounds(format, constraints);
    const byName = new Map(found.map((b) => [b.name.toLowerCase(), b]));
    const next: Record<string, string> = {};
    const filled: string[] = [];
    const missing: string[] = [];
    for (const v of vars) {
      const b = byName.get(v.name.toLowerCase());
      if (!b) {
        missing.push(v.name);
        continue;
      }
      const raw = rawBounds[v.name] ?? "";
      if (!overwrite && raw.trim() !== "" && !restored.has(v.name) && !fromStatement.has(v.name)) continue;
      next[v.name] = boundText(b);
      filled.push(v.name);
    }
    if (filled.length > 0) {
      setRawBounds((prev) => ({ ...prev, ...next }));
      setRestored((prev) => new Set([...prev].filter((n) => !filled.includes(n))));
      setFromStatement((prev) => new Map([...prev, ...filled.map((n): [string, string] => [n, source])]));
    }
    return { filled, missing, found: found.map((b) => b.name) };
  };

  const fillMessage = (r: { filled: string[]; missing: string[]; found: string[] }): string => {
    if (r.found.length === 0) return "制約から変数の範囲を読み取れませんでした。問題ページの「制約」の部分(またはページ全体)をコピーして貼り付けてください。";
    if (r.filled.length === 0) {
      return `制約の変数(${r.found.slice(0, 8).join("・")})と、コードの変数(${r.missing.join("・")})の名前が一致しませんでした。手で入れてください。`;
    }
    return `${r.filled.join("・")} を制約から入れました。${r.missing.length > 0 ? `${r.missing.join("・")} は制約から分からないので、手で入れてください。` : ""}`;
  };

  // 問題ページの「制約」(またはページ全体)を貼ったら、まとめて入れる。数式は KaTeX の HTML から TeX に戻す
  const readStatement = (text: string) => {
    const parts = splitStatement(text);
    // 見出しが無ければ、貼ったものを丸ごと制約として読む
    const constraints = parts.constraints ?? (parts.format === null ? text : "");
    setFillNote(fillMessage(fillFromStatement(parts.format ?? "", constraints, "貼り付けた制約", true)));
    setStatementText("");
  };
  const pasteStatement = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const html = e.clipboardData.getData("text/html");
    const plain = e.clipboardData.getData("text/plain");
    if (!html && !plain) return;
    e.preventDefault();
    readStatement(html ? statementHtmlToText(html) : plain);
  };
  // 問題ページの制約をコピーして貼ると、KaTeX の表示では累乗が「10 改行 5」に割れ、入力欄は改行を捨てるので
  // 「105」になってしまう。HTML に元の TeX があればそれを、無ければ改行を空白にして入れる
  const pasteBound = (name: string) => (e: ClipboardEvent<HTMLInputElement>) => {
    const html = e.clipboardData.getData("text/html");
    const tex = html ? katexHtmlToText(html) : null;
    const plain = e.clipboardData.getData("text/plain");
    if (tex === null && !/[\n\u200b]/.test(plain)) return; // ふつうの貼り付けはそのまま
    e.preventDefault();
    const text = (tex ?? plain).replace(/\u200b/g, "").replace(/\s*\n\s*/g, " ").trim();
    const el = e.currentTarget;
    const a = el.selectionStart ?? el.value.length;
    const b = el.selectionEnd ?? a;
    setBound(name, el.value.slice(0, a) + text + el.value.slice(b));
  };
  const clearBounds = () => {
    if (!result) return;
    setRawBounds((prev) => {
      const next = { ...prev };
      for (const v of result.variables) delete next[v.name];
      return next;
    });
    setFromStatement(new Map());
    setFillNote("");
  };

  const stale = analyzed !== null && (analyzed.code !== code || analyzed.lang !== langKey);
  const variables = ok && result ? result.variables : [];
  const used = ok && result ? result.breakdown.filter((b) => !b.unused) : [];
  const unused = ok && result ? result.breakdown.filter((b) => b.unused) : [];
  const note = LANG_NOTES[langKey];

  let timeSub = "「解析 ▶」で推定";
  if (result && !ok) timeSub = result.status === "unsupported" ? "この言語はまだ解析できません" : "解析できませんでした";
  else if (est && est.missing.length === 0) {
    // スマホでは判定のチップが下の「変数の範囲」まで行かないと見えないので、ここにも出す
    timeSub = `≒ ${est.opsText} 回${est.verdict && tlValid ? `(${VERDICT_CHIP[est.verdict].text})` : ""}`;
  }
  else if (est) timeSub = `${est.missing.join(", ")} の上限を入力すると回数を概算`;

  return (
    <div className="page">
      <div className="editor-toolbar">
        <label className="editor-lang">
          言語
          <select value={langKey} onChange={(e: ChangeEvent<HTMLSelectElement>) => switchLang(e.target.value)}>
            {EDITOR_LANGS.map((l) => (
              <option key={l.key} value={l.key}>
                {l.label}
                {!isSupported(l.key) ? "(準備中)" : BASIC_LANGS.has(l.key) ? "(簡易対応)" : ""}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="run-btn" onClick={() => analyzeNow()}>
          解析 ▶
        </button>
        <button type="button" className="linklike" onClick={importFromEditor}>
          エディターのコードを読み込む
        </button>
        <span className="muted editor-hint">Ctrl+Enterで解析 / Ctrl+/でコメント / Esc→Tabで欄の外へ</span>
      </div>

      <section className="card editor-card cx-code-card">
        {error && <p className="error-text cx-msg">{error}</p>}
        {!error && stale && <p className="muted cx-msg">コードが変更されています。もう一度解析してください</p>}
        {suggest && (
          <p className="muted cx-msg">
            このコードは {suggest.label} のようです。{" "}
            <button type="button" className="linklike" onClick={() => switchLang(suggest.key, true)}>
              {suggest.label} として解析する
            </button>
          </p>
        )}
        <CodeEditor
          ref={editorRef}
          code={code}
          onChange={onCodeChange}
          langKey={langKey}
          indentWidth={indentWidth}
          heightKey={HEIGHT_KEY}
          ariaLabel="解析するコード"
          placeholder="ここにコードを貼り付けて「解析 ▶」"
        />
      </section>

      <div className="stat-grid cx-stats">
        <StatCard label="時間計算量" value={ok && result ? result.time.text : "—"} sub={timeSub} />
        <StatCard label="領域計算量" value={ok && result ? result.space.text : "—"} sub={ok ? "入力と再帰の深さを含む確保の合計" : "「解析 ▶」で推定"} />
      </div>

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">解析メモ</h2>
          {ok && result && <span className={CONF_CHIP[result.confidence].cls}>{CONF_CHIP[result.confidence].text}</span>}
          <p className="visually-hidden" role="status">
            {ok && result ? `解析しました: 時間 ${result.time.text}、領域 ${result.space.text}` : ""}
          </p>
        </div>
        {!result && <p className="muted cx-empty">「解析 ▶」を押すと結果がここに出ます。</p>}
        {result && (result.status !== "ok" || (result.breakdown.length === 0 && result.confidence === "low")) && (
          <p className="muted cx-empty">推定できませんでした。警告を確認してください</p>
        )}
        {result && result.warnings.length > 0 && (
          <ul className="cx-warn-list">
            {result.warnings.map((w, i) => {
              const s = splitLine(w.message);
              return (
                <li key={i} className={w.level}>
                  {s ? (
                    <>
                      <button type="button" className="linklike" onClick={() => jumpTo(s.line)}>
                        {s.line}行目
                      </button>
                      : {s.rest}
                    </>
                  ) : (
                    w.message
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {ok && result && result.warnings.length === 0 && <p className="muted cx-empty">気になる点はありません。</p>}
      </section>

      <div className="two-col cx-cols">
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">変数の範囲</h2>
            <span className="card-sub">範囲を入れると回数を概算</span>
            {variables.length > 0 && (
              <button type="button" className="linklike cx-clear" onClick={clearBounds}>
                範囲をクリア
              </button>
            )}
          </div>
          {!ok && <p className="muted cx-empty">解析すると、式に出てくる変数がここに並びます。</p>}
          {ok && variables.length === 0 && <p className="muted cx-empty">記号変数はありません(計算量はリテラルだけで決まります)</p>}
          {variables.length > 0 && (
            <>
              <div className="table-scroll">
                <table className="data-table cx-range-table">
                  <thead>
                    <tr>
                      <th>変数と由来</th>
                      <th>範囲</th>
                      <th>値</th>
                    </tr>
                  </thead>
                  <tbody>
                    {variables.map((v) => {
                      const raw = rawBounds[v.name] ?? "";
                      const b = bounds[v.name];
                      const bad = raw.trim() !== "" && !b;
                      return (
                        <tr key={v.name}>
                          <td>
                            <code className="cx-var">{v.name}</code>
                            <div className="cx-origin">
                              {v.line > 0 ? (
                                <button type="button" className="linklike" onClick={() => jumpTo(v.line)}>
                                  {v.origin}
                                </button>
                              ) : (
                                v.origin
                              )}
                            </div>
                          </td>
                          <td>
                            <input
                              className="cx-bound"
                              inputMode="text"
                              list="cx-common-bounds"
                              placeholder="例: 2e5"
                              value={raw}
                              onChange={(e) => setBound(v.name, e.target.value)}
                              onPaste={pasteBound(v.name)}
                              aria-label={`${v.name} の範囲`}
                              aria-invalid={bad}
                              aria-describedby="cx-total"
                              spellCheck={false}
                              autoCapitalize="off"
                              autoCorrect="off"
                            />
                          </td>
                          <td className="num">
                            {raw.trim() === "" ? (
                              <span className="muted">—</span>
                            ) : !b ? (
                              <span className="cx-bound-bad">無効</span>
                            ) : (
                              <>
                                {b.lo !== null ? `${showValue(b.lo)} 〜 ${showValue(b.hi)}` : `≤ ${showValue(b.hi)}`}
                                {fromStatement.has(v.name) ? (
                                  <span className="muted cx-restored">{fromStatement.get(v.name)}</span>
                                ) : (
                                  restored.has(v.name) && <span className="muted cx-restored">前回の値</span>
                                )}
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <datalist id="cx-common-bounds">
                {COMMON_BOUNDS.map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
              <p className="muted cx-hint">上限だけ(2e5)でも、制約の書き方(1 ≤ N ≤ 2×10^5)でも入れられます。欄を選ぶとよくある上限を選べます</p>
              {/* 問題の制約からまとめて入れる */}
              <div className="cx-fill">
                {linked && (
                  <button
                    type="button"
                    className="mypage-toggle cx-fill-linked"
                    onClick={() => setFillNote(fillMessage(fillFromStatement(linked.format, linked.constraints, `${linked.title} の制約`, true)))}
                    title="エディターで連携している問題の、読み込んである制約から入れます"
                  >
                    {linked.title} の制約から入れる
                  </button>
                )}
                <textarea
                  className="cx-fill-paste"
                  rows={2}
                  value={statementText}
                  onChange={(e) => setStatementText(e.target.value)}
                  onPaste={pasteStatement}
                  spellCheck={false}
                  placeholder="問題ページの「制約」(またはページ全体)をここに貼り付けると、まとめて入れます"
                  aria-label="問題の制約を貼り付ける欄"
                />
                {statementText.trim() !== "" && (
                  <button type="button" className="mypage-toggle" onClick={() => readStatement(statementText)}>
                    入れる
                  </button>
                )}
                {fillNote && (
                  <p className="muted cx-fill-note" role="status">
                    {fillNote}
                  </p>
                )}
              </div>
            </>
          )}
          {ok && (
            <div className="cx-total-row">
              <label className="editor-lang">
                制限時間
                <input
                  className="cx-bound cx-tl"
                  inputMode="decimal"
                  value={rawTl}
                  onChange={(e) => setRawTl(e.target.value)}
                  aria-label="制限時間(秒)"
                  aria-invalid={!tlValid}
                />
                秒
              </label>
              <p id="cx-total" className="cx-total">
                {est && est.missing.length === 0 ? (
                  <>
                    合計演算回数の概算 ≒ {est.opsText} 回
                    {est.verdict && tlValid && <span className={VERDICT_CHIP[est.verdict].cls}>{VERDICT_CHIP[est.verdict].text}</span>}
                    {!tlValid && <span className="error-text"> 制限時間を秒で入れると判定します(例: 2)</span>}
                  </>
                ) : (
                  <span className="muted">{est?.missing.join(", ")} の範囲を入れると概算します</span>
                )}
              </p>
              <p className="muted cx-hint">
                {lang.label} は約 {formatOps(SPEED[langKey] ?? 1e8)} 回/秒として概算(粗い目安)
              </p>
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h2 className="card-title">内訳</h2>
            <span className="card-sub">行をクリックでコードの該当箇所へ</span>
          </div>
          {!ok && <p className="muted cx-empty">ループ・呼び出し・再帰・確保ごとの計算量がここに並びます。</p>}
          {ok && used.length === 0 && <p className="muted cx-empty">目立った処理はありません。</p>}
          {used.length > 0 && <BreakdownTable items={used} onJump={jumpTo} />}
          {unused.length > 0 && (
            <details className="cx-unused">
              <summary>使われていない関数 {unused.length} 個</summary>
              <BreakdownTable items={unused} onJump={jumpTo} />
            </details>
          )}
        </section>
      </div>

      <p className="muted editor-note">
        計算量はブラウザ内の静的解析による推定で、コードは実行もどこかへ送信もしません。while の終了条件・ライブラリ関数の内部・文字列連結の実コストは推定できないことがあります。領域計算量は入力配列と再帰スタックを含む総確保量の目安です。入力の読み取り(1行の分割・数値変換)そのものは時間に数えません。「余裕/厳しい/TLEの恐れ」はループ本体を1演算と数えた粗い目安で、実際の判定は提出して確かめてください。
        {note && <> {note}</>}
      </p>
    </div>
  );
}

function BreakdownTable({ items, onJump }: { items: BreakdownItem[]; onJump: (from: number, to: number) => void }) {
  return (
    <div className="table-scroll">
      <table className="data-table cx-breakdown">
        <thead>
          <tr>
            <th>行</th>
            <th>項</th>
            <th>対象</th>
            <th>理由</th>
          </tr>
        </thead>
        <tbody>
          {items.map((b, i) => (
            <tr key={i}>
              <td className="num">
                <button type="button" className="linklike" onClick={() => onJump(b.loc.line, b.loc.endLine)}>
                  {b.loc.endLine > b.loc.line ? `${b.loc.line}–${b.loc.endLine}` : b.loc.line}
                </button>
              </td>
              <td>
                <code className="cx-term">{b.text}</code>
              </td>
              <td>
                <div className="cx-kind">
                  {b.axis === "time" ? "時間" : "領域"}・{KIND_LABEL[b.kind]}
                </div>
                <div className="cx-label">{b.label}</div>
              </td>
              <td className="cx-reason">{b.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
