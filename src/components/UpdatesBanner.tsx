import { useState } from "react";
import { UPDATES } from "../data/updates";
import { getSeenUpdate, setSeenUpdate } from "../lib/updates";

// 一度に見せる件数。初回訪問者に履歴を全部浴びせないための上限でもある
const MAX_SHOWN = 2;

/**
 * トップに出す「アップデート内容」。未読が無ければ何も描画しない。
 * (空要素を返すと .page > *:nth-child() の時間差アニメーションがずれるので、
 *  NextContestBannerと同じく null を返す)
 */
export function UpdatesBanner() {
  // 初回レンダーのseenで固定する。押した直後に再計算されると行が消えていくため
  const [seen] = useState(getSeenUpdate);
  const [hidden, setHidden] = useState(false);

  const unread = UPDATES.filter((u) => seen === null || u.id > seen);
  if (hidden || unread.length === 0) return null;
  const shown = unread.slice(0, MAX_SHOWN);

  const dismiss = () => {
    // 表示中の先頭ではなく「全体の最新」を既読にする。表示分だけ既読にすると
    // 未読5件・表示2件のときに押しても3件残り、バナーが出続けて抜けられなくなる
    setSeenUpdate(UPDATES[0].id);
    setHidden(true);
  };

  return (
    <section className="updates-banner" aria-label="アップデート内容">
      <span className="ub-icon" aria-hidden="true">
        🔔
      </span>
      <div className="ub-body">
        <div className="ub-head">アップデート</div>
        {/* 見出しだけを並べ、箇条書きの詳細は開いたときだけ出す(トップの大半を更新履歴が占めないように) */}
        {shown.map((u) =>
          u.items ? (
            <details className="ub-item" key={u.id}>
              <summary>
                <span className="ub-date">{u.date}</span>{" "}
                <span className="ub-title">{u.title}</span>
              </summary>
              <ul className="ub-list">
                {u.items.map((it) => (
                  <li key={it}>{it}</li>
                ))}
              </ul>
            </details>
          ) : (
            <div className="ub-item" key={u.id}>
              <span className="ub-date">{u.date}</span>{" "}
              <span className="ub-title">{u.title}</span>
            </div>
          ),
        )}
        {unread.length > shown.length && (
          <div className="ub-more muted">
            ほか {unread.length - shown.length} 件の更新
          </div>
        )}
      </div>
      <button type="button" className="ub-ack" onClick={dismiss}>
        確認した
      </button>
    </section>
  );
}
