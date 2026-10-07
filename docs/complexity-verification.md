# 計算量チェッカーの検証(AtCoder 公式解説との照合)

計算量タブ(`src/lib/complexity/`)が実際の競プロのコードで正しく動くかを、AtCoder の公式解説で確かめた記録。
解説に載っている実装例をチェッカーに通し、解説に書かれた計算量(書かれていなければコードを読んで決めた正解)と比べた。

## まとめ

| | ◎ 一致 | ○ 設計上の割り切り | × 不一致 | AC 解なのに「TLE の恐れ」 |
| --- | --- | --- | --- | --- |
| 修正前 | 105 | 6 | 45 | 8 |
| 修正後 | **130** | 17 | **9** | **6** |

- 対象は ABC459〜478(2026年5月〜10月の20回)の A〜G。公式解説に C++ / Python の実装例があった 106 問・156 ケース
- 見つかったズレを原因ごとに 10 のコミットで直し、156 ケース中 36 ケースが改善、悪化は 0。ゴールデンテストを 34 本追加した
- 修正前は、解説の解法を **過小に** 見積もるケース(最大流・畳み込み・判定関数つきの二分探索を数えない、
  `"o".join(S)` を区切りの長さで数える、再帰ラムダを見落とす、根拠の無い償却 など)が 7 件あった。修正後に残る差で
  過小になりうるのは、推定できない大きさを記号で示す ABC464 F と、入力の1行をそのまま加工する式を読み取りとして数えない
  ABC462 A(設計どおり)だけ
- 残る × 9 件は、出力の個数に比例する列挙・要素の値に依存する償却など、静的解析では原理的に決まらないもの。
  いずれも過大に出すか、推定できないことを警告・記号で示す

## 方法

### 対象とデータ

- [AtCoder Problems](https://kenkoooo.com/atcoder/#/table/) の表にある直近20回の ABC(abc459〜abc478)の A〜G、140 問
- 各問題の **公式の日本語解説** の本文から、C++ / Python のコードブロックを取り出す(1つの解説に複数あれば別ケース)。
  37 件の解説はコードが無いか(31 件)、提出へのリンクだけだった(6 件。提出ページは取得できない)ので対象外
- 結果は 106 問・156 ケース(C++ 79 / Python 77)

### 正解の決め方

- 解説に計算量が書かれている 50 ケースは、それをコードの変数名に読み替えたもの(解説の H, W をコードが n, m で読むなら `O(N·M)`)
- 書かれていない 106 ケースは、コードとアルゴリズムを読んで決めた
- コードが上限の定数で配列を確保・ループしているなら、その定数が出るのが正しい(`int a[3e5+1]` → `O(Q + 3×10^5)`)

### 判定

| 判定 | 意味 |
| --- | --- |
| ◎ 一致 | チェッカーの式が正解と同じ |
| ○ 設計上の割り切り | 既知の限界にあたる差で、理由を書いて許容したもの(マルチテストの総和制約を見ない、推定できない大きさを記号で出す など) |
| × 不一致 | それ以外 |

もう1つの基準として、問題文の制約(`1 ≤ N ≤ 2×10^5` など)と実行時間制限で見積もり(`evaluate`)を出し、
**AC するはずの解説の解法に「TLE の恐れ」と出たか** を数えた。Python のコードは PyPy の速さの目安で見積もる。
制約から値が取れない記号(`H × W ≤ 10^6` の H, W など)は期待値表に値を書いた。

### 仕組み

- `scripts/verify-complexity.mjs`: 解説一覧から公式の日本語解説を選び、コード・「計算量は O(…)」の文・制約・実行時間制限を取り出して
  `analyzeCode` / `evaluate` に通し、期待値表と照合する。取得した HTML は `.cache/verify-complexity/` に置き(コミットしない)、
  無いときだけ 1 秒に 1 件取りに行く
- `scripts/verify-complexity.expected.json`: 156 ケースの正解・許容する表記・制約から取れない値・メモ。
  解説のコードは AtCoder の著作物なのでコミットせず、コードのハッシュだけ持つ(解説が書き換わったら「要再レビュー」と出る)

```sh
node scripts/verify-complexity.mjs                     # 集計と × の一覧
node scripts/verify-complexity.mjs --only abc470_g     # 1問(abc470 なら1回分)を詳しく。--code でコードも
node scripts/verify-complexity.mjs --contests abc479   # 新しい回を足す(期待値の無いケースは「未レビュー」)
node scripts/verify-complexity.mjs --skeleton          # 未レビューのケースを期待値表に足す(time は null)
node scripts/verify-complexity.mjs --json out.json     # ケースごとの結果(修正の前後を比べる用)
```

ネットワークと AtCoder への負荷があるので CI には入れていない。チェッカーを直したら、`npm test` に加えてこのスクリプトを流し、
`--json` の結果を前回と比べて他のケースが悪化していないことを確かめる。

## 直したもの

| 原因 | 主な問題 | 内容 |
| --- | --- | --- |
| ループの中で作り直すコンテナ | ABC474 E / 466 F / 464 G / 459 F | `diff = []` / ループ内で宣言した vector の大きさを1回分にする(T·N 個と数えて TLE 判定) |
| 長さを入れた変数 | ABC461 D / 476 F / 464 G | 関数内の `n = a.size()` を呼び出し側の長さに置き換える。C++ の `ll n = …;` を1回だけの代入として扱う。同じ記号になる別の変数(`h` と入力の `H`)は区別する |
| 尺取りのポインタ | ABC461 D | `r = max(r, l + 1)` は振り出しに戻さない(償却) |
| Python の ACL | ABC461 E / 468 F / 477 F / 472 G | `FenwickTree` / `SegTree` / `LazySegTree` / `MFGraph` を ACL として数える(`fs[t].sum` を Python の `sum` と取り違えて TLE 判定)。`input = sys.stdin.readline` を入力の変数と取り違えない |
| コンテナを並べたリスト | ABC461 E / 471 G | `[set() for …]` / `vector<ll> g[n]` の要素の種類を覚える。`atcoder::convolution` を数える |
| 構造化束縛と Dijkstra | ABC463 E | `const auto [d, v]{pq.top()}` を読む。1回目の走査で辺の数を仮に M と置き、入力の M と取り違えていた(TLE 判定) |
| 1度しか通らない分岐 | ABC473 B / 472 E | `return` / `break` で終わる if の枝はループの回数を掛けない |
| リストの連結とタプル代入 | ABC465 C / 472 E | `ans = a + [w] + b[::-1]` の長さ、`a, b = [], []` の確保 |
| 個々の書き方 | ABC463 F / 465 F / 468 C / 468 G / 471 B / 474 G / 475 A | `"o".join(S)`、型の分からない `split`、`permutations` の要素、内包表記の長さ、`rbegin(x)` / `views::iota`、`!(bi >> k)`、読んだ行の `lower()` |
| バケツの総和 | ABC461 C / 462 B / 470 G / 478 E | `for r in t` の `|r|` や `t[i]` の大きさに比例する項は、ループ全体で追加の総数(Σ|t[i]| = 総数) |
| 消し続ける while | ABC470 G | `while (true) { …; s.erase(it); }` は s に入った総数で償却(TLE 判定) |
| 初期化文つきの範囲 for | ABC473 E / 478 E | `for (int s = 0; const auto& x : a)`、`views::istream<T>(cin)` |
| リンクでたどるスタック | ABC478 F | `while (p && a[p] < a[i]) p = prev[p]; prev[i] = p;` を償却(N² で TLE 判定)。`unsigned p{…}` を宣言として読む |
| 判定関数つきの二分探索 | ABC463 D | `ranges::partition_point(views::iota(0, 10^9), f)` は log × f(f を数えず過小) |
| 外接長方形 | ABC464 B | `d = max(d, i)` で更新する変数の上限 |
| 関数の断片 | ABC477 G | 初期化と関数だけのコードは関数を入口として評価する(O(1) と出ていた) |
| 添字で回す木の DFS・再帰ラムダ | ABC459 E / 473 D | `for (i < g[v].size()) dfs(g[v][i])` を隣接走査に。`this auto self` / `auto&& self` の再帰を認識(見落として過小) |
| 入れ直すキューの償却 | ABC466 F | `heappush` で入れ直す while をキューの要素数で償却しない(根拠の無い過小評価だった) |

## 残した限界

### × 不一致(9 件)

| 問題 | チェッカー | 正解 | 理由 |
| --- | --- | --- | --- |
| ABC473 D(4 件) | `O(K·4^N)` など(指数時間の再帰と警告) | O(N² f) / O(N³ f) | 出力の個数 f(N, K) に比例する列挙。f は静的には分からない |
| ABC466 F(2 件) | `O(T·N² log N)`(推定できないと警告) | O(N log N log X) | 取り出しては入れ直す優先度付きキューの回数は、値が割られて小さくなる議論(log X)が要る |
| ABC470 C | `O(Q² + N)` | O(N + Q) | フィルタで作り直すリストの償却は、要素の値が減って 0 になると消えるという値の議論が要る |
| ABC476 G | `O(T·R·C + …)` | O(T log² R) | 刻みが 2 冪の変数で進む while の回数(log R)は、刻みの値の議論が要る |
| ABC464 F | `O(N^4 + |trs|·… )` | O(N² 2^(N/2)) | 半分全列挙で `extend` して作るリストの大きさは追えない(記号が残るので見積もりは出ない) |

### ○ 設計上の割り切りとして許容したもの(17 件)

- **マルチテストの総和制約**(9 件: ABC459 D / 459 E / 459 F / 462 F / 464 D / 464 G / 472 E / 474 E / 474 G):
  ΣN ≤ … を見ず、1 ケースあたりの N と T の積で出す(既知の限界)。範囲指定で T = 1、N = 総和の上限にすると見積もれる
- **推定できない大きさや値を記号で出す**(6 件: ABC464 B の `zip` の要素、465 F の関数で作った表の値、466 G の定数の問題、
  473 G のキューの多項式、476 B の文字、478 D の時刻の値)
- **同名の変数を区別しない**(ABC476 D: 関数内の局所変数 b と大域の b)
- **入力をそのまま加工する1式**(ABC462 A: `"".join(filter(str.isdigit, input()))` は読み取りとして数えない)

### 「TLE の恐れ」と出る AC 解(6 件)

- ABC473 D(2 件)/ 466 F(2 件)/ 470 C: 上の × と同じ理由(警告つき)
- ABC468 D: 式は正解と一致(O(N²)、N ≤ 10^4)。PyPy の速さの目安(3×10^7 回/秒、ループ本体を1回と数える)では 10^8 回が
  予算を超えるため。目安は保守的にしている

修正前の 8 件のうち ABC461 E / 463 E / 470 G / 478 F の 4 件は直った。ABC473 D の C++ 版と ABC466 F の Python 版は、
修正前は過小評価(再帰の見落とし・根拠の無い償却)で「余裕」と出ていたのが、ほかの言語の版と同じく警告つきの TLE になった。

## 付録: ケースごとの結果

判定の記号は上と同じ(◎ 一致 / ○ 許容 / × 不一致)。「制約での見積もり」は修正後のチェッカーで、問題文の制約と実行時間制限から
出した目安(ok 余裕 / tight 厳しい / TLE / — 値の無い記号があり出ない)。

| 問題 | 言語 | 解説の計算量 | 正解(コードの変数で) | 修正前 | 修正後 | 制約での見積もり | メモ |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [ABC459 A](https://atcoder.jp/contests/abc459/editorial/20921) | Python | — | O(10) | O(10) ◎ | O(10) ◎ | ok | 10 文字の固定ループ |
| [ABC459 A](https://atcoder.jp/contests/abc459/editorial/20921) | C++ | — | O(1) | O(1) ◎ | O(1) ◎ | ok |  |
| [ABC459 B](https://atcoder.jp/contests/abc459/editorial/20977) | C++ | — | O(N) | O(N) ◎ | O(N) ◎ | ok |  |
| [ABC459 B](https://atcoder.jp/contests/abc459/editorial/20977) | C++ | — | O(N + 27) | O(N + 27) ◎ | O(N + 27) ◎ | ok | 表を作る 9×3 回の固定ループ(係数 10 以上の定数項は残す規則) |
| [ABC459 B](https://atcoder.jp/contests/abc459/editorial/20977) | Python | — | O(N) | O(N) ◎ | O(N) ◎ | ok |  |
| [ABC459 C](https://atcoder.jp/contests/abc459/editorial/20978) | C++ | O(N + Q) | O(Q + 3×10^5) | O(Q + 3×10^5) ◎ | O(Q + 3×10^5) ◎ | ok | 配列を上限 3×10^5 で確保している(解説の N にあたる) |
| [ABC459 D](https://atcoder.jp/contests/abc459/editorial/20973) | Python | O(σ\|S\|) | O(26·Σ\|S\|) | O(26·T·N) ○ | O(26·T·N) ○ | tight | マルチテストの総和制約(ΣN ≤ …)は見ず、1ケースあたりの N と T の積で出す(既知の限界。範囲指定で T = 1、N = 総和の上限にすると見積もれる)。while True は \|S\| 回で、推定できず N(主記号)になる |
| [ABC459 E](https://atcoder.jp/contests/abc459/editorial/20979) | C++ | O(N + ΣD) | O(N + ΣD) | O(N·sz + N·max(d)) × | O(N + 2×10^5·max(d)) ○ | — | int sz = e[k].size(); for (i < sz) dfs(e[k][i]) を隣接リストを添字で回す DFS と認識する(以前は再帰の引数を解釈できず N 回の呼び出しとみなし、記号 sz が残った)。頂点数は配列の大きさ 2×10^5(マクロ N)。各頂点の d[k] 回のループは ΣD ≤ 10^6 の総和制約を見ないので max(d) の記号(既知の限界) |
| [ABC459 F](https://atcoder.jp/contests/abc459/editorial/20507) | Python | O(N) | O(ΣN) | O(T²·N·len) × | O(T·N·len) ○ | — | マルチテストの総和制約(ΣN ≤ …)は見ず、1ケースあたりの N と T の積で出す(既知の限界。範囲指定で T = 1、N = 総和の上限にすると見積もれる)。テストケースごとに作り直す d の大きさは1ケース分。for i in range(len) の len は d の要素(タプル)の値で、Σlen = N は分からず記号になる(要素の値で回すループの既知の限界) |
| [ABC460 A](https://atcoder.jp/contests/abc460/editorial/21025) | C++ | — | O(log M) | O(log M) ◎ | O(log M) ◎ | ok | 互除法 |
| [ABC460 B](https://atcoder.jp/contests/abc460/editorial/21008) | C++ | — | O(T) | O(T) ◎ | O(T) ◎ | ok |  |
| [ABC460 C](https://atcoder.jp/contests/abc460/editorial/21026) | C++ | O(N log N + M log M) | O(N log N + M log M) | O(N log N + M log M) ◎ | O(N log N + M log M) ◎ | ok |  |
| [ABC460 D](https://atcoder.jp/contests/abc460/editorial/21027) | C++ | O(HW) | O(N·M) | O(N·M) ◎ | O(N·M) ◎ | ok | コードでは H, W を n, m で読む(H×W ≤ 10^6) |
| [ABC460 E](https://atcoder.jp/contests/abc460/editorial/21009) | C++ | — | O(19·T log M) | O(19·T log M) ◎ | O(19·T log M) ◎ | ok | 桁数 19 の固定ループ × gcd |
| [ABC461 A](https://atcoder.jp/contests/abc461/editorial/21021) | Python | — | O(1) | O(1) ◎ | O(1) ◎ | ok |  |
| [ABC461 A](https://atcoder.jp/contests/abc461/editorial/21021) | Python | — | O(1) | O(1) ◎ | O(1) ◎ | ok |  |
| [ABC461 A](https://atcoder.jp/contests/abc461/editorial/21021) | Python | — | O(1) | O(1) ◎ | O(1) ◎ | ok |  |
| [ABC461 A](https://atcoder.jp/contests/abc461/editorial/21021) | Python | — | O(1) | O(1) ◎ | O(1) ◎ | ok |  |
| [ABC461 A](https://atcoder.jp/contests/abc461/editorial/21021) | C++ | — | O(1) | O(1) ◎ | O(1) ◎ | ok |  |
| [ABC461 A](https://atcoder.jp/contests/abc461/editorial/21021) | C++ | — | O(1) | O(1) ◎ | O(1) ◎ | ok |  |
| [ABC461 C](https://atcoder.jp/contests/abc461/editorial/21020) | Python | O(N log N) | O(N log N + K + M) | O(N·\|r\| log \|r\| + N log N + \|tail\| log \|tail\| + K + M) × | O(N log N + K + M) ◎ | ok | バケツ t の各 r を回してソートしても、\|r\| の総和は追加の総数 N(以前は N·\|r\| log \|r\|)。tail += r[1:] でも \|r\| の総和だけ大きくなる |
| [ABC461 D](https://atcoder.jp/contests/abc461/editorial/20145) | C++ | O(H²W) | O(H²·W) | O(H²·N² + H²·W) × | O(H²·W) ◎ | tight | 関数の中の n = a.size() を呼び出し側の長さ(W)に置き換え、r1 = max(r1, l+1) は振り出しに戻さない(尺取りの償却) |
| [ABC461 E](https://atcoder.jp/contests/abc461/editorial/21023) | Python | O(Q log Q + N) | O(Q log Q + N) | O(Q²) × | O(Q log Q + N) ◎ | ok | FenwickTree のリストの要素の .sum を Python の sum(O(Q))と取り違えて TLE 判定だった。ACL のクラスとして log Q で数える |
| [ABC462 A](https://atcoder.jp/contests/abc462/editorial/21397) | Python | — | O(\|s\|) | O(\|s\|) ◎ | O(\|s\|) ◎ | ok |  |
| [ABC462 A](https://atcoder.jp/contests/abc462/editorial/21397) | Python | — | O(\|S\|) | O(1) ○ | O(1) ○ | ok | 入力の文字列をその場で filter する処理は読み取りとして数えない(入力を読む時間以下) |
| [ABC462 B](https://atcoder.jp/contests/abc462/editorial/21457) | Python | — | O(N·\|a\|) | O(N²·\|a\|) × | O(N·\|a\|) ◎ | — | for i in range(n) の中の ans[i] の大きさは、ループ全体で追加の総数(N·\|a\|)。読んだ行のスライス [1:] は読み取りの一部。\|a\| は各行の個数 K_i(≤ N - 1)で記号のまま |
| [ABC462 C](https://atcoder.jp/contests/abc462/editorial/21406) | Python | O(N log N) | O(N log N) | O(N log N) ◎ | O(N log N) ◎ | ok |  |
| [ABC462 D](https://atcoder.jp/contests/abc462/editorial/21022) | Python | O(N + M) | O(N + 10^6) | O(N + 10^6) ◎ | O(N + 10^6) ◎ | ok | M = 10^6 を定数で持つ |
| [ABC462 E](https://atcoder.jp/contests/abc462/editorial/21400) | Python | O(1)/ケース | O(T) | O(T) ◎ | O(T) ◎ | ok |  |
| [ABC462 F](https://atcoder.jp/contests/abc462/editorial/16164) | C++ | O(NK) | O(K·Σ\|S\|) | O(T·K·N) ○ | O(T·K·N) ○ | ok | マルチテストの総和制約(ΣN ≤ …)は見ず、1ケースあたりの N と T の積で出す(既知の限界。範囲指定で T = 1、N = 総和の上限にすると見積もれる) |
| [ABC463 A](https://atcoder.jp/contests/abc463/editorial/21926) | Python | — | O(1) | O(1) ◎ | O(1) ◎ | ok |  |
| [ABC463 B](https://atcoder.jp/contests/abc463/editorial/21927) | Python | — | O(N) | O(N) ◎ | O(N) ◎ | ok |  |
| [ABC463 B](https://atcoder.jp/contests/abc463/editorial/21927) | C++ | — | O(N) | O(N) ◎ | O(N) ◎ | ok |  |
| [ABC463 C](https://atcoder.jp/contests/abc463/editorial/21941) | C++ | O(N + Q log N) | O(Q log N + N) | O(Q log N + N) ◎ | O(Q log N + N) ◎ | ok |  |
| [ABC463 D](https://atcoder.jp/contests/abc463/editorial/21942) | C++ | — | O(N log N + 30·N) | O(N log N) × | O(N log N + 30·N) ◎ | ok | ranges::partition_point(views::iota(0, 10^9), f) は log(10^9) ≒ 30 回 f を呼ぶ。以前は f の O(N) を数えず O(N log N)(過小) |
| [ABC463 E](https://atcoder.jp/contests/abc463/editorial/21940) | C++ | — | O(N log M + N log N + M log N + M log M) | O(N·M log N + N·M log M + N² log N + N² log M) × | O(N log M + N log N + M log N + M log M) ◎ | ok | (N + M) log(N + M) を展開した形。const auto [dist, now]{pq.top()} の構造化束縛(波括弧の初期化)を取り出した頂点と認識できず、edges[now] を毎回全体の辺数と数えて TLE 判定だった。1回目の走査で辺の数を仮に M と置いていたので、キューの大きさを入力の M と取り違えていた |
| [ABC463 F](https://atcoder.jp/contests/abc463/editorial/21939) | C++ | — | O(N) | O(N + \|rbegin(ifact)\| + \|views.iota(winner_min, …\| + \|views.iota(winner_min +…\|) × | O(N) ◎ | ok | inclusive_scan(rbegin(x), rend(x)) の長さと views::iota(a, b) の回数を読む(以前は記号 \|rbegin(ifact)\| などが出ていた) |
| [ABC464 A](https://atcoder.jp/contests/abc464/editorial/22254) | C++ | — | O(\|s\|) | O(\|s\|) ◎ | O(\|s\|) ◎ | ok |  |
| [ABC464 B](https://atcoder.jp/contests/abc464/editorial/22268) | Python | — | O(H·W) | O(H·W + D·\|C[]\|) × | O(H·W) ◎ | ok | u, d = min(u, i), max(d, i) で更新する d の上限は H(i の上限)。行のスライス C[i][l:r + 1] の長さは r + 1 ≤ W |
| [ABC464 B](https://atcoder.jp/contests/abc464/editorial/22268) | C++ | — | O(H·W) | O(H·W + D·R) × | O(H·W) ◎ | ok | d = max(d, i) / r = max(r, j) で更新する変数の上限は H / W |
| [ABC464 B](https://atcoder.jp/contests/abc464/editorial/22268) | Python | — | O(H² + H·\|C[]\|) | O(H² + H·\|C[]\| + \|*a[:]\|) × | O(H² + H·\|C[]\| + H·\|r\|) ○ | — | zip(*a[::-1]) の要素(列のタプル)r の長さは分からず記号 \|r\|(≒ H)。\|C[]\| は入力の行の長さ(W)。while not "#" in C[0] の回数は推定できず H(主記号) |
| [ABC464 B](https://atcoder.jp/contests/abc464/editorial/22268) | C++ | — | O(H·\|C[]\| + H² + H·W) | O(H·\|C[]\| + H² + H·W) ◎ | O(H·\|C[]\| + H² + H·W) ◎ | — | \|C[]\| は入力の行の長さ(W)。while (true) の理由が「キュー true」になる |
| [ABC464 C](https://atcoder.jp/contests/abc464/editorial/22255) | C++ | O(N + M) | O(N + M) | O(N + M) ◎ | O(N + M) ◎ | ok |  |
| [ABC464 D](https://atcoder.jp/contests/abc464/editorial/22256) | C++ | O(N) | O(ΣN) | O(T·N) ○ | O(T·N) ○ | ok | マルチテストの総和制約(ΣN ≤ …)は見ず、1ケースあたりの N と T の積で出す(既知の限界。範囲指定で T = 1、N = 総和の上限にすると見積もれる) |
| [ABC464 E](https://atcoder.jp/contests/abc464/editorial/22266) | Python | O(HW + Q) | O(H·W + Q) | O(H·W + Q) ◎ | O(H·W + Q) ◎ | ok | H×W ≤ 10^6 |
| [ABC464 F](https://atcoder.jp/contests/abc464/editorial/22267) | Python | O(N² 2^(N/2)) | O(N²·2^(N/2)) | O(\|trs\|·\|tls\|·\|tl\| log \|tr\| + \|trs\|·\|tr\| log \|tr\| + N²) × | O(N^4 + \|trs\|·\|tls\|·\|tl\| log \|tr\| + \|trs\|·\|tr\| log \|tr\|) × | — | 半分全列挙で r[k+1].extend(…) して作るリストの大きさ(2^(N/2))は、ループの中の extend の繰り返しから静的には求まらない(既知の限界)。記号が残るので判定は出ない |
| [ABC464 G](https://atcoder.jp/contests/abc464/editorial/22263) | C++ | O(N log N) | O(ΣN log ΣN) | O(T²·N + T·dl log T + T·dl log dl + T·N log dl) × | O(T·N log N) ○ | ok | マルチテストの総和制約(ΣN ≤ …)は見ず、1ケースあたりの N と T の積で出す(既知の限界。範囲指定で T = 1、N = 総和の上限にすると見積もれる)。ループの中で宣言した sam の大きさは1ケース分、dl = d.size() は d の大きさ |
| [ABC465 A](https://atcoder.jp/contests/abc465/editorial/22565) | Python | — | O(1) | O(1) ◎ | O(1) ◎ | ok |  |
| [ABC465 A](https://atcoder.jp/contests/abc465/editorial/22565) | C++ | — | O(1) | O(1) ◎ | O(1) ◎ | ok |  |
| [ABC465 A](https://atcoder.jp/contests/abc465/editorial/22565) | Python | — | O(1) | O(1) ◎ | O(1) ◎ | ok |  |
| [ABC465 A](https://atcoder.jp/contests/abc465/editorial/22565) | C++ | — | O(1) | O(1) ◎ | O(1) ◎ | ok |  |
| [ABC465 B](https://atcoder.jp/contests/abc465/editorial/22564) | C++ | — | O(B) | O(B) ◎ | O(B) ◎ | ok | B ≤ 23 |
| [ABC465 C](https://atcoder.jp/contests/abc465/editorial/22418) | Python | O(N) | O(N) | O(N + \|ans\|) × | O(N) ◎ | ok | ans = a[::-1] + b の長さは \|a\| + \|b\|(以前は記号 \|ans\|) |
| [ABC465 D](https://atcoder.jp/contests/abc465/editorial/22416) | Python | — | O(T log X) | O(T log X) ◎ | O(T log X) ◎ | ok |  |
| [ABC465 E](https://atcoder.jp/contests/abc465/editorial/22563) | C++ | O(2^D D log N) | O(2.8×10^4·\|s\|) | O(2.8×10^4·\|s\|) ◎ | O(2.8×10^4·\|s\|) ◎ | ok | 桁 DP。2^10·3·9 ≈ 2.8×10^4、log N は桁数 \|s\| ≤ 500 |
| [ABC465 F](https://atcoder.jp/contests/abc465/editorial/22562) | C++ | O(DN + B^D D + Q 2^D D) | O(N + 384·Q + 10^6) | O(N·Q + max(pow10)) × | O(N + 384·Q + max(pow10)) ○ | tight | for (bi = 0; !(bi >> 6); bi++) は 2^6 回(以前は推定できず N 回で N·Q)。pow10[BITLEN] は関数で作った表の値(10^6)で、要素の値の上限 max(pow10) の記号になる |
| [ABC466 A](https://atcoder.jp/contests/abc466/editorial/22625) | C++ | — | O(N) | O(N) ◎ | O(N) ◎ | ok |  |
| [ABC466 A](https://atcoder.jp/contests/abc466/editorial/22625) | Python | — | O(N) | O(N) ◎ | O(N) ◎ | ok |  |
| [ABC466 B](https://atcoder.jp/contests/abc466/editorial/22628) | C++ | — | O(N + M) | O(N + M) ◎ | O(N + M) ◎ | ok |  |
| [ABC466 C](https://atcoder.jp/contests/abc466/editorial/22627) | C++ | — | O(N) | O(N) ◎ | O(N) ◎ | ok | インタラクティブ。l, r を進めるだけ |
| [ABC466 D](https://atcoder.jp/contests/abc466/editorial/22608) | C++ | O(M) | O(M + 3×10^5) | O(M + 3×10^5) ◎ | O(M + 3×10^5) ◎ | ok | 配列を上限の定数で確保 |
| [ABC466 D](https://atcoder.jp/contests/abc466/editorial/22608) | C++ | O(M) | O(M + 3×10^5) | O(M + 3×10^5) ◎ | O(M + 3×10^5) ◎ | ok | 配列を上限の定数で確保 |
| [ABC466 F](https://atcoder.jp/contests/abc466/editorial/22630) | C++ | O(N log N log X) | O(ΣN log ΣN log X) | O(T·N² log N) × | O(T·N² log N) × | **TLE** | 取り出しては2つまで入れ直す while の回数は、値が毎回割られて小さくなる議論(log X)が要り、静的には推定できない。キューに入る回数を推定できないと警告して N 回とみなすので TLE と出る(既知の限界) |
| [ABC466 F](https://atcoder.jp/contests/abc466/editorial/22630) | Python | O(N log N log X) | O(ΣN log ΣN log X) | O(T·N log N + T·N log T) × | O(T·N² log N) × | **TLE** | C++ 版と同じ(既知の限界)。以前は heappush で入れ直すのを見ずにキューの要素数で償却していた(根拠の無い過小評価)ので、C++ 版と同じく警告つきで N 回とみなすようにした |
| [ABC466 G](https://atcoder.jp/contests/abc466/editorial/22603) | C++ | — | O(定数) | O(N·K·2^N + 2^K + 30·N² + N·M + 30·K·sz + 30·sz·sz2 + \|tmp[]\| + 64) × | O(N·K·2^N + 2^K + N·M + 30·K·sz + 30·sz·sz2 + 30·N + \|tmp[]\| + 64) ○ | — | N ≤ 8 / M ≤ 36 で全体が定数の問題。制約の数 k(大域変数を k++ で数える)や unordered_map の大きさ sz は記号のまま(推定できない値は記号で出す設計)。判定は出ない |
| [ABC467 A](https://atcoder.jp/contests/abc467/editorial/22699) | C++ | — | O(1) | O(1) ◎ | O(1) ◎ | ok |  |
| [ABC467 A](https://atcoder.jp/contests/abc467/editorial/22699) | Python | — | O(1) | O(1) ◎ | O(1) ◎ | ok |  |
| [ABC467 B](https://atcoder.jp/contests/abc467/editorial/23429) | C++ | — | O(N) | O(N) ◎ | O(N) ◎ | ok |  |
| [ABC467 D](https://atcoder.jp/contests/abc467/editorial/23431) | C++ | — | O(T log C) | O(T log C) ◎ | O(T log C) ◎ | ok | gcd の引数(座標から作る係数 c)の大きさの log |
| [ABC468 A](https://atcoder.jp/contests/abc468/editorial/23477) | Python | — | O(N) | O(N) ◎ | O(N) ◎ | ok |  |
| [ABC468 A](https://atcoder.jp/contests/abc468/editorial/23477) | C++ | — | O(N) | O(N) ◎ | O(N) ◎ | ok |  |
| [ABC468 B](https://atcoder.jp/contests/abc468/editorial/23735) | Python | — | O(M²) | O(M²) ◎ | O(M²) ◎ | ok |  |
| [ABC468 C](https://atcoder.jp/contests/abc468/editorial/23508) | C++ | — | O(N·N!) | O(N·N!) ◎ | O(N·N!) ◎ | ok | 全順列 |
| [ABC468 C](https://atcoder.jp/contests/abc468/editorial/23508) | Python | — | O(N·N!) | O(\|a\|·N!) × | O(N·N!) ◎ | tight | permutations の要素 a の長さは N |
| [ABC468 D](https://atcoder.jp/contests/abc468/editorial/23736) | Python | O(N²) | O(N²) | O(N²) ◎ | O(N²) ◎ | **TLE** | 式は一致。判定は、PyPy の速さの目安(3×10^7 回/秒、ループ本体を1回と数える)で N² = 10^8 回が予算を超えて TLE の恐れと出る(実際は AC。目安は保守的) |
| [ABC468 E](https://atcoder.jp/contests/abc468/editorial/23476) | Python | — | O(30·N) | O(30·N) ◎ | O(30·N) ◎ | ok | pow(i, MOD-2, MOD) は log MOD ≈ 30 |
| [ABC468 E](https://atcoder.jp/contests/abc468/editorial/23476) | Python | — | O(30·N) | O(30·N) ◎ | O(30·N) ◎ | ok | 同上 |
| [ABC468 F](https://atcoder.jp/contests/abc468/editorial/23738) | Python | O(N log N) | O(N log N) | O(input) × | O(N log N) ◎ | ok | input = sys.stdin.readline の input を入力の変数とみなして記号 input になっていた。atcoder.segtree の set / prod は log N |
| [ABC468 F](https://atcoder.jp/contests/abc468/editorial/23738) | Python | O(N log N) | O(N log N) | O(N log N) ◎ | O(N log N) ◎ | ok |  |
| [ABC468 G](https://atcoder.jp/contests/abc468/editorial/23741) | Python | O(N²) | O(N² + \|s\|) | O(N² + \|s\| + \|s.split("o")\|) × | O(N² + \|s\|) ◎ | ok | s.split("o") の要素数は \|s\| 以下 |
| [ABC469 A](https://atcoder.jp/contests/abc469/editorial/23757) | C++ | — | O(1) | O(1) ◎ | O(1) ◎ | ok |  |
| [ABC469 A](https://atcoder.jp/contests/abc469/editorial/23757) | Python | — | O(1) | O(1) ◎ | O(1) ◎ | ok |  |
| [ABC470 A](https://atcoder.jp/contests/abc470/editorial/23856) | Python | — | O(N) | O(N) ◎ | O(N) ◎ | ok |  |
| [ABC470 B](https://atcoder.jp/contests/abc470/editorial/23857) | Python | — | O(N) | O(N) ◎ | O(N) ◎ | ok |  |
| [ABC470 C](https://atcoder.jp/contests/abc470/editorial/23859) | Python | O(N + Q) | O(N + Q) | O(Q² + N) × | O(Q² + N) × | **TLE** | idxs = [v for v in idxs if a[v] != 0] でフィルタして作り直す形の償却は、要素の値 a[v] が減って 0 になると消えるという値の議論が要り、静的には分からない(既知の限界)。Q 回 × \|idxs\| で TLE と出る |
| [ABC470 D](https://atcoder.jp/contests/abc470/editorial/23875) | C++ | — | O(N + Q) | O(N + Q) ◎ | O(N + Q) ◎ | ok |  |
| [ABC470 F](https://atcoder.jp/contests/abc470/editorial/23854) | C++ | — | O(N + M) | O(N + M) ◎ | O(N + M) ◎ | ok | Union-Find(経路圧縮 + サイズ)。自作クラスのメソッドは解決されず O(1) 扱い |
| [ABC470 G](https://atcoder.jp/contests/abc470/editorial/23879) | C++ | O(N log N) | O(N log N) | O(N³ log N) × | O(N log N) ◎ | ok | ris = idxs[xi] の大きさは xi のループ全体で N(バケツの総和)。while (true) で毎回 slopes から erase する部分は、slopes に入った総数で償却。以前は O(N³ log N) で TLE 判定 |
| [ABC471 A](https://atcoder.jp/contests/abc471/editorial/24211) | Python | — | O(1) | O(1) ◎ | O(1) ◎ | ok |  |
| [ABC471 A](https://atcoder.jp/contests/abc471/editorial/24211) | C++ | — | O(1) | O(1) ◎ | O(1) ◎ | ok |  |
| [ABC471 B](https://atcoder.jp/contests/abc471/editorial/23913) | C++ | — | O(N·\|s[]\| + N log N) | O(N·\|s[]\| + N log N) ◎ | O(N·\|s[]\| + N log N) ◎ | ok | \|s[]\| は各文字列の長さ(≤ 10) |
| [ABC471 B](https://atcoder.jp/contests/abc471/editorial/23913) | Python | — | O(N) | O(N²) × | O(N) ◎ | ok | 読んだ行をそのまま lower() するのは読み取りの一部(以前は行の長さを入力の要素数 N とみなして N²) |
| [ABC471 C](https://atcoder.jp/contests/abc471/editorial/23911) | C++ | — | O(N log N) | O(N log N) ◎ | O(N log N) ◎ | ok |  |
| [ABC471 C](https://atcoder.jp/contests/abc471/editorial/23911) | Python | — | O(N log N) | O(N log N) ◎ | O(N log N) ◎ | ok |  |
| [ABC471 D](https://atcoder.jp/contests/abc471/editorial/24210) | C++ | O(Q log Q) | O(Q log Q) | O(Q log Q) ◎ | O(Q log Q) ◎ | ok |  |
| [ABC471 G](https://atcoder.jp/contests/abc471/editorial/24208) | C++ | O(N + K² log K) | O(K² log K + N) | O(K·\|p\| + K² + K·\|q\| + N) × | O(K² log K + N) ◎ | ok | atcoder::convolution は (\|a\| + \|b\|) log(\|a\| + \|b\|)。vector<ll> rarr[k] の要素は配列で、rarr[i].assign(k, 0) の大きさは K |
| [ABC472 A](https://atcoder.jp/contests/abc472/editorial/24786) | C++ | — | O(\|S\|) | O(\|S\|) ◎ | O(\|S\|) ◎ | ok |  |
| [ABC472 A](https://atcoder.jp/contests/abc472/editorial/24786) | Python | — | O(\|S\|) | O(\|S\|) ◎ | O(\|S\|) ◎ | ok |  |
| [ABC472 A](https://atcoder.jp/contests/abc472/editorial/24786) | C++ | — | O(\|S\|) | O(\|S\|) ◎ | O(\|S\|) ◎ | ok |  |
| [ABC472 A](https://atcoder.jp/contests/abc472/editorial/24786) | Python | — | O(\|S\|) | O(\|S\|) ◎ | O(\|S\|) ◎ | ok |  |
| [ABC472 B](https://atcoder.jp/contests/abc472/editorial/24787) | C++ | — | O(N²) | O(N²) ◎ | O(N²) ◎ | ok |  |
| [ABC472 B](https://atcoder.jp/contests/abc472/editorial/24787) | Python | — | O(N²) | O(N²) ◎ | O(N²) ◎ | ok |  |
| [ABC472 C](https://atcoder.jp/contests/abc472/editorial/24788) | C++ | — | O(N) | O(N) ◎ | O(N) ◎ | ok |  |
| [ABC472 C](https://atcoder.jp/contests/abc472/editorial/24788) | Python | — | O(N) | O(N) ◎ | O(N) ◎ | ok |  |
| [ABC472 D](https://atcoder.jp/contests/abc472/editorial/24427) | Python | — | O(H·W) | O(H·W) ◎ | O(H·W) ◎ | ok | H×W ≤ 5×10^5 |
| [ABC472 E](https://atcoder.jp/contests/abc472/editorial/24429) | Python | — | O(ΣN + ΣM) | O(T²·N·M² + T·M·\|ans\|) × | O(T·N + T·M) ○ | ok | マルチテストの総和制約(ΣN ≤ …)は見ず、1ケースあたりの N と T の積で出す(既知の限界。範囲指定で T = 1、N = 総和の上限にすると見積もれる)。奇閉路を見つけたら経路を復元して return する分岐は1度だけ。a, b = [], [] はその場で作るリスト、ans = a + [w] + b[::-1] の長さは長さの和 |
| [ABC472 G](https://atcoder.jp/contests/abc472/editorial/24419) | Python | — | O(H²·W²) | O(H·W) × | O(H²·W²) ◎ | ok | atcoder.maxflow の flow は頂点数の2乗の粗い見積もり(最悪 O(V²E) と警告を出す)。以前は未知の関数で O(1) だった(過小) |
| [ABC473 A](https://atcoder.jp/contests/abc473/editorial/24870) | C++ | — | O(N) | O(N) ◎ | O(N) ◎ | ok |  |
| [ABC473 B](https://atcoder.jp/contests/abc473/editorial/24874) | C++ | — | O(N²) | O(N³) × | O(N²) ◎ | ok | 見つけたら erase して break する分岐はループの1回の実行で1度しか通らない(以前は erase の O(N) をループの回数だけ掛けて N³) |
| [ABC473 B](https://atcoder.jp/contests/abc473/editorial/24874) | Python | — | O(N²) | O(N²) ◎ | O(N²) ◎ | ok |  |
| [ABC473 B](https://atcoder.jp/contests/abc473/editorial/24874) | C++ | — | O(N + 101) | O(N + 101) ◎ | O(N + 101) ◎ | ok |  |
| [ABC473 B](https://atcoder.jp/contests/abc473/editorial/24874) | Python | — | O(N + 101) | O(N + 101) ◎ | O(N + 101) ◎ | ok |  |
| [ABC473 C](https://atcoder.jp/contests/abc473/editorial/24875) | C++ | O(N) | O(N + K) | O(N + K) ◎ | O(N + K) ◎ | ok | K ≤ N |
| [ABC473 C](https://atcoder.jp/contests/abc473/editorial/24875) | Python | O(N) | O(N + K) | O(N + K) ◎ | O(N + K) ◎ | ok | K ≤ N |
| [ABC473 D](https://atcoder.jp/contests/abc473/editorial/24887) | Python | O(N³ f(N,K)) | O(N³·f) | O(K·4^N + I·2^N) × | O(K·4^N + I·2^N) × | — | 出力の個数 f(N,K)(≤ 3×10^5)に比例する列挙で、静的には分からない(既知の限界)。指数時間の再帰と警告する |
| [ABC473 D](https://atcoder.jp/contests/abc473/editorial/24887) | Python | O(N³ f(N,K)) | O(N³·f) | O(K·4^N + I·2^N) × | O(K·4^N + I·2^N) × | — | 出力の個数 f(N,K)(≤ 3×10^5)に比例する列挙で、静的には分からない(既知の限界)。指数時間の再帰と警告する |
| [ABC473 D](https://atcoder.jp/contests/abc473/editorial/24887) | C++ | O(N² f(N,K)) | O(N²·f) | O(N + K) × | O(N·2^N + K·2^N) × | **TLE** | 出力の個数 f(N,K)(≤ 3×10^5)に比例する列挙で、静的には分からない(既知の限界)。[…](this auto self, …){ … self(…) … }(0, 0, path) のその場で呼ぶ再帰ラムダを見落として O(N + K)(過小)だったのを、ほかの言語と同じく指数時間の再帰(警告つき)と数えるようにした |
| [ABC473 D](https://atcoder.jp/contests/abc473/editorial/24887) | Python | O(N² f(N,K)) | O(N²·f) | O(K·4^N) × | O(K·4^N) × | **TLE** | 出力の個数 f(N,K)(≤ 3×10^5)に比例する列挙で、静的には分からない(既知の限界)。指数時間の再帰と警告し、TLE と出る |
| [ABC473 E](https://atcoder.jp/contests/abc473/editorial/24877) | C++ | — | O(N log N) | O(\|const\| log \|const\|) × | O(N log N) ◎ | ok | 初期化文つきの範囲 for(for (init; x : …))を読む。views::istream<unsigned>(cin) は入力の要素数 N |
| [ABC473 F](https://atcoder.jp/contests/abc473/editorial/24871) | C++ | O(N + Q log N) | O(Q log N + N) | O(Q log N + N) ◎ | O(Q log N + N) ◎ | ok |  |
| [ABC473 G](https://atcoder.jp/contests/abc473/editorial/24872) | C++ | O(N log² N) | O(N log² N) | O(N) × | O(N·\|l\| log \|l\| + N·\|l\| log \|r\| + N·\|r\| log \|l\| + N·\|r\| log \|r\|) ○ | — | atcoder::convolution を数えるようにした(以前は O(N) で過小)。キューから取り出す多項式 l, r の大きさは追えず記号のまま(推定できない) |
| [ABC474 A](https://atcoder.jp/contests/abc474/editorial/25429) | Python | — | O(1) | O(1) ◎ | O(1) ◎ | ok |  |
| [ABC474 B](https://atcoder.jp/contests/abc474/editorial/25370) | C++ | — | O(N) | O(N) ◎ | O(N) ◎ | ok |  |
| [ABC474 B](https://atcoder.jp/contests/abc474/editorial/25370) | Python | — | O(N) | O(N) ◎ | O(N) ◎ | ok |  |
| [ABC474 E](https://atcoder.jp/contests/abc474/editorial/25442) | Python | — | O(ΣN log ΣN) | O(T²·N log N + T²·N log T) × | O(T·N log N) ○ | ok | マルチテストの総和制約(ΣN ≤ …)は見ず、1ケースあたりの N と T の積で出す(既知の限界。範囲指定で T = 1、N = 総和の上限にすると見積もれる)。テストケースごとに作り直す diff の大きさは1ケース分 |
| [ABC474 G](https://atcoder.jp/contests/abc474/editorial/25439) | Python | — | O(ΣN²) | O(T·N·\|t\|) × | O(T·N²) ○ | ok | マルチテストの総和制約(ΣN ≤ …)は見ず、1ケースあたりの N と T の積で出す(既知の限界。範囲指定で T = 1、N = 総和の上限にすると見積もれる)(ΣN² ≤ 10^6)。t = [… for i in range(m)] の長さは M(≒ N/2) |
| [ABC475 A](https://atcoder.jp/contests/abc475/editorial/25489) | C++ | — | O(N) | O(N) ◎ | O(N) ◎ | ok | n = s.size() |
| [ABC475 A](https://atcoder.jp/contests/abc475/editorial/25489) | Python | — | O(\|S\|) | O(1) × | O(\|S\|) ◎ | ok | "o".join(S) は S の長さ(以前は区切りの長さで O(1)、過小) |
| [ABC475 B](https://atcoder.jp/contests/abc475/editorial/25491) | C++ | — | O(N) | O(N) ◎ | O(N) ◎ | ok |  |
| [ABC475 B](https://atcoder.jp/contests/abc475/editorial/25491) | Python | — | O(N) | O(N) ◎ | O(N) ◎ | ok |  |
| [ABC475 C](https://atcoder.jp/contests/abc475/editorial/25534) | C++ | O(N²) | O(N·S) | O(N·S) ◎ | O(N·S) ◎ | tight | S ≤ N |
| [ABC476 A](https://atcoder.jp/contests/abc476/editorial/25811) | Python | — | O(1) | O(1) ◎ | O(1) ◎ | ok |  |
| [ABC476 A](https://atcoder.jp/contests/abc476/editorial/25811) | C++ | — | O(1) | O(1) ◎ | O(1) ◎ | ok |  |
| [ABC476 B](https://atcoder.jp/contests/abc476/editorial/25803) | C++ | — | O(N) | O(N) ◎ | O(N) ◎ | ok |  |
| [ABC476 B](https://atcoder.jp/contests/abc476/editorial/25803) | Python | — | O(N) | O(\|T\|·\|s\|) ○ | O(\|T\|·\|s\|) ○ | ok | zip(S, T) の各文字 s の長さが 1 と分からず記号 \|s\| になる |
| [ABC476 C](https://atcoder.jp/contests/abc476/editorial/25794) | Python | — | O(N) | O(N) ◎ | O(N) ◎ | ok | 大きさ 4 までのリストを毎回ソート |
| [ABC476 D](https://atcoder.jp/contests/abc476/editorial/25809) | C++ | O((N+M) log (N+M)) | O(N log N + M log M) | O(N log N + M log N + sz log sz) × | O(N log N + M log N) ○ | ok | 関数 accum の中の局所変数 b と大域の b を同じ変数とみなすので sort(b) が M log N になる(同名の変数を区別しない既知の限界) |
| [ABC476 E](https://atcoder.jp/contests/abc476/editorial/25802) | C++ | O(N + M log N) | O(M log N + N) | O(M log N + N) ◎ | O(M log N + N) ◎ | ok |  |
| [ABC476 F](https://atcoder.jp/contests/abc476/editorial/25806) | C++ | — | O(N²) | O(N² + nn²) × | O(N²) ◎ | ok | const ll nn = 3*n+1(宣言と初期化)の nn は 3N |
| [ABC476 G](https://atcoder.jp/contests/abc476/editorial/25751) | Python | O(log² R) | O(T log² R) | O(T·R·C + 60·T·R + 62·T + 3844) × | O(T·R·C + 60·T·R + 62·T + 3844) × | — | l += x(x は l の下位ビットと r - l 以下の最大の 2 冪の小さいほう)で進む while は log R 回だが、刻みが変数なので静的には分からず R 回とみなす(既知の限界)。c = x.bit_length() - 1 も記号のまま |
| [ABC477 A](https://atcoder.jp/contests/abc477/editorial/26404) | C++ | — | O(1) | O(1) ◎ | O(1) ◎ | ok |  |
| [ABC477 A](https://atcoder.jp/contests/abc477/editorial/26404) | C++ | — | O(1) | O(1) ◎ | O(1) ◎ | ok |  |
| [ABC477 A](https://atcoder.jp/contests/abc477/editorial/26404) | Python | — | O(1) | O(1) ◎ | O(1) ◎ | ok |  |
| [ABC477 B](https://atcoder.jp/contests/abc477/editorial/26405) | C++ | — | O(N²) | O(N²) ◎ | O(N²) ◎ | ok |  |
| [ABC477 B](https://atcoder.jp/contests/abc477/editorial/26405) | Python | — | O(N²) | O(N²) ◎ | O(N²) ◎ | ok |  |
| [ABC477 D](https://atcoder.jp/contests/abc477/editorial/25849) | Python | O(N + Q) | O(N + Q) | O(N + Q) ◎ | O(N + Q) ◎ | ok | 709a643 で直した形 |
| [ABC477 F](https://atcoder.jp/contests/abc477/editorial/26406) | Python | — | O(N log M + Q log M + M) | O(N·\|seg\| + Q) × | O(N log M + Q log M + M) ◎ | ok | atcoder.lazysegtree の apply / prod は log M(大きさは最後の引数 [(0, 1)] * m の要素数) |
| [ABC477 G](https://atcoder.jp/contests/abc477/editorial/25886) | Python | — | O(N + M) | O(1) × | O(N + M) ◎ | — | 関数の断片(dfs を呼ぶ処理が無い)。トップレベルが初期化だけなので関数を入口として評価する(以前は O(1))。g が未定義なので辺の数は記号 M |
| [ABC478 A](https://atcoder.jp/contests/abc478/editorial/26498) | Python | — | O(N + M) | O(N + M) ◎ | O(N + M) ◎ | ok |  |
| [ABC478 A](https://atcoder.jp/contests/abc478/editorial/26498) | Python | — | O(N) | O(N) ◎ | O(N) ◎ | ok |  |
| [ABC478 B](https://atcoder.jp/contests/abc478/editorial/26499) | Python | — | O(N³) | O(N³) ◎ | O(N³) ◎ | ok |  |
| [ABC478 B](https://atcoder.jp/contests/abc478/editorial/26499) | Python | — | O(N·V + N²) | O(N·V + N²) ◎ | O(N·V + N²) ◎ | ok | V ≤ 3N - 3 |
| [ABC478 C](https://atcoder.jp/contests/abc478/editorial/26536) | C++ | O(N) | O(N) | O(N) ◎ | O(N) ◎ | ok |  |
| [ABC478 D](https://atcoder.jp/contests/abc478/editorial/26537) | C++ | — | O(Q log Q + N) | O(Q log Q + T) ○ | O(Q log Q + T) ○ | ok | while (t != now) ++now の t はイベントの時刻(≤ N)。値の上限は分からず記号 T |
| [ABC478 E](https://atcoder.jp/contests/abc478/editorial/26539) | C++ | O(N + Q) | O(N + Q) | O(\|scc.scc()\|·\|component\| + N + Q + \|const\|) × | O(N + Q) ◎ | ok | scc() の成分の大きさの総和は頂点数 N。初期化文つきの範囲 for(for (string delim{}; a : ans))を読む |
| [ABC478 F](https://atcoder.jp/contests/abc478/editorial/26540) | C++ | O(N) | O(N) | O(N²) × | O(N) ◎ | ok | p = i - 1 から prev_greater[p] をたどり、たどり終えた p を prev_greater[i] に入れる連結スタックは、全体で N 回(償却)。unsigned p{i - 1} が宣言として読めず、毎回 N 回と数えて N² で TLE 判定だった |
