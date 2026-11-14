// Python の外部ライブラリ(sortedcontainers・ac-library-python)を、実行先に送るコードへ同梱する。
//
// AtCoder のジャッジにはこの2つが入っているが、Compiler Explorer と Wandbox の Python は標準ライブラリしか無く
// (2026-11 に CPython 3.14・PyPy 3.10 の両方で実測)、そのまま提出できるコードがエディターでは
// ModuleNotFoundError になっていた。どちらも Python だけで書かれているので、ソースを src/lib/pylibs に持っておき、
// import しているときだけ「ソースから読み込む仕組み(sys.meta_path の finder)を足してから、書いたコードを実行する」
// Python に包んで送る。import していないコードは1文字も変えずに送る。
//
// 書いたコードは文字列のまま compile(…, "Main.py") して exec する。先頭に行を足すとエラーの行番号がずれるが、
// こうすれば行番号も列も書いたコードのまま(ファイル名は AtCoder と同じ Main.py)。
// 包む側のフレームはエラー表示から外し、巨大な文字列の行はエラー表示に出ないようにする(例外を出さない代入の行に置く)。
// ライブラリのソースは zlib で縮めて base64 で送る(sortedcontainers は約120KB → 約30KB、ac-library-python は約45KB → 約14KB)。

export type PyLib = "sortedcontainers" | "atcoder";

/** 同梱しているライブラリ(src/lib/pylibs の README に出どころと更新の手順) */
export const PY_LIBS: Record<PyLib, { label: string; version: string }> = {
  sortedcontainers: { label: "sortedcontainers", version: "2.4.0" },
  atcoder: { label: "ac-library-python", version: "27fdbb7" },
};

const DETECT: Record<PyLib, RegExp> = {
  // ほかの意味で出てくる語ではないので、どこかにあれば同梱する(コメントの中で余計に同梱しても害はない)
  sortedcontainers: /\bsortedcontainers\b/,
  // atcoder は URL やコメント・文字列にもよく出てくるので、import 文にあるときだけ
  atcoder: /\bfrom[ \t]+atcoder\b|\bimport[ \t]+[^\n#;]*\batcoder\b/,
};

/** コードが使っている(同梱が要る)ライブラリ */
export function usedPyLibs(code: string): PyLib[] {
  return (Object.keys(DETECT) as PyLib[]).filter((k) => DETECT[k].test(code));
}

/** 書いたコードのファイル名(AtCoder と同じ) */
const MAIN = "Main.py";

// 包む側の Python。
// - _shojin_boot はモジュールの名前空間に何も残さない(書いたコードから sys などが見えると、
//   import し忘れても動いてしまい AtCoder でだけ落ちる)。import はすべて関数の中で行う。
// - 表示される実行時間に乗るので、ここでは組み込みのモジュールしか import しない。PyPy では base64 が 92ms、
//   json が 18ms、linecache が 12ms、importlib.machinery が 9ms かかっていた(2026-11 に Compiler Explorer で実測)。
// - エラー表示でソースの行を出すのは、linecache が各モジュールの __loader__.get_source から読む仕組みに任せる
//   (書いたコードは __main__ の __loader__ を差し替えて Main.py の中身を返す)。
const BOOT = `# 精進ボード: 実行先に無いライブラリを読み込めるようにしてから、書いたコードを ${MAIN} として実行する
def _shojin_boot():
    import binascii, sys, zlib

    g = globals()
    packed, src = g.pop("_shojin_packed"), g.pop("_shojin_src")
    del g["_shojin_boot"]
    parts = zlib.decompress(binascii.a2b_base64(packed)).decode("utf-8").split("\\0")
    files = dict(zip(parts[0::2], parts[1::2]))
    ModuleSpec = getattr(sys.modules.get("_frozen_importlib"), "ModuleSpec", None)
    if ModuleSpec is None:
        from importlib.machinery import ModuleSpec

    def key_of(name):
        base = name.replace(".", "/")
        for key in (base + "/__init__.py", base + ".py"):
            if key in files:
                return key
        return None

    class Finder:
        # sys.meta_path の最後に足すので、実行先に本物が入っていればそちらが使われる
        @classmethod
        def find_spec(cls, name, path=None, target=None):
            key = key_of(name)
            if key is None:
                return None
            return ModuleSpec(name, cls, origin=key, is_package=key.endswith("/__init__.py"))

        @staticmethod
        def create_module(spec):
            return None

        @staticmethod
        def exec_module(module):
            key = module.__spec__.origin
            exec(compile(files[key], key, "exec", dont_inherit=True), module.__dict__)

        @staticmethod
        def get_source(name):
            return files.get(key_of(name))

    class MainSource:
        @staticmethod
        def get_source(name):
            return src

    sys.meta_path.append(Finder)
    g["__loader__"] = MainSource

    def hook(etype, value, tb):
        # 包む側(このファイル)のフレームは出さず、書いたコードから先を出す
        t = tb
        while t is not None and t.tb_frame.f_code.co_filename != "${MAIN}":
            t = t.tb_next
        if t is not None or (isinstance(value, SyntaxError) and value.filename == "${MAIN}"):
            tb = t
            value.__traceback__ = t
        import traceback
        traceback.print_exception(etype, value, tb)

    sys.excepthook = hook
    return compile(src, "${MAIN}", "exec", dont_inherit=True)


`;

/** UTF-8 を zlib(deflate)で縮めて base64 にする。Python の zlib.decompress でそのまま戻せる */
async function deflateBase64(text: string): Promise<string> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("deflate"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// 同じライブラリの組なら縮めた結果を使い回す(まとめて実行では同じコードを何十回も送る)
const packCache = new WeakMap<Record<string, string>, Map<string, Promise<string>>>();

function pack(files: Record<string, string>, libs: PyLib[]): Promise<string> {
  let byLibs = packCache.get(files);
  if (!byLibs) packCache.set(files, (byLibs = new Map()));
  const key = [...libs].sort().join(",");
  let p = byLibs.get(key);
  if (!p) {
    // パスとソースを NUL でつないで送る(ソースに NUL は無い。json を import しないで済む)
    const picked = Object.entries(files).filter(([path]) => libs.some((l) => path.startsWith(`${l}/`)));
    p = deflateBase64(picked.flat().join("\0"));
    byLibs.set(key, p);
  }
  return p;
}

/**
 * 書いたコードを、ライブラリを読み込めるようにする Python で包む。
 * @param files ライブラリのソース。キーは "sortedcontainers/sortedlist.py" のようなパス
 */
export async function wrapPython(code: string, files: Record<string, string>, libs: PyLib[]): Promise<string> {
  const packed = await pack(files, libs);
  // JSON の文字列はそのまま Python の文字列リテラルとして読める(\" \\ \n \uXXXX などの書き方が同じ)。
  // 先頭の BOM はファイルなら読み飛ばされるが、compile() に文字列で渡すと構文エラーになるので外す
  const src = JSON.stringify(code.replace(/^﻿/, ""));
  return `${BOOT}_shojin_packed = "${packed}"\n_shojin_src = ${src}\nexec(_shojin_boot())\n`;
}
