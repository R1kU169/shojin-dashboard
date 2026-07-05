import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Mode } from "./lib/colors";

type Pref = "auto" | Mode;

interface ThemeCtx {
  pref: Pref;
  resolved: Mode;
  cycle: () => void;
}

const Ctx = createContext<ThemeCtx>({
  pref: "auto",
  resolved: "light",
  cycle: () => {},
});

const systemMode = (): Mode =>
  window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPref] = useState<Pref>(
    () => (localStorage.getItem("shojin:theme") as Pref | null) ?? "auto",
  );
  const [system, setSystem] = useState<Mode>(systemMode);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystem(mq.matches ? "dark" : "light");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const resolved: Mode = pref === "auto" ? system : pref;

  // CSSは data-theme だけを見る。auto時もresolved値を書き込み、OS変更はリスナーが追随する
  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);
  useEffect(() => {
    localStorage.setItem("shojin:theme", pref);
  }, [pref]);

  const cycle = () =>
    setPref((p) => (p === "auto" ? "light" : p === "light" ? "dark" : "auto"));

  return <Ctx.Provider value={{ pref, resolved, cycle }}>{children}</Ctx.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export const useTheme = () => useContext(Ctx);
