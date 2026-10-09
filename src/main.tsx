import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import "./index.css";
import App from "./App.tsx";

// デプロイをまたいで開いたままのタブでは、古いチャンク(計算量タブ)が無くなって遅延読み込みが失敗する。
// 1回だけ再読み込みして新しい版を取る(続けて失敗したら ErrorBoundary が再読み込みのボタンを出す)
window.addEventListener("vite:preloadError", (e) => {
  const KEY = "shojin:chunkReloadAt";
  try {
    const last = Number(sessionStorage.getItem(KEY));
    if (Date.now() - last < 10_000) return;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    return;
  }
  e.preventDefault();
  location.reload();
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);
