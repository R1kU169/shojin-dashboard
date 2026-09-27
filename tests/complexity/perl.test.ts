// Perl のゴールデンテスト(docs/complexity-analyzer-plan.md §7.7)。
// $x / @a / %h は sigil 付きの識別子として読み、$a と @a は同じ変数として扱う。
import { test } from "node:test";
import { check } from "./helpers.ts";
import type { Golden } from "./helpers.ts";

const CASES: Golden[] = [
  {
    id: "P1 chomp(my $n = <STDIN>)・split / /・for my $i (0..$n-1)・修飾子の if",
    lang: "perl",
    code: `
      chomp(my $n = <STDIN>);
      my @a = split / /, <STDIN>;
      my $cnt = 0;
      for my $i (0..$n-1) {
          for my $j ($i+1..$n-1) {
              $cnt++ if $a[$i] + $a[$j] == 0;
          }
      }
      print "$cnt\\n";`,
    time: "O(N²)",
    space: "O(N)",
    noWarn: true,
  },
  {
    id: "P2 split ' '・map { } split・sort { $a <=> $b }・grep { }",
    lang: "perl",
    code: `
      my ($n, $m) = split ' ', <STDIN>;
      my @a = map { $_ * 2 } split ' ', <STDIN>;
      my @b = sort { $a <=> $b } @a;
      my @c = grep { $_ > $m } @b;
      print scalar(@c), "\\n";`,
    time: "O(N log N)",
    space: "O(N)",
  },
  {
    id: "P3 C 形式の for の i * i <= n と、割っていく while",
    lang: "perl",
    code: `
      my $n = <STDIN>;
      my $c = 0;
      for (my $i = 1; $i * $i <= $n; $i++) {
          $c++;
      }
      my $k = $n;
      while ($k > 0) {
          $k = int($k / 2);
      }
      print "$c\\n";`,
    time: "O(√N)",
    space: "O(1)",
    noWarn: true,
  },
  {
    id: "P4 (0) x ($n + 1)・sub の再帰(my ($k) = @_)・print for @memo",
    lang: "perl",
    code: `
      my $n = <STDIN>;
      my @memo = (0) x ($n + 1);
      sub fact {
          my ($k) = @_;
          return 1 if $k <= 1;
          return $k * fact($k - 1);
      }
      print fact($n), "\\n";
      print "$_\\n" for @memo;`,
    time: "O(N)",
    space: "O(N)",
    noWarn: true,
  },
  {
    id: "P5 リテラルの配列・文字列の中の {・ヒアドキュメント・s{a}{b}g・until",
    lang: "perl",
    code: `
      my @a = (3, 1, 2);
      my $s = "a{b";
      my $t = <<'EOS';
      } for (;;) { while (1) {
      EOS
      $s =~ s{a}{b}g;
      my $i = 0;
      until ($i >= 1000) {
          $i++;
      }
      print for @a;`,
    time: "O(1000)",
    space: "O(1)",
    noWarn: true,
  },
  {
    id: "P6 do { local $/; <STDIN> } の一括読み込み・shift と splice・sort keys %h・$cnt{$_}++ for @a",
    lang: "perl",
    code: `
      my @in = split /\\s+/, do { local $/; <STDIN> };
      my $n = shift @in;
      my @a = splice @in, 0, $n;
      my %cnt;
      $cnt{$_}++ for @a;
      for (sort keys %cnt) {
          print "$_ $cnt{$_}\\n";
      }`,
    time: "O(N log N)",
    space: "O(N + |in|)",
  },
  {
    id: "P7 if / elsif / else・ハッシュのキーの for と sort・1 << $n の全探索・push @rows, \\\\@f",
    lang: "perl",
    code: `
      my $n = <STDIN>;
      my %h = (for => 1, sort => 2);
      print $h{sort};
      my $full = 1 << $n;
      my @rows;
      for my $mask (0 .. $full - 1) {
          my @f;
          if ($mask % 3 == 0) {
              push @f, 1;
          } elsif ($mask % 3 == 1) {
              push @f, 2;
          } else {
              push @f, 3;
          }
          push @rows, \\@f if @f > 5;
      }`,
    time: "O(2^N)",
    space: "O(2^N)",
  },
  {
    id: "P8 テンプレート(A+B)",
    lang: "perl",
    code: `
      my ($x, $y) = split /\\s+/, <STDIN>;
      print $x + $y, "\\n";`,
    time: "O(1)",
    space: "O(1)",
    noWarn: true,
  },
];

for (const g of CASES) test(g.id, () => void check(g));
