import { useEffect, useState } from "react";

const prefersReduced = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function useCountUp(target: number, durationMs = 900): number {
  const [value, setValue] = useState(() => (prefersReduced() ? target : 0));
  useEffect(() => {
    if (prefersReduced()) {
      setValue(target);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setValue(Math.round(target * eased));
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
