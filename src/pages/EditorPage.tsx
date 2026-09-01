import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent, UIEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { ProblemSearch } from "../components/ProblemSearch";
import { highlightCode } from "../lib/highlight";
import { EDITOR_LANGS } from "../lib/wandbox";
import { runCode } from "../lib/run";
import type { RunOutcome } from "../lib/run";
import type { LinkedProblem } from "../lib/types";

const CODE_KEY = (lang: string) => `shojin:editor:code:${lang}`;
const STDIN_KEY = "shojin:editor:stdin";
const LANG_KEY = "shojin:editor:lang";
const PROBLEM_KEY = "shojin:editor:problem";

// エディター入力支援: 自動補完する括弧/クォートのペア
const INDENT_KEY = "shojin:editor:indent";
const INDENT_WIDTHS = [2, 4, 8];
const PAIRS: Record<string, string> = {
  "(": ")",
  "[": "]",
  "{": "}",
  '"': '"',
  "'": "'",
};
const CLOSERS = new Set(Object.values(PAIRS));

// 行末の「:」でブロックが始まる言語。C++/Javaの public: や case 1: で
// 誤ってインデントしないよう、この言語でだけ「:」を見る。
const COLON_BLOCK_LANGS = new Set(["python", "pypy", "nim"]);

function loadProblem(): LinkedProblem | null {
  try {
    const raw = localStorage.getItem(PROBLEM_KEY);
    return raw ? (JSON.parse(raw) as LinkedProblem) : null;
  } catch {
    return null;
  }
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
    () => localStorage.getItem(LANG_KEY) ?? EDITOR_LANGS[0].key,
  );
  const lang =
    EDITOR_LANGS.find((l) => l.key === langKey) ?? EDITOR_LANGS[0];
  // インデント幅(スペース数)。入力支援(Enter/Tab)とtab-size表示・テンプレ変換に効く
  const [indentWidth, setIndentWidth] = useState(() => {
    const n = Number(localStorage.getItem(INDENT_KEY));
    return INDENT_WIDTHS.includes(n) ? n : 2;
  });
  const INDENT = " ".repeat(indentWidth);
  // 保存済みコードを読む。全削除(空白のみ)された保存分はテンプレートに戻す
  const loadCode = (key: string, template: string): string => {
    const saved = localStorage.getItem(CODE_KEY(key));
    if (saved != null && saved.trim() !== "") return saved;
    return reindent(template, TEMPLATE_WIDTH, indentWidth);
  };
  const [code, setCode] = useState(() => loadCode(langKey, lang.template));
  const [stdin, setStdin] = useState(
    () => localStorage.getItem(STDIN_KEY) ?? "",
  );
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunOutcome | null>(null);
  const [error, setError] = useState("");
  const [problem, setProblem] = useState<LinkedProblem | null>(loadProblem);
  // 「コードをコピーして提出」を押した直後の表示切り替え
  const [copied, setCopied] = useState(false);
  const [copyErr, setCopyErr] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const linesRef = useRef<HTMLDivElement>(null);
  const codeRef = useRef<HTMLTextAreaElement>(null);
  const hlRef = useRef<HTMLPreElement>(null);

  // シンタックスハイライト(textareaの背後に重ねる)。末尾に改行を足して
  // 最終行の高さがtextareaとずれないようにする
  const highlighted = useMemo(
    () => highlightCode(code, langKey) + "\n",
    [code, langKey],
  );

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

  const applyProblem = (p: LinkedProblem) => {
    setProblem(p);
    localStorage.setItem(PROBLEM_KEY, JSON.stringify(p));
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
    // ユーザー操作の直後である必要があるので、最初の文で同期的に呼ぶ
    const p = navigator.clipboard?.writeText(code);
    if (!p) return;
    void p.then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => setCopyErr(true),
    );
  };

  const unlinkProblem = () => {
    setProblem(null);
    localStorage.removeItem(PROBLEM_KEY);
  };

  // 言語切替: 現在のコードを保存し、切替先の保存分(無ければ/空ならテンプレ)を読む
  const switchLang = (key: string) => {
    localStorage.setItem(CODE_KEY(langKey), code);
    const next = EDITOR_LANGS.find((l) => l.key === key) ?? EDITOR_LANGS[0];
    setLangKey(key);
    setCode(loadCode(key, next.template));
    localStorage.setItem(LANG_KEY, key);
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
    const el = codeRef.current;
    if (el) edit(el, 0, el.value.length, tpl, tpl.length, tpl.length);
    else setCode(tpl);
  };

  // インデント幅変更: 既存コードの先頭インデントも新しい幅に変換する。
  // 表示中の言語だけでなく、他言語の保存済みコードも合わせて変換しないと
  // 言語を切り替えたときに旧い幅のコードが出てきて混在する。
  const changeIndent = (n: number) => {
    const newCode = reindent(code, indentWidth, n);
    setIndentWidth(n);
    localStorage.setItem(INDENT_KEY, String(n));
    for (const l of EDITOR_LANGS) {
      if (l.key === langKey) continue;
      const saved = localStorage.getItem(CODE_KEY(l.key));
      if (saved == null) continue;
      const conv = reindent(saved, indentWidth, n);
      if (conv !== saved) localStorage.setItem(CODE_KEY(l.key), conv);
    }
    if (newCode === code) return;
    const el = codeRef.current;
    if (el) {
      // execCommand経由でundo履歴を保って全置換
      const pos = Math.min(el.selectionStart, newCode.length);
      edit(el, 0, el.value.length, newCode, pos, pos);
    } else {
      setCode(newCode);
    }
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
    // execCommandは「フォーカス中の編集可能要素」に効く。インデントのセレクト
    // 操作直後などフォーカスが外れたままだと選択置換にならず重複挿入されるため、
    // 必ず先にtextareaへフォーカスして選択を張る
    el.focus();
    el.setSelectionRange(from, to);
    const expected = el.value.slice(0, from) + text + el.value.slice(to);
    const ok =
      text === ""
        ? document.execCommand("delete")
        : document.execCommand("insertText", false, text);
    if (ok && el.value === expected) {
      el.setSelectionRange(selFrom, selTo);
    } else {
      // 失敗や環境差での不整合は、期待する内容へsetStateで強制的に揃える
      setCode(expected);
      requestAnimationFrame(() => el.setSelectionRange(selFrom, selTo));
    }
  };

  // エディターの入力支援: 改行の自動インデント・括弧/クォート補完・
  // Tab/Shift+Tabのブロックインデント・Ctrl/Cmd+Enterで実行
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // IME変換中のキーは一切横取りしない。ここを通すと変換確定のEnterで改行が入り、
    // 「」や(の入力が括弧補完に食われて変換バッファが壊れる。
    // keyCode 229 も見るのは、Safariが compositionend を keydown より先に出すため
    // (確定時のkeydownでは isComposing が既にfalseになっている)。
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;

    const el = e.currentTarget;
    const v = el.value;
    const s = el.selectionStart;
    const t = el.selectionEnd;

    // 行頭ジャンプ(Home / macOSのCmd+←)は列0ではなく行の最初の文字へ。
    // もう一度押すと列0に移る(VS Codeと同じ)。トグルが無いとインデントされた行で
    // 列0にキーボードから到達できなくなり、機能が後退してしまう。
    // Cmd+←を拾うので、下の修飾キーreturnより前に置くこと。
    // .editor-codeは white-space: pre で折り返さないため、論理行頭がそのまま視覚的な行頭。
    const isLineHome =
      (e.key === "Home" && !e.ctrlKey && !e.metaKey && !e.altKey) ||
      (e.key === "ArrowLeft" && e.metaKey && !e.ctrlKey && !e.altKey);
    if (isLineHome) {
      e.preventDefault();
      // 選択を伸ばすときは「動く側の端」を動かす(Safariは"none"を返すのでforward扱い)
      const head = el.selectionDirection === "backward" ? s : t;
      const lineStart = v.lastIndexOf("\n", head - 1) + 1;
      let lineEnd = v.indexOf("\n", lineStart);
      if (lineEnd === -1) lineEnd = v.length;
      const indent = /^[ \t]*/.exec(v.slice(lineStart, lineEnd))?.[0] ?? "";
      const firstNs = lineStart + indent.length;
      // 空白だけの行はfirstNsが行末になってしまうので列0を目標にする
      const target =
        head === firstNs || firstNs === lineEnd ? lineStart : firstNs;
      if (e.shiftKey) {
        const anchor = el.selectionDirection === "backward" ? t : s;
        el.setSelectionRange(
          Math.min(anchor, target),
          Math.max(anchor, target),
          target < anchor ? "backward" : "forward",
        );
      } else {
        // 純粋なキャレット移動なのでedit()は通さない(undo履歴に空の項目が積まれる)
        el.setSelectionRange(target, target);
      }
      // 長い行を右にスクロールしているとジャンプ後にキャレットが画面外に残る。
      // scrollLeftを戻すとscrollイベント経由でハイライト層と行番号も追随する
      if (el.scrollLeft > 0) el.scrollLeft = 0;
      return;
    }

    // 他のショートカット(コピー・undo等)は邪魔しない。
    // Ctrl/Cmd+Enterはページ全体のリスナー(下のuseEffect)が受ける
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.key === "Tab") {
      e.preventDefault();
      if (e.shiftKey || v.slice(s, t).includes("\n")) {
        // 選択行ブロックをまとめてインデント/デデント
        const blockStart = v.lastIndexOf("\n", s - 1) + 1;
        let blockEnd = v.indexOf("\n", Math.max(s, t - 1));
        if (blockEnd === -1) blockEnd = v.length;
        const lines = v.slice(blockStart, blockEnd).split("\n");
        const dedent = new RegExp(`^ {1,${indentWidth}}`);
        const newBlock = e.shiftKey
          ? lines.map((l) => l.replace(dedent, "")).join("\n")
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
      // { や ( [ の直後、Python系の行末: では1段深く
      const opens =
        (prev !== "" && "{([".includes(prev)) ||
        (COLON_BLOCK_LANGS.has(langKey) && /:\s*$/.test(line));
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
    const { scrollTop, scrollLeft } = e.currentTarget;
    if (linesRef.current) linesRef.current.scrollTop = scrollTop;
    if (hlRef.current) {
      hlRef.current.scrollTop = scrollTop;
      hlRef.current.scrollLeft = scrollLeft;
    }
  };

  const lineCount = code.split("\n").length;
  // クリップボードが使えない環境(古いWebView等)では従来の文言のままにする
  const copyLabel = !navigator.clipboard
    ? "AtCoderで提出 ↗"
    : copied
      ? "コピーしました ✓"
      : copyErr
        ? "コピーできませんでした(提出ページへ) ↗"
        : "コードをコピーして提出 ↗";
  const exitOk = result !== null && result.status === "0" && !result.signal;

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
        <span className="muted editor-hint">Ctrl+Enterでも実行</span>
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
        <button
          type="button"
          className="tpl-reset"
          onClick={resetTemplate}
          title="コードをこの言語のテンプレートに戻す"
        >
          ↺ テンプレートに戻す
        </button>
        <div className="editor-wrap">
          <div className="editor-lines" ref={linesRef} aria-hidden="true">
            {Array.from({ length: lineCount }, (_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>
          <div className="editor-pane">
            <pre
              className="editor-highlight"
              ref={hlRef}
              aria-hidden="true"
              style={{ tabSize: indentWidth }}
            >
              <code dangerouslySetInnerHTML={{ __html: highlighted }} />
            </pre>
            <textarea
              ref={codeRef}
              className="editor-code"
              style={{ tabSize: indentWidth }}
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
              {result.backend === "godbolt" && (
                <p className="fallback-note">
                  ⚠ Wandboxが停止中のため{" "}
                  <a href="https://godbolt.org" target="_blank" rel="noreferrer">
                    Compiler Explorer
                  </a>{" "}
                  で実行しました({result.backendVersion})
                </p>
              )}
              <pre className="io-out">{result.stdout || "(出力なし)"}</pre>
              {result.compilerError && (
                <>
                  <div className="io-label">コンパイラメッセージ</div>
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

      <p className="muted editor-note">
        実行は{" "}
        <a href="https://wandbox.org" target="_blank" rel="noreferrer">
          Wandbox
        </a>
        (停止中は{" "}
        <a href="https://godbolt.org" target="_blank" rel="noreferrer">
          Compiler Explorer
        </a>
        )上で行われます(コードは外部サービスに送信されます)。
      </p>
    </div>
  );
}
