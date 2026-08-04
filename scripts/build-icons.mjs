// public/icon.svg から PWA用のPNGを書き出す。
// SVGラスタライズにローカルのChromeを使うローカル専用ツール(CI/npm run buildからは呼ばない)。
// 生成物はコミット済みなので、アイコンを描き直したときだけ手で実行する:
//   node scripts/build-icons.mjs
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(ROOT, "public");
const SRC = join(PUBLIC, "icon.svg");

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  process.env.CHROME_PATH,
].filter(Boolean);

const chrome = CHROME_CANDIDATES.find((p) => {
  try {
    readFileSync(p);
    return true;
  } catch {
    return false;
  }
});
if (!chrome) {
  console.error("Chromeが見つかりません。CHROME_PATH で実行ファイルを指定してください。");
  process.exit(1);
}

// [出力ファイル名, 一辺のpx]
const TARGETS = [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["icon-maskable-512.png", 512],
  ["apple-touch-icon.png", 180],
];

// XMLコメント内の "--" は不正でSVGごとパースに失敗する(真っ白なPNGが黙って出来る)ので先に弾く
for (const body of readFileSync(SRC, "utf8").matchAll(/<!--([\s\S]*?)-->/g)) {
  if (body[1].includes("--")) {
    console.error(`icon.svg のコメントに "--" が含まれています: ${body[0].trim()}`);
    process.exit(1);
  }
}

const dir = mkdtempSync(join(tmpdir(), "shojin-icons-"));
copyFileSync(SRC, join(dir, "icon.svg"));

for (const [name, size] of TARGETS) {
  // ウィンドウぴったりのimgを1枚置いて実寸スクリーンショットする
  writeFileSync(
    join(dir, "page.html"),
    `<!doctype html><body style="margin:0;width:${size}px;height:${size}px;overflow:hidden">` +
      `<img src="icon.svg" style="display:block;width:${size}px;height:${size}px">`,
  );
  const shot = join(dir, name);
  execFileSync(
    chrome,
    [
      "--headless",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      `--window-size=${size},${size}`,
      "--default-background-color=00000000",
      `--screenshot=${shot}`,
      join(dir, "page.html"),
    ],
    { stdio: "ignore" },
  );
  writeFileSync(join(PUBLIC, name), readFileSync(shot));
  console.log(`public/${name} (${size}x${size})`);
}
