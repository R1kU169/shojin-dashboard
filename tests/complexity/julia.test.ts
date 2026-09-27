// Julia のゴールデンテスト(docs/complexity-analyzer-plan.md §7.7)。
// function / for / if / begin … end は字句の後で波括弧の形に書き換えて読む(endRewrite.ts)。
// for i in 1:n, j in 1:m は入れ子のループ、f(x) = expr は関数、a[end] の end は添字。
import { test } from "node:test";
import { check } from "./helpers.ts";
import type { Golden } from "./helpers.ts";

const CASES: Golden[] = [
  {
    id: "J1 for i in 1:n, j in i+1:n の二重ループ",
    lang: "julia",
    code: `
      n = parse(Int, readline())
      a = parse.(Int, split(readline()))
      cnt = 0
      for i in 1:n, j in i+1:n
          if a[i] + a[j] == 0
              cnt += 1
          end
      end
      println(cnt)`,
    time: "O(N²)",
    space: "O(N)",
    noWarn: true,
  },
  {
    id: "J2 sort と searchsortedfirst",
    lang: "julia",
    code: `
      n, q = parse.(Int, split(readline()))
      a = sort(parse.(Int, split(readline())))
      for _ in 1:q
          x = parse(Int, readline())
          println(n - searchsortedfirst(a, x) + 1)
      end`,
    time: "O(N log N + Q log N)",
    space: "O(N)",
  },
  {
    id: "J3 短縮形の定義 fib(n) = …",
    lang: "julia",
    code: `
      fib(n) = n < 2 ? n : fib(n - 1) + fib(n - 2)
      n = parse(Int, readline())
      println(fib(n))`,
    time: "O(2^N)",
    space: "O(N)",
    warn: /指数時間の再帰/,
  },
  {
    id: "J4 zeros(Int, h, w) と dp[i, j]",
    lang: "julia",
    code: `
      h, w = parse.(Int, split(readline()))
      dp = zeros(Int, h, w)
      for i in 1:h
          for j in 1:w
              dp[i, j] = i + j
          end
      end
      println(dp[end, end])`,
    time: "O(H·W)",
    space: "O(H·W)",
  },
  {
    id: "J5 a[2:end]・式展開・@inbounds・内包表記",
    lang: "julia",
    code: `
      n = parse(Int, readline())
      a = parse.(Int, split(readline()))
      b = a[2:end]
      println("$(a[end])")
      s = 0
      @inbounds for i in eachindex(b)
          s += b[i]
      end
      c = [x * 2 for x in b if x > 0]
      println(s, c)`,
    time: "O(N)",
    space: "O(N)",
    noWarn: true,
  },
  {
    id: "J6 10^5・2n・文字の範囲・eof・a[begin]・return ']'",
    lang: "julia",
    code: `
      function f(x)
          return ']'
      end
      n = parse(Int, readline())
      a = [1, 2, 3]
      t = 0
      for _ in 1:10^5
          t += 1
      end
      for i in 1:2n
          t += i
      end
      for c in 'a':'z'
          t += 1
      end
      x = a[begin]
      while !eof(stdin)
          line = readline()
      end
      println(t, x, f(1))`,
    time: "O(N + 10^5)",
    space: "O(1)",
    noWarn: true,
  },
  {
    id: "J7 sort!(a, by = x -> …)・fill・n:-1:1",
    lang: "julia",
    code: `
      n = parse(Int, readline())
      a = [parse.(Int, split(readline())) for _ in 1:n]
      sort!(a, by = x -> begin x[2] end)
      best = fill(typemax(Int), n)
      for i in n:-1:1
          best[i] = a[i][1]
      end
      println(best)`,
    time: "O(N log N)",
    space: "O(N)",
  },
  {
    id: "J8 テンプレート(A+B)",
    lang: "julia",
    code: `
      a, b = parse.(Int, split(readline()))
      println(a + b)`,
    time: "O(1)",
    space: "O(1)",
    noWarn: true,
  },
];

for (const g of CASES) test(g.id, () => void check(g));
