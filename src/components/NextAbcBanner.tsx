import { useEffect, useState } from "react";
import { snapshotUpcomingAbc } from "../lib/snapshot";
import type { UpcomingContest } from "../lib/types";

const CONTESTS_URL = "https://atcoder.jp/contests/";

function fmt(start: number): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(start * 1000));
}

/**
 * 「次のABC」バナー。開始時刻から日付が変わっても番号は計算できないため、
 * スナップショット(upcoming-abc.json)の予定一覧から現在時刻基準で次の回を選ぶ。
 * 取得できない場合(dev等)はコンテスト一覧へのリンクにフォールバックする。
 */
export function NextAbcBanner() {
  const [next, setNext] = useState<UpcomingContest | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancel = false;
    snapshotUpcomingAbc()
      .then((list) => {
        if (cancel) return;
        const now = Date.now() / 1000;
        // 開始2時間後までを「次 or 開催中」とみなし、最も近い回を選ぶ
        const n = (list ?? [])
          .filter((c) => c.start + 2 * 3600 >= now)
          .sort((a, b) => a.start - b.start)[0];
        setNext(n ?? null);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancel) setLoaded(true);
      });
    return () => {
      cancel = true;
    };
  }, []);

  if (next) {
    return (
      <a
        className="abc-banner"
        href={`https://atcoder.jp/contests/${next.id}`}
        target="_blank"
        rel="noreferrer"
      >
        <span className="abc-banner-cal">🗓</span>
        <span className="abc-banner-body">
          <span className="abc-banner-label">次のABC</span>
          <span className="abc-banner-title">{next.title}</span>
        </span>
        <span className="abc-banner-when">{fmt(next.start)}</span>
        <span className="abc-banner-go">参加する →</span>
      </a>
    );
  }

  if (loaded) {
    return (
      <a
        className="abc-banner"
        href={CONTESTS_URL}
        target="_blank"
        rel="noreferrer"
      >
        <span className="abc-banner-cal">🗓</span>
        <span className="abc-banner-body">
          <span className="abc-banner-label">次のABC</span>
          <span className="abc-banner-title">毎週土曜 21:00 開催</span>
        </span>
        <span className="abc-banner-go">コンテスト一覧 →</span>
      </a>
    );
  }

  return null;
}
