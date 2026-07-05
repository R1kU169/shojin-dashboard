# 🔥 精進ボード — AtCoder精進ダッシュボード

AtCoderの提出履歴から精進の記録を可視化し、いまの実力に合った「次に解くべき問題」を
レコメンドする非公式Webダッシュボード。データサイエンスクラブの部内ランキング機能つき。

バックエンド不要の完全静的SPA。[AtCoder Problems API](https://github.com/kenkoooo/AtCoderProblems/blob/master/doc/api.md)
(kenkoooo氏)をブラウザから直接叩き、IndexedDBに増分キャッシュする。

## 機能

| ページ | 内容 |
|---|---|
| `#/u/<AtCoder ID>` | 個人ダッシュボード: 累計AC・今週の新規AC・ストリーク・GitHub風精進ヒートマップ(26週)・難易度帯別AC数(AtCoder色)・累計AC推移・**実力推定つき問題レコメンド** |
| `#/club` | 部内ランキング: 今週AC / 累計AC / ストリーク / 推定内部レート |
| `#/` | ID入力 + 部員一覧(前回見たIDを記憶) |

ライト/ダークテーマ対応(OS追従 + 手動切り替え)。

## 実力推定とレコメンド — このアプリの独自実装

AtCoder Problemsの難易度データ(`problem-models.json`)には、各問題の
2PL項目応答理論(IRT)パラメータ(識別力 a・困難度 b)が含まれている。
本アプリはこれを「問題側は既知、ユーザー側だけ未知」のIRTとして解き直す:

- **観測**: AC済み問題 = 成功、提出したのに未ACの問題 = 失敗。
  挑戦していない問題は観測に含めない(解けないから避けたのか、興味がないのか識別できない)
- **モデル**: P(AC | θ) = 1 / (1 + exp(-a(θ - b)))
- **推定**: 対数尤度をNewton-Raphsonで最大化。失敗観測が少ないとMLEが発散するため、
  弱い事前分布 θ ~ N(600, 1200^2) を置いたMAP推定
- **レコメンド**: 推定θでのAC確率が40〜75%の未AC問題を、60%に近い順に提示
  (「半分くらい解けるはず」の問題が一番学習効率が良い、という難易度設定の思想に合わせた)

レート情報はAPIに含まれないため、この推定値が「内部レート換算」の代わりになる。

## 技術スタック

- React 19 + TypeScript + Vite(完全静的・APIキー不要)
- Recharts(棒・面グラフ) + 自作SVG(ヒートマップ)
- react-router (HashRouter) / idb-keyval (IndexedDBキャッシュ)

## 開発

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # 型チェック + 本番ビルド (dist/)
node scripts/smoke.mjs <atcoder_id>   # 実APIに対するロジックのスモークテスト
```

部員の追加は `src/data/members.ts`(掲載は本人の同意を得てから)。

## kenkoooo APIを使う上での注意(ハマりどころ)

- **リクエスト間隔は1秒以上**あける規約。本アプリは1.1秒スリープ+IndexedDB増分
  キャッシュ(提出履歴は前回取得時刻以降だけ取得)で遵守している
- **gzip必須**: `Accept-Encoding: gzip` のないリクエストは403で弾かれる。
  ブラウザとNodeのfetchは自動対応するが、curl等で叩くときは `--compressed` が必要
- 提出履歴APIは1回500件。同一秒に複数提出がありうるため、ページ送りは
  「最後の提出時刻から重複込みで取得してidでdedupe」する(+1すると取りこぼす)
- 非公式APIのため、仕様変更は [リポジトリ](https://github.com/kenkoooo/AtCoderProblems) を確認

## データ出典

[AtCoder Problems](https://kenkoooo.com/atcoder/) (kenkoooo氏) の非公式APIを利用。
