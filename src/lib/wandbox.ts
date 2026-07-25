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
}

export const EDITOR_LANGS: EditorLang[] = [
  {
    key: "cpp",
    label: "C++ (GCC 13)",
    compiler: "gcc-13.2.0",
    version: "C++17",
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
    key: "java",
    label: "Java (OpenJDK)",
    compiler: "openjdk-jdk-22+36",
    version: "JDK 22",
    template: `import java.util.*;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int a = sc.nextInt(), b = sc.nextInt();
        System.out.println(a + b);
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
  signal?: AbortSignal,
): Promise<RunResult> {
  const res = await fetch(`${API}/compile.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ compiler, code, stdin }),
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
