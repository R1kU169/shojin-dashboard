// Lua のゴールデンテスト(docs/complexity-analyzer-plan.md §7.7)。
// then / do … end は字句の後で波括弧の形に書き換えて読む(endRewrite.ts)。
import { test } from "node:test";
import { check } from "./helpers.ts";
import type { Golden } from "./helpers.ts";

const CASES: Golden[] = [
  {
    id: "L1 1行の for と二重ループ",
    lang: "lua",
    code: `
      local n = io.read("n")
      local a = {}
      for i = 1, n do a[i] = io.read("n") end
      local cnt = 0
      for i = 1, n do
        for j = i + 1, n do
          if a[i] + a[j] == 0 then cnt = cnt + 1 end
        end
      end
      print(cnt)`,
    time: "O(N²)",
    space: "O(N)",
    noWarn: true,
  },
  {
    id: "L2 table.sort と二分探索",
    lang: "lua",
    code: `
      local n, q = io.read("n", "n")
      local a = {}
      for i = 1, n do a[i] = io.read("n") end
      table.sort(a)
      for _ = 1, q do
        local x = io.read("n")
        local lo, hi = 1, n + 1
        while lo < hi do
          local mid = (lo + hi) // 2
          if a[mid] < x then lo = mid + 1 else hi = mid end
        end
        print(lo)
      end`,
    time: "O(N log N + Q log N)",
    space: "O(N)",
  },
  {
    id: "L3 local function の再帰(fib)",
    lang: "lua",
    code: `
      local function fib(n)
        if n < 2 then return n end
        return fib(n - 1) + fib(n - 2)
      end
      local n = io.read("n")
      print(fib(n))`,
    time: "O(2^N)",
    space: "O(N)",
  },
  {
    id: "L4 dp[i] = {} と dp[i][j] = 0",
    lang: "lua",
    code: `
      local h, w = io.read("n", "n")
      local dp = {}
      for i = 1, h do
        dp[i] = {}
        for j = 1, w do dp[i][j] = 0 end
      end
      print(dp[h][w])`,
    time: "O(H·W)",
    space: "O(H·W)",
  },
  {
    id: "L5 長い文字列・長いコメント・repeat-until",
    lang: "lua",
    code: `
      local s = [[ end do while
      for i = 1, n do ]]
      --[[ for i = 1, n do
        for j = 1, n do end
      end ]]
      local n = io.read("n")
      local i = 0
      repeat
        i = i + 1
      until i >= n
      print(s, i)`,
    time: "O(N)",
    space: "O(1)",
    noWarn: true,
  },
  {
    id: "L6 10^5 と割っていく while と line:match",
    lang: "lua",
    code: `
      local line = io.read()
      local n, m = line:match("(%d+) (%d+)")
      n = tonumber(n)
      local s = 0
      for i = 1, 10^5 do s = s + i end
      while n > 0 do n = n // 2 end
      print(s, m)`,
    time: "O(log N + 10^5)",
    space: "O(1)",
  },
  {
    id: "L7 比較関数つきの table.sort と、訪問済みの判定の無い DFS",
    lang: "lua",
    code: `
      local n, m = io.read("n", "n")
      local adj = {}
      for i = 1, n do adj[i] = {} end
      for _ = 1, m do
        local u, v = io.read("n", "n")
        table.insert(adj[u], v)
      end
      local a = {}
      for i = 1, n do a[i] = io.read("n") end
      table.sort(a, function(x, y) return x > y end)
      local dfs
      dfs = function(v)
        for _, u in ipairs(adj[v]) do dfs(u) end
      end
      dfs(1)`,
    time: "O(N log N + M)",
    space: "O(N + M)",
    warn: /訪問済みの判定が見つかりません/,
  },
  {
    id: "L8 テンプレート(A+B)",
    lang: "lua",
    code: `
      local a, b = io.read("*n"), io.read("*n")
      print(a + b)`,
    time: "O(1)",
    space: "O(1)",
    noWarn: true,
  },
];

for (const g of CASES) test(g.id, () => void check(g));
