import { useEffect, useState } from "react";
import { MEMBERS } from "../data/members";
import { getRating } from "../lib/cache";
import { tierIndex } from "../lib/colors";

/**
 * 全部員の公式レーティング → 帯インデックス(0..7)を id ごとに返す(未取得は欠番)。
 * ホームのアバターをレート帯色に合わせるための軽量ロード。getRating が
 * snapshot/idbキャッシュを担うので、本番や再訪では即座に埋まる。API礼儀のため
 * 並列ではなく順番に問い合わせ、算出でき次第 id→tier を逐次反映する。
 */
export function useMemberTiers(): Record<string, number> {
  const [tiers, setTiers] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancel = false;
    (async () => {
      for (const m of MEMBERS) {
        if (cancel) break;
        try {
          const r = await getRating(m.id);
          if (!cancel) setTiers((prev) => ({ ...prev, [m.id]: tierIndex(r) }));
        } catch {
          // 取得失敗した部員は中立色のまま(致命扱いにしない)
        }
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  return tiers;
}
