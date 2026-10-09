import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Mode } from "./lib/colors";
import { readStore, writeStore } from "./lib/storage";

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

const THEME_KEY = "shojin:theme";
// ブラウザのUI(アドレスバー等)の色。index.html の meta theme-color と同じ値
const UI_COLOR: Record<Mode, string> = { light: "#f9f9f7", dark: "#0d0d0d" };

function storedPref(): Pref {
  const v = readStore(THEME_KEY);
  return v === "light" || v === "dark" ? v : "auto";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPref] = useState<Pref>(storedPref);
  const [system, setSystem] = useState<Mode>(systemMode);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystem(mq.matches ? "dark" : "light");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const resolved: Mode = pref === "auto" ? system : pref;

  // CSSは data-theme だけを見る。auto時もresolved値を書き込み、OS変更はリスナーが追随する
  // (最初の描画の前は index.html のスクリプトが同じ値を当てている)。
  // ブラウザのUIの色も、OSではなく画面のテーマに合わせる
  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
    for (const m of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
      m.content = UI_COLOR[resolved];
    }
  }, [resolved]);
  useEffect(() => {
    writeStore(THEME_KEY, pref);
  }, [pref]);

  const cycle = () =>
    setPref((p) => (p === "auto" ? "light" : p === "light" ? "dark" : "auto"));

  return <Ctx.Provider value={{ pref, resolved, cycle }}>{children}</Ctx.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export const useTheme = () => useContext(Ctx);
