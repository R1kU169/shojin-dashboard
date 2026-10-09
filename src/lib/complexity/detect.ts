// 貼り付けたコードの言語を推定する(計算量タブで「選んでいる言語と違うようです」と知らせるため)。
// 競プロの提出によく出る書き方の手がかりに点を付け、いちばん高い言語を返す。自信が無ければ null。
// 選んでいる言語を勝手に変えることはしない(知らせて、ボタンで切り替えてもらう)。

/** [言語キー, 手がかり, 点] */
const CLUES: [string, RegExp, number][] = [
  ["cpp", /#include\s*<(?:bits\/stdc\+\+|iostream|vector|algorithm|string|map|set|queue)/, 5],
  ["cpp", /\busing\s+namespace\s+std\b|\bstd::|\bcin\s*>>|\bcout\s*<</, 4],
  ["c", /#include\s*<stdio\.h>/, 4],
  ["c", /\bscanf\s*\(|\bprintf\s*\(/, 1],
  ["python", /^\s*def\s+\w+\s*\(.*\)\s*(?:->.*)?:\s*$/m, 3],
  ["python", /\binput\(\)|\bprint\(|\bsys\.stdin\b|\bmap\(int,/, 3],
  ["python", /^\s*(?:for|while|if|elif)\b.*:\s*$/m, 2],
  ["python", /^\s*(?:import\s+\w+|from\s+\w+\s+import\b)/m, 1],
  ["java", /\bpublic\s+static\s+void\s+main\b|\bSystem\.out\.print|\bimport\s+java\./, 5],
  ["csharp", /\bConsole\.(?:ReadLine|WriteLine|Write)\b|\busing\s+System\b/, 5],
  ["rust", /\bfn\s+main\s*\(\s*\)|\blet\s+mut\b|\bprintln!\s*\(|\buse\s+proconio\b/, 5],
  ["go", /^\s*package\s+main\b|\bfunc\s+main\s*\(\s*\)|\bfmt\.(?:Scan|Print)/m, 5],
  ["js", /\bconsole\.log\s*\(|\brequire\(\s*["']fs["']\s*\)/, 3],
  ["ts", /:\s*(?:number|string|boolean)(?:\[\])?\s*[=,);]|\binterface\s+\w+\s*\{/, 2],
  ["ruby", /\bgets\b|\bputs\b|\.each\s+do\b|^\s*end\s*$/m, 2],
  ["ruby", /\.(?:to_i|chomp|split\.map\(&:to_i\))/, 3],
  ["php", /<\?php/, 6],
  ["perl", /^\s*use\s+strict\s*;|\bmy\s+[$@%]\w+/m, 4],
  ["lua", /\blocal\s+\w+\s*=|\bio\.read\s*\(|\bthen\b[\s\S]*\bend\b/, 3],
  ["julia", /\bparse\(Int|\breadline\(\)|\bprintln\(/, 3],
  ["haskell", /^\s*main\s*=|::\s*IO\b|^\s*import\s+qualified\b|<-\s*getLine/m, 5],
  ["d", /\bimport\s+std\.\w+|\breadln\b|\bwriteln\s*\(/, 4],
  ["nim", /\bimport\s+strutils\b|\becho\b|\bproc\s+\w+\s*\(|\bstdin\.readLine\b/, 3],
  ["bash", /^#!.*\b(?:ba)?sh\b|^\s*read\s+-?\w*\s*\w+|\becho\s+\$/m, 4],
];

// 選んでいる言語のまま解析しても読める言語(C++ は C の書き方を、TS は JS を含む。PyPy と CPython は同じ)。
// これらは知らせない(C を選んで C++ のコードを貼ったときは知らせる)
const COVERS: Record<string, string[]> = { cpp: ["c"], ts: ["js"], python: ["pypy"], pypy: ["python"] };

/** コードの言語を推定する。手がかりが弱いときは null */
export function guessLanguage(code: string): string | null {
  if (code.trim().length < 20) return null;
  const score = new Map<string, number>();
  for (const [lang, re, w] of CLUES) if (re.test(code)) score.set(lang, (score.get(lang) ?? 0) + w);
  // C の書き方は C++ でも使えるので、C++ の手がかりがあれば C++ にまとめる
  if ((score.get("cpp") ?? 0) > 0 && score.has("c")) score.set("cpp", (score.get("cpp") ?? 0) + (score.get("c") ?? 0));
  // JS の書き方は TS でも使える
  if ((score.get("ts") ?? 0) > 0 && score.has("js")) score.set("ts", (score.get("ts") ?? 0) + (score.get("js") ?? 0));
  const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) return null;
  const [best, top] = ranked[0];
  const second = ranked[1]?.[1] ?? 0;
  // 4点以上で、2位に2点以上の差があるときだけ言い切る
  return top >= 4 && top - second >= 2 ? best : null;
}

/** 選んでいる言語と推定した言語が別物か(同じ系統なら知らせない) */
export function differentLanguage(selected: string, guessed: string | null): boolean {
  if (!guessed || guessed === selected) return false;
  return !COVERS[selected]?.includes(guessed);
}
