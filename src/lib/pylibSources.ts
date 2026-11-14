// 同梱する Python ライブラリのソース(pywrap.ts が実行先に送る。出どころと更新の手順は pylibs/README.md)。
// Vite が文字列として取り込む。run.ts が要るときだけ動的に読み込むので、ふだんのページは重くならない
const raw = import.meta.glob<string>("./pylibs/*/*.py", { query: "?raw", import: "default", eager: true });

/** キーは "sortedcontainers/sortedlist.py" のようなパス */
export const PYLIB_FILES: Record<string, string> = Object.fromEntries(
  Object.entries(raw).map(([path, src]) => [path.slice("./pylibs/".length), src]),
);
