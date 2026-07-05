import { NavLink, Route, Routes } from "react-router-dom";
import { ClubPage } from "./pages/ClubPage";
import { Home } from "./pages/Home";
import { UserPage } from "./pages/UserPage";
import { MyPage } from "./pages/MyPage";
import { ThemeProvider, useTheme } from "./theme";

function ThemeToggle() {
  const { pref, cycle } = useTheme();
  const icon = pref === "auto" ? "🌗" : pref === "light" ? "☀️" : "🌙";
  const label =
    pref === "auto"
      ? "テーマ: 自動 (クリックでライト)"
      : pref === "light"
        ? "テーマ: ライト (クリックでダーク)"
        : "テーマ: ダーク (クリックで自動)";
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

export default function App() {
  return (
    <ThemeProvider>
      <header className="app-header">
        <NavLink to="/" className="brand">
          <span className="flame">🔥</span> 精進ボード
        </NavLink>
        <nav>
          <NavLink to="/me">マイページ</NavLink>
          <NavLink to="/club">クラブ</NavLink>
        </nav>
        <ThemeToggle />
      </header>
      <main className="container">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/me" element={<MyPage />} />
          <Route path="/u/:userId" element={<UserPage />} />
          <Route path="/club" element={<ClubPage />} />
        </Routes>
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
