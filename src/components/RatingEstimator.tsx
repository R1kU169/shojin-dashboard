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
  PERF_MIN,
  perfToFallBelow,
  perfToReach,
  perfToRise,
  tierFloor,
  tierOf,
} from "../lib/ratingEstimate";
import { groupChances, recentAbcTable, solveChances } from "../lib/perfGuide";
import type { AbcTable } from "../lib/perfGuide";
import type { ProblemModels, RatePoint } from "../lib/types";
import { useTheme } from "../theme";

const fmt = (n: number) => n.toLocaleString("en-US");
/** スライダーの範囲(数値の欄にはこの外も入れられる) */
const SLIDER_MIN = -400;
const SLIDER_MAX = 4000;

/**
 * 個人ページの「レート予測」。次のコンテストのパフォで、レートがどう動くか(src/lib/ratingEstimate.ts)。
 * history は Rated の回だけ(古い順)。各点のパフォ(p)がそろっていなければ「データ更新待ち」と出す
 */
export function RatingEstimator({ history, models }: { history: RatePoint[]; models?: ProblemModels }) {
  const { resolved } = useTheme();
  // パフォの目安(最近の ABC の各問題を解ける確率)。難易度のデータが読めるまでは出さない
  const table = useMemo(() => (models ? recentAbcTable(models) : null), [models]);
  const ready = history.every((h) => typeof h.p === "number");
  const perfs = useMemo(() => (ready ? history.map((h) => h.p as number) : []), [history, ready]);
  const now = perfs.length > 0 ? displayRating(perfs) : 0;
  const up = nextTierFloor(now);
  const rise = perfs.length > 0 ? perfToRise(perfs) : null;

  const [perfText, setPerfText] = useState(() => String(rise ?? Math.max(now, 400)));
  const [targetText, setTargetText] = useState(() => String(up ?? now + 100));

  /** 目安の行に添える、そのパフォの実力で ABC の問題を解ける度合い(ほぼ毎回 A・B / 2回に1回 C / たまに D) */
  const guide = (perf: number | null) =>
    table && perf !== null ? (
      <span className="re-sub re-guide-sub">
        ABC の目安:{" "}
        {/* 区分ごとに折り返さない(狭い幅で「たまに」と「D」が別の行に分かれないように) */}
        {groupChances(solveChances(table, perf)).map((g, i) => (
          <span key={g.label}>
            {i > 0 && " / "}
            <span className="re-nowrap">
              {g.short} {g.letters.join("・")}
            </span>
          </span>
        ))}
      </span>
    ) : null;

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
                    {guide(upPerf)}
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
                    {guide(rise)}
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
                    {guide(downPerf)}
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
                    <strong>
                      {p === null ? "届きません" : p <= PERF_MIN ? "どのパフォでも届きます" : `パフォ ${fmt(p)} 以上`}
                    </strong>
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
              {table && <PerfGuide table={table} perf={Math.round(perf)} />}
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
        {table &&
          ` 「ABC の目安」は、そのパフォくらいの実力の人が ABC${table.from}〜${table.to} の各問題を解ける確率(AtCoder Problems の難易度から計算)で分けています。ほぼ毎回は 80% 以上、2回に1回は 35〜80%、たまには 10〜35% です。実際のパフォは解いた早さやペナルティでも変わります。`}
      </p>
    </section>
  );
}

/** 入れたパフォの実力の目安: 最近の ABC の A〜G を解ける度合いの区分と、それぞれの確率 */
function PerfGuide({ table, perf }: { table: AbcTable; perf: number }) {
  const chances = solveChances(table, perf);
  return (
    <div className="re-guide">
      <p className="re-guide-say">
        パフォ {fmt(perf)} の実力の目安<span className="re-nowrap">(最近の ABC)</span>
      </p>
      <dl className="re-groups">
        {groupChances(chances).map((g) => (
          <div key={g.label} className="re-group">
            <dt>{g.label}</dt>
            <dd>{g.letters.join(" ・ ")}</dd>
          </div>
        ))}
      </dl>
      <div className="re-letters" role="list" aria-label={`最近の ABC(${table.from}〜${table.to})の各問題を解ける確率`}>
        {chances.map((c) => {
          const pct = Math.round(c.p * 100);
          return (
            <div key={c.letter} className="re-letter" role="listitem" aria-label={`${c.letter} 問題 ${pct}%`}>
              <span className="re-letter-bar">
                <span className="re-letter-fill" style={{ height: `${Math.max(pct, 2)}%`, opacity: 0.35 + 0.65 * c.p }} />
              </span>
              <span className="re-letter-name">{c.letter}</span>
              <span className="re-letter-pct">{pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
