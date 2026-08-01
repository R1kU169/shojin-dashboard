// 「マイページ」で表示する自分のAtCoder ID(閲覧者ごとにブラウザへ保存)
const KEY = "shojin:myId";

export function getMyId(): string | null {
  return localStorage.getItem(KEY);
}

export function setMyId(id: string): void {
  localStorage.setItem(KEY, id);
}

export function clearMyId(): void {
  localStorage.removeItem(KEY);
}

/**
 * AtCoder IDの同一判定。AtCoderのIDは大文字小文字を区別しない扱いなので、
 * /u/R1kU169 と /u/r1ku169 を同じ人として扱う。
 */
export function sameId(a: string | null, b: string | null): boolean {
  if (a == null || b == null) return false;
  return a.toLowerCase() === b.toLowerCase();
}
