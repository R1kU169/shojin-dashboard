// Nim のゴールデンテスト(docs/complexity-analyzer-plan.md §7.7)。
// インデント系として読み、proc の行末の = でブロックを開く。var / let / const は節として読み、
// echo x / inc x / a.add x のような括弧なしの呼び出しと、x in 0..<n の範囲を読む。
import { test } from "node:test";
import { check } from "./helpers.ts";
import type { Golden } from "./helpers.ts";

const CASES: Golden[] = [
  {
    id: "T1 readLine.split.map と let (n, m) = (v[0], v[1]) と二重ループ",
    lang: "nim",
    code: `
      import std/[strutils, sequtils]
      let v = stdin.readLine.split.map(parseInt)
      let (n, m) = (v[0], v[1])
      var s = 0
      for i in 0..<n:
        for j in 0 ..< m:
          s += i * j
      echo s`,
    time: "O(N·M)",
    space: "O(1)",
    noWarn: true,
  },
  {
    id: "T2 sort と lowerBound",
    lang: "nim",
    code: `
      import std/[strutils, sequtils, algorithm]
      let n = stdin.readLine.parseInt
      var a = stdin.readLine.split.map(parseInt)
      a.sort()
      let q = stdin.readLine.parseInt
      for _ in 0..<q:
        let x = stdin.readLine.parseInt
        echo a.lowerBound(x)`,
    time: "O(N log N + Q log N)",
    space: "O(N)",
  },
  {
    id: "T3 倍々の while と d * d <= n の while",
    lang: "nim",
    code: `
      let n = stdin.readLine.parseInt
      var i = 1
      while i <= n:
        i *= 2
      var d = 2
      while d * d <= n:
        inc d
      echo i, d`,
    time: "O(√N)",
    space: "O(1)",
    noWarn: true,
  },
  {
    id: "T4 #[ ]#・const・newSeqWith の2次元・プラグマ・case / of",
    lang: "nim",
    code: `
      #[ for i in 0..<n:
        #[ nested ]#
      ]#
      import std/[strutils, sequtils]
      const MOD = 1_000_000_007
      let v = stdin.readLine.split.map(parseInt)
      let n = v[0]
      let m = v[1]
      var dp = newSeqWith(n + 1, newSeq[int](m + 1))
      proc step(x: int): int {.inline.} =
        (x * 2) mod MOD
      for i in 1..n:
        for j in 1..m:
          case (i + j) mod 3
          of 0:
            dp[i][j] = step(dp[i - 1][j])
          of 1:
            dp[i][j] = dp[i][j - 1]
          else:
            dp[i][j] = 1
      echo dp[n][m]`,
    time: "O(N·M)",
    space: "O(N·M)",
  },
  {
    id: "T5 array[1000, int] と定数の二重ループ",
    lang: "nim",
    code: `
      var a: array[1000, int]
      var s = 0
      for i in 0..<1000:
        for j in i+1..<1000:
          s += a[i] * a[j]
      echo s`,
    time: "O(10^6)",
    space: "O(1000)",
    noWarn: true,
  },
  {
    id: "T6 initHashSet と in と incl と再帰の proc",
    lang: "nim",
    code: `
      import std/[sets, strutils, sequtils]
      proc fact(k: int): int =
        if k <= 1: return 1
        return k * fact(k - 1)
      let n = stdin.readLine.parseInt
      let a = stdin.readLine.split.map(parseInt)
      var seen = initHashSet[int]()
      var cnt = 0
      for x in a:
        if x in seen:
          inc cnt
        seen.incl x
      echo cnt, fact(n)`,
    time: "O(N)",
    space: "O(N)",
  },
  {
    id: "T7 proc main() = の中の三角ループと main()",
    lang: "nim",
    code: `
      import std/strutils
      proc main() =
        let n = stdin.readLine.parseInt
        var c = 0
        for i in 0..<n:
          for j in 0..<i:
            inc c
        echo c
      main()`,
    time: "O(N²)",
    space: "O(1)",
    noWarn: true,
  },
  {
    id: "T8 グリッドの BFS(newSeqWith(h, newSeqWith(w, -1)) と while q.len > 0)",
    lang: "nim",
    code: `
      import std/[strutils, sequtils, deques]
      let hw = stdin.readLine.split.map(parseInt)
      let h = hw[0]
      let w = hw[1]
      var dist = newSeqWith(h, newSeqWith(w, -1))
      var q = initDeque[(int, int)]()
      q.addLast((0, 0))
      dist[0][0] = 0
      let dx = [1, 0, -1, 0]
      let dy = [0, 1, 0, -1]
      while q.len > 0:
        let (x, y) = q.popFirst()
        for d in 0..<4:
          let nx = x + dx[d]
          let ny = y + dy[d]
          if nx in 0..<h and ny in 0..<w and dist[nx][ny] == -1:
            dist[nx][ny] = dist[x][y] + 1
            q.addLast((nx, ny))
      echo dist[h - 1][w - 1]`,
    time: "O(H·W)",
    space: "O(H·W)",
  },
  {
    id: "T10 隣接リストの DFS(g[u].add v と for u in g[v] と dfs u)",
    lang: "nim",
    code: `
      import std/[strutils, sequtils]
      let nm = stdin.readLine.split.map(parseInt)
      let n = nm[0]
      let m = nm[1]
      var g = newSeq[seq[int]](n)
      for _ in 0..<m:
        let e = stdin.readLine.split.map(parseInt)
        g[e[0]].add e[1]
        g[e[1]].add e[0]
      var visited = newSeq[bool](n)
      proc dfs(v: int) =
        visited[v] = true
        for u in g[v]:
          if not visited[u]:
            dfs u
      dfs 0`,
    time: "O(N + M)",
    space: "O(N + M)",
  },
  {
    id: "T12 1..n の範囲と試し割りと t div 10",
    lang: "nim",
    code: `
      let n = stdin.readLine.parseInt
      var c = 0
      for i in 1..n:
        c += i
      var x = n
      var p = 2
      while p * p <= x:
        while x mod p == 0:
          x = x div p
        inc p
      var t = n
      while t > 0:
        t = t div 10
      echo c, x`,
    time: "O(N)",
    space: "O(1)",
  },
  {
    id: "T13 1 shl n のビット全探索",
    lang: "nim",
    code: `
      import std/strutils
      let n = stdin.readLine.parseInt
      var dp = newSeq[int](1 shl n)
      for s in 0..<(1 shl n):
        for i in 0..<n:
          if (s and (1 shl i)) != 0:
            dp[s] += 1
      echo dp[(1 shl n) - 1]`,
    time: "O(N·2^N)",
    space: "O(2^N)",
  },
  {
    id: "T15 コメント・文字列の中の for / #",
    lang: "nim",
    code: `
      let s = stdin.readLine
      var cnt = 0
      for c in s:
        if c == '#':
          inc cnt
      let t = """for i in 0..<n:
        # not code
      """
      echo cnt, t`,
    time: "O(|s|)",
    space: "O(1)",
  },
  {
    id: "T9 let の節・var b = a・sort b・sortedByIt・lowerBound",
    lang: "nim",
    code: `
      import std/[strutils, sequtils, algorithm]
      let
        n = stdin.readLine.parseInt
        a = stdin.readLine.split.map(parseInt)
      var b = a
      sort b
      let c = a.sortedByIt(-it)
      for x in c:
        echo b.lowerBound(x)`,
    time: "O(N log N)",
    space: "O(N)",
    noWarn: true,
  },
  {
    id: "T11 readChar で数を読む proc scan() と newSeqWith(n, scan())",
    lang: "nim",
    code: `
      proc scan(): int =
        var c = stdin.readChar
        while c.isDigit:
          result = result * 10 + (c.ord - '0'.ord)
          c = stdin.readChar
      let n = scan()
      let a = newSeqWith(n, scan())
      var s = 0
      for x in a:
        s += x
      echo s`,
    time: "O(N)",
    space: "O(N)",
  },
  {
    id: "T14 map(x => x * 2)・block と break・do 記法の sort",
    lang: "nim",
    code: `
      import std/[strutils, sequtils, algorithm, sugar]
      let n = stdin.readLine.parseInt
      var ps = newSeq[(int, int)](n)
      for i in 0..<n:
        ps[i] = (i, n - i)
      ps.sort do (p, q: (int, int)) -> int:
        cmp(p[1], q[1])
      let b = ps.map(x => x[0] * 2)
      block search:
        for i in 0..<n:
          for j in 0..<n:
            if b[i] + b[j] == 0:
              break search
      echo b.len`,
    time: "O(N²)",
    space: "O(N)",
  },
  {
    id: "T16 テンプレート(A+B)",
    lang: "nim",
    code: `
      import std/[strutils, sequtils]

      let v = stdin.readLine.split.map(parseInt)
      echo v[0] + v[1]`,
    time: "O(1)",
    space: "O(1)",
    noWarn: true,
  },
];

for (const g of CASES) test(g.id, () => void check(g));
