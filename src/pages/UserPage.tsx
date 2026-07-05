import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useParams } from "react-router-dom";
import { AnimatedNumber } from "../components/AnimatedNumber";
import { DifficultyBars } from "../components/DifficultyBars";
import { Heatmap } from "../components/Heatmap";
import { PaceChart } from "../components/PaceChart";
import { RecommendList } from "../components/RecommendList";
import { StatCard } from "../components/StatCard";
import { useUserData } from "../hooks/useUserData";
import {
  TIER_COLORS,
  TIER_LABELS,
  clipDifficulty,
  tierIndex,
} from "../lib/colors";
import { collectIrtItems, estimateTheta, recommend } from "../lib/irt";
import { getMyId, setMyId } from "../lib/me";
import { computeStats, todayEpochDay } from "../lib/stats";
import { useTheme } from "../theme";

export function UserPage() {
  const { userId = "" } = useParams();
  const { resolved } = useTheme();
  const data = useUserData(userId);
  const [myId, setMyIdState] = useState<string | null>(() => getMyId());
  const isMine = myId === userId;

  useEffect(() => {
    if (userId) localStorage.setItem("shojin:lastUser", userId);
  }, [userId]);

  const stats = useMemo(
    () =>
      data.phase === "ready" && data.subs && data.models
        ? computeStats(data.subs, data.models)
        : null,
    [data],
  );
  const theta = useMemo(
    () =>
      stats && data.models
        ? estimateTheta(
            collectIrtItems(data.models, stats.solved, stats.attemptedNoAc),
          )
        : null,
    [stats, data.models],
  );
  const recs = useMemo(
    () =>
      stats && theta !== null && data.problems && data.models
        ? recommend(theta, data.problems, data.models, stats.solved)
        : [],
    [stats, theta, data.problems, data.models],
  );

  if (data.phase === "error") {
    return (
      <div className="notice error-text">
        読み込みに失敗しました: {data.error}
      </div>
    );
  }
  if (data.phase === "loading") {
    return (
      <div className="notice">
        <div className="loading-flame">🔥</div>
        精進の記録を集めています…
        {data.progress > 0 ? ` ${data.progress.toLocaleString()}件` : ""}
      </div>
    );
  }
  if (!stats || (data.subs?.length ?? 0) === 0) {
    return (
      <div className="notice">
        提出が見つかりませんでした。ID「{userId}」を確認してください。
      </div>
    );
  }

  const thetaClip = theta !== null ? clipDifficulty(theta) : null;
  const tier = thetaClip !== null ? tierIndex(thetaClip) : null;
  const tierColor = tier !== null ? TIER_COLORS[resolved][tier] : null;
  const nextColor =
    tier !== null && tier < 7 ? TIER_COLORS[resolved][tier + 1] : null;
  const todayAc = stats.dailyNewAc.get(todayEpochDay()) ?? 0;

  return (
    <div
      className="page"
      style={tierColor ? ({ "--tier": tierColor } as CSSProperties) : undefined}
    >
      <section className="user-hero">
        <div className="user-head">
          <div
            className="user-avatar"
            style={
              tierColor
                ? {
                    color: tierColor,
                    background: `color-mix(in srgb, ${tierColor} 14%, transparent)`,
                  }
                : undefined
            }
          >
            {userId.charAt(0).toUpperCase()}
          </div>
          <div className="user-title">
            <h1>{userId}</h1>
            <div className="user-title-actions">
              <a
                className="profile-link"
                href={`https://atcoder.jp/users/${userId}`}
                target="_blank"
                rel="noreferrer"
              >
                AtCoderプロフィール ↗
              </a>
              <button
                type="button"
                className={`mypage-toggle${isMine ? " on" : ""}`}
                onClick={() => {
                  setMyId(userId);
                  setMyIdState(userId);
                }}
                disabled={isMine}
                title={
                  isMine
                    ? "このページがあなたのマイページです"
                    : "このIDをマイページに設定"
                }
              >
                {isMine ? "★ マイページ" : "☆ マイページにする"}
              </button>
            </div>
          </div>
          {thetaClip !== null && tierColor && (
            <span className="theta-chip">
              <span className="tier-dot" style={{ background: tierColor }} />
              推定内部レート
              <strong>
                <AnimatedNumber n={thetaClip} />
              </strong>
            </span>
          )}
        </div>
        {thetaClip !== null && tier !== null && tier < 7 && nextColor && (
          <div className="tier-progress">
            <div className="tier-progress-head">
              <span>
                {TIER_LABELS[tier + 1]}色まで あと
                <strong>{(tier + 1) * 400 - thetaClip}</strong>
              </span>
              <span className="muted">
                {thetaClip} / {(tier + 1) * 400}
              </span>
            </div>
            <div className="meter">
              <div
                className="meter-fill"
                style={{
                  width: `${((thetaClip - tier * 400) / 400) * 100}%`,
                  background: `linear-gradient(90deg, ${tierColor}, ${nextColor})`,
                }}
              />
            </div>
          </div>
        )}
      </section>

      <div className="stat-grid">
        <StatCard label="累計AC" value={stats.totalAc} unit="問" />
        <StatCard
          label="今週の新規AC"
          value={stats.weeklyAc}
          unit="問"
          sub="直近7日"
        />
        <StatCard
          label="現在ストリーク"
          value={stats.currentStreak}
          unit="日"
          sub={stats.currentStreak > 0 ? "🔥 継続中" : "今日ACして再点火"}
        />
        <StatCard label="最長ストリーク" value={stats.longestStreak} unit="日" />
      </div>

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">精進ヒートマップ</h2>
          {todayAc > 0 && (
            <span className="today-chip">✨ 今日 {todayAc} AC</span>
          )}
          <span className="card-sub">直近26週・その日に初めてACした問題数</span>
        </div>
        <Heatmap dailyNewAc={stats.dailyNewAc} />
      </section>

      <div className="two-col">
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">難易度帯別AC数</h2>
            <span className="card-sub">難易度推定のある問題のみ</span>
          </div>
          <DifficultyBars tierCounts={stats.tierCounts} />
        </section>
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">累計ACの推移</h2>
            <span className="card-sub">週次</span>
          </div>
          <PaceChart cumulative={stats.cumulative} />
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">次に解く問題</h2>
          <span className="card-sub">
            2PL-IRTで実力θを推定し、AC確率40〜75%の未ACを60%に近い順に表示
          </span>
        </div>
        {theta !== null ? (
          <RecommendList recs={recs} />
        ) : (
          <p className="muted">AC実績がまだないため推定できません。</p>
        )}
      </section>
    </div>
  );
}
