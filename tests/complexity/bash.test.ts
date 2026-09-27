// Bash のゴールデンテスト(docs/complexity-analyzer-plan.md §7.7。簡易対応)。
// コマンドを式に直してから(canonBash)do / then … done / fi を波括弧の形に書き換えて読む。
import { test } from "node:test";
import { check } from "./helpers.ts";
import type { Golden } from "./helpers.ts";

const CASES: Golden[] = [
  {
    id: "B1 read -a と for (( … )) の二重ループ",
    lang: "bash",
    code: `
      read n
      read -a a
      cnt=0
      for ((i=0; i<n; i++)); do
        for ((j=i+1; j<n; j++)); do
          if (( a[i] + a[j] == 0 )); then
            cnt=$((cnt+1))
          fi
        done
      done
      echo $cnt`,
    time: "O(N²)",
    space: "O(N)",
    noWarn: true,
  },
  {
    id: "B2 mapfile < <(… | sort) と while (( lo < hi )) の二分探索",
    lang: "bash",
    code: `
      read n q
      read -a a
      mapfile -t s < <(printf "%s\\n" "\${a[@]}" | sort -n)
      for ((k=0; k<q; k++)); do
        read x
        lo=0; hi=$n
        while (( lo < hi )); do
          mid=$(( (lo + hi) / 2 ))
          if (( s[mid] < x )); then lo=$((mid+1)); else hi=$mid; fi
        done
        echo $lo
      done`,
    time: "O(N log N + Q log N)",
    space: "O(N)",
    noWarn: true,
  },
  {
    id: "B3 関数の再帰 fib(コマンド置換)",
    lang: "bash",
    code: `
      fib() {
        local n=$1
        if (( n < 2 )); then echo $n; return; fi
        echo $(( $(fib $((n-1))) + $(fib $((n-2))) ))
      }
      read n
      fib $n`,
    time: "O(2^N)",
    space: "O(N)",
  },
  {
    id: "B4 dp[i*w+j]=0 と ${#dp[@]}",
    lang: "bash",
    code: `
      read h w
      for ((i=0; i<h; i++)); do
        for ((j=0; j<w; j++)); do
          dp[i*w+j]=0
        done
      done
      echo \${#dp[@]}`,
    time: "O(H·W)",
    space: "O(H·W)",
  },
  {
    id: "B5 文字列の中の done / fi・echo done・case",
    lang: "bash",
    code: `
      x=1
      echo "done $x fi"
      echo done
      case "$1" in
        a) echo a ;;
        *) echo other ;;
      esac
      read n
      for ((i=0; i<n; i++)); do echo $i; done`,
    time: "O(N)",
    space: "O(1)",
    noWarn: true,
  },
  {
    id: "B6 read -ra・b=($line)・state=done・配列の要素を回す for",
    lang: "bash",
    code: `
      read n
      read -ra a
      read -r line
      b=($line)
      state=done
      s=0
      for x in "\${a[@]}"; do
        s=$((s + x))
      done
      echo $s \${#b[@]} $state`,
    time: "O(N)",
    space: "O(N + |b|)",
  },
  {
    id: "B7 パイプの sort と while [ $i -lt $n ]",
    lang: "bash",
    code: `
      read n
      read -a a
      echo "\${a[@]}" | tr " " "\\n" | sort -n | head -1
      i=0
      while [ $i -lt $n ]; do
        i=$((i+1))
      done`,
    time: "O(N log N)",
    space: "O(N)",
    noWarn: true,
  },
  {
    id: "B8 テンプレート(A+B)",
    lang: "bash",
    code: `
      read a b
      echo $((a + b))`,
    time: "O(1)",
    space: "O(1)",
    noWarn: true,
  },
];

for (const g of CASES) test(g.id, () => void check(g));
