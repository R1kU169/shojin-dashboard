import { useEffect, useRef, useState } from "react";

const prefersReduced = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * 数字を数え上げる。値が変わったら、いま表示している値から新しい値へ動かす
 * (裏で最新の提出が届いて 356 → 358 になったとき、0 から数え直さない)。
 */
function useCountUp(target: number, durationMs = 900): number {
  const [value, setValue] = useState(() => (prefersReduced() ? target : 0));
  const shown = useRef(value);
  shown.current = value;
  useEffect(() => {
    if (prefersReduced()) {
      setValue(target);
      return;
    }
    const from = shown.current;
    if (from === target) return;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      // rAF の時刻はフレームの開始時刻なので start より前のことがある。0 未満にすると
      // ease-out の式が負になり、一瞬「-18問」のように出てしまう
      const t = Math.min(1, Math.max(0, (now - start) / durationMs));
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setValue(Math.round(from + (target - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return value;
}

export function AnimatedNumber({ n }: { n: number }) {
  const v = useCountUp(n);
  return <>{v.toLocaleString()}</>;
}
