import { Link } from "react-router-dom";
import { TIER_COLORS, TIER_LABELS, tierIndex } from "../lib/colors";
import type { Recommendation } from "../lib/irt";

/**
 * 「次の一問」。おすすめの1位(AC確率が60%に一番近い未AC)を大きく出し、
 * その場でエディターか問題ページへ進めるようにする。残りは下の「次に解く問題」タブに並ぶ。
 */
export function Spotlight({
  best,
  more = [],
  reason,
}: {
  best?: Recommendation;
  /** 2位以下の候補(小さく並べる) */
  more?: Recommendation[];
  /** おすすめが出せないときに出す理由 */
  reason: string;
}) {
  if (!best) {
    return (
      <section className="spotlight">
        <div className="spot-eyebrow">次の一問</div>
        <p className="spot-empty">{reason}</p>
      </section>
    );
  }
  const tier = tierIndex(best.clippedDifficulty);
  const pct = Math.round(best.probability * 100);
  const p = best.problem;
  return (
    <section className="spotlight">
      <div className="spot-eyebrow">次の一問</div>
      <a className="spot-title" href={best.url} target="_blank" rel="noreferrer">
        {p.title}
      </a>
      <div className="spot-meta">
        {/* 濃色の地の上なので、ライトのときも帯の色はダーク用の明るい方を使う */}
        <span className="tier-dot" style={{ background: TIER_COLORS.dark[tier] }} />
        {TIER_LABELS[tier]}・難易度 {best.clippedDifficulty}
        <span className="spot-contest">{p.contest_id}</span>
      </div>
      {more.length > 0 && (
        <div className="spot-more">
          <div className="spot-more-label">ほかの候補</div>
          <ul>
          {more.map((r) => (
            <li key={r.problem.id}>
              <span
                className="tier-dot"
                style={{ background: TIER_COLORS.dark[tierIndex(r.clippedDifficulty)] }}
              />
              <a href={r.url} target="_blank" rel="noreferrer">
                {r.problem.title}
              </a>
              <span className="spot-more-pct">{Math.round(r.probability * 100)}%</span>
            </li>
          ))}
          </ul>
        </div>
      )}
      <div className="spot-prob">
        <span className="spot-pct">
          {pct}
          <small>%</small>
        </span>
        <span className="spot-prob-label">
          いまの実力で
          <br />
          ACできる見込み
        </span>
      </div>
      <div className="spot-actions">
        <Link
          className="spot-btn primary"
          to={`/editor?contest=${encodeURIComponent(p.contest_id)}&task=${encodeURIComponent(p.id)}&title=${encodeURIComponent(p.title)}`}
        >
          エディターで解く
        </Link>
        <a className="spot-btn" href={best.url} target="_blank" rel="noreferrer">
          問題を開く ↗
        </a>
      </div>
    </section>
  );
}
