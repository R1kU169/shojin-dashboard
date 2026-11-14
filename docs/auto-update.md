# データの自動更新を時刻どおりに動かす(外部の cron から起動)

## 背景

スナップショット(`public/snapshot/`)は GitHub Actions の `schedule` で作り直しているが、GitHub の `schedule` は
混んでいると数時間遅れたり、飛ばされたりする。実際に:

- 6時間ごとのはずが、1日2回(UTC 6時台・19時台)しか動いていない
- 土日の夜(JST 22:45・23:00・23:15・0:00)の更新が 4〜5 時間遅れる。2026-11-14(土)の夜は、翌 0:20 の時点で1回も動いておらず、
  コンテストタブに ABC484 の参加人数・公式順位が出ず、開くたびに部員全員の提出を取り直していた

そこで、外部の cron サービス(cron-job.org。無料)から GitHub の API で `workflow_dispatch` を呼び、時刻どおりに動かす。
GitHub の `schedule` は予備として残す(遅れて動いても同じデータを作り直すだけ)。

## 1. GitHub のトークンを作る

リポジトリ `R1kU169/shojin-dashboard` は R1kU169 さんの個人アカウントのものなので、
**リポジトリの持ち主(R1kU169 さん)が** Fine-grained token を作るのがいちばん安全(このリポジトリの Actions を動かす権限だけになる)。

1. 次のリンクを開く(名前・無期限・Actions の Read and write が入った状態で作成画面が開く)
   <https://github.com/settings/personal-access-tokens/new?name=shojin-dashboard+cron&description=Trigger+snapshot+updates+from+cron-job.org&expires_in=none&actions=write>
   (手で開くときは GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token)
2. Token name: `shojin-dashboard cron`、Expiration: **No expiration**(無期限)
3. Repository access: **Only select repositories** → `shojin-dashboard`(ここはリンクでは選べないので手で選ぶ)
4. Permissions → Repository permissions → **Actions: Read and write**(ほかは付けない。Metadata: Read-only は自動で付く)
5. 作ったトークン(`github_pat_…`)を控える

無期限にしているのは、期限が切れると更新が止まり、作り直しを頼むことになるため。トークンでできるのはこのリポジトリの Actions の操作
(ワークフローの起動・取り消し・実行記録の削除)だけで、コードの変更やほかのリポジトリには触れない。漏れたと思ったら、持ち主が
Settings → Developer settings → Fine-grained tokens から **Revoke** すればすぐ使えなくなる(作り直して cron-job.org のヘッダーを差し替える)。

> コラボレーター(push 権限だけの人)は、他人の個人リポジトリに Fine-grained token を使えない。
> 持ち主に頼めないときは Classic token(scope: `public_repo`)でも動くが、その人が書き込めるすべての公開リポジトリに効くので勧めない。

## 2. cron-job.org にジョブを作る

<https://cron-job.org> でアカウントを作り、Cronjobs → Create cronjob。どのジョブも次の設定にする。

| 項目 | 値 |
| --- | --- |
| URL | `https://api.github.com/repos/R1kU169/shojin-dashboard/actions/workflows/deploy.yml/dispatches` |
| Request method(ADVANCED タブ) | `POST` |
| Headers | `Authorization: Bearer <1. のトークン>`<br>`Accept: application/vnd.github+json`<br>`X-GitHub-Api-Version: 2022-11-28`<br>`User-Agent: shojin-dashboard-cron` |
| Request body | `{"ref":"main"}` |
| Time zone | `Asia/Tokyo` |
| 失敗の通知 | オン(トークンの期限切れに気づけるように) |

作るジョブ(時刻は JST):

| ジョブ | 実行する時刻 | 目的 |
| --- | --- | --- |
| 定期 | 毎日 2:17・8:17・14:17・20:17 | 6時間ごとの更新 |
| 土日の夜 | 土・日の 22:45・23:00・23:15 | コンテスト直後の結果(レートの更新は終了の数十分後) |
| 土日の深夜 | 日・月の 0:00 | 同上 |

成功すると GitHub は **204 No Content** を返す(本文は空)。401 はトークンの間違いか期限切れ、404 は権限(Actions: Read and write)が無いとき。

## 3. 確かめる

手元から1回呼んでみる(トークンはシェルの履歴に残さないよう、環境変数で渡す):

```bash
read -s GH_TOKEN   # トークンを貼り付けて Enter
curl -i -X POST \
  -H "Authorization: Bearer $GH_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  https://api.github.com/repos/R1kU169/shojin-dashboard/actions/workflows/deploy.yml/dispatches \
  -d '{"ref":"main"}'
gh run list --limit 3   # event が workflow_dispatch の実行が増えていればよい
```

## メモ

- `workflow_dispatch` の実行ではテストを飛ばす(push のときだけ動かす)。データの更新を早く終わらせるため
- ワークフローは `concurrency: pages`(`cancel-in-progress: true`)なので、遅れて来た `schedule` と重なっても、後から来たほうだけが最後まで動く
- 外部 cron が止まっても、GitHub の `schedule` が(遅れて)動くので、データが何日も古くなることはない
