import { useEffect, useState } from "react";
import { snapshotUpcoming } from "../lib/snapshot";
import type { UpcomingContest } from "../lib/types";

const CONTESTS_URL = "https://atcoder.jp/contests/";
// 表示順(予定がある種別だけ出す)
const CATS = ["abc", "arc", "agc"] as const;

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
 * 「次のABC/ARC/AGC」バナー。番号は日付から計算できないため、スナップショット
 * (upcoming.json)の予定一覧から現在時刻基準で種別ごとの次回を選ぶ。開催が終われば
 * 自動で次回に切り替わる。取得できない場合(dev等)は一覧リンクにフォールバックする。
 */
export function NextContestBanner() {
  const [list, setList] = useState<UpcomingContest[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancel = false;
    snapshotUpcoming()
      .then((l) => {
        if (cancel) return;
        setList(l ?? []);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancel) setLoaded(true);
      });
    return () => {
      cancel = true;
    };
  }, []);

  const now = Date.now() / 1000;
  const next = CATS.map(
    (cat) =>
      list
        .filter((c) => c.id.startsWith(cat) && c.start + 2 * 3600 >= now)
        .sort((a, b) => a.start - b.start)[0],
  ).filter(Boolean) as UpcomingContest[];

  if (next.length > 0) {
    return (
      <div className="abc-banners">
        {next.map((c) => (
          <a
            key={c.id}
            className="abc-banner"
            href={`https://atcoder.jp/contests/${c.id}`}
            target="_blank"
            rel="noreferrer"
          >
            <span className="abc-banner-cal">🗓</span>
            <span className="abc-banner-body">
              <span className="abc-banner-label">
                次の{c.id.slice(0, 3).toUpperCase()}
              </span>
              <span className="abc-banner-title">{c.title}</span>
            </span>
            <span className="abc-banner-when">{fmt(c.start)}</span>
            <span className="abc-banner-go">参加する →</span>
          </a>
        ))}
      </div>
    );
  }

  if (loaded) {
    return (
      <div className="abc-banners">
        <a
          className="abc-banner"
          href={CONTESTS_URL}
          target="_blank"
          rel="noreferrer"
        >
          <span className="abc-banner-cal">🗓</span>
          <span className="abc-banner-body">
            <span className="abc-banner-label">次のコンテスト</span>
            <span className="abc-banner-title">
              ABCは毎週土曜 21:00 開催
            </span>
          </span>
          <span className="abc-banner-go">コンテスト一覧 →</span>
        </a>
      </div>
    );
  }

  return null;
}
