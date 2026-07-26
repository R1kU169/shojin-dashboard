// エディターのシンタックスハイライト(Prism.js)。
// 透明なtextareaの背後にハイライト済みコードを重ねる方式なので、
// ここでは「コード文字列 → ハイライトHTML」の変換だけを担当する。
import Prism from "prismjs";
// 依存順に注意: cppはc、typescriptはjavascript(コア同梱)、phpはmarkup-templatingが前提
import "prismjs/components/prism-c";
import "prismjs/components/prism-cpp";
import "prismjs/components/prism-python";
import "prismjs/components/prism-java";
import "prismjs/components/prism-csharp";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-go";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-ruby";
import "prismjs/components/prism-haskell";
import "prismjs/components/prism-d";
import "prismjs/components/prism-nim";
import "prismjs/components/prism-julia";
import "prismjs/components/prism-perl";
import "prismjs/components/prism-markup-templating";
import "prismjs/components/prism-php";
import "prismjs/components/prism-lua";
import "prismjs/components/prism-bash";

// 自動ハイライト(DOM走査)は使わない。二重処理を避ける
Prism.manual = true;

// EditorLang.key → Prismの言語名
const LANG_MAP: Record<string, string> = {
  cpp: "cpp",
  c: "c",
  python: "python",
  pypy: "python",
  java: "java",
  csharp: "csharp",
  rust: "rust",
  go: "go",
  js: "javascript",
  ts: "typescript",
  ruby: "ruby",
  haskell: "haskell",
  d: "d",
  nim: "nim",
  julia: "julia",
  perl: "perl",
  php: "php",
  lua: "lua",
  bash: "bash",
};

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** コードをハイライト済みHTMLへ変換する。未対応言語はエスケープのみ。 */
export function highlightCode(code: string, langKey: string): string {
  const name = LANG_MAP[langKey];
  const grammar = name ? Prism.languages[name] : undefined;
  if (!grammar) return escapeHtml(code);
  try {
    return Prism.highlight(code, grammar, name);
  } catch {
    return escapeHtml(code);
  }
}
