// トップの「アップデート内容」を最後に確認したときの、最新アップデートID。
// boolean ではなくIDを持つことで、新しいエントリを足すだけでバナーが復活する。
const KEY = "shojin:updatesSeen";

export function getSeenUpdate(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    // プライベートモード等でlocalStorageが使えない場合は未読扱いにする
    return null;
  }
}

export function setSeenUpdate(id: string): void {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // 保存できなくても表示は消す(次回また出るだけ)
  }
}
