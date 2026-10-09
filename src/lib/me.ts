import { readStore, removeStore, writeStore } from "./storage";

// 「マイページ」で表示する自分のAtCoder ID(閲覧者ごとにブラウザへ保存)
const KEY = "shojin:myId";
// 最後に開いた個人ページのID(トップとマイページ設定の入力欄に入れておく)
const LAST_KEY = "shojin:lastUser";

export function getMyId(): string | null {
  return readStore(KEY);
}

export function setMyId(id: string): void {
  writeStore(KEY, id);
}

export function clearMyId(): void {
  removeStore(KEY);
}

export function getLastUser(): string | null {
  return readStore(LAST_KEY);
}

export function setLastUser(id: string): void {
  writeStore(LAST_KEY, id);
}

/**
 * AtCoder IDの同一判定。AtCoderのIDは大文字小文字を区別しない扱いなので、
 * /u/R1kU169 と /u/r1ku169 を同じ人として扱う。
 */
export function sameId(a: string | null, b: string | null): boolean {
  if (a == null || b == null) return false;
  return a.toLowerCase() === b.toLowerCase();
}
