import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AnimatedNumber } from "../components/AnimatedNumber";
import { DifficultyBars } from "../components/DifficultyBars";
import { GrowthChart } from "../components/GrowthChart";
import { Heatmap } from "../components/Heatmap";
import { LangBreakdown } from "../components/LangBreakdown";
import { PaceChart } from "../components/PaceChart";
import { RatingChart } from "../components/RatingChart";
import { RecentList } from "../components/RecentList";
import { RecommendList } from "../components/RecommendList";
import { ReviewList } from "../components/ReviewList";
import { StatCard } from "../components/StatCard";
import { useUserData } from "../hooks/useUserData";
import { getRating, getRatingHistory } from "../lib/cache";
import {
  TIER_COLORS,
  TIER_LABELS,
  clipDifficulty,
  tierIndex,
} from "../lib/colors";
import { collectIrtItems, estimateTheta, recommend } from "../lib/irt";
import { getMyId, setMyId } from "../lib/me";
import { computeStats, todayEpochDay } from "../lib/stats";
import type { RatePoint } from "../lib/types";
import { useTheme } from "../theme";

export function UserPage() {
  const { userId = "" } = useParams();
  const nav = useNavigate();
  const { resolved } = useTheme();
  const data = useUserData(userId);
  const [myId, setMyIdState] = useState<string | null>(() => getMyId());
  const isMine = myId === userId;
  // 公式レーティング(プロフィールのユーザー名の色)。アバター・色味・レート表示に使う。
  const [rating, setRating] = useState<number | null>(null);
  const [history, setHistory] = useState<RatePoint[]>([]);

  useEffect(() => {
    if (userId) localStorage.setItem("shojin:lastUser", userId);
  }, [userId]);

  useEffect(() => {
    let cancel = false;
    setRating(null);
    setHistory([]);
    getRating(userId)
      .then((r) => {
        if (!cancel) setRating(r);
      })
      .catch(() => {
        if (!cancel) setRating(null);
      });
    getRatingHistory(userId)
      .then((h) => {
        if (!cancel) setHistory(h);
      })
      .catch(() => {
        if (!cancel) setHistory([]);
      });
    return () => {
      cancel = true;
    };
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
  // 復習リスト: 挑戦した(提出がある)が一度もACしていない問題。最終挑戦の新しい順
  const reviewList = useMemo(() => {
    if (!data.subs) return [];
    const acSet = new Set<string>();
    for (const s of data.subs) if (s.result === "AC") acSet.add(s.problem_id);
    const tried = new Map<
      string,
      { contestId: string; last: number; count: number }
    >();
    for (const s of data.subs) {
      if (s.result === "AC" || acSet.has(s.problem_id)) continue;
      const e = tried.get(s.problem_id);
      if (e) {
        e.count++;
        e.last = Math.max(e.last, s.epoch_second);
      } else {
        tried.set(s.problem_id, {
          contestId: s.contest_id,
          last: s.epoch_second,
          count: 1,
        });
      }
    }
    const pmap = new Map((data.problems ?? []).map((p) => [p.id, p]));
    return [...tried.entries()]
      .sort((a, b) => b[1].last - a[1].last)
      .slice(0, 20)
      .map(([id, t]) => ({
        id,
        title: pmap.get(id)?.title ?? id,
        contestId: t.contestId,
        url: `https://atcoder.jp/contests/${t.contestId}/tasks/${id}`,
        difficulty: data.models?.[id]?.difficulty,
        second: t.last,
        count: t.count,
      }));
  }, [data.subs, data.problems, data.models]);

  // 成長グラフ: 初ACの 日付×難易度(難易度推定のある問題のみ)
  const growth = useMemo(() => {
    if (!data.subs || !data.models) return [];
    const pmap = new Map((data.problems ?? []).map((p) => [p.id, p]));
    const seen = new Set<string>();
    const pts = [];
    for (const s of data.subs) {
      if (s.result !== "AC" || seen.has(s.problem_id)) continue;
      seen.add(s.problem_id);
      const d = data.models[s.problem_id]?.difficulty;
      if (d === undefined) continue;
      pts.push({
        t: s.epoch_second,
        d: clipDifficulty(d),
        title: pmap.get(s.problem_id)?.title ?? s.problem_id,
      });
    }
    return pts;
  }, [data.subs, data.problems, data.models]);

  // 使用言語の内訳(上位5言語+その他)。
  // "C++ 20 (gcc 12.2)" → "C++"、"Python (CPython 3.11)" → "Python" に正規化
  const langStats = useMemo(() => {
    if (!data.subs || data.subs.length === 0) return [];
    const counts = new Map<string, number>();
    for (const s of data.subs) {
      const base =
        s.language
          .replace(/\s*\(.*$/, "")
          .replace(/\s*\d+$/, "")
          .trim() || s.language;
      counts.set(base, (counts.get(base) ?? 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 5);
    const rest = sorted.slice(5).reduce((sum, [, n]) => sum + n, 0);
    if (rest > 0) top.push(["その他", rest]);
    const total = data.subs.length;
    return top.map(([name, n]) => ({ name, n, pct: n / total }));
  }, [data.subs]);

  // 初めてACした日の新しい順(最大20問)。subsはepoch昇順なので初出=初AC。
  const recentSolved = useMemo(() => {
    if (!data.subs) return [];
    const seen = new Map<string, { contestId: string; second: number }>();
    for (const s of data.subs) {
      if (s.result !== "AC" || seen.has(s.problem_id)) continue;
      seen.set(s.problem_id, {
        contestId: s.contest_id,
        second: s.epoch_second,
      });
    }
    const pmap = new Map((data.problems ?? []).map((p) => [p.id, p]));
    return [...seen.entries()]
      .sort((a, b) => b[1].second - a[1].second)
      .slice(0, 20)
      .map(([id, { contestId, second }]) => ({
        id,
        title: pmap.get(id)?.title ?? id,
        contestId,
        url: `https://atcoder.jp/contests/${contestId}/tasks/${id}`,
        difficulty: data.models?.[id]?.difficulty,
        second,
      }));
  }, [data.subs, data.problems, data.models]);

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

  const tier = rating != null ? tierIndex(rating) : null;
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
              {isMine ? (
                <>
                  <span
                    className="mypage-toggle on"
                    title="このページがあなたのマイページです"
                  >
                    ★ マイページ
                  </span>
                  <button
                    type="button"
                    className="mypage-toggle"
                    onClick={() => nav("/me?change=1")}
                    title="マイページを別の人に変更する"
                  >
                    変更
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="mypage-toggle"
                  onClick={() => {
                    setMyId(userId);
                    setMyIdState(userId);
                  }}
                  title="このIDをマイページに設定"
                >
                  ☆ マイページにする
                </button>
              )}
            </div>
          </div>
          {rating != null && tierColor && (
            <span className="theta-chip">
              <span className="tier-dot" style={{ background: tierColor }} />
              レート
              <strong>
                {rating > 0 ? <AnimatedNumber n={rating} /> : "未レート"}
              </strong>
            </span>
          )}
        </div>
        {rating != null && rating > 0 && tier !== null && tier < 7 && nextColor && (
          <div className="tier-progress">
            <div className="tier-progress-head">
              <span>
                {TIER_LABELS[tier + 1]}色まで あと
                <strong>{(tier + 1) * 400 - rating}</strong>
              </span>
              <span className="muted">
                {rating} / {(tier + 1) * 400}
              </span>
            </div>
            <div className="meter">
              <div
                className="meter-fill"
                style={{
                  width: `${((rating - tier * 400) / 400) * 100}%`,
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

      {history.length >= 2 && (
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">レーティング推移</h2>
            <span className="card-sub">レート付きコンテストの結果</span>
          </div>
          <RatingChart history={history} color={tierColor ?? undefined} />
        </section>
      )}

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

      <div className="two-col">
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">成長グラフ</h2>
            <span className="card-sub">初ACの日付×難易度</span>
          </div>
          {growth.length > 0 ? (
            <GrowthChart points={growth} />
          ) : (
            <p className="muted">難易度推定のあるAC問題がまだありません。</p>
          )}
        </section>
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">使用言語</h2>
            <span className="card-sub">提出の内訳</span>
          </div>
          <LangBreakdown stats={langStats} />
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">次に解く問題</h2>
          <span className="card-sub">
            あなたの実力を推定し、AC確率40〜75%の未ACを60%に近い順に表示
          </span>
        </div>
        {theta !== null ? (
          <RecommendList recs={recs} />
        ) : (
          <p className="muted">AC実績がまだないため推定できません。</p>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">復習リスト</h2>
          <span className="card-sub">
            挑戦したが未ACの問題・最終挑戦の新しい順(最大20問)
          </span>
        </div>
        <ReviewList items={reviewList} />
      </section>

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">最近解いた問題</h2>
          <span className="card-sub">初めてACした日の新しい順・最大20問</span>
        </div>
        <RecentList items={recentSolved} />
      </section>
    </div>
  );
}
