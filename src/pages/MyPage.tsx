import { useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { isValidAtcoderId } from "../lib/api";
import { clearMyId, getMyId, setMyId } from "../lib/me";

export function MyPage() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const changing = params.get("change") === "1";
  const myId = getMyId();
  // 変更時は空から入力、初回設定時は前回見たIDを初期値に
  const [input, setInput] = useState(() =>
    myId ? "" : (localStorage.getItem("shojin:lastUser") ?? ""),
  );
  const [err, setErr] = useState("");

  // 設定済みなら通常は自分のページへ即移動(ショートカット)。
  // 「変更」から来たとき(change=1)だけフォームを出して別IDに切り替えられるようにする。
  if (myId && !changing) return <Navigate to={`/u/${myId}`} replace />;

  const save = (e: FormEvent) => {
    e.preventDefault();
    const id = input.trim();
    if (!isValidAtcoderId(id)) {
      setErr("英数字と_のみ・24文字以内で入力してください");
      return;
    }
    setMyId(id);
    nav(`/u/${id}`);
  };

  return (
    <div className="page">
      <section className="card mypage-setup">
        <div className="card-head">
          <h2 className="card-title">
            {myId ? "マイページを変更" : "マイページを設定"}
          </h2>
          <span className="card-sub">
            {myId
              ? `現在は @${myId}。別のAtCoder IDを登録すると切り替わります(このブラウザにのみ保存)`
              : "自分のAtCoder IDを登録すると、次回からこのタブで自分の精進がすぐ見られます(このブラウザにのみ保存)"}
          </span>
        </div>
        <form onSubmit={save} className="id-form">
          <div className="input-group">
            <span className="at">@</span>
            <input
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setErr("");
              }}
              placeholder="AtCoder ID"
              aria-label="自分のAtCoder ID"
            />
            <button type="submit">
              {myId ? "変更" : "登録"} <span className="arr">→</span>
            </button>
          </div>
        </form>
        {err && <p className="error-text">{err}</p>}
        {myId ? (
          <p className="muted mypage-links">
            <Link to={`/u/${myId}`}>@{myId} のページを見る →</Link>
            <button
              type="button"
              className="linklike"
              onClick={() => {
                clearMyId();
                nav("/me");
              }}
            >
              マイページ設定を解除する
            </button>
          </p>
        ) : (
          <p className="muted">
            あとから変更したいときは、そのユーザーページの「☆
            マイページにする」からでも設定し直せます。
          </p>
        )}
      </section>
    </div>
  );
}
