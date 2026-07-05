// 「マイページ」で表示する自分のAtCoder ID(閲覧者ごとにブラウザへ保存)
const KEY = "shojin:myId";

export function getMyId(): string | null {
  return localStorage.getItem(KEY);
}

export function setMyId(id: string): void {
  localStorage.setItem(KEY, id);
}
