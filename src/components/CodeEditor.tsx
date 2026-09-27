// コード欄(エディタータブと計算量タブで共用)。
// 透明な textarea をハイライト層(pre)に重ね、行番号・自動インデント・括弧の補完・
// Tab/Shift+Tab のブロックインデント・Ctrl+/ のコメント・識別子補完・高さ変更のつまみを持つ。
// 2つのタブで入力の感触がずれないよう、コード欄の振る舞いはすべてここに置く。
// Ctrl/Cmd+Enter(実行・解析)はページ全体のリスナーが受ける(ここでは素通しする)。
import { useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type {
  ChangeEvent,
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
  Ref,
  UIEvent,
} from "react";
import { AcPopup } from "./AcPopup";
import { toggleLineComment } from "../lib/comment";
import { collectCompletions } from "../lib/completion";
import { highlightCode } from "../lib/highlight";

// コード欄の最小高さ(CSSの .editor-wrap min-height と揃える)
const MIN_EDITOR_H = 160;

// エディター入力支援: 自動補完する括弧/クォートのペア
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

// ポップアップの想定サイズ(画面端でのはみ出し回避に使う)
const AC_W = 220;
const AC_H = 176;

/** 表示中の補完ポップアップ */
interface AcState {
  items: string[];
  /** 選択中の候補 */
  index: number;
  /** 置き換え開始位置(入力中の語の先頭) */
  from: number;
  /** ビューポート座標(position: fixed) */
  x: number;
  y: number;
  /** キャレットの上に出すか(下に入らないとき) */
  above: boolean;
}

/** ページからコード欄を操作する口 */
export interface CodeEditorHandle {
  focus(): void;
  /**
   * コード全体を text に置き換える(Cmd+Z で戻せる)。
   * caret を省くと今のキャレット位置(新しい長さで切り詰め)を保つ
   */
  replaceAll(text: string, caret?: number): void;
  /** lineFrom〜lineTo 行(1始まり)を選択し、見える位置までスクロールする */
  selectLines(lineFrom: number, lineTo?: number): void;
}

export function CodeEditor({
  ref,
  code,
  onChange,
  langKey,
  indentWidth,
  heightKey,
  ariaLabel = "コード",
  placeholder,
}: {
  ref?: Ref<CodeEditorHandle>;
  code: string;
  onChange: (code: string) => void;
  /** ハイライト・コメント記号・「:」でのインデントに使う言語 */
  langKey: string;
  /** インデント幅(スペース数)。Enter/Tab の入力と tab-size の表示に効く */
  indentWidth: number;
  /** ドラッグで変えた高さを覚えておく localStorage のキー */
  heightKey: string;
  ariaLabel?: string;
  placeholder?: string;
}) {
  const INDENT = " ".repeat(indentWidth);
  const [ac, setAc] = useState<AcState | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const linesRef = useRef<HTMLDivElement>(null);
  const codeRef = useRef<HTMLTextAreaElement>(null);
  const hlRef = useRef<HTMLPreElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  // IME変換中はonChangeに途中のかなが飛んでくるので候補を組み立てない
  const composingRef = useRef(false);
  // edit()由来のinputイベントで候補を開き直さないための目印
  const skipAcRef = useRef(false);

  // シンタックスハイライト(textareaの背後に重ねる)。末尾に改行を足して
  // 最終行の高さがtextareaとずれないようにする
  const highlighted = useMemo(
    () => highlightCode(code, langKey) + "\n",
    [code, langKey],
  );

  /**
   * [from,to) を text に置き換えて選択を張り直す。まず execCommand を使い、
   * ブラウザのundo履歴(Cmd+Z)を保つ。使えない環境ではonChangeにフォールバック。
   */
  const edit = (
    el: HTMLTextAreaElement,
    from: number,
    to: number,
    text: string,
    selFrom: number,
    selTo: number,
  ) => {
    // プログラムからの書き換えでは補完を開かない。edit()が唯一の書き換え口なので
    // ここで目印を立てておけば、確定後・自動インデント後・括弧補完後の
    // inputイベントをまとめて弾ける
    skipAcRef.current = true;
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
      // 失敗や環境差での不整合は、期待する内容へ強制的に揃える。
      // この経路はinputイベントが出ないのでonChangeが走らず、目印が残ってしまう
      skipAcRef.current = false;
      onChange(expected);
      requestAnimationFrame(() => el.setSelectionRange(selFrom, selTo));
    }
  };

  useImperativeHandle(ref, () => ({
    focus: () => codeRef.current?.focus(),
    replaceAll: (text, caret) => {
      const el = codeRef.current;
      if (!el) {
        onChange(text);
        return;
      }
      const pos = Math.min(caret ?? el.selectionStart, text.length);
      // execCommand経由でundo履歴を保って全置換
      edit(el, 0, el.value.length, text, pos, pos);
    },
    selectLines: (lineFrom, lineTo = lineFrom) => {
      const el = codeRef.current;
      if (!el || lineFrom < 1) return;
      const lines = el.value.split("\n");
      let start = 0;
      for (let i = 0; i < lineFrom - 1 && i < lines.length; i++) start += lines[i].length + 1;
      let end = start;
      for (let i = lineFrom - 1; i < lineTo && i < lines.length; i++) end += lines[i].length + 1;
      end = Math.max(start, Math.min(end - 1, el.value.length));
      setAc(null);
      el.focus();
      el.setSelectionRange(start, end);
      // Chrome / Safari は選択位置まで自動でスクロールしないので、行の高さから計算する。
      // scrollTop / scrollLeft を書くと scroll イベント経由でハイライト層と行番号も追随する
      const lh = parseFloat(getComputedStyle(el).lineHeight) || 20;
      el.scrollTop = Math.max(0, (lineFrom - 1) * lh - el.clientHeight / 3);
      el.scrollLeft = 0;
    },
  }));

  /**
   * キャレットのビューポート座標を測る。
   *
   * 「文字幅を1度測ってcol×charW」はやらない。Webフォントはdisplay=swapなので
   * 初回はフォールバックの幅を測ってしまい、日本語コメント(Zen Kaku)とタブ幅可変で
   * 崩れる。行頭からキャレットまでの実文字列を毎回測る方が常に正しい。
   * .editor-codeは white-space: pre で折り返さないので、これで足りる。
   */
  const caretPoint = (el: HTMLTextAreaElement, pos: number) => {
    const span = measureRef.current;
    if (!span) return null;
    const cs = getComputedStyle(el);
    // フォント指定はCSSに複製せずtextareaから実測値をコピーする。
    // 複製すると「2層のメトリクスを一致させる」不変条件のコピーがもう1つ増える
    span.style.fontFamily = cs.fontFamily;
    span.style.fontSize = cs.fontSize;
    span.style.fontWeight = cs.fontWeight;
    span.style.fontStyle = cs.fontStyle;
    span.style.letterSpacing = cs.letterSpacing;
    span.style.fontVariantLigatures = cs.fontVariantLigatures;
    span.style.fontFeatureSettings = cs.fontFeatureSettings;
    span.style.tabSize = cs.tabSize;

    const v = el.value;
    const lineStart = v.lastIndexOf("\n", pos - 1) + 1;
    const lineIdx = v.slice(0, lineStart).split("\n").length - 1;
    span.textContent = v.slice(lineStart, pos);
    const w = span.getBoundingClientRect().width;

    const r = el.getBoundingClientRect();
    const lineH =
      parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.55;
    const x = r.left + parseFloat(cs.paddingLeft) + w - el.scrollLeft;
    const top = r.top + parseFloat(cs.paddingTop) + lineIdx * lineH - el.scrollTop;
    // キャレットがコード欄の外へスクロールされていたら出さない
    if (top + lineH < r.top || top > r.bottom || x < r.left - 1 || x > r.right)
      return null;
    // 画面下に入らなければキャレットの上に出す
    const above = top + lineH + AC_H > window.innerHeight - 8;
    return {
      x: Math.max(8, Math.min(x, window.innerWidth - AC_W - 8)),
      y: above ? Math.max(8, top - AC_H) : top + lineH,
      above,
    };
  };

  const openAc = (el: HTMLTextAreaElement) => {
    const c = collectCompletions(el.value, el.selectionStart);
    if (!c) {
      setAc(null);
      return;
    }
    const pt = caretPoint(el, el.selectionStart);
    if (!pt) {
      setAc(null);
      return;
    }
    setAc({ items: c.items, index: 0, from: c.from, ...pt });
  };

  const onCodeChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    onChange(el.value);
    if (skipAcRef.current) {
      // プログラムからの書き換え。開き直さないだけでなく、開いていたものも閉じる。
      // ここで閉じ忘れると、ポップアップ表示中に「(」を打ったときに
      // 古い接頭辞・古い座標のまま出しっぱなしになる
      skipAcRef.current = false;
      setAc(null);
      return;
    }
    if (composingRef.current) return;
    openAc(el);
  };

  const acceptAc = (word: string) => {
    const el = codeRef.current;
    if (!el || !ac) return;
    const to = el.selectionStart;
    // edit()経由にすることでCmd+Zで1操作として戻せる
    edit(el, ac.from, to, word, ac.from + word.length, ac.from + word.length);
    setAc(null);
  };

  // ページがスクロール/リサイズされるとビューポート座標がずれる。
  // 位置を計算し直すより閉じてしまう方が単純で、実害も無い
  useEffect(() => {
    if (!ac) return;
    const close = () => setAc(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [ac]);

  // エディターの入力支援: 改行の自動インデント・括弧/クォート補完・
  // Tab/Shift+Tabのブロックインデント
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

    // 補完ポップアップが開いている間のキー操作。修飾キー付きは素通しする
    if (ac && !e.altKey && !e.ctrlKey && !e.metaKey) {
      if (e.key === "Tab" && !e.shiftKey) {
        // ポップアップは「選択が畳まれていて直前が2文字以上の語」のときしか
        // 開かないので、ブロックインデントの意図と衝突することはない
        e.preventDefault();
        acceptAc(ac.items[ac.index]);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setAc({ ...ac, index: (ac.index + 1) % ac.items.length });
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setAc({
          ...ac,
          index: (ac.index - 1 + ac.items.length) % ac.items.length,
        });
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setAc(null);
        return;
      }
      // Enterは確定に使わない(打った語がたまたま長い語の接頭辞だったときに
      // 黙って書き換わる事故を防ぐ)。閉じて通常の自動インデントへ流す。
      // Shift+Tabのデデントとキャレット移動も同じく閉じて素通し
      if (
        e.key === "Enter" ||
        e.key === "Tab" ||
        e.key.startsWith("Arrow") ||
        e.key === "Home" ||
        e.key === "End" ||
        e.key === "PageUp" ||
        e.key === "PageDown"
      ) {
        setAc(null);
      }
    }

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
      // 位置0のときlastIndexOfに-1を渡すと0にクランプされ、先頭の改行自身に
      // 一致してしまう(行頭が1行ずれる)ので分岐する
      const lineStart = head === 0 ? 0 : v.lastIndexOf("\n", head - 1) + 1;
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

    // Ctrl+/ (macOSは⌘+/) で行コメントをトグル。
    // 下の「修飾キーは素通し」returnより前に置くこと。
    //
    // AltGrは ctrlKey && altKey として報告されるので、altKeyが立っていたら
    // 見送る(「/」をAltGrで打つ配列でユーザーの入力を食わないため)。
    // e.code は見ない: JISでも「/」キーは key:"/" を返すので得が無く、
    // Slash位置が別文字の配列(独語の「-」など)で誤爆する。
    // shiftKeyも見ない(「/」にShiftが要る配列があるため)。
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key === "/") {
      e.preventDefault();
      if (e.repeat) return; // 長押しでコメント↔解除がピンポンするのを防ぐ
      const patch = toggleLineComment(v, s, t, langKey);
      if (!patch) return;
      // edit()のonChangeフォールバック経路ではinputが出ず候補が閉じないので明示的に閉じる
      setAc(null);
      edit(el, patch.from, patch.to, patch.text, patch.selFrom, patch.selTo);
      return;
    }

    // 他のショートカット(コピー・undo等)は邪魔しない。
    // Ctrl/Cmd+Enterはページ全体のリスナーが受ける
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.key === "Tab") {
      e.preventDefault();
      if (e.shiftKey || v.slice(s, t).includes("\n")) {
        // 選択行ブロックをまとめてインデント/デデント
        // 上と同じ理由。ここは from > to の壊れた置換になりうる
        // (先頭が空行の文書で、位置0からShift+Tab)
        const blockStart = s === 0 ? 0 : v.lastIndexOf("\n", s - 1) + 1;
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

  // コード欄の高さ(つまみでユーザーがドラッグした値)を覚えておく。
  //
  // つまみはインラインstyleに書き込むので、それが空のうちは
  // まだ掴まれていない=CSSのclamp(画面高に追従)のままにしておく。
  // 無条件に保存すると、一度も掴んでいないのに画面サイズ由来の高さが
  // 焼き付いてしまい、以後ウィンドウを変えても追従しなくなる。
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    try {
      const saved = localStorage.getItem(heightKey);
      if (saved) el.style.height = saved;
    } catch {
      // 読めなければCSSの既定の高さのまま
    }
    const ro = new ResizeObserver(() => {
      if (!el.style.height) return;
      try {
        localStorage.setItem(heightKey, el.style.height);
      } catch {
        // 保存できなくても高さの変更そのものは効いている
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [heightKey]);

  /** コード欄の高さを px で設定する(最小値でクランプ)。保存はResizeObserverが拾う */
  const setEditorHeight = (h: number) => {
    const el = wrapRef.current;
    if (el) el.style.height = `${Math.round(Math.max(MIN_EDITOR_H, h))}px`;
  };

  // つまみのドラッグ。setPointerCaptureで、掴んだ指/カーソルがバーの外へ出ても
  // 追従させる(はみ出した瞬間にリサイズが止まるのを防ぐ)
  const onGripDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = wrapRef.current;
    if (!el) return;
    e.preventDefault();
    const grip = e.currentTarget;
    const startY = e.clientY;
    const startH = el.getBoundingClientRect().height;
    grip.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => setEditorHeight(startH + ev.clientY - startY);
    const up = () => {
      grip.releasePointerCapture(e.pointerId);
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
      grip.removeEventListener("pointercancel", up);
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
    grip.addEventListener("pointercancel", up);
  };

  // マウスが使えない場合の操作手段(role="separator"は矢印キーで動かせることが期待される)
  const onGripKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const el = wrapRef.current;
    if (!el) return;
    const step = e.shiftKey ? 80 : 20;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setEditorHeight(el.getBoundingClientRect().height + step);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setEditorHeight(el.getBoundingClientRect().height - step);
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

  return (
    <>
      <div className="editor-wrap" ref={wrapRef}>
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
            onChange={onCodeChange}
            onKeyDown={onKeyDown}
            onScroll={onScroll}
            onBlur={() => setAc(null)}
            // マウスでキャレットを動かしたら接頭辞が古くなる
            onClick={() => setAc(null)}
            onCompositionStart={() => {
              composingRef.current = true;
              setAc(null);
            }}
            onCompositionEnd={() => {
              composingRef.current = false;
            }}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-label={ariaLabel}
            aria-autocomplete="list"
            placeholder={placeholder}
          />
          {/* キャレット位置の実測用。CSSは位置決めだけ持ち、フォントは
              caretPointがtextareaからコピーする */}
          <span ref={measureRef} className="editor-measure" aria-hidden="true" />
        </div>
      </div>
      {/* 高さ変更のつまみ。ネイティブのresizeのつまみはカードの角丸に
          完全に切られて見えないので、自前でカード下端に出す */}
      <div
        className="editor-grip"
        onPointerDown={onGripDown}
        onKeyDown={onGripKeyDown}
        role="separator"
        aria-orientation="horizontal"
        aria-label="コード欄の高さを変える(ドラッグ、または上下キー)"
        tabIndex={0}
      />
      {ac && (
        <AcPopup
          items={ac.items}
          index={ac.index}
          x={ac.x}
          y={ac.y}
          above={ac.above}
          onPick={acceptAc}
          onHover={(i) => setAc({ ...ac, index: i })}
        />
      )}
    </>
  );
}
