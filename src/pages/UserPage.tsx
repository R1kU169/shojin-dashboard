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
import { RatingCircle } from "../components/RatingCircle";
import { Spotlight } from "../components/Spotlight";
import { Tile } from "../components/Tile";
import { RecentList } from "../components/RecentList";
import { RecommendList } from "../components/RecommendList";
import { ReviewList } from "../components/ReviewList";
import { useUserData } from "../hooks/useUserData";
import { isValidAtcoderId } from "../lib/api";
import { getRating, getRatingHistory } from "../lib/cache";
import {
  TIER_COLORS,
  TIER_LABELS,
  clipDifficulty,
  tierIndex,
} from "../lib/colors";
import { collectIrtItems, estimateTheta, recommend } from "../lib/irt";
import { getMyId, sameId, setLastUser, setMyId } from "../lib/me";
import { computeStats, todayEpochDay } from "../lib/stats";
import type { RatePoint } from "../lib/types";
import { useTheme } from "../theme";

export function UserPage() {
  const { userId = "" } = useParams();
  // 別の人のページへ移ったら状態ごと作り直す(前の人の数字が新しい人の名前の下に一瞬出ないように)
  return <UserDashboard key={userId} userId={userId} />;
}

function UserDashboard({ userId }: { userId: string }) {
  const nav = useNavigate();
  const { resolved } = useTheme();
  const data = useUserData(userId);
  const [myId, setMyIdState] = useState<string | null>(() => getMyId());
  const isMine = sameId(myId, userId);
  // 公式レーティング(プロフィールのユーザー名の色)。アバター・色味・レート表示に使う。
  const [rating, setRating] = useState<number | null>(null);
  const [history, setHistory] = useState<RatePoint[]>([]);
  const [listTab, setListTab] = useState<ListTab>("rec");

  useEffect(() => {
    if (isValidAtcoderId(userId)) setLastUser(userId);
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
  const langStats = useMemo(() => {
    if (!data.subs || data.subs.length === 0) return [];
    const counts = new Map<string, number>();
    for (const s of data.subs) {
      const base = languageFamily(s.language);
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
  // いまの色の帯の中での位置(%)。アバターの輪と「次の色まで」のバーに使う。3200 以上は満タン
  const ringPct =
    rating != null && rating > 0 && tier !== null
      ? tier >= 7 && rating >= 3200
        ? 100
        : Math.round(((rating - tier * 400) / 400) * 100)
      : 0;

  return (
    <div
      className="page"
      style={tierColor ? ({ "--tier": tierColor } as CSSProperties) : undefined}
    >
      {/* solved.ac のようなプロフィール: レートの色のバナー、その下にアバター・名前・レート */}
      <section className="profile">
        <div className="profile-banner" aria-hidden="true">
          {rating != null && rating > 0 && (
            <span className="banner-num">{rating}</span>
          )}
        </div>
        <div className="profile-body">
          {/* アバターの周りの輪 = いまの色の帯の中でどこまで来たか(次の色までの進み具合) */}
          <div
            className="profile-avatar"
            style={{ "--p": ringPct } as CSSProperties}
            title={
              rating != null && rating > 0 && tier !== null && tier < 7
                ? `${TIER_LABELS[tier + 1]}色まで ${ringPct}%`
                : undefined
            }
          >
            <span>{userId.charAt(0).toUpperCase()}</span>
          </div>
          <div className="profile-id">
            {/* AtCoder と同じく、名前をレートの色で書く */}
            <h1 style={tierColor && rating ? { color: tierColor } : undefined}>
              {userId}
            </h1>
            <div className="user-title-actions">
              <a
                className="profile-link"
                href={`https://atcoder.jp/users/${userId}`}
                target="_blank"
                rel="noreferrer"
              >
                AtCoderプロフィール ↗
              </a>
              <a
                className="profile-link"
                href={`https://kenkoooo.com/atcoder/#/user/${encodeURIComponent(userId)}`}
                target="_blank"
                rel="noreferrer"
              >
                AtCoder Problems ↗
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
              {data.refreshing && (
                <span className="sync-note" role="status">
                  <span className="sync-spinner" aria-hidden="true" />
                  最新の提出を確認中…
                </span>
              )}
              {data.stale && (
                <span
                  className="sync-note"
                  role="status"
                  title="AtCoder Problems が混んでいるか止まっています。しばらくしてから再読み込みしてください"
                >
                  最新の提出を取得できませんでした{data.staleAt ? `(${timeAgo(data.staleAt)}の時点)` : ""}
                </span>
              )}
            </div>
          </div>
          {rating != null && tierColor && (
            <div className="profile-rating">
              <span className="hero-rating-label">レート</span>
              <span className="hero-rating-value" style={{ color: tierColor }}>
                <RatingCircle rating={rating} size={18} />
                {rating > 0 ? <AnimatedNumber n={rating} /> : "未レート"}
              </span>
              {rating > 0 && tier !== null && tier < 7 && nextColor && (
                <div className="tier-progress">
                  <div className="tier-progress-head">
                    <span>
                      {TIER_LABELS[tier + 1]}色まで あと
                      <strong>{(tier + 1) * 400 - rating}</strong>
                    </span>
                  </div>
                  <div className="meter">
                    <div
                      className="meter-fill"
                      style={{
                        width: `${ringPct}%`,
                        background: `linear-gradient(90deg, ${tierColor}, ${nextColor})`,
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      <div className="tiles">
        <Tile icon="check" color="var(--accent)" label="累計AC" value={stats.totalAc} unit="問" />
        <Tile
          icon="calendar"
          color="var(--accent-2)"
          label="今週の新規AC"
          value={stats.weeklyAc}
          unit="問"
          sub={todayAc > 0 ? `今日 +${todayAc} 問` : "直近7日"}
        />
        <Tile
          icon="flame"
          color="var(--brand-b)"
          label="現在ストリーク"
          value={stats.currentStreak}
          unit="日"
          sub={stats.currentStreak > 0 ? "継続中" : "今日ACして再点火"}
          hot={stats.currentStreak > 0}
        />
        <Tile
          icon="trophy"
          color="var(--brand-a)"
          label="最長ストリーク"
          value={stats.longestStreak}
          unit="日"
        />
      </div>

      {/* レーティング推移(広い枠)と「次の一問」(狭い枠)を横に並べる */}
      <div className="bento">
        {history.length >= 2 && (
          <section className="card">
            <div className="card-head">
              <h2 className="card-title">レーティング推移</h2>
              <span className="card-sub">
                コンテスト {history.length} 回・背景はレートの色の帯
              </span>
            </div>
            <RatingChart history={history} />
          </section>
        )}
        <Spotlight
          best={theta !== null ? recs[0] : undefined}
          more={theta !== null ? recs.slice(1, 3) : []}
          reason={
            theta !== null
              ? "条件に合う未AC問題が見つかりませんでした。"
              : stats.totalAc > 0
                ? "難易度の推定がある問題のACがまだないため推定できません。"
                : "AC実績がまだないため推定できません。"
          }
        />
      </div>

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">精進ヒートマップ</h2>
          <span className="card-sub">直近1年・その日に初めてACした問題数</span>
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
            <h2 className="card-title">使用言語</h2>
            <span className="card-sub">
              提出 {(data.subs?.length ?? 0).toLocaleString()} 件の内訳
            </span>
          </div>
          <LangBreakdown stats={langStats} />
        </section>
      </div>

      <div className="two-col">
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">累計ACの推移</h2>
            <span className="card-sub">週次</span>
          </div>
          <PaceChart cumulative={stats.cumulative} />
        </section>
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
      </div>

      {/* 問題の表3つは AtCoder Problems・LeetCode のようにタブで1枚にまとめ、ページを縦に伸ばさない */}
      <section className="card">
        <div className="tabs" role="tablist" aria-label="問題リスト">
          {LIST_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`tab-${t.key}`}
              aria-selected={listTab === t.key}
              aria-controls={`panel-${t.key}`}
              className={listTab === t.key ? "tab on" : "tab"}
              onClick={() => setListTab(t.key)}
            >
              {t.label}
              <span className="tab-count">
                {t.key === "rec"
                  ? recs.length
                  : t.key === "review"
                    ? reviewList.length
                    : recentSolved.length}
              </span>
            </button>
          ))}
        </div>
        <div
          role="tabpanel"
          id={`panel-${listTab}`}
          aria-labelledby={`tab-${listTab}`}
        >
          <p className="tab-note">{LIST_TABS.find((t) => t.key === listTab)?.note}</p>
          {listTab === "rec" ? (
            theta !== null ? (
              <RecommendList recs={recs} />
            ) : stats.totalAc > 0 ? (
              <p className="muted">難易度の推定がある問題のACがまだないため推定できません。</p>
            ) : (
              <p className="muted">AC実績がまだないため推定できません。</p>
            )
          ) : listTab === "review" ? (
            <ReviewList items={reviewList} />
          ) : (
            <RecentList items={recentSolved} />
          )}
        </div>
      </section>
    </div>
  );
}

type ListTab = "rec" | "review" | "recent";
const LIST_TABS: { key: ListTab; label: string; note: string }[] = [
  {
    key: "rec",
    label: "次に解く問題",
    note: "あなたの実力を推定し、AC確率40〜75%の未ACを60%に近い順に表示",
  },
  {
    key: "review",
    label: "復習リスト",
    note: "挑戦したが未ACの問題・最終挑戦の新しい順(最大20問)",
  },
  {
    key: "recent",
    label: "最近解いた問題",
    note: "初めてACした日の新しい順(最大20問)",
  },
];

/**
 * 提出の言語名を言語ごとにまとめる。
 * "C++ 20 (gcc 12.2)" / "C++23 (GCC 15.2.0)" → "C++"、"Python (CPython 3.11.4)" / "Python3 (3.4.3)" → "Python"、
 * "Python (PyPy 3.10-v7.3.12)" / "PyPy3 (7.3.0)" → "PyPy"、"Java11 (OpenJDK 11.0.6)" → "Java"。
 * 版や規格の違いはまとめ、CPython と PyPy は実行速度の違う別の処理系なので分ける。
 */
function languageFamily(language: string): string {
  if (/pypy/i.test(language)) return "PyPy";
  const noParen = language.replace(/\s*\(.*$/, "").trim();
  if (noParen === "") return language;
  if (/^Perl ?6$/i.test(noParen)) return "Raku";
  // 末尾の版の数字("C++ 20"、"Java11"、"Python3")を落とす。"C#" "F#" はそのまま
  return noParen.replace(/\s*\d+(?:\.\d+)*$/, "") || noParen;
}

/** 「5分前」「3時間前」「2日前」 */
function timeAgo(ms: number): string {
  const min = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (min < 60) return `${Math.max(1, min)}分前`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h}時間前`;
  return `${Math.round(h / 24)}日前`;
}
