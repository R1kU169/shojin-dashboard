import { lazy, Suspense } from "react";
import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ClubPage } from "./pages/ClubPage";
import { EditorPage } from "./pages/EditorPage";
import { Home } from "./pages/Home";
import { UserPage } from "./pages/UserPage";
import { MyPage } from "./pages/MyPage";
import { ThemeProvider, useTheme } from "./theme";

// 計算量タブは解析器(約6,000行)ごと別のチャンクにして、ほかのページの読み込みを重くしない
const ComplexityPage = lazy(() => import("./pages/ComplexityPage").then((m) => ({ default: m.ComplexityPage })));

function ThemeToggle() {
  const { pref, cycle } = useTheme();
  const icon = pref === "auto" ? "🌗" : pref === "light" ? "☀️" : "🌙";
  const label =
    pref === "auto"
      ? "テーマ: 自動 — OSのダークモード設定に追従 (クリックでライト固定)"
      : pref === "light"
        ? "テーマ: ライト固定 (クリックでダーク固定)"
        : "テーマ: ダーク固定 (クリックで自動に戻す)";
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={cycle}
      title={label}
      aria-label={label}
    >
      <span className="icon" key={icon}>
        {icon}
      </span>
    </button>
  );
}

function NotFound() {
  return (
    <div className="notice">
      <p>ページが見つかりませんでした。</p>
      <Link to="/">トップへ戻る</Link>
    </div>
  );
}

export default function App() {
  const { pathname } = useLocation();
  return (
    <ThemeProvider>
      <header className="app-header">
        <NavLink to="/" className="brand">
          <span className="flame">🔥</span> 精進ボード
        </NavLink>
        <nav>
          <NavLink to="/me">マイページ</NavLink>
          {/* .nav-long は狭い幅で畳まれる補足語 (→「ランキング」「DS倶楽部 ↗」) */}
          <NavLink to="/club">
            <span className="nav-long">クラブ内</span>ランキング
          </NavLink>
          <NavLink to="/editor">エディター</NavLink>
          <NavLink to="/complexity">計算量</NavLink>
          {/* 幅 820px を超える画面だけに出す(.nav-wide)。スマホではタブが横スクロールになり DS倶楽部HP が
              押し出されるので、ユーザーのページとトップページのリンクから開いてもらう */}
          <a
            className="nav-ext nav-wide"
            href="https://kenkoooo.com/atcoder/"
            target="_blank"
            rel="noreferrer"
          >
            AtCoder Problems ↗
          </a>
          <a
            className="nav-ext"
            href="https://mocaluna0117.github.io/ds-club-web"
            target="_blank"
            rel="noreferrer"
          >
            DS倶楽部<span className="nav-long">HP</span> ↗
          </a>
        </nav>
        <ThemeToggle />
      </header>
      <main className="container">
        <ErrorBoundary key={pathname}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/me" element={<MyPage />} />
            <Route path="/u/:userId" element={<UserPage />} />
            <Route path="/club" element={<ClubPage />} />
            <Route path="/editor" element={<EditorPage />} />
            <Route
              path="/complexity"
              element={
                <Suspense fallback={<p className="muted">読み込み中…</p>}>
                  <ComplexityPage />
                </Suspense>
              }
            />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </ErrorBoundary>
      </main>
      <footer className="app-footer">
        <span className="footer-brand">
          🔥 精進ボード
          <span className="fb-tag">keep the streak burning</span>
        </span>
        <span>
          データ:{" "}
          <a
            href="https://github.com/kenkoooo/AtCoderProblems/blob/master/doc/api.md"
            target="_blank"
            rel="noreferrer"
          >
            AtCoder Problems API
          </a>{" "}
          (kenkoooo) · 非公式ツール
        </span>
      </footer>
    </ThemeProvider>
  );
}
