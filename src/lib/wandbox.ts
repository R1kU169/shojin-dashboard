// Wandbox (https://wandbox.org) でコードをコンパイル・実行する。
// CORS全開放・APIキー不要なのでブラウザから直接叩ける。
// 注意: コードと標準入力は外部サービス(wandbox.org)に送信される。
const API = "https://wandbox.org/api";

/** エディターで選べる言語(コンパイラは安定版を固定)。 */
export interface EditorLang {
  /** 表示名 */
  label: string;
  /** Wandboxのcompiler名 */
  compiler: string;
  /** コンパイラ/処理系のバージョン表示 */
  version: string;
  /** localStorage保存やUIのキー */
  key: string;
  /** 初期コード */
  template: string;
  /** Wandboxに渡すスイッチ(カンマ区切り)。未指定はコンパイラのデフォルト */
  options?: string;
}

// 各言語のテンプレートはA+B問題の解答例。全言語とも実際にWandboxで
// stdin "3 4" → "7" が出ることを検証済み(動かない言語は載せない)。
// 注: WandboxはJavaをprog.javaで保存するため public class Main は使えない。
export const EDITOR_LANGS: EditorLang[] = [
  {
    key: "cpp",
    label: "C++ (GCC 13)",
    compiler: "gcc-13.2.0",
    version: "C++23",
    // オプション未指定だとgccデフォルト(gnu++17)になるため、gnu++2b(=C++23)を明示
    options: "warning,gnu++2b",
    template: `#include <bits/stdc++.h>
using namespace std;

int main() {
    int a, b;
    cin >> a >> b;
    cout << a + b << endl;
}
`,
  },
  {
    key: "python",
    label: "Python 3",
    compiler: "cpython-3.14.0",
    version: "CPython 3.14",
    template: `a, b = map(int, input().split())
print(a + b)
`,
  },
  {
    key: "pypy",
    label: "PyPy 3",
    compiler: "pypy-3.10-v7.3.17",
    version: "PyPy 3.10",
    template: `a, b = map(int, input().split())
print(a + b)
`,
  },
  {
    key: "java",
    label: "Java (OpenJDK)",
    compiler: "openjdk-jdk-22+36",
    version: "JDK 22",
    template: `import java.util.*;

class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int a = sc.nextInt(), b = sc.nextInt();
        System.out.println(a + b);
    }
}
`,
  },
  {
    key: "c",
    label: "C (GCC 13)",
    compiler: "gcc-13.2.0-c",
    version: "C17",
    template: `#include <stdio.h>

int main(void) {
    int a, b;
    scanf("%d %d", &a, &b);
    printf("%d\\n", a + b);
    return 0;
}
`,
  },
  {
    key: "csharp",
    label: "C# (Mono)",
    compiler: "mono-6.12.0.199",
    version: "Mono 6.12",
    template: `using System;
using System.Linq;

class Program {
    static void Main() {
        var v = Console.ReadLine().Split().Select(int.Parse).ToArray();
        Console.WriteLine(v[0] + v[1]);
    }
}
`,
  },
  {
    key: "rust",
    label: "Rust",
    compiler: "rust-1.82.0",
    version: "rustc 1.82",
    template: `use std::io::*;

fn main() {
    let mut s = String::new();
    stdin().read_to_string(&mut s).unwrap();
    let v: Vec<i64> = s.split_whitespace().map(|x| x.parse().unwrap()).collect();
    println!("{}", v[0] + v[1]);
}
`,
  },
  {
    key: "go",
    label: "Go",
    compiler: "go-1.23.2",
    version: "Go 1.23",
    template: `package main

import "fmt"

func main() {
    var a, b int
    fmt.Scan(&a, &b)
    fmt.Println(a + b)
}
`,
  },
  {
    key: "js",
    label: "JavaScript (Node)",
    compiler: "nodejs-20.17.0",
    version: "Node 20",
    template: `const [a, b] = require("fs").readFileSync(0, "utf8").split(/\\s+/).map(Number);
console.log(a + b);
`,
  },
  {
    key: "ts",
    label: "TypeScript",
    compiler: "typescript-5.6.2",
    version: "TS 5.6",
    template: `declare function require(name: string): any;
const [a, b] = require("fs").readFileSync(0, "utf8").split(/\\s+/).map(Number);
console.log(a + b);
`,
  },
  {
    key: "ruby",
    label: "Ruby",
    compiler: "ruby-3.4.9",
    version: "Ruby 3.4",
    template: `a, b = gets.split.map(&:to_i)
puts a + b
`,
  },
  {
    key: "haskell",
    label: "Haskell (GHC)",
    compiler: "ghc-9.10.1",
    version: "GHC 9.10",
    template: `main :: IO ()
main = do
    [a, b] <- map read . words <$> getContents
    print (a + b :: Int)
`,
  },
  {
    key: "d",
    label: "D (DMD)",
    compiler: "dmd-2.109.1",
    version: "DMD 2.109",
    template: `import std.stdio, std.array, std.conv;

void main() {
    auto v = readln.split.to!(int[]);
    writeln(v[0] + v[1]);
}
`,
  },
  {
    key: "nim",
    label: "Nim",
    compiler: "nim-2.2.10",
    version: "Nim 2.2",
    template: `import std/[strutils, sequtils]

let v = stdin.readLine.split.map(parseInt)
echo v[0] + v[1]
`,
  },
  {
    key: "julia",
    label: "Julia",
    compiler: "julia-1.10.5",
    version: "Julia 1.10",
    template: `a, b = parse.(Int, split(readline()))
println(a + b)
`,
  },
  {
    key: "perl",
    label: "Perl",
    compiler: "perl-5.42.0",
    version: "Perl 5.42",
    template: `my ($x, $y) = split /\\s+/, <STDIN>;
print $x + $y, "\\n";
`,
  },
  {
    key: "php",
    label: "PHP",
    compiler: "php-8.3.12",
    version: "PHP 8.3",
    template: `<?php
[$a, $b] = array_map("intval", preg_split("/\\s+/", trim(fgets(STDIN))));
echo $a + $b, PHP_EOL;
`,
  },
  {
    key: "lua",
    label: "Lua",
    compiler: "lua-5.4.7",
    version: "Lua 5.4",
    template: `local a, b = io.read("*n"), io.read("*n")
print(a + b)
`,
  },
  {
    key: "bash",
    label: "Bash",
    compiler: "bash",
    version: "bash",
    template: `read a b
echo $((a + b))
`,
  },
];

export interface RunResult {
  /** プログラムの終了コード(文字列。シグナル終了時は空) */
  status: string;
  signal: string;
  compilerError: string;
  stdout: string;
  stderr: string;
}

/** コードを実行して結果を返す。ネットワーク/サービスエラー時は例外。 */
export async function runCode(
  compiler: string,
  code: string,
  stdin: string,
  options?: string,
  signal?: AbortSignal,
): Promise<RunResult> {
  const res = await fetch(`${API}/compile.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ compiler, code, stdin, ...(options ? { options } : {}) }),
    signal,
  });
  if (!res.ok) throw new Error(`実行APIエラー (HTTP ${res.status})`);
  const j = (await res.json()) as {
    status?: string;
    signal?: string;
    compiler_error?: string;
    compiler_message?: string;
    program_output?: string;
    program_error?: string;
  };
  return {
    status: j.status ?? "",
    signal: j.signal ?? "",
    compilerError: j.compiler_error ?? j.compiler_message ?? "",
    stdout: j.program_output ?? "",
    stderr: j.program_error ?? "",
  };
}
