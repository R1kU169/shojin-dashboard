// Ruby のゴールデンテスト(docs/complexity-analyzer-plan.md §7.7)。
// def / if / do … end は字句の後で波括弧の形に書き換えて読む(endRewrite.ts)。修飾子の if / while は
// 文末の修飾として読み、n.times do |i| のようなブロック付きの反復は文ならループとして扱う。
import { test } from "node:test";
import { check } from "./helpers.ts";
import type { Golden } from "./helpers.ts";

const CASES: Golden[] = [
  {
    id: "R1 times と範囲の each、修飾子の if",
    lang: "ruby",
    code: `
      n, k = gets.split.map(&:to_i)
      a = gets.split.map(&:to_i)
      cnt = 0
      n.times do |i|
        (i + 1...n).each do |j|
          cnt += 1 if a[i] + a[j] == k
        end
      end
      puts cnt`,
    time: "O(N²)",
    space: "O(N)",
    noWarn: true,
  },
  {
    id: "R2 sort と bsearch_index",
    lang: "ruby",
    code: `
      n, q = gets.split.map(&:to_i)
      a = gets.split.map(&:to_i).sort
      q.times do
        x = gets.to_i
        i = a.bsearch_index { |v| v >= x } || n
        puts n - i
      end`,
    time: "O(N log N + Q log N)",
    space: "O(N)",
  },
  {
    id: "R3 再帰の fib(修飾子の return)",
    lang: "ruby",
    code: `
      def fib(n)
        return n if n < 2
        fib(n - 1) + fib(n - 2)
      end
      n = gets.to_i
      puts fib(n)`,
    time: "O(2^N)",
    space: "O(N)",
  },
  {
    id: "R4 Array.new(h) { Array.new(w, 0) }",
    lang: "ruby",
    code: `
      h, w = gets.split.map(&:to_i)
      dp = Array.new(h) { Array.new(w, 0) }
      h.times do |i|
        w.times do |j|
          dp[i][j] = i + j
        end
      end
      p dp[h - 1][w - 1]`,
    time: "O(H·W)",
    space: "O(H·W)",
  },
  {
    id: "R5 %w・正規表現・式展開の中の end / do / if",
    lang: "ruby",
    code: `
      words = %w[end do if]
      s = gets.chomp
      re = /end|do/
      puts "#{s} end" if s.include?("end")
      cnt = 0
      s.each_char do |c|
        cnt += 1 if c == "e"
      end
      puts cnt, words.size, re`,
    time: "O(|s|)",
    space: "O(1)",
    noWarn: true,
  },
  {
    id: "R6 木の DFS(next if v == p)、n /= 10 while、begin … end while",
    lang: "ruby",
    code: `
      n = gets.to_i
      $adj = Array.new(n) { [] }
      (n - 1).times do
        u, v = gets.split.map(&:to_i)
        $adj[u] << v
        $adj[v] << u
      end
      def dfs(u, p)
        $adj[u].each do |v|
          next if v == p
          dfs(v, u)
        end
      end
      dfs(0, -1)
      x = n
      x /= 10 while x > 0
      y = n
      begin
        y /= 2
      end while y > 0`,
    time: "O(N)",
    space: "O(N)",
    noWarn: true,
  },
  {
    id: "R7 x.class・(l..r).end・all?{}・combination・until STDIN.eof?",
    lang: "ruby",
    code: `
      n = gets.to_i
      a = gets.split.map(&:to_i)
      puts a.class
      l, r = 1, n
      puts (l..r).end
      puts a.all?{ |x| x > 0 }
      cnt = 0
      a.combination(2) { |x, y| cnt += 1 if x < y }
      until STDIN.eof?
        line = gets
      end
      puts cnt`,
    time: "O(N²)",
    space: "O(N)",
  },
  {
    id: "R8 テンプレート(A+B)",
    lang: "ruby",
    code: `
      a, b = gets.split.map(&:to_i)
      puts a + b`,
    time: "O(1)",
    space: "O(1)",
    noWarn: true,
  },
];

for (const g of CASES) test(g.id, () => void check(g));
