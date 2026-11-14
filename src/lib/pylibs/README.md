# 同梱している Python ライブラリ

エディターで Python 3 / PyPy 3 のコードが `sortedcontainers` や `atcoder` を import しているとき、実行先(Compiler Explorer・Wandbox)には入っていないので、ここにあるソースを一緒に送って読み込ませる。仕組みは [../pywrap.ts](../pywrap.ts)。どちらも AtCoder のジャッジに入っているライブラリで、書いたコードはそのまま提出できる。

| ディレクトリ | ライブラリ | 版 | ライセンス | 出どころ |
|---|---|---|---|---|
| `sortedcontainers/` | sortedcontainers | 2.4.0 | Apache-2.0(`sortedcontainers/LICENSE`) | PyPI の wheel `sortedcontainers-2.4.0-py2.py3-none-any.whl` |
| `atcoder/` | ac-library-python | `27fdbb7`(2024-11-24 の master) | CC0-1.0(`atcoder/LICENSE`) | https://github.com/not522/ac-library-python |

- `.py` は手を入れずにそのまま置く(縮めるのは送るときに zlib で行う)。
- ac-library-python の `atcoder/__main__.py` は使わないので入れていない(`python -m atcoder` でライブラリをコードに展開する道具)。
- 更新するときは同じ場所から取り直してファイルを置き換え、[../pywrap.ts](../pywrap.ts) の `PY_LIBS` の版を書き換える。`npm test` の `tests/pywrap.test.ts` が手元の `python3` で動作を確かめる。
