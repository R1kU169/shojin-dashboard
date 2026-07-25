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

// abc468 → "ABC 468"(狭いサイドに収まる短い名前)
function shortName(id: string): string {
  return `${id.slice(0, 3).toUpperCase()} ${id.slice(3)}`;
}

/**
 * 「次のABC/ARC/AGC」カード(ホーム右側に配置)。番号は日付から計算できないため、
 * スナップショット(upcoming.json)の予定一覧から現在時刻基準で種別ごとの次回を選ぶ。
 * 開催が終われば自動で次回に切り替わる。取得できない場合(dev等)は一覧リンクにする。
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

  if (next.length === 0 && !loaded) return null;

  return (
    <div className="contest-side">
      <div className="contest-side-head">コンテスト予定</div>
      {next.length > 0 ? (
        next.map((c) => (
          <a
            key={c.id}
            className="ct-card"
            href={`https://atcoder.jp/contests/${c.id}`}
            target="_blank"
            rel="noreferrer"
            title={c.title}
          >
            <span className="ct-label">次の{c.id.slice(0, 3).toUpperCase()}</span>
            <span className="ct-name">{shortName(c.id)}</span>
            <span className="ct-when">🗓 {fmt(c.start)}</span>
          </a>
        ))
      ) : (
        <a
          className="ct-card"
          href={CONTESTS_URL}
          target="_blank"
          rel="noreferrer"
        >
          <span className="ct-label">次のコンテスト</span>
          <span className="ct-name">ABC 毎週土 21:00</span>
          <span className="ct-when">コンテスト一覧 →</span>
        </a>
      )}
    </div>
  );
}
