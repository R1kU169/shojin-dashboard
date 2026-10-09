// localStorage は、プライベートモードやサイトデータのブロックで読み書きが例外になり、
// 容量(5MB 程度)を超えると書き込みが例外になる。どれもページを止めないよう、ここを通して使う。

export function readStore(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** 保存できたら true。できなくても(プライベートモード・容量超過)ページは動かす */
export function writeStore(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeStore(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // 消せなくても続ける
  }
}
