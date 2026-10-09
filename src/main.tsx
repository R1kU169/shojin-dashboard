import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import "./index.css";
import App from "./App.tsx";

// デプロイをまたいで開いたままのタブでは、古いチャンク(個人ページ・エディター・計算量タブ)が無くなって
// 遅延読み込みが失敗する。1回だけ再読み込みして新しい版を取る(続けて失敗したら ErrorBoundary が
// 再読み込みのボタンを出す)。失敗そのものは握りつぶさない(握ると読み込んだ値が undefined になって別の例外になる)
window.addEventListener("vite:preloadError", () => {
  const KEY = "shojin:chunkReloadAt";
  try {
    const last = Number(sessionStorage.getItem(KEY));
    if (Date.now() - last < 10_000) return;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    return;
  }
  location.reload();
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);
