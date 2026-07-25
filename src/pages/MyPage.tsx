import { useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { MEMBERS } from "../data/members";
import { useMemberTiers } from "../hooks/useMemberTiers";
import { isValidAtcoderId } from "../lib/api";
import { CHART_CHROME, TIER_COLORS } from "../lib/colors";
import { clearMyId, getMyId, setMyId } from "../lib/me";
import { useTheme } from "../theme";

export function MyPage() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const changing = params.get("change") === "1";
  const myId = getMyId();
  const { resolved } = useTheme();
  const tiers = useMemberTiers();
  // 変更時は空から入力、初回設定時は前回見たIDを初期値に
  const [input, setInput] = useState(() =>
    myId ? "" : (localStorage.getItem("shojin:lastUser") ?? ""),
  );
  const [err, setErr] = useState("");

  // 設定済みなら通常は自分のページへ即移動(ショートカット)。
  // 「変更」から来たとき(change=1)だけフォームを出して別IDに切り替えられるようにする。
  if (myId && !changing) return <Navigate to={`/u/${myId}`} replace />;

  const choose = (id: string) => {
    setMyId(id);
    nav(`/u/${id}`);
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    const id = input.trim();
    if (!isValidAtcoderId(id)) {
      setErr("英数字と_のみ・24文字以内で入力してください");
      return;
    }
    choose(id);
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
              ? `現在は @${myId}。IDを入力するか下の部員から選ぶと切り替わります(このブラウザにのみ保存)`
              : "自分のAtCoder IDを入力するか、下の部員から選んでください(このブラウザにのみ保存)"}
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
        {myId && (
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
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">部員から選ぶ</h2>
          <span className="card-sub">タップでマイページに設定</span>
        </div>
        <div className="member-grid">
          {MEMBERS.map((m) => {
            const tier = tiers[m.id];
            const hue =
              tier != null
                ? TIER_COLORS[resolved][tier]
                : CHART_CHROME[resolved].muted;
            const current = m.id === myId;
            return (
              <button
                type="button"
                key={m.id}
                className={`member-card${current ? " current" : ""}`}
                onClick={() => choose(m.id)}
                title={`${m.name} をマイページに設定`}
              >
                <span
                  className="avatar"
                  style={{
                    color: hue,
                    background: `color-mix(in srgb, ${hue} 13%, transparent)`,
                  }}
                >
                  {m.id.charAt(0).toUpperCase()}
                </span>
                <span className="member-meta">
                  <span className="member-name">{m.name}</span>
                  {m.name !== m.id && (
                    <span className="muted member-id">@{m.id}</span>
                  )}
                </span>
                {current ? (
                  <span className="member-current-tag">現在</span>
                ) : (
                  <span className="member-arrow">→</span>
                )}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
