import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { getProblems } from "../lib/cache";
import {
  PROBLEM_ID,
  buildIndex,
  isSearchable,
  parseProblemUrl,
  searchProblems,
  toLinked,
} from "../lib/problemSearch";
import type { LinkedProblem, Problem } from "../lib/types";

/** 候補の表示上限。問題名は480件ほど重複があるので8件では足りない */
const LIMIT = 20;

/**
 * 問題名・問題URL・問題IDのどれでも問題を連携できる入力欄。
 * 名前で引くときは候補をドロップダウンに出す。
 */
export function ProblemSearch({
  onPick,
}: {
  onPick: (p: LinkedProblem) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1); // -1 = 入力行(候補未選択)
  const [problems, setProblems] = useState<Problem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState(false);
  const [err, setErr] = useState("");
  // 変換中の onChange は "かんｓ" のような途中の値なので拾わない
  const composing = useRef(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // 問題一覧(gzipで約200KB)は初回フォーカス時に読む。検索しない人には払わせない。
  // getProblemsはIndexedDBに24時間キャッシュ + 同時呼び出しを束ねるので何度呼んでもよい
  const load = () => {
    if (problems || loading) return;
    setLoading(true);
    setLoadErr(false);
    getProblems()
      .then(setProblems)
      .catch(() => setLoadErr(true))
      .finally(() => setLoading(false));
  };

  const ix = useMemo(() => (problems ? buildIndex(problems) : null), [problems]);
  // 実測で1クエリ1ms未満なのでタイマーによるデバウンスは要らない
  const deferred = useDeferredValue(query);
  const trimmed = deferred.trim();
  const looksUrl = /atcoder\.jp\/contests\//.test(trimmed);

  const hits = useMemo(() => {
    if (!ix || looksUrl) return [];
    return searchProblems(ix, trimmed, LIMIT + 1);
  }, [ix, trimmed, looksUrl]);

  // 問題IDが打たれたときは完全一致を先頭に固定する。
  // PROBLEM_IDは英数字と_の間に_を要求するので、問題名と競合することはない
  const idHit = useMemo(() => {
    if (!ix || looksUrl || !PROBLEM_ID.test(trimmed)) return null;
    const id = trimmed.toLowerCase();
    return ix.problems.find((p) => p.id === id) ?? null;
  }, [ix, trimmed, looksUrl]);

  const rows = useMemo(() => {
    const base = idHit ? [idHit, ...hits.filter((p) => p.id !== idHit.id)] : hits;
    return base.slice(0, LIMIT);
  }, [idHit, hits]);
  const overflow = (idHit ? hits.length + 1 : hits.length) > LIMIT;

  // 入力欄の外を触ったら閉じる(ツールバーはフォーカストラップではない)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const pick = (p: Problem) => {
    onPick(toLinked(p, ix?.contests ?? new Set([p.contest_id])));
    setQuery("");
    setOpen(false);
    setActive(-1);
    setErr("");
  };

  // Enterや「連携」ボタン: URL → 問題ID → 名前検索の先頭 の順に解決する
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const s = query.trim();
    if (!s) return;
    const fromUrl = parseProblemUrl(s);
    if (fromUrl) {
      onPick(fromUrl);
      setQuery("");
      setOpen(false);
      setErr("");
      return;
    }
    if (rows.length > 0) {
      pick(rows[Math.max(active, 0)]);
      return;
    }
    if (PROBLEM_ID.test(s)) {
      // 候補が無い(=一覧が未読込)場合はここで引く
      setErr("");
      try {
        const id = s.toLowerCase();
        const hit = (await getProblems()).find((p) => p.id === id);
        if (hit) {
          pick(hit);
          return;
        }
      } catch {
        setErr("問題一覧を取得できませんでした。問題URLを貼ってください");
        return;
      }
    }
    setErr(
      isSearchable(s)
        ? `「${s}」に一致する問題がありません。問題URLを貼っても連携できます`
        : "問題名は2文字以上で検索してください(問題URL・問題IDも使えます)",
    );
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // 変換確定のEnterで候補を選んだりフォームを送信したりしない
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "ArrowDown" && rows.length > 0) {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % rows.length);
    } else if (e.key === "ArrowUp" && rows.length > 0) {
      e.preventDefault();
      setActive((i) => (i <= 0 ? -1 : i - 1));
    } else if (e.key === "Escape" && open) {
      e.preventDefault(); // Safariは入力欄を空にしてしまうので止める
      setOpen(false);
      setActive(-1);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
    // Enterは<form onSubmit>に任せる(submitがURL/ID/候補を解決する)
  };

  const listId = "ep-listbox";
  const showList = open && (loading || loadErr || rows.length > 0 || !!trimmed);

  return (
    <div className="ep-search" ref={wrapRef}>
      <form className="ep-form" onSubmit={(e) => void submit(e)}>
        <input
          value={query}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `ep-opt-${active}` : undefined}
          autoComplete="off"
          onFocus={() => {
            setOpen(true);
            load();
          }}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={(e) => {
            composing.current = false;
            setQuery(e.currentTarget.value);
          }}
          onChange={(e) => {
            if (!composing.current) setQuery(e.target.value);
            setActive(-1);
            setOpen(true);
            setErr("");
            // フォーカスだけに頼らない。focusが飛ばない環境でも検索できるように
            load();
          }}
          onKeyDown={onKeyDown}
          placeholder="問題名 / URL / ID で連携"
          title="問題名で検索するか、AtCoderの問題URL・問題IDを貼って連携します"
          aria-label="AtCoderの問題を検索"
        />
        <button type="submit">連携</button>
      </form>
      {showList && (
        <ul className="ep-listbox" id={listId} role="listbox">
          {loading && <li className="ep-note muted">問題一覧を読み込み中…</li>}
          {loadErr && (
            <li className="ep-note error-text">
              問題一覧を取得できませんでした。問題URLを貼ってください
            </li>
          )}
          {!loading && !loadErr && looksUrl && (
            <li className="ep-note muted">問題URLとして連携します</li>
          )}
          {!loading && !loadErr && !looksUrl && !isSearchable(trimmed) && (
            <li className="ep-note muted">2文字以上で検索(URL・問題IDも可)</li>
          )}
          {!loading &&
            !loadErr &&
            !looksUrl &&
            isSearchable(trimmed) &&
            rows.length === 0 && (
              <li className="ep-note muted">一致する問題がありません</li>
            )}
          {rows.map((p, i) => (
            <li
              key={p.id}
              id={`ep-opt-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? "ep-opt on" : "ep-opt"}
              // blurで先に閉じてクリックが届かなくなるのを防ぐ
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(p)}
            >
              <span className="ep-opt-idx">{p.problem_index}</span>
              <span className="ep-opt-name">{p.name}</span>
              <span className="ep-opt-contest">
                {toLinked(p, ix?.contests ?? new Set()).contest}
              </span>
            </li>
          ))}
          {overflow && (
            <li className="ep-note muted">
              他にも候補があります。絞り込んでください
            </li>
          )}
        </ul>
      )}
      {err && <span className="error-text">{err}</span>}
    </div>
  );
}
