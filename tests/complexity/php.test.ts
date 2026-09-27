// PHP のゴールデンテスト(docs/complexity-analyzer-plan.md §7.7)。
// $ を落とした波括弧系として読み、代替構文(for (…): … endfor;)と array( は字句の後で直す。
import { test } from "node:test";
import { check } from "./helpers.ts";
import type { Golden } from "./helpers.ts";

const CASES: Golden[] = [
  {
    id: "Q1 fscanf と array_map の入力・二重ループ・波括弧なしの if",
    lang: "php",
    code: `
      <?php
      fscanf(STDIN, "%d", $n);
      $a = array_map("intval", explode(" ", trim(fgets(STDIN))));
      $cnt = 0;
      for ($i = 0; $i < $n; $i++) {
          for ($j = $i + 1; $j < $n; $j++) {
              if ($a[$i] + $a[$j] == 0) $cnt++;
          }
      }
      echo $cnt, PHP_EOL;`,
    time: "O(N²)",
    space: "O(N)",
    noWarn: true,
  },
  {
    id: "Q2 array_fill の2次元・foreach の $i => $row・sort",
    lang: "php",
    code: `
      <?php
      [$h, $w] = array_map("intval", explode(" ", trim(fgets(STDIN))));
      $grid = array_fill(0, $h, array_fill(0, $w, 0));
      foreach ($grid as $i => $row) {
          for ($j = 0; $j < $w; $j++) $grid[$i][$j] = $i + $j;
      }
      $n = intval(fgets(STDIN));
      $a = array_map("intval", explode(" ", trim(fgets(STDIN))));
      sort($a);
      echo $grid[$h - 1][$w - 1], PHP_EOL;`,
    time: "O(H·W + N log N)",
    space: "O(H·W + N)",
    noWarn: true,
  },
  {
    id: "Q3 代替構文と intdiv と ?>",
    lang: "php",
    code: `
      <?php
      $n = intval(fgets(STDIN));
      $total = 0;
      for ($i = 1; $i <= $n; $i++):
          $k = $i;
          while ($k > 0):
              $total += $k % 2;
              $k = intdiv($k, 2);
          endwhile;
          if ($total > 10):
              $total -= 10;
          elseif ($total < 0):
              $total = 0;
          else:
              $total += 1;
          endif;
      endfor;
      echo $total;
      ?>
      <p>done</p>`,
    time: "O(N log N)",
    space: "O(1)",
    noWarn: true,
  },
  {
    id: "Q4 use (&$fact) の再帰・usort・ヒアドキュメントの中の } while (",
    lang: "php",
    code: `
      <?php
      $fact = function (int $k) use (&$fact): int {
          if ($k <= 1) return 1;
          return $k * $fact($k - 1);
      };
      $n = intval(fgets(STDIN));
      $a = array_map("intval", explode(" ", trim(fgets(STDIN))));
      usort($a, fn($x, $y) => $x <=> $y);
      $s = <<<EOS
        } while ( for (;;) {
      EOS;
      echo $fact($n), $s;`,
    time: "O(N log N)",
    space: "O(N)",
  },
  {
    id: "Q5 SplQueue の BFS と $adj[$u][] = $v",
    lang: "php",
    code: `
      <?php
      [$n, $m] = array_map("intval", explode(" ", trim(fgets(STDIN))));
      $adj = array_fill(0, $n, []);
      for ($i = 0; $i < $m; $i++) {
          [$u, $v] = array_map("intval", explode(" ", trim(fgets(STDIN))));
          $adj[$u][] = $v;
          $adj[$v][] = $u;
      }
      $dist = array_fill(0, $n, -1);
      $dist[0] = 0;
      $q = new SplQueue();
      $q->enqueue(0);
      while (!$q->isEmpty()) {
          $u = $q->dequeue();
          foreach ($adj[$u] as $v) {
              if ($dist[$v] === -1) {
                  $dist[$v] = $dist[$u] + 1;
                  $q->enqueue($v);
              }
          }
      }
      echo implode(" ", $dist), PHP_EOL;`,
    time: "O(N + M)",
    space: "O(N + M)",
  },
  {
    id: "Q6 array_sum(array_map(fn…))・max(...$a)・sqrt の上限・<<= と (int) の割り算",
    lang: "php",
    code: `
      <?php
      $n = intval(fgets(STDIN));
      $a = array_map("intval", explode(" ", trim(fgets(STDIN))));
      echo array_sum(array_map(fn($x) => $x * 2, $a)), PHP_EOL;
      echo max(...$a), PHP_EOL;
      $c = 0;
      for ($i = 1; $i <= sqrt($n); $i++) $c++;
      $len = 1;
      while ($len < $n) $len <<= 1;
      $k = $n;
      while ($k > 0) $k = (int)($k / 2);
      echo $c + $len;`,
    time: "O(N)",
    space: "O(N)",
    noWarn: true,
  },
  {
    id: "Q7 クラスのメソッドと $this・str_split の行",
    lang: "php",
    code: `
      <?php
      class Main {
          private array $g = [];
          public function run(): void {
              [$h, $w] = array_map("intval", explode(" ", trim(fgets(STDIN))));
              for ($i = 0; $i < $h; $i++) {
                  $this->g[] = str_split(trim(fgets(STDIN)));
              }
              $cnt = 0;
              for ($i = 0; $i < $h; $i++) {
                  for ($j = 0; $j < $w; $j++) {
                      if ($this->g[$i][$j] === "#") $cnt++;
                  }
              }
              echo $cnt, PHP_EOL;
          }
      }
      (new Main)->run();`,
    time: "O(H·W)",
    space: "O(H·N)",
  },
  {
    id: "Q8 テンプレート(A+B)",
    lang: "php",
    code: `
      <?php
      [$a, $b] = array_map("intval", preg_split("/\\s+/", trim(fgets(STDIN))));
      echo $a + $b, PHP_EOL;`,
    time: "O(1)",
    space: "O(1)",
    noWarn: true,
  },
];

for (const g of CASES) test(g.id, () => void check(g));
