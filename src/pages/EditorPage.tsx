import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CaseGenerator } from "../components/CaseGenerator";
import { CodeEditor } from "../components/CodeEditor";
import type { CodeEditorHandle } from "../components/CodeEditor";
import { ProblemSearch } from "../components/ProblemSearch";
import { EDITOR_LANGS } from "../lib/wandbox";
import { isWarningOnly, runCode } from "../lib/run";
import type { RunOutcome } from "../lib/run";
import { readStore, removeStore, writeStore } from "../lib/storage";
import type { LinkedProblem } from "../lib/types";

const CODE_KEY = (lang: string) => `shojin:editor:code:${lang}`;
const STDIN_KEY = "shojin:editor:stdin";
const LANG_KEY = "shojin:editor:lang";
const PROBLEM_KEY = "shojin:editor:problem";

// コード欄の入力支援・高さ変更は CodeEditor(計算量タブと共用)が持つ
const INDENT_KEY = "shojin:editor:indent";
const HEIGHT_KEY = "shojin:editor:height";
const INDENT_WIDTHS = [2, 4, 8];
// 標準入力はこれより大きければ保存しない(コーナーケースの大きい入力で localStorage の容量を使い切り、
// コードまで保存できなくなるのを防ぐ。古い入力が戻るよりは空の方がよい)
const STDIN_SAVE_MAX = 1_000_000;
// 標準出力はこれより長ければ先頭だけを表示する(数MBの出力でページが固まらないように)
const OUTPUT_SHOW_MAX = 100_000;

function loadProblem(): LinkedProblem | null {
  try {
    const raw = readStore(PROBLEM_KEY);
    return raw ? (JSON.parse(raw) as LinkedProblem) : null;
  } catch {
    return null;
  }
}

/** クリップボードの API が使えないとき(古い WebView・http)の代わり。選択してコピーする */
function copyByCommand(text: string): boolean {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.top = "-1000px";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

/** 長い出力は先頭だけにする */
function clip(s: string): string {
  return s.length > OUTPUT_SHOW_MAX
    ? `${s.slice(0, OUTPUT_SHOW_MAX)}\n…(全 ${s.length.toLocaleString()} 文字のうち先頭 ${OUTPUT_SHOW_MAX.toLocaleString()} 文字を表示)`
    : s;
}

// テンプレート(wandbox.ts)が書かれているインデント幅
const TEMPLATE_WIDTH = 4;

/** 各行の先頭インデントを oldW → newW のレベルに変換する(端数スペースは維持)。 */
function reindent(code: string, oldW: number, newW: number): string {
  if (oldW === newW) return code;
  return code
    .split("\n")
    .map((line) => {
      const m = /^ +/.exec(line);
      if (!m) return line;
      const n = m[0].length;
      return " ".repeat(Math.floor(n / oldW) * newW + (n % oldW)) + line.slice(n);
    })
    .join("\n");
}

export function EditorPage() {
  const [params, setParams] = useSearchParams();
  const [langKey, setLangKey] = useState(
    () => readStore(LANG_KEY) ?? EDITOR_LANGS[0].key,
  );
  const lang =
    EDITOR_LANGS.find((l) => l.key === langKey) ?? EDITOR_LANGS[0];
  // インデント幅(スペース数)。入力支援(Enter/Tab)とtab-size表示・テンプレ変換に効く
  const [indentWidth, setIndentWidth] = useState(() => {
    const n = Number(readStore(INDENT_KEY));
    return INDENT_WIDTHS.includes(n) ? n : 2;
  });
  // 保存済みコードを読む。全削除(空白のみ)された保存分はテンプレートに戻す
  const loadCode = (key: string, template: string): string => {
    const saved = readStore(CODE_KEY(key));
    if (saved != null && saved.trim() !== "") return saved;
    return reindent(template, TEMPLATE_WIDTH, indentWidth);
  };
  const [code, setCode] = useState(() => loadCode(langKey, lang.template));
  const [stdin, setStdin] = useState(
    () => readStore(STDIN_KEY) ?? "",
  );
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunOutcome | null>(null);
  const [error, setError] = useState("");
  const [problem, setProblem] = useState<LinkedProblem | null>(loadProblem);
  // 「コードをコピーして提出」を押した直後の表示切り替え
  const [copied, setCopied] = useState(false);
  const [copyErr, setCopyErr] = useState(false);
  // コードを保存できなかった(localStorage の容量切れなど)。再読み込みで消えることを知らせる
  const [saveFailed, setSaveFailed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const editorRef = useRef<CodeEditorHandle>(null);

  // 「次に解く問題」等からの遷移(?contest=&task=&title=)で問題を連携する
  useEffect(() => {
    const contest = params.get("contest");
    const task = params.get("task");
    if (!contest || !task) return;
    const p: LinkedProblem = {
      contest,
      task,
      title: params.get("title") ?? undefined,
    };
    setProblem(p);
    writeStore(PROBLEM_KEY, JSON.stringify(p));
    setParams({}, { replace: true }); // URLを綺麗に保つ(再訪時はlocalStorageから復元)
  }, [params, setParams]);

  const applyProblem = (p: LinkedProblem) => {
    setProblem(p);
    writeStore(PROBLEM_KEY, JSON.stringify(p));
  };

  /**
   * 提出リンクのクリックでコードをクリップボードへ入れる。
   * ブラウザからatcoder.jpへは投稿できない(CORSもログインもある)ので、
   * 「貼り付けるだけ」まで持っていくのが現実的な上限。
   *
   * <a>のままにしてpreventDefaultしないので、ポップアップブロックと無縁で
   * ⌘クリックや中クリックも生きる。コピーに失敗しても遷移は止めない。
   */
  const copyForSubmit = () => {
    const done = (ok: boolean) => {
      setCopied(ok);
      setCopyErr(!ok);
      // 次に押したときのために、少ししたら元の文言に戻す
      setTimeout(() => {
        setCopied(false);
        setCopyErr(false);
      }, ok ? 2000 : 4000);
    };
    // ユーザー操作の直後である必要があるので、最初の文で同期的に呼ぶ
    const p = navigator.clipboard?.writeText(code);
    if (!p) {
      done(copyByCommand(code));
      return;
    }
    void p.then(
      () => done(true),
      () => done(false),
    );
  };

  const unlinkProblem = () => {
    setProblem(null);
    removeStore(PROBLEM_KEY);
  };

  // 言語切替: 現在のコードを保存し、切替先の保存分(無ければ/空ならテンプレ)を読む
  const switchLang = (key: string) => {
    writeStore(CODE_KEY(langKey), code);
    const next = EDITOR_LANGS.find((l) => l.key === key) ?? EDITOR_LANGS[0];
    setLangKey(key);
    setCode(loadCode(key, next.template));
    writeStore(LANG_KEY, key);
  };

  // コードを現在の言語のテンプレートに戻す(確認つき・undoで復帰可能)
  const resetTemplate = () => {
    const tpl = reindent(lang.template, TEMPLATE_WIDTH, indentWidth);
    if (code === tpl) return;
    if (
      code.trim() !== "" &&
      !confirm("現在のコードを消してテンプレートに戻します。よろしいですか?")
    ) {
      return;
    }
    const ed = editorRef.current;
    if (ed) ed.replaceAll(tpl, tpl.length);
    else setCode(tpl);
  };

  // インデント幅変更: 既存コードの先頭インデントも新しい幅に変換する。
  // 表示中の言語だけでなく、他言語の保存済みコードも合わせて変換しないと
  // 言語を切り替えたときに旧い幅のコードが出てきて混在する。
  const changeIndent = (n: number) => {
    const newCode = reindent(code, indentWidth, n);
    setIndentWidth(n);
    writeStore(INDENT_KEY, String(n));
    for (const l of EDITOR_LANGS) {
      if (l.key === langKey) continue;
      const saved = readStore(CODE_KEY(l.key));
      if (saved == null) continue;
      const conv = reindent(saved, indentWidth, n);
      if (conv !== saved) writeStore(CODE_KEY(l.key), conv);
    }
    if (newCode === code) return;
    // undo履歴を保って全置換(キャレット位置は保つ)
    const ed = editorRef.current;
    if (ed) ed.replaceAll(newCode);
    else setCode(newCode);
  };

  // コード/入力は自動保存(リロードしても消えない)
  const saveCode = (key: string, c: string) => setSaveFailed(!writeStore(CODE_KEY(key), c));
  const saveStdin = (s: string) => {
    // コーナーケースの大きい入力は保存しない(容量を使い切るとコードまで保存できなくなる)
    if (s.length > STDIN_SAVE_MAX || !writeStore(STDIN_KEY, s)) removeStore(STDIN_KEY);
  };
  useEffect(() => {
    const t = setTimeout(() => saveCode(langKey, code), 400);
    return () => clearTimeout(t);
  }, [code, langKey]);
  useEffect(() => {
    const t = setTimeout(() => saveStdin(stdin), 400);
    return () => clearTimeout(t);
  }, [stdin]);
  // 保存待ち(400ms)のうちにページを離れても、最後のコードと入力を保存する
  const latest = useRef({ code, langKey, stdin });
  latest.current = { code, langKey, stdin };
  useEffect(
    () => () => {
      const { code: c, langKey: k, stdin: s } = latest.current;
      writeStore(CODE_KEY(k), c);
      saveStdin(s);
    },
    [],
  );

  const run = async () => {
    if (running) {
      abortRef.current?.abort();
      return;
    }
    setRunning(true);
    setError("");
    setResult(null);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const r = await runCode(lang, code, stdin, ac.signal);
      setResult(r);
    } catch (e) {
      if ((e as Error).name === "AbortError") setError("中断しました");
      else setError(`実行に失敗しました: ${e}`);
    } finally {
      setRunning(false);
    }
  };

  // Ctrl/Cmd+Enterはコード欄に限らずエディタータブのどこからでも効かせる。
  // run() は code/stdin/lang/running を閉じ込むので、[]依存で登録した素の
  // クロージャだと「常に初期コードを実行し、runningがfalse固定で中断も壊れる」。
  // useEffectEventなら識別子は安定したまま常に最新のrunを呼べる。
  const onRunHotkey = useEffectEvent(() => {
    void run();
  });
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.repeat) return; // 長押しで実行↔中断がピンポンするのを防ぐ
      if (!(e.ctrlKey || e.metaKey) || e.key !== "Enter") return;
      // preventDefaultは必須(消すと実行と同時にtextareaへ改行が入る)
      e.preventDefault();
      onRunHotkey();
    };
    // キャプチャで拾って、途中で伝播を止める要素があっても取りこぼさない
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);

  const copyLabel = copied
    ? "コピーしました ✓"
    : copyErr
      ? "コピーできませんでした(提出ページへ) ↗"
      : "コードをコピーして提出 ↗";
  const exitOk = result !== null && result.status === "0" && !result.signal;
  // コンパイラの出力が警告(=実行を妨げないもの)だけかどうか。
  // 判定できないときはfalseになり、従来どおりエラー扱いの赤で出る
  const warnOnly = result !== null && isWarningOnly(result);

  return (
    <div className="page">
      <div className="editor-toolbar">
        <label className="editor-lang">
          言語
          <select
            value={langKey}
            onChange={(e: ChangeEvent<HTMLSelectElement>) =>
              switchLang(e.target.value)
            }
          >
            {EDITOR_LANGS.map((l) => (
              <option key={l.key} value={l.key}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <span className="muted editor-version">{lang.version}</span>
        <label className="editor-lang">
          インデント
          <select
            value={indentWidth}
            onChange={(e: ChangeEvent<HTMLSelectElement>) =>
              changeIndent(Number(e.target.value))
            }
            aria-label="インデント幅"
          >
            {INDENT_WIDTHS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="run-btn"
          onClick={() => void run()}
        >
          {running ? "中断" : "実行 ▶"}
        </button>
        <span className="muted editor-hint">
          Ctrl+Enterで実行 / Ctrl+/でコメント / Esc→Tabで欄の外へ
        </span>
        <div className="editor-problem">
          {problem ? (
            <>
              <span className="ep-label">問題</span>
              <a
                className="ep-title"
                href={`https://atcoder.jp/contests/${problem.contest}/tasks/${problem.task}`}
                target="_blank"
                rel="noreferrer"
              >
                {problem.title ?? problem.task} ↗
              </a>
              <a
                className="ep-submit"
                href={`https://atcoder.jp/contests/${problem.contest}/submit?taskScreenName=${problem.task}`}
                target="_blank"
                rel="noreferrer"
                onClick={copyForSubmit}
                title="コードをクリップボードにコピーして、AtCoderの提出ページを新しいタブで開きます(提出ページの言語選択は引き継げません)"
              >
                {copyLabel}
              </a>
              <button type="button" className="linklike" onClick={unlinkProblem}>
                解除
              </button>
            </>
          ) : (
            <ProblemSearch onPick={applyProblem} />
          )}
        </div>
      </div>

      <section className="card editor-card">
        {/* コード欄の右上に浮かせる操作。ツールバーに足すと問題連携が2行目に落ちるので、コードに対する操作はここに置く */}
        <div className="editor-card-actions">
          {/* 計算量タブへ。入力の途中(400msの保存待ち)でも今のコードを渡せるよう、移動の前に保存する */}
          <Link
            className="editor-cx-link"
            to="/complexity?from=editor"
            onClick={() => {
              // 保存できなくても移動はする(計算量タブ側でエラーを出す)
              writeStore(CODE_KEY(langKey), code);
              writeStore(LANG_KEY, langKey);
            }}
            title="このコードの計算量を計算量タブで調べます(コードは送信しません)"
          >
            計算量を調べる →
          </Link>
          <button
            type="button"
            className="tpl-reset"
            onClick={resetTemplate}
            title="コードをこの言語のテンプレートに戻す"
          >
            ↺ テンプレートに戻す
          </button>
        </div>
        <CodeEditor
          ref={editorRef}
          code={code}
          onChange={setCode}
          langKey={langKey}
          indentWidth={indentWidth}
          heightKey={HEIGHT_KEY}
        />
        {saveFailed && (
          <p className="error-text editor-save-err">
            コードをブラウザに保存できませんでした(保存領域がいっぱいか、プライベートモードです)。再読み込みすると消えます。
          </p>
        )}
      </section>

      <div className="two-col editor-io">
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">標準入力</h2>
          </div>
          <textarea
            className="io-area"
            value={stdin}
            onChange={(e) => setStdin(e.target.value)}
            spellCheck={false}
            placeholder="入力をここに書く"
            aria-label="標準入力"
          />
        </section>
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">標準出力</h2>
            {result !== null && (
              <span className={exitOk ? "exit-chip ok" : "exit-chip ng"}>
                {result.signal
                  ? `シグナル: ${result.signal}`
                  : result.truncated
                    ? "出力が長すぎて打ち切り(終了コード不明)"
                    : `終了コード ${result.status || "不明"}`}
              </span>
            )}
          </div>
          {running && <p className="muted">実行中…</p>}
          {error && <p className="error-text">{error}</p>}
          {result !== null && (
            <>
              {result.backend === "godbolt" && (
                <p className="fallback-note">
                  ⚠ {result.fallback === "size" ? "入力が大きい(約1MBを超える)ため" : "Wandboxが停止中のため"}{" "}
                  <a href="https://godbolt.org" target="_blank" rel="noreferrer">
                    Compiler Explorer
                  </a>{" "}
                  で実行しました({result.backendVersion})
                </p>
              )}
              {result.truncated && (
                <p className="fallback-note">
                  ⚠ 出力が Wandbox の上限(約128KB)を超えたため、途中で切られています
                </p>
              )}
              <pre className="io-out">{result.stdout ? clip(result.stdout) : "(出力なし)"}</pre>
              {result.compilerError && (
                <>
                  <div className="io-label">
                    {warnOnly ? "コンパイラの警告" : "コンパイラメッセージ"}
                  </div>
                  <pre className={warnOnly ? "io-out io-warn" : "io-out io-err"}>
                    {clip(result.compilerError)}
                  </pre>
                </>
              )}
              {result.stderr && (
                <>
                  <div className="io-label">標準エラー出力</div>
                  <pre className="io-out io-err">{clip(result.stderr)}</pre>
                </>
              )}
            </>
          )}
          {!running && !error && result === null && (
            <p className="muted">「実行 ▶」を押すと結果がここに出ます。</p>
          )}
        </section>
      </div>

      <CaseGenerator lang={lang} code={code} problem={problem} onUseInput={setStdin} />

      <p className="muted editor-note">
        実行は{" "}
        <a href="https://wandbox.org" target="_blank" rel="noreferrer">
          Wandbox
        </a>
        (停止中や入力が約1MBを超えるときは{" "}
        <a href="https://godbolt.org" target="_blank" rel="noreferrer">
          Compiler Explorer
        </a>
        )で、コーナーケースのまとめて実行は実行時間を測れる Compiler Explorer を先に使います(コードは外部サービスに送信されます)。
      </p>
    </div>
  );
}
