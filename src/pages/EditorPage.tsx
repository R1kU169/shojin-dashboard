import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, KeyboardEvent, UIEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { EDITOR_LANGS, runCode } from "../lib/wandbox";
import type { RunResult } from "../lib/wandbox";

const CODE_KEY = (lang: string) => `shojin:editor:code:${lang}`;
const STDIN_KEY = "shojin:editor:stdin";
const LANG_KEY = "shojin:editor:lang";
const PROBLEM_KEY = "shojin:editor:problem";

// エディター入力支援: インデント幅と自動補完する括弧/クォートのペア
const INDENT = "    ";
const PAIRS: Record<string, string> = {
  "(": ")",
  "[": "]",
  "{": "}",
  '"': '"',
  "'": "'",
};
const CLOSERS = new Set(Object.values(PAIRS));

/** エディターに連携中のAtCoder問題 */
interface LinkedProblem {
  contest: string;
  task: string;
  title?: string;
}

// 問題URL(atcoder.jp/contests/x/tasks/y)か問題ID(abc467_b)をパースする
function parseProblemInput(s: string): LinkedProblem | null {
  const m = s.match(/atcoder\.jp\/contests\/([\w-]+)\/tasks\/([\w-]+)/);
  if (m) return { contest: m[1], task: m[2] };
  const t = s.trim().match(/^([a-z0-9-]+)_[a-z0-9]+$/i);
  if (t) return { contest: t[1].toLowerCase(), task: s.trim() };
  return null;
}

function loadProblem(): LinkedProblem | null {
  try {
    const raw = localStorage.getItem(PROBLEM_KEY);
    return raw ? (JSON.parse(raw) as LinkedProblem) : null;
  } catch {
    return null;
  }
}

export function EditorPage() {
  const [params, setParams] = useSearchParams();
  const [langKey, setLangKey] = useState(
    () => localStorage.getItem(LANG_KEY) ?? EDITOR_LANGS[0].key,
  );
  const lang =
    EDITOR_LANGS.find((l) => l.key === langKey) ?? EDITOR_LANGS[0];
  const [code, setCode] = useState(
    () => localStorage.getItem(CODE_KEY(langKey)) ?? lang.template,
  );
  const [stdin, setStdin] = useState(
    () => localStorage.getItem(STDIN_KEY) ?? "",
  );
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState("");
  const [problem, setProblem] = useState<LinkedProblem | null>(loadProblem);
  const [problemInput, setProblemInput] = useState("");
  const [problemErr, setProblemErr] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const linesRef = useRef<HTMLDivElement>(null);

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
    localStorage.setItem(PROBLEM_KEY, JSON.stringify(p));
    setParams({}, { replace: true }); // URLを綺麗に保つ(再訪時はlocalStorageから復元)
  }, [params, setParams]);

  const linkProblem = (e: FormEvent) => {
    e.preventDefault();
    const p = parseProblemInput(problemInput);
    if (!p) {
      setProblemErr("問題URL(atcoder.jp/contests/…/tasks/…)か問題ID(abc467_b)を入れてください");
      return;
    }
    setProblem(p);
    setProblemInput("");
    setProblemErr("");
    localStorage.setItem(PROBLEM_KEY, JSON.stringify(p));
  };

  const unlinkProblem = () => {
    setProblem(null);
    localStorage.removeItem(PROBLEM_KEY);
  };

  // 言語切替: 現在のコードを保存し、切替先の保存分(無ければテンプレ)を読む
  const switchLang = (key: string) => {
    localStorage.setItem(CODE_KEY(langKey), code);
    const next = EDITOR_LANGS.find((l) => l.key === key) ?? EDITOR_LANGS[0];
    setLangKey(key);
    setCode(localStorage.getItem(CODE_KEY(key)) ?? next.template);
    localStorage.setItem(LANG_KEY, key);
  };

  // コード/入力は自動保存(リロードしても消えない)
  useEffect(() => {
    const t = setTimeout(
      () => localStorage.setItem(CODE_KEY(langKey), code),
      400,
    );
    return () => clearTimeout(t);
  }, [code, langKey]);
  useEffect(() => {
    const t = setTimeout(() => localStorage.setItem(STDIN_KEY, stdin), 400);
    return () => clearTimeout(t);
  }, [stdin]);

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
      const r = await runCode(lang.compiler, code, stdin, ac.signal);
      setResult(r);
    } catch (e) {
      if ((e as Error).name === "AbortError") setError("中断しました");
      else setError(`実行に失敗しました: ${e}`);
    } finally {
      setRunning(false);
    }
  };

  /**
   * [from,to) を text に置き換えて選択を張り直す。まず execCommand を使い、
   * ブラウザのundo履歴(Cmd+Z)を保つ。使えない環境ではsetStateにフォールバック。
   */
  const edit = (
    el: HTMLTextAreaElement,
    from: number,
    to: number,
    text: string,
    selFrom: number,
    selTo: number,
  ) => {
    el.setSelectionRange(from, to);
    const ok =
      text === ""
        ? document.execCommand("delete")
        : document.execCommand("insertText", false, text);
    if (ok) {
      el.setSelectionRange(selFrom, selTo);
    } else {
      const v = el.value;
      setCode(v.slice(0, from) + text + v.slice(to));
      requestAnimationFrame(() => el.setSelectionRange(selFrom, selTo));
    }
  };

  // エディターの入力支援: 改行の自動インデント・括弧/クォート補完・
  // Tab/Shift+Tabのブロックインデント・Ctrl/Cmd+Enterで実行
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const v = el.value;
    const s = el.selectionStart;
    const t = el.selectionEnd;

    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      void run();
      return;
    }
    // 他のショートカット(コピー・undo等)は邪魔しない
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.key === "Tab") {
      e.preventDefault();
      if (e.shiftKey || v.slice(s, t).includes("\n")) {
        // 選択行ブロックをまとめてインデント/デデント
        const blockStart = v.lastIndexOf("\n", s - 1) + 1;
        let blockEnd = v.indexOf("\n", Math.max(s, t - 1));
        if (blockEnd === -1) blockEnd = v.length;
        const lines = v.slice(blockStart, blockEnd).split("\n");
        const newBlock = e.shiftKey
          ? lines.map((l) => l.replace(/^ {1,4}/, "")).join("\n")
          : lines.map((l) => INDENT + l).join("\n");
        edit(el, blockStart, blockEnd, newBlock, blockStart, blockStart + newBlock.length);
      } else {
        edit(el, s, t, INDENT, s + INDENT.length, s + INDENT.length);
      }
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      const lineStart = v.lastIndexOf("\n", s - 1) + 1;
      const line = v.slice(lineStart, s);
      const indent = /^[ \t]*/.exec(line)?.[0] ?? "";
      const prev = v[s - 1] ?? "";
      const next = v[t] ?? "";
      // { や ( [ の直後、Pythonの行末: では1段深く
      const opens = (prev !== "" && "{([".includes(prev)) || /:\s*$/.test(line);
      if (PAIRS[prev] && PAIRS[prev] === next) {
        // 括弧の間で改行: 中に1段インデントした行を作り、閉じ括弧を揃えて次行へ
        const mid = s + 1 + indent.length + INDENT.length;
        edit(el, s, t, `\n${indent}${INDENT}\n${indent}`, mid, mid);
      } else {
        const ins = `\n${indent}${opens ? INDENT : ""}`;
        edit(el, s, t, ins, s + ins.length, s + ins.length);
      }
      return;
    }

    // 閉じ括弧/クォートの直前で同じ文字を打ったらスキップ(重複させない)
    if (s === t && CLOSERS.has(e.key) && v[s] === e.key) {
      e.preventDefault();
      el.setSelectionRange(s + 1, s + 1);
      return;
    }

    if (PAIRS[e.key]) {
      const isQuote = e.key === '"' || e.key === "'";
      // 単語の直後のクォートは補完しない(英語コメントのdon't等)
      if (isQuote && s === t && /[A-Za-z0-9_]/.test(v[s - 1] ?? "")) return;
      e.preventDefault();
      if (s !== t) {
        // 選択範囲を括弧/クォートで囲む
        const inner = v.slice(s, t);
        edit(el, s, t, e.key + inner + PAIRS[e.key], s + 1, s + 1 + inner.length);
      } else {
        edit(el, s, t, e.key + PAIRS[e.key], s + 1, s + 1);
      }
      return;
    }

    // 空のペア()[]{}""'' の中でBackspace → 両方消す
    if (e.key === "Backspace" && s === t && s > 0) {
      const close = PAIRS[v[s - 1]];
      if (close && v[s] === close) {
        e.preventDefault();
        edit(el, s - 1, s + 1, "", s - 1, s - 1);
      }
    }
  };

  const onScroll = (e: UIEvent<HTMLTextAreaElement>) => {
    if (linesRef.current)
      linesRef.current.scrollTop = e.currentTarget.scrollTop;
  };

  const lineCount = code.split("\n").length;
  const exitOk = result !== null && result.status === "0" && !result.signal;

  return (
    <div className="page">
      <h1>コードテスト</h1>
      <p className="muted">
        コードと標準入力を書いて実行できます。実行は{" "}
        <a href="https://wandbox.org" target="_blank" rel="noreferrer">
          Wandbox
        </a>{" "}
        上で行われます(コードは外部サービスに送信されます)。
      </p>

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
        <button
          type="button"
          className="run-btn"
          onClick={() => void run()}
        >
          {running ? "中断" : "実行 ▶"}
        </button>
        <span className="muted editor-hint">Ctrl+Enterでも実行</span>
      </div>

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
            >
              AtCoderで提出 ↗
            </a>
            <button type="button" className="linklike" onClick={unlinkProblem}>
              解除
            </button>
          </>
        ) : (
          <form className="ep-form" onSubmit={linkProblem}>
            <input
              value={problemInput}
              onChange={(e) => {
                setProblemInput(e.target.value);
                setProblemErr("");
              }}
              placeholder="問題URLを貼ると提出ページへのリンクが出ます"
              aria-label="AtCoder問題URL"
            />
            <button type="submit">連携</button>
          </form>
        )}
        {problemErr && <span className="error-text">{problemErr}</span>}
      </div>

      <section className="card editor-card">
        <div className="editor-wrap">
          <div className="editor-lines" ref={linesRef} aria-hidden="true">
            {Array.from({ length: lineCount }, (_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>
          <textarea
            className="editor-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={onKeyDown}
            onScroll={onScroll}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-label="コード"
          />
        </div>
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
                  : `終了コード ${result.status}`}
              </span>
            )}
          </div>
          {running && <p className="muted">実行中…</p>}
          {error && <p className="error-text">{error}</p>}
          {result !== null && (
            <>
              <pre className="io-out">{result.stdout || "(出力なし)"}</pre>
              {result.compilerError && (
                <>
                  <div className="io-label">コンパイルエラー</div>
                  <pre className="io-out io-err">{result.compilerError}</pre>
                </>
              )}
              {result.stderr && (
                <>
                  <div className="io-label">標準エラー出力</div>
                  <pre className="io-out io-err">{result.stderr}</pre>
                </>
              )}
            </>
          )}
          {!running && !error && result === null && (
            <p className="muted">「実行 ▶」を押すと結果がここに出ます。</p>
          )}
        </section>
      </div>
    </div>
  );
}
