// ゴールデンテスト: 主要11言語のスニペット → 期待する計算量(docs/complexity-analyzer-plan.md §10)
import { test } from "node:test";
import { check } from "./helpers.ts";
import type { Golden } from "./helpers.ts";

const CASES: Golden[] = [
  {
    id: "1 ループ1本",
    lang: "cpp",
    code: `
      #include <bits/stdc++.h>
      using namespace std;
      int main() {
          int n; cin >> n;
          for (int i = 0; i < n; i++) cout << i << endl;
      }`,
    time: "O(N)",
    space: "O(1)",
    noWarn: true,
    conf: "high",
  },
  {
    id: "2 二重ループ N·M",
    lang: "cpp",
    code: `
      int main() {
          int n, m; cin >> n >> m;
          long long s = 0;
          for (int i = 0; i < n; i++)
              for (int j = 0; j < m; j++) s += i ^ j;
          cout << s << endl;
      }`,
    time: "O(N·M)",
    space: "O(1)",
  },
  {
    id: "3 同じ変数の二重ループ",
    lang: "python",
    code: `
      n = int(input())
      c = 0
      for i in range(n):
          for j in range(n):
              c += 1
      print(c)`,
    time: "O(N²)",
    space: "O(1)",
  },
  {
    id: "4 外側がリテラル",
    lang: "cpp",
    code: `
      int main() {
          int n; cin >> n;
          for (int i = 0; i < 1000; i++)
              for (int j = 0; j < n; j++) cnt++;
      }`,
    time: "O(1000·N)",
  },
  {
    id: "5 内側がリテラル",
    lang: "python",
    code: `
      n = int(input())
      for i in range(n):
          for j in range(1000):
              pass`,
    time: "O(1000·N)",
  },
  {
    id: "6 小さい定数の項は消える",
    lang: "cpp",
    code: `
      int main() {
          int n; cin >> n;
          for (int k = 0; k < 5; k++) cout << k;
          for (int i = 0; i < n; i++) cout << i;
      }`,
    time: "O(N)",
  },
  {
    id: "7 10以上の係数は残る",
    lang: "cpp",
    code: `
      int main() {
          int n, m; cin >> n >> m;
          for (int i = 0; i < n; i++) for (int j = 0; j < 1000; j++) x++;
          for (int i = 0; i < n; i++) for (int j = 0; j < m; j++) x++;
      }`,
    time: "O(N·M + 1000·N)",
  },
  {
    id: "8 #define rep",
    lang: "cpp",
    code: `
      #include <bits/stdc++.h>
      #define rep(i, n) for (int i = 0; i < (int)(n); i++)
      using namespace std;
      int main() {
          int n, m; cin >> n >> m;
          rep(i, n) rep(j, m) cout << i * j;
      }`,
    time: "O(N·M)",
    noWarn: true,
  },
  {
    id: "9 定義の無い rep",
    lang: "cpp",
    code: `
      int main() {
          int n; cin >> n;
          rep(i, n) rep(j, n) ans += i * j;
      }`,
    time: "O(N²)",
    warn: /rep の定義が見当たらない/,
  },
  {
    id: "10 sort + lower_bound",
    lang: "cpp",
    code: `
      #define all(x) (x).begin(), (x).end()
      int main() {
          int n; cin >> n;
          vector<int> a(n);
          for (auto &x : a) cin >> x;
          sort(all(a));
          for (int i = 0; i < n; i++) {
              int k = lower_bound(all(a), a[i] * 2) - a.begin();
              ans += k;
          }
      }`,
    time: "O(N log N)",
    space: "O(N)",
  },
  {
    id: "11 三角ループ",
    lang: "cpp",
    code: `
      int main() {
          int n; cin >> n;
          for (int i = 0; i < n; i++)
              for (int j = i + 1; j < n; j++) ans++;
      }`,
    time: "O(N²)",
  },
  {
    id: "12 エラトステネスの篩",
    lang: "cpp",
    code: `
      int main() {
          int n; cin >> n;
          vector<bool> np(n + 1);
          for (int i = 2; i * i <= n; i++)
              if (!np[i])
                  for (int j = i * i; j <= n; j += i) np[j] = true;
      }`,
    time: "O(N log N)",
    space: "O(N)",
    warn: /N log log N/,
  },
  {
    id: "13 上限 n/i の調和級数",
    lang: "cpp",
    code: `
      int main() {
          int n; cin >> n;
          for (int i = 1; i <= n; i++)
              for (int j = 1; j <= n / i; j++) ans++;
      }`,
    time: "O(N log N)",
    space: "O(1)",
  },
  {
    id: "14 Python の刻み i の調和級数",
    lang: "python",
    code: `
      n = int(input())
      cnt = [0] * (n + 1)
      for i in range(1, n + 1):
          for j in range(i, n + 1, i):
              cnt[j] += 1`,
    time: "O(N log N)",
    space: "O(N)",
  },
  {
    id: "15 倍々",
    lang: "python",
    code: `
      n = int(input())
      i = 1
      while i < n:
          i *= 2`,
    time: "O(log N)",
  },
  {
    id: "16 平方根まで",
    lang: "cpp",
    code: `
      int main() {
          long long n; cin >> n;
          for (long long i = 1; i * i <= n; i++) if (n % i == 0) ans++;
      }`,
    time: "O(√N)",
  },
  {
    id: "17 log(N·M)",
    lang: "cpp",
    code: `
      int main() {
          int n, m; cin >> n >> m;
          for (int k = 1; k < n * m; k *= 2) ans++;
      }`,
    time: "O(log N + log M)",
  },
  {
    id: "18 答えの二分探索(上限 1e18)",
    lang: "cpp",
    code: `
      int n; vector<long long> a;
      bool ok(long long x) {
          long long s = 0;
          for (int i = 0; i < n; i++) s += x / a[i];
          return s >= 100;
      }
      int main() {
          cin >> n; a.resize(n);
          long long lo = 0, hi = 1e18;
          while (hi - lo > 1) {
              long long mid = (lo + hi) / 2;
              if (ok(mid)) hi = mid; else lo = mid;
          }
          cout << hi << endl;
      }`,
    time: "O(60·N)",
  },
  {
    id: "19 二分探索",
    lang: "cpp",
    code: `
      int main() {
          int n; cin >> n;
          int l = 0, r = n;
          while (l < r) {
              int mid = (l + r) / 2;
              if (mid * mid < n) l = mid + 1; else r = mid;
          }
      }`,
    time: "O(log N)",
  },
  {
    id: "20 尺取り(Python)",
    lang: "python",
    code: `
      n, k = map(int, input().split())
      a = list(map(int, input().split()))
      r = 0
      s = 0
      ans = 0
      for l in range(n):
          while r < n and s + a[r] <= k:
              s += a[r]
              r += 1
          ans += r - l
          if r == l:
              r += 1
          else:
              s -= a[l]`,
    time: "O(N)",
    space: "O(N)",
  },
  {
    id: "21 尺取り(for の初期化で宣言)",
    lang: "cpp",
    code: `
      int main() {
          int n; cin >> n;
          vector<int> a(n);
          for (int l = 0, r = 0; l < n; l++) {
              while (r < n && a[r] - a[l] <= 10) r++;
              ans += r - l;
          }
      }`,
    time: "O(N)",
  },
  {
    id: "22 毎回振り出しに戻すと N²",
    lang: "cpp",
    code: `
      int main() {
          int n; cin >> n;
          vector<int> a(n);
          for (int l = 0; l < n; l++) {
              int r = l;
              while (r < n && a[r] - a[l] <= 10) r++;
              ans += r - l;
          }
      }`,
    time: "O(N²)",
  },
  {
    id: "23 単調スタック",
    lang: "cpp",
    code: `
      int main() {
          int n; cin >> n;
          vector<int> a(n);
          stack<int> st;
          for (int i = 0; i < n; i++) {
              while (!st.empty() && a[st.top()] < a[i]) st.pop();
              st.push(i);
          }
      }`,
    time: "O(N)",
    space: "O(N)",
  },
  {
    id: "24 条件の分からない while",
    lang: "cpp",
    code: `
      int main() {
          int n; cin >> n;
          int x = n;
          while (check(x)) x = next_value(x);
      }`,
    time: "O(N)",
    warn: /while の反復回数を推定できません/,
    conf: "low",
  },
  {
    id: "25 break があっても最悪は変わらない",
    lang: "cpp",
    code: `
      int main() {
          int n; cin >> n;
          for (int i = 0; i < n; i++) {
              for (int j = 0; j < n; j++) {
                  if (i + j > 100) break;
              }
          }
      }`,
    time: "O(N²)",
  },
  {
    id: "26 逐次のループは和",
    lang: "python",
    code: `
      n, m = map(int, input().split())
      for i in range(n):
          print(i)
      for j in range(m):
          print(j)`,
    time: "O(N + M)",
  },
  {
    id: "27 呼ばれない関数は数えない",
    lang: "python",
    code: `
      def solve(n):
          for i in range(n):
              for j in range(n):
                  pass

      n = int(input())
      for i in range(n):
          print(i)`,
    time: "O(N)",
    warn: /使われていない関数 1 個/,
  },
  {
    id: "28 main の無い関数だけ",
    lang: "cpp",
    code: `
      int solve(vector<int>& a) {
          int c = 0;
          for (int i = 0; i < (int)a.size(); i++)
              for (int j = 0; j < (int)a.size(); j++)
                  if (a[i] < a[j]) c++;
          return c;
      }`,
    time: "O(|a|²)",
    warn: /main が無いので/,
  },
  {
    id: "29 コメントの中の for は数えない",
    lang: "cpp",
    code: `
      int main() {
          int n; cin >> n;
          // for (int i = 0; i < n * n; i++) {
          /* for (int j = 0; j < n; j++) */
          for (int i = 0; i < n; i++) ans++;
      }`,
    time: "O(N)",
  },
  {
    id: "30 文字列の中の for は数えない",
    lang: "python",
    code: `
      n = int(input())
      print("for i in range(n * n):")
      s = """
      for j in range(n):
      """
      for i in range(n):
          pass`,
    time: "O(N)",
  },
  {
    id: "31 桁区切りの定数",
    lang: "cpp",
    code: `
      const int MOD = 1'000'000'007;
      int main() {
          int n; cin >> n;
          for (int i = 0; i < n; i++) ans = ans * 2 % MOD;
      }`,
    time: "O(N)",
  },
  {
    id: "32 1ずつ減る再帰",
    lang: "cpp",
    code: `
      int f(int n) {
          if (n == 0) return 0;
          return f(n - 1) + 1;
      }
      int main() {
          int n; cin >> n;
          cout << f(n) << endl;
      }`,
    time: "O(N)",
    space: "O(N)",
  },
  {
    id: "33 素朴なフィボナッチ",
    lang: "python",
    code: `
      def fib(n):
          if n < 2:
              return n
          return fib(n - 1) + fib(n - 2)

      n = int(input())
      print(fib(n))`,
    time: "O(2^N)",
    space: "O(N)",
    warn: /指数時間/,
  },
  {
    id: "34 lru_cache のメモ化",
    lang: "python",
    code: `
      from functools import lru_cache
      import sys
      n, m = map(int, input().split())

      @lru_cache(maxsize=None)
      def rec(i, j):
          if i == n:
              return 0
          if j > m:
              return 0
          return max(rec(i + 1, j), rec(i, j + 1) + 1)

      print(rec(0, 0))`,
    time: "O(N·M)",
    space: "O(N·M)",
  },
  {
    id: "35 配列のメモ化",
    lang: "cpp",
    code: `
      int n, m;
      int dp[2005][2005];
      int rec(int i, int j) {
          if (i == n) return 0;
          if (j == m) return 0;
          if (dp[i][j] != -1) return dp[i][j];
          return dp[i][j] = max(rec(i + 1, j), rec(i + 1, j + 1) + 1);
      }
      int main() {
          cin >> n >> m;
          memset(dp, -1, sizeof(dp));
          cout << rec(0, 0) << endl;
      }`,
    time: "O(N·M + 4×10^6)",
    space: "O(N + M + 4×10^6)",
  },
  {
    id: "36 ~memo[i] の形のメモ化",
    lang: "cpp",
    code: `
      int n; vector<long long> memo;
      long long f(int i) {
          if (i >= n) return 0;
          if (~memo[i]) return memo[i];
          return memo[i] = max(f(i + 1), f(i + 2) + 1);
      }
      int main() {
          cin >> n;
          memo.assign(n, -1);
          cout << f(0) << endl;
      }`,
    time: "O(N)",
    space: "O(N)",
  },
  {
    id: "37 再帰の DFS",
    lang: "python",
    code: `
      import sys
      sys.setrecursionlimit(10 ** 6)
      n, m = map(int, input().split())
      g = [[] for _ in range(n)]
      for _ in range(m):
          a, b = map(int, input().split())
          g[a].append(b)
          g[b].append(a)
      seen = [False] * n

      def dfs(v):
          seen[v] = True
          for to in g[v]:
              if not seen[to]:
                  dfs(to)

      dfs(0)`,
    time: "O(N + M)",
    space: "O(N + M)",
  },
  {
    id: "38 ラムダの再帰(木)",
    lang: "cpp",
    code: `
      int main() {
          int n; cin >> n;
          vector<vector<int>> g(n);
          for (int i = 0; i < n - 1; i++) {
              int a, b; cin >> a >> b;
              g[a].push_back(b);
              g[b].push_back(a);
          }
          auto dfs = [&](auto&& self, int v, int p) -> void {
              for (int to : g[v]) if (to != p) self(self, to, v);
          };
          dfs(dfs, 0, -1);
      }`,
    time: "O(N)",
    space: "O(N)",
  },
  {
    id: "39 threading.Thread(target=main)",
    lang: "python",
    code: `
      import sys, threading

      def main():
          n, m = map(int, input().split())
          g = [[] for _ in range(n)]
          for _ in range(m):
              a, b = map(int, input().split())
              g[a].append(b)
          seen = [False] * n

          def dfs(v):
              seen[v] = True
              for to in g[v]:
                  if not seen[to]:
                      dfs(to)

          dfs(0)

      threading.stack_size(1 << 26)
      threading.Thread(target=main).start()`,
    time: "O(N + M)",
  },
  {
    id: "40 Union-Find(再帰の find)",
    lang: "cpp",
    code: `
      vector<int> par;
      int find(int x) { return par[x] == x ? x : par[x] = find(par[x]); }
      void unite(int a, int b) { a = find(a); b = find(b); if (a != b) par[a] = b; }
      int main() {
          int n, q; cin >> n >> q;
          par.resize(n);
          iota(par.begin(), par.end(), 0);
          for (int i = 0; i < q; i++) {
              int a, b; cin >> a >> b;
              unite(a, b);
          }
      }`,
    time: "O(Q log N + N)",
    space: "O(N)",
  },
  {
    id: "41 Union-Find(while で根をたどる)",
    lang: "cpp",
    code: `
      int main() {
          int n, q; cin >> n >> q;
          vector<int> par(n);
          for (int i = 0; i < n; i++) par[i] = i;
          for (int i = 0; i < q; i++) {
              int x; cin >> x;
              while (par[x] != x) x = par[x];
          }
      }`,
    time: "O(Q log N + N)",
    space: "O(N)",
  },
  {
    id: "42 マージソート",
    lang: "cpp",
    code: `
      vector<int> a, tmp;
      void msort(int l, int r) {
          if (r - l <= 1) return;
          int mid = (l + r) / 2;
          msort(l, mid);
          msort(mid, r);
          int i = l, j = mid, k = l;
          for (int t = l; t < r; t++) tmp[t] = a[t];
      }
      int main() {
          int n; cin >> n;
          a.resize(n); tmp.resize(n);
          msort(0, n);
      }`,
    time: "O(N log N)",
    space: "O(N)",
  },
  {
    id: "43 セグ木の区間クエリ",
    lang: "cpp",
    code: `
      int sz; vector<long long> d;
      long long query(int a, int b, int k, int l, int r) {
          if (r <= a || b <= l) return 0;
          if (a <= l && r <= b) return d[k];
          int m = (l + r) / 2;
          return query(a, b, 2 * k + 1, l, m) + query(a, b, 2 * k + 2, m, r);
      }
      int main() {
          int n, q; cin >> n >> q;
          d.assign(2 * n, 0);
          for (int i = 0; i < q; i++) {
              int l, r; cin >> l >> r;
              cout << query(l, r, 0, 0, n) << endl;
          }
      }`,
    time: "O(Q log N + N)",
    space: "O(N)",
  },
  {
    id: "44 2次元の DP 表",
    lang: "cpp",
    code: `
      int main() {
          int n, m; cin >> n >> m;
          vector<vector<long long>> dp(n + 1, vector<long long>(m + 1));
          for (int i = 0; i < n; i++)
              for (int j = 0; j < m; j++)
                  dp[i + 1][j + 1] = max(dp[i][j + 1], dp[i + 1][j]);
      }`,
    time: "O(N·M)",
    space: "O(N·M)",
  },
  {
    id: "45 set への挿入と検索",
    lang: "cpp",
    code: `
      int main() {
          int n, q; cin >> n >> q;
          set<int> s;
          for (int i = 0; i < n; i++) { int x; cin >> x; s.insert(x); }
          for (int i = 0; i < q; i++) { int x; cin >> x; cout << s.count(x) << endl; }
      }`,
    time: "O(N log N + Q log N)",
    space: "O(N)",
  },
  {
    id: "46 map の添字は挿入",
    lang: "cpp",
    code: `
      int main() {
          int n; cin >> n;
          vector<int> a(n);
          map<int, int> mp;
          for (int i = 0; i < n; i++) mp[a[i]]++;
      }`,
    time: "O(N log N)",
    space: "O(N)",
  },
  {
    id: "47 リストの in",
    lang: "python",
    code: `
      a = list(map(int, input().split()))
      q = int(input())
      for _ in range(q):
          x = int(input())
          if x in a:
              print("Yes")`,
    time: "O(Q·|a|)",
    space: "O(|a|)",
  },
  {
    id: "48 スライスの sum",
    lang: "python",
    code: `
      a = list(map(int, input().split()))
      q = int(input())
      for _ in range(q):
          l, r = map(int, input().split())
          print(sum(a[l:r]))`,
    time: "O(Q·|a|)",
  },
  {
    id: "49 bit 全探索",
    lang: "cpp",
    code: `
      int main() {
          int n; cin >> n;
          for (int s = 0; s < (1 << n); s++)
              for (int i = 0; i < n; i++) if (s >> i & 1) c++;
      }`,
    time: "O(N·2^N)",
    space: "O(1)",
  },
  {
    id: "50 itertools.product",
    lang: "python",
    code: `
      from itertools import product
      n = int(input())
      for bits in product((0, 1), repeat=n):
          pass`,
    time: "O(2^N)",
  },
  {
    id: "51 permutations",
    lang: "python",
    code: `
      from itertools import permutations
      n = int(input())
      for p in permutations(range(n)):
          for i in range(n):
              pass`,
    time: "O(N·N!)",
  },
  {
    id: "52 next_permutation",
    lang: "cpp",
    code: `
      int main() {
          int n; cin >> n;
          vector<int> p(n);
          iota(p.begin(), p.end(), 0);
          do {
              for (int i = 0; i < n; i++) c += p[i];
          } while (next_permutation(p.begin(), p.end()));
      }`,
    time: "O(N·N!)",
    space: "O(N)",
  },
  {
    id: "53 静的配列の領域は数値",
    lang: "cpp",
    code: `
      const int MAX = 200005;
      int a[MAX];
      int main() {
          int n; cin >> n;
          for (int i = 0; i < n; i++) cin >> a[i];
      }`,
    time: "O(N)",
    space: "O(2×10^5)",
  },
  {
    id: "54 BFS(deque)",
    lang: "python",
    code: `
      from collections import deque
      n, m = map(int, input().split())
      g = [[] for _ in range(n)]
      for _ in range(m):
          a, b = map(int, input().split())
          g[a].append(b)
      dist = [-1] * n
      dist[0] = 0
      q = deque([0])
      while q:
          v = q.popleft()
          for to in g[v]:
              if dist[to] == -1:
                  dist[to] = dist[v] + 1
                  q.append(to)`,
    time: "O(N + M)",
    space: "O(N + M)",
  },
  {
    id: "55 Dijkstra(heapq)",
    lang: "python",
    code: `
      import heapq
      n, m = map(int, input().split())
      g = [[] for _ in range(n)]
      for _ in range(m):
          a, b, c = map(int, input().split())
          g[a].append((b, c))
      dist = [10 ** 18] * n
      dist[0] = 0
      pq = [(0, 0)]
      while pq:
          d, v = heapq.heappop(pq)
          if d > dist[v]:
              continue
          for to, c in g[v]:
              if d + c < dist[to]:
                  dist[to] = d + c
                  heapq.heappush(pq, (dist[to], to))`,
    time: "O(N log M + M log M)",
    space: "O(N + M)",
  },
  {
    id: "58 while (t--) のマルチテスト",
    lang: "cpp",
    code: `
      void solve() {
          int n; cin >> n;
          for (int i = 0; i < n; i++) ans++;
      }
      int main() {
          int t; cin >> t;
          while (t--) solve();
      }`,
    time: "O(T·N)",
    warn: /マルチテスト/,
  },
  {
    id: "59 range(int(input())) のマルチテスト",
    lang: "python",
    code: `
      def solve():
          n = int(input())
          for i in range(n):
              pass

      for _ in range(int(input())):
          solve()`,
    time: "O(T·N)",
  },
  {
    id: "60 逆順の range",
    lang: "python",
    code: `
      n = int(input())
      for i in range(n - 1, -1, -1):
          pass
      for i in reversed(range(n)):
          pass`,
    time: "O(N)",
  },
  {
    id: "61 enumerate とリテラルの並び",
    lang: "python",
    code: `
      a = list(map(int, input().split()))
      for i, x in enumerate(a):
          for dx, dy in [(0, 1), (1, 0), (0, -1), (-1, 0)]:
              pass`,
    time: "O(|a|)",
  },
  {
    id: "62 試し割り(割っていく while は償却)",
    lang: "cpp",
    code: `
      int main() {
          long long x; cin >> x;
          for (long long i = 2; i * i <= x; i++)
              while (x % i == 0) x /= i;
      }`,
    time: "O(√X)",
  },
  {
    id: "63 ユークリッドの互除法",
    lang: "cpp",
    code: `
      int main() {
          int n; cin >> n;
          vector<long long> x(n), y(n);
          for (int i = 0; i < n; i++) {
              long long a = x[i], b = y[i];
              while (b) { a %= b; swap(a, b); }
          }
      }`,
    time: "O(N log max(x))",
  },
  {
    id: "64 ユーザー定義の pow が組み込みより優先",
    lang: "cpp",
    code: `
      long long pow(long long a, long long b) {
          long long r = 1;
          while (b) { if (b & 1) r = r * a; a = a * a; b >>= 1; }
          return r;
      }
      int main() {
          int n; long long k; cin >> n >> k;
          for (int i = 0; i < n; i++) ans += pow(i, k);
      }`,
    time: "O(N log K)",
  },
  {
    id: "65 i + 1 < n",
    lang: "cpp",
    code: `
      int main() {
          int n; cin >> n;
          for (int i = 0; i + 1 < n; i++) ans++;
      }`,
    time: "O(N)",
  },
  {
    id: "65b イテレータのループ",
    lang: "cpp",
    code: `
      int main() {
          int n; cin >> n;
          set<int> s;
          for (int i = 0; i < n; i++) s.insert(i);
          for (auto it = s.begin(); it != s.end(); it++) ans += *it;
      }`,
    time: "O(N log N)",
  },
  {
    id: "66 3次元の内包表記",
    lang: "python",
    code: `
      n, m, k = map(int, input().split())
      dp = [[[0] * k for _ in range(m)] for _ in range(n)]`,
    time: "O(N·M·K)",
    space: "O(N·M·K)",
  },
  {
    id: "67 内包表記の中の関数呼び出し",
    lang: "python",
    code: `
      def f(x):
          s = 0
          for i in range(n):
              s += i
          return s

      a = list(map(int, input().split()))
      n = int(input())
      b = [f(x) for x in a]`,
    time: "O(N·|a|)",
    space: "O(|a|)",
  },
  {
    id: "68 ACL の segtree",
    lang: "cpp",
    code: `
      #include <atcoder/segtree>
      using namespace atcoder;
      int op(int a, int b) { return max(a, b); }
      int e() { return 0; }
      int main() {
          int n, q; cin >> n >> q;
          segtree<int, op, e> seg(n);
          for (int i = 0; i < q; i++) {
              int p, x; cin >> p >> x;
              seg.set(p, x);
              cout << seg.prod(0, p) << endl;
          }
      }`,
    time: "O(Q log N + N)",
    space: "O(N)",
  },
  {
    id: "74 内側で同名の変数を宣言しても同じ記号",
    lang: "cpp",
    code: `
      int main() {
          int n; cin >> n;
          { int n2 = n; }
          for (int i = 0; i < n; i++) ans++;
      }`,
    time: "O(N)",
  },
  {
    id: "75 括弧が壊れていても止まらない",
    lang: "cpp",
    code: `
      int main() {
          int n; cin >> n;
          for (int i = 0; i < n; i++) {
              for (int j = 0; j < n; j++) {
                  ans++;
              }
          }
      }
      }`,
    time: "O(N²)",
    warn: /閉じ括弧/,
  },
  {
    id: "追加1 前置の ++i / --j",
    lang: "cpp",
    code: `
      int main() {
          int n; cin >> n;
          for (int i = 0; i < n; ++i)
              for (int j = n; j > 0; --j) x++;
      }`,
    time: "O(N²)",
    space: "O(1)",
    conf: "high",
    noWarn: true,
  },
  {
    id: "追加2 辞書の内包表記",
    lang: "python",
    code: `
      n = int(input())
      d = {i: 0 for i in range(n)}
      print(len(d))`,
    time: "O(N)",
    space: "O(N)",
  },
  {
    id: "追加3 key=f と map(f, a) はユーザー定義の関数を呼ぶ",
    lang: "python",
    code: `
      def f(x):
          return x % 7
      n = int(input())
      a = list(map(int, input().split()))
      b = sorted(a, key=f)
      c = list(map(f, a))`,
    time: "O(N log N)",
    space: "O(N)",
  },
  {
    id: "追加4 sort の比較関数",
    lang: "cpp",
    code: `
      bool cmp(int a, int b) { return a > b; }
      int main() {
          int n; cin >> n;
          vector<int> a(n);
          sort(a.begin(), a.end(), cmp);
      }`,
    time: "O(N log N)",
    space: "O(N)",
  },
  {
    id: "追加5 k <<= 1 で倍々",
    lang: "cpp",
    code: `
      int main() {
          long long n; cin >> n;
          long long k = 1;
          while (k <= n) k <<= 1;
      }`,
    time: "O(log N)",
    noWarn: true,
  },
  {
    id: "追加6 1行を読んでから変換した値も入力",
    lang: "python",
    code: `
      line = input()
      m = int(line)
      dp = [0] * (m + 1)
      for i in range(m):
          dp[i + 1] = dp[i] + 1`,
    time: "O(M)",
    space: "O(M)",
  },
  {
    id: "追加7 1回だけ代入した変数は元の式に置き換える",
    lang: "python",
    code: `
      n = int(input())
      m = n - 1
      k = min(n, 20)
      x = n if n > 0 else 1
      for i in range(m):
          for j in range(k):
              pass
      for i in range(x):
          pass`,
    time: "O(20·N)",
  },
  {
    id: "Java: テンプレート(A+B)",
    lang: "java",
    code: `
      import java.util.*;
      public class Main {
          public static void main(String[] args) {
              Scanner sc = new Scanner(System.in);
              int a = sc.nextInt();
              int b = sc.nextInt();
              System.out.println(a + b);
          }
      }`,
    time: "O(1)",
    space: "O(1)",
    noWarn: true,
  },
  {
    id: "69 Java: Arrays.sort と TreeMap",
    lang: "java",
    code: `
      import java.util.*;
      public class Main {
          public static void main(String[] args) {
              Scanner sc = new Scanner(System.in);
              int n = sc.nextInt();
              int[] a = new int[n];
              for (int i = 0; i < n; i++) a[i] = sc.nextInt();
              Arrays.sort(a);
              TreeMap<Integer, Integer> mp = new TreeMap<>();
              for (int i = 0; i < n; i++) mp.put(a[i], i);
              System.out.println(mp.size());
          }
      }`,
    time: "O(N log N)",
    space: "O(N)",
  },
  {
    id: "C#: テンプレート(A+B)",
    lang: "csharp",
    code: `
      using System;
      class Program {
          static void Main() {
              var s = Console.ReadLine().Split();
              int a = int.Parse(s[0]), b = int.Parse(s[1]);
              Console.WriteLine(a + b);
          }
      }`,
    time: "O(1)",
    space: "O(1)",
    noWarn: true,
  },
  {
    id: "72 C#: for × foreach(a の長さは先に読んだ n)",
    lang: "csharp",
    code: `
      using System;
      using System.Linq;
      class Program {
          static void Main() {
              int n = int.Parse(Console.ReadLine());
              var a = Console.ReadLine().Split().Select(int.Parse).ToArray();
              long s = 0;
              for (int i = 0; i < n; i++)
                  foreach (var x in a) s += x;
              Console.WriteLine(s);
          }
      }`,
    time: "O(N²)",
    space: "O(N)",
  },
  {
    id: "Rust: テンプレート(proconio)",
    lang: "rust",
    code: `
      use proconio::input;
      fn main() {
          input! { a: i64, b: i64 }
          println!("{}", a + b);
      }`,
    time: "O(1)",
    space: "O(1)",
    noWarn: true,
  },
  {
    id: "Rust: テンプレート(read_line)",
    lang: "rust",
    code: `
      use std::io::*;
      fn main() {
          let mut s = String::new();
          stdin().read_line(&mut s).unwrap();
          let v: Vec<i64> = s.split_whitespace().map(|x| x.parse().unwrap()).collect();
          println!("{}", v[0] + v[1]);
      }`,
    time: "O(1)",
    space: "O(1)",
    noWarn: true,
  },
  {
    id: "57 Rust: while let Some(v) = q.pop_front() の BFS",
    lang: "rust",
    code: `
      use proconio::input;
      use std::collections::VecDeque;
      fn main() {
          input! { n: usize, m: usize, e: [(usize, usize); m] }
          let mut g = vec![vec![]; n];
          for &(a, b) in &e { g[a].push(b); g[b].push(a); }
          let mut dist = vec![usize::MAX; n];
          let mut q = VecDeque::new();
          dist[0] = 0;
          q.push_back(0);
          while let Some(v) = q.pop_front() {
              for &to in &g[v] {
                  if dist[to] == usize::MAX { dist[to] = dist[v] + 1; q.push_back(to); }
              }
          }
      }`,
    time: "O(N + M)",
    space: "O(N + M)",
  },
  {
    id: "Go: テンプレート(A+B)",
    lang: "go",
    code: `
      package main
      import "fmt"
      func main() {
          var a, b int
          fmt.Scan(&a, &b)
          fmt.Println(a + b)
      }`,
    time: "O(1)",
    space: "O(1)",
    noWarn: true,
  },
  {
    id: "56 Go: for len(q) > 0 の BFS",
    lang: "go",
    code: `
      package main
      import "fmt"
      func main() {
          var n, m int
          fmt.Scan(&n, &m)
          g := make([][]int, n)
          for i := 0; i < m; i++ {
              var a, b int
              fmt.Scan(&a, &b)
              g[a] = append(g[a], b)
              g[b] = append(g[b], a)
          }
          dist := make([]int, n)
          for i := range dist {
              dist[i] = -1
          }
          dist[0] = 0
          q := []int{0}
          for len(q) > 0 {
              v := q[0]
              q = q[1:]
              for _, to := range g[v] {
                  if dist[to] == -1 {
                      dist[to] = dist[v] + 1
                      q = append(q, to)
                  }
              }
          }
          fmt.Println(dist[n-1])
      }`,
    time: "O(N + M)",
    space: "O(N + M)",
  },
  {
    id: "JS: テンプレート(A+B)",
    lang: "js",
    code: `
      const [a, b] = require("fs").readFileSync("/dev/stdin", "utf8").trim().split(" ").map(Number);
      console.log(a + b);`,
    time: "O(1)",
    space: "O(1)",
    noWarn: true,
  },
  {
    id: "70 JS: for × for-of と sort(a の長さは先に読んだ n)",
    lang: "js",
    code: `
      const lines = require("fs").readFileSync(0, "utf8").split("\\n");
      const n = Number(lines[0]);
      const a = lines[1].split(" ").map(Number);
      let s = 0;
      for (let i = 0; i < n; i++) for (const x of a) s += x;
      a.sort((x, y) => x - y);
      console.log(s);`,
    time: "O(N²)",
    space: "O(N)",
  },
  {
    id: "TS: テンプレート(A+B)",
    lang: "ts",
    code: `
      const input: string[] = require("fs").readFileSync("/dev/stdin", "utf8").split("\\n");
      const [a, b]: number[] = input[0].split(" ").map(Number);
      console.log(a + b);`,
    time: "O(1)",
    space: "O(1)",
    noWarn: true,
  },
  {
    id: "71 TS: forEach のコールバックの中のループは要素数ぶん",
    lang: "ts",
    code: `
      const [n, ...a]: number[] = require("fs").readFileSync(0, "utf8").trim().split(/\\s+/).map(Number);
      let s = 0;
      a.forEach((x: number) => {
        for (let j = 0; j < n; j++) s += x * j;
      });
      console.log(s);`,
    time: "O(N·|a|)",
    space: "O(|a|)",
  },
  {
    id: "D: テンプレート(A+B)",
    lang: "d",
    code: `
      import std.stdio, std.conv, std.string, std.array;
      void main() {
          auto ab = readln.split.to!(int[]);
          writeln(ab[0] + ab[1]);
      }`,
    time: "O(1)",
    space: "O(1)",
    noWarn: true,
  },
  {
    id: "73 D: foreach (i; 0 .. n) の二重ループ",
    lang: "d",
    code: `
      import std.stdio, std.conv, std.string, std.array;
      void main() {
          auto nm = readln.split.to!(int[]);
          int n = nm[0], m = nm[1];
          long s = 0;
          foreach (i; 0 .. n)
              foreach (j; 0 .. m) s += i * j;
          writeln(s);
      }`,
    time: "O(N·M)",
    space: "O(1)",
  },
  {
    id: "追加8 別々の枝の自己呼び出しは1本(再帰の二分探索)",
    lang: "cpp",
    code: `
      vector<int> a;
      int bs(int l, int r, int x) {
          if (r - l <= 1) return l;
          int m = (l + r) / 2;
          if (a[m] <= x) return bs(m, r, x);
          else return bs(l, m, x);
      }
      int main() {
          int n, q; cin >> n >> q;
          a.resize(n);
          for (int i = 0; i < n; i++) cin >> a[i];
          for (int i = 0; i < q; i++) { int x; cin >> x; cout << bs(0, n, x) << endl; }
      }`,
    time: "O(Q log N + N)",
    space: "O(N)",
  },
  {
    // ABC477 D の解説の解法。for i in s のあとで s を空にするので、外側のループ全体で s に入った要素の数(N + Q)だけ回る
    id: "追加9 回したあとで空にするコレクションは償却(ABC477 D)",
    lang: "python",
    code: `
      n, q = map(int, input().split())

      qry = [(2, "a")]
      tile = [0] * n
      for i in range(q):
          t, x = input().split()
          if t == "1":
              x = int(x) - 1
              tile[x] ^= 1
              qry.append((1, x))
          else:
              qry.append((2, x))

      s = set(i for i in range(n) if tile[i] == 0)
      ans = [""] * n
      for t, x in reversed(qry):
          if t == 1:
              if tile[x] == 0 and ans[x] == "":
                  s.remove(x)
              if tile[x] and ans[x] == "":
                  s.add(x)
              tile[x] ^= 1
          else:
              for i in s:
                  ans[i] = x
              s.clear()

      print("".join(ans))`,
    time: "O(N + Q)",
    space: "O(N + Q)",
    conf: "medium",
  },
  {
    id: "追加10 空にしないなら償却しない(ABC477 D から s.clear() を除いた形)",
    lang: "python",
    code: `
      n, q = map(int, input().split())
      qry = [(2, "a")]
      tile = [0] * n
      for i in range(q):
          t, x = input().split()
          qry.append((1, int(x)))
      s = set(i for i in range(n) if tile[i] == 0)
      ans = [""] * n
      for t, x in reversed(qry):
          if t == 1:
              s.add(x)
          else:
              for i in s:
                  ans[i] = x
      print("".join(ans))`,
    time: "O(N·Q + Q²)",
    space: "O(N + Q)",
  },
  {
    id: "追加11 C++: 貯めてから回して clear する",
    lang: "cpp",
    code: `
      int main() {
          int q; cin >> q;
          vector<int> buf;
          long long s = 0;
          for (int i = 0; i < q; i++) {
              int t, x; cin >> t >> x;
              if (t == 1) buf.push_back(x);
              else {
                  for (int v : buf) s += v;
                  buf.clear();
              }
          }
          cout << s << endl;
      }`,
    time: "O(Q)",
    space: "O(Q)",
  },
  {
    id: "追加12 毎回作り直すなら償却しない",
    lang: "python",
    code: `
      n, q = map(int, input().split())
      s = 0
      for _ in range(q):
          cur = list(range(n))
          for x in cur:
              s += x
          cur = []
      print(s)`,
    time: "O(N·Q)",
    space: "O(N)",
  },
  {
    id: "追加13 初期サイズ + 追加の数",
    lang: "cpp",
    code: `
      int main() {
          int n, q; cin >> n >> q;
          vector<int> v(n);
          for (int i = 0; i < q; i++) v.push_back(i);
          long long s = 0;
          for (int x : v) s += x;
          cout << s << endl;
      }`,
    time: "O(N + Q)",
    space: "O(N + Q)",
  },
  {
    // 足してすぐ取り除くので s はずっと3〜4個。ループの中の sort は O(1)
    id: "追加14 足してすぐ取り除くコンテナは大きくならない(上位3つ)",
    lang: "python",
    code: `
      n = int(input())
      a = list(map(int, input().split()))
      s = a[:3]
      s.sort(reverse=True)
      print(s[2])
      for k in range(3, n):
          s.append(a[k])
          s.sort(reverse=True)
          s.pop()
          print(s[2])`,
    time: "O(N)",
    space: "O(N)",
  },
  {
    id: "追加15 取り除かなければ増え続ける",
    lang: "python",
    code: `
      n = int(input())
      a = list(map(int, input().split()))
      s = a[:3]
      for k in range(3, n):
          s.append(a[k])
          s.sort()
      print(s)`,
    time: "O(N² log N)",
    space: "O(N)",
  },
  {
    id: "追加16 大きさが k を超えたら取り除くヒープは k 個まで",
    lang: "python",
    code: `
      import heapq
      n, k = map(int, input().split())
      a = list(map(int, input().split()))
      h = []
      for x in a:
          heapq.heappush(h, x)
          if len(h) > k:
              heapq.heappop(h)
      print(h[0])`,
    time: "O(N log K)",
    space: "O(N + K)",
  },
  {
    id: "追加17 C++: pq.size() > k なら pop",
    lang: "cpp",
    code: `
      int main() {
          int n, k; cin >> n >> k;
          priority_queue<int> pq;
          for (int i = 0; i < n; i++) {
              int x; cin >> x;
              pq.push(x);
              if ((int)pq.size() > k) pq.pop();
          }
          cout << pq.top() << endl;
      }`,
    time: "O(N log K)",
    space: "O(K)",
  },
  {
    id: "追加18 2つ足して1つ取り除くなら増え続ける",
    lang: "python",
    code: `
      import heapq
      n, k = map(int, input().split())
      a = list(map(int, input().split()))
      h = []
      for x in a:
          heapq.heappush(h, x)
          heapq.heappush(h, -x)
          if len(h) > k:
              heapq.heappop(h)
      print(h[0])`,
    time: "O(N log N)",
    space: "O(N)",
  },
  {
    id: "追加19 C++: push_back → sort → pop_back",
    lang: "cpp",
    code: `
      int main() {
          int n; cin >> n;
          vector<int> st;
          for (int i = 0; i < n; i++) {
              st.push_back(i);
              sort(st.begin(), st.end());
              st.pop_back();
          }
          cout << st.size() << endl;
      }`,
    time: "O(N)",
    space: "O(1)",
  },
  {
    // AtCoder 公式解説での検証(docs/complexity-verification.md)で見つかった形。以下、解説のコードそのものではなく同じ形の最小のコード
    id: "追加20 テストケースごとに作り直すリストは1ケース分の大きさ(ABC474 E)",
    lang: "python",
    code: `
      for _ in range(int(input())):
          n = int(input())
          d = []
          for _ in range(n):
              a, b = map(int, input().split())
              d.append(b - a)
          d.sort()
          print(sum(d))`,
    time: "O(T·N log N)",
    space: "O(N)",
  },
  {
    id: "追加21 C++: ループの中で宣言した vector の大きさは1回分(ABC464 G)",
    lang: "cpp",
    code: `
      int main() {
          int T; cin >> T;
          while (T--) {
              int n; cin >> n;
              vector<int> v;
              for (int i = 0; i < n; i++) v.push_back(i);
              int m = v.size();
              priority_queue<int> pq;
              for (int i = 0; i < m; i++) pq.push(v[i]);
          }
      }`,
    time: "O(T·N log N)",
  },
  {
    id: "追加22 関数の中の n = a.size() は呼び出し側の長さ(ABC461 D)",
    lang: "cpp",
    code: `
      long long f(vector<long long>& a, long long k) {
          long long n = a.size();
          long long r = 0, res = 0;
          for (long long l = 0; l < n; l++) {
              r = max(r, l + 1);
              while (r < n && a[r] - a[l] < k) r++;
              res += r - l;
          }
          return res;
      }
      int main() {
          long long h, w, k; cin >> h >> w >> k;
          vector<vector<long long>> a(h, vector<long long>(w));
          long long ans = 0;
          for (int u = 0; u < h; u++)
              for (int d = u; d < h; d++) {
                  vector<long long> b(w + 1);
                  ans += f(b, k);
              }
          cout << ans << endl;
      }`,
    time: "O(H²·W)",
  },
  {
    id: "追加23 関数の中の h と入力の H は別の変数(ABC464 B)",
    lang: "cpp",
    code: `
      vector<string> rot(vector<string> a) {
          int h = a.size(), w = a[0].size();
          vector<string> res(w, string(h, '.'));
          for (int i = 0; i < h; i++)
              for (int j = 0; j < w; j++) res[j][h - 1 - i] = a[i][j];
          return res;
      }
      int main() {
          int H, W; cin >> H >> W;
          vector<string> C(H);
          for (int i = 0; i < H; i++) cin >> C[i];
          for (int t = 0; t < 4; t++) C = rot(C);
      }`,
    time: "O(H·W)",
  },
  {
    id: "追加24 C++: 宣言と同時に初期化した定数式の変数(ABC476 F)",
    lang: "cpp",
    code: `
      int main() {
          long long n; cin >> n;
          const long long nn = 3 * n + 1;
          vector<vector<long long>> s(nn, vector<long long>(nn));
          for (long long i = 0; i < nn; i++)
              for (long long j = 0; j < nn; j++) s[i][j] = i + j;
      }`,
    time: "O(N²)",
    space: "O(N²)",
  },
];

for (const g of CASES) test(g.id, () => void check(g));
