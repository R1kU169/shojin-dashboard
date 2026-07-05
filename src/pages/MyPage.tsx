import { useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { isValidAtcoderId } from "../lib/api";
import { getMyId, setMyId } from "../lib/me";

export function MyPage() {
  // 前回見たIDがあれば初期値に(自分のページを見た直後の登録がラク)
  const [input, setInput] = useState(
    () => localStorage.getItem("shojin:lastUser") ?? "",
  );
  const [err, setErr] = useState("");
  const nav = useNavigate();

  const myId = getMyId();
  if (myId) return <Navigate to={`/u/${myId}`} replace />;

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
          <h2 className="card-title">マイページを設定</h2>
          <span className="card-sub">
            自分のAtCoder IDを登録すると、次回からこのタブで自分の精進がすぐ見られます(このブラウザにのみ保存)
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
              登録 <span className="arr">→</span>
            </button>
          </div>
        </form>
        {err && <p className="error-text">{err}</p>}
        <p className="muted">
          あとから変更したいときは、そのユーザーページの「☆ マイページにする」から設定し直せます。
        </p>
      </section>
    </div>
  );
}
