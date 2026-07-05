import { useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { MEMBERS } from "../data/members";
import { isValidAtcoderId } from "../lib/api";

// アートカードの炎パターン(7x5、0=空き 4=一番熱い)
const ART_PATTERN = [
  0, 1, 0, 2, 1, 0, 0,
  1, 2, 3, 2, 3, 1, 0,
  0, 3, 4, 4, 3, 2, 1,
  1, 2, 4, 4, 4, 3, 1,
  0, 1, 2, 3, 2, 1, 0,
];

// アバターはIDから決まる色で塗り分けて画一感をなくす
const AVATAR_HUES = [
  "#2a78d6",
  "#1baf7a",
  "#eb6834",
  "#e34948",
  "#eda100",
  "#00a0a0",
];
const hueFor = (id: string) =>
  AVATAR_HUES[
    [...id].reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % AVATAR_HUES.length
  ];

export function Home() {
  const [input, setInput] = useState("");
  const [err, setErr] = useState("");
  const nav = useNavigate();
  const last = localStorage.getItem("shojin:lastUser");

  const go = (e: FormEvent) => {
    e.preventDefault();
    const id = input.trim();
    if (!isValidAtcoderId(id)) {
      setErr("英数字と_のみ・24文字以内で入力してください");
      return;
    }
    nav(`/u/${id}`);
  };

  return (
    <div className="page">
      <section className="hero">
        <div className="hero-orbs" aria-hidden="true">
          <span className="orb orb-a" />
          <span className="orb orb-b" />
          <span className="orb orb-c" />
        </div>
        <div className="hero-main">
          <p className="eyebrow">AtCoder Shojin Dashboard</p>
          <h1>
            <span className="flame">🔥</span>{" "}
            <span className="grad">精進ボード</span>
          </h1>
          <p className="hero-lead">
            AtCoderのIDを入れるだけで、これまでの精進がヒートマップとグラフでひと目でわかる。
            いまの実力にちょうどいい「次の一問」のおすすめつき。
          </p>
          <form onSubmit={go} className="id-form">
            <div className="input-group">
              <span className="at">@</span>
              <input
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  setErr("");
                }}
                placeholder="AtCoder ID"
                aria-label="AtCoder ID"
              />
              <button type="submit">
                見る <span className="arr">→</span>
              </button>
            </div>
          </form>
          {err && <p className="error-text">{err}</p>}
          {last && (
            <p className="muted last-user">
              前回: <Link to={`/u/${last}`}>@{last}</Link>
            </p>
          )}
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="art-card">
            <div className="art-grid">
              {ART_PATTERN.map((w, i) => (
                <span
                  key={i}
                  className={`art-cell w${w}`}
                  style={{ "--i": i } as CSSProperties}
                />
              ))}
            </div>
            <div className="art-caption">keep the streak burning</div>
          </div>
          <span className="art-flame">🔥</span>
        </div>
      </section>
      <section className="card">
        <div className="card-head">
          <h2 className="card-title">部員</h2>
          <span className="card-sub">追加は src/data/members.ts</span>
        </div>
        <div className="member-grid">
          {MEMBERS.map((m) => {
            const hue = hueFor(m.id);
            return (
              <Link key={m.id} className="member-card" to={`/u/${m.id}`}>
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
                  <span className="muted member-id">@{m.id}</span>
                </span>
                <span className="member-arrow">→</span>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
