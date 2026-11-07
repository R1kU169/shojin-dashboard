import { useMemo, useState } from "react";
import { RatingCircle } from "./RatingCircle";
import { TIER_COLORS, TIER_LABELS } from "../lib/colors";
import {
  ABC_PERF_CAP,
  ABC_RATED_BELOW,
  contestsToReach,
  displayRating,
  limitRating,
  nextRating,
  nextTierFloor,
  perfToFallBelow,
  perfToReach,
  perfToRise,
  tierFloor,
  tierOf,
} from "../lib/ratingEstimate";
import type { RatePoint } from "../lib/types";
import { useTheme } from "../theme";

const fmt = (n: number) => n.toLocaleString("en-US");
/** スライダーの範囲(数値の欄にはこの外も入れられる) */
const SLIDER_MIN = -400;
const SLIDER_MAX = 4000;

/**
 * 個人ページの「レート予測」。次のコンテストのパフォで、レートがどう動くか(src/lib/ratingEstimate.ts)。
 * history は Rated の回だけ(古い順)。各点のパフォ(p)がそろっていなければ「データ更新待ち」と出す
 */
export function RatingEstimator({ history }: { history: RatePoint[] }) {
  const { resolved } = useTheme();
  const ready = history.every((h) => typeof h.p === "number");
  const perfs = useMemo(() => (ready ? history.map((h) => h.p as number) : []), [history, ready]);
  const now = perfs.length > 0 ? displayRating(perfs) : 0;
  const up = nextTierFloor(now);
  const rise = perfs.length > 0 ? perfToRise(perfs) : null;

  const [perfText, setPerfText] = useState(() => String(rise ?? Math.max(now, 400)));
  const [targetText, setTargetText] = useState(() => String(up ?? now + 100));

  const tierName = (rating: number) => {
    const t = tierOf(rating);
    return (
      <span className="re-tier" style={{ color: TIER_COLORS[resolved][t] }}>
        {TIER_LABELS[t]}
      </span>
    );
  };

  if (!ready) {
    return (
      <section className="card re-card">
        <div className="card-head">
          <h2 className="card-title">レート予測</h2>
        </div>
        <p className="muted">データ更新待ちです(次のデータ更新で、コンテストごとのパフォーマンスが入ります)。</p>
      </section>
    );
  }

  const perf = Number(perfText.normalize("NFKC").replace(/[,\s]/g, ""));
  const perfOk = perfText.trim() !== "" && Number.isFinite(perf);
  const after = perfOk ? nextRating(perfs, Math.round(perf)) : null;
  const target = Number(targetText.normalize("NFKC").replace(/[,\s]/g, ""));
  const targetOk = targetText.trim() !== "" && Number.isInteger(target) && target > 0;
  const abc = now < ABC_RATED_BELOW;

  // 次の色に上がる・今の色から下がる
  const upPerf = up !== null ? perfToReach(perfs, up) : null;
  const floor = tierFloor(now);
  const downPerf = floor !== null && perfs.length > 0 ? perfToFallBelow(perfs, floor) : null;
  const keepGoing = up !== null && perfOk ? contestsToReach(perfs, Math.round(perf), up) : null;

  return (
    <section className="card re-card">
      <div className="card-head">
        <h2 className="card-title">レート予測</h2>
        <span className="card-sub">次のコンテストのパフォで、レートがどう動くか(AtCoder の計算式どおり)</span>
      </div>
      <div className="re-grid">
        <div className="re-col">
          <h3 className="re-h">次のコンテストの目安</h3>
          {perfs.length === 0 ? (
            <p className="re-first">
              まだ Rated の参加がありません。初回は、パフォから 1200 引いた値がレートになります
              (400 以下はさらに小さく写します)。2回目以降は、この補正がだんだん減っていきます。
            </p>
          ) : (
            <ul className="re-rows">
              {up !== null && (
                <li className="re-row re-up">
                  <span className="re-label">
                    ↑ {tierName(up)}({up})に上がる
                  </span>
                  <span className="re-value">
                    {upPerf === null ? "次の1回では届きません" : `パフォ ${fmt(upPerf)} 以上`}
                    {upPerf !== null && abc && upPerf > ABC_PERF_CAP && (
                      <span className="re-sub">ABC のパフォは {fmt(ABC_PERF_CAP)} までなので、ABC では届きません</span>
                    )}
                  </span>
                </li>
              )}
              {rise !== null && (
                <li className="re-row">
                  <span className="re-label">→ レートが上がる</span>
                  <span className="re-value">
                    パフォ {fmt(rise)} 以上
                    <span className="re-sub">これより低いと、レートは下がるか変わりません</span>
                  </span>
                </li>
              )}
              {floor !== null && (
                <li className="re-row re-down">
                  <span className="re-label">
                    ↓ {tierName(floor - 1)}({floor} 未満)に下がる
                  </span>
                  <span className="re-value">
                    {downPerf === null ? "次の1回では下がりません" : `パフォ ${fmt(downPerf)} 以下`}
                  </span>
                </li>
              )}
            </ul>
          )}

          <h3 className="re-h">目標のレートに必要なパフォ</h3>
          <label className="re-input-row">
            目標
            <input
              className="re-input"
              inputMode="numeric"
              value={targetText}
              onChange={(e) => setTargetText(e.target.value)}
              aria-label="目標のレート"
            />
            {targetOk && tierName(target)}
          </label>
          {targetOk && (
            <ul className="re-times">
              {[1, 2, 3].map((k) => {
                const p = perfToReach(perfs, target, k);
                return (
                  <li key={k}>
                    <span className="muted">{k === 1 ? "次の1回で" : `${k}回続けて`}</span>
                    <strong>{p === null ? "届きません" : `パフォ ${fmt(p)} 以上`}</strong>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="re-col">
          <h3 className="re-h">パフォを入れて試す</h3>
          <div className="re-sim">
            <label className="re-input-row">
              パフォ
              <input
                className="re-input"
                inputMode="numeric"
                value={perfText}
                onChange={(e) => setPerfText(e.target.value)}
                aria-label="次のコンテストのパフォーマンス"
              />
            </label>
            <input
              type="range"
              className="re-slider"
              min={SLIDER_MIN}
              max={SLIDER_MAX}
              step={10}
              value={perfOk ? Math.min(SLIDER_MAX, Math.max(SLIDER_MIN, perf)) : 0}
              onChange={(e) => setPerfText(e.target.value)}
              aria-label="パフォーマンス(スライダー)"
            />
          </div>
          {after !== null ? (
            <>
              <p className="re-result">
                <span className="re-from">{perfs.length > 0 ? fmt(now) : "未レート"}</span>
                <span className="muted"> → </span>
                <RatingCircle rating={after} size={16} />
                <strong className="re-to" style={{ color: TIER_COLORS[resolved][tierOf(after)] }}>
                  {fmt(after)}
                </strong>
                {perfs.length > 0 && (
                  <span className={after > now ? "re-delta plus" : after < now ? "re-delta minus" : "re-delta"}>
                    ({after >= now ? "+" : ""}
                    {after - now})
                  </span>
                )}
              </p>
              {up !== null && (
                <p className="re-keep">
                  {keepGoing === null ? (
                    <>
                      このパフォを続けても{tierName(up)}({up})には届きません
                      (レートはおよそ {fmt(limitRating(perfs, Math.round(perf)))} に近づきます)
                    </>
                  ) : (
                    <>
                      このパフォを続けると <strong>{keepGoing} 回</strong>で{tierName(up)}({up})
                    </>
                  )}
                </p>
              )}
            </>
          ) : (
            <p className="muted">パフォーマンスを数で入れてください。</p>
          )}
        </div>
      </div>
      <p className="muted re-notes">
        Rated の回のパフォーマンスだけで計算します(部員の全履歴で、実際のレートと一致することを確かめています)。
        ABC は 2000 以上だと Unrated で、パフォは {fmt(ABC_PERF_CAP)} までです。
        新しいコンテストの結果は、レートの更新のあとのデータ更新(6時間ごと、土日の夜は 22:45〜0:00 にも)で入ります。
      </p>
    </section>
  );
}
