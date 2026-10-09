import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

// 遅延読み込みのチャンク(計算量タブ)を取れなかったときのブラウザごとのメッセージ
const CHUNK_ERROR = /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Failed to fetch/i;

/**
 * 描画中の例外でアプリ全体(ヘッダーごと)が消えないよう、ページの部分だけを差し替える。
 * デプロイをまたいで開いたままのタブで古いチャンクが無くなったときも、ここで再読み込みを促す。
 * 別のページへ移ったらエラーの表示を消せるよう、使う側でパスを key に渡す。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const chunk = CHUNK_ERROR.test(error.message);
    return (
      <div className="notice error-text" role="alert">
        <p>
          {chunk
            ? "ページの読み込みに失敗しました。サイトが更新されたか、通信が切れた可能性があります。"
            : `表示中にエラーが起きました: ${error.message}`}
        </p>
        <button type="button" className="run-btn" onClick={() => location.reload()}>
          再読み込み
        </button>
      </div>
    );
  }
}
