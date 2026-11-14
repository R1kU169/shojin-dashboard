// エディターのコードのタブ(名前・言語・言語ごとのコード)の保存。
// エディター(EditorPage)と計算量タブの「エディターから読み込む」が使う。テストから Node で直接読むので拡張子付きで import する
import { readStore, writeStore } from "./storage.ts";

// タブごとに名前・言語と、言語ごとのコードを持つ(1つのタブの中で言語を切り替えても、前の言語のコードは残る)。
// 最初のタブ(FIRST_TAB)のコードは、タブを入れる前と同じキー(shojin:editor:code:<言語>)に置く。
// shojin:editor:lang には開いているタブの言語を書く(計算量タブが最初の言語に使う)

const TABS_KEY = "shojin:editor:tabs";
export const EDITOR_LANG_KEY = "shojin:editor:lang";
export const FIRST_TAB = "1";
/** タブの数の上限 */
export const MAX_TABS = 20;
/** タブの名前の長さの上限 */
export const TAB_NAME_MAX = 30;

export interface EditorTab {
  id: string;
  name: string;
  /** このタブで選んでいる言語 */
  lang: string;
}

export interface EditorTabs {
  /** 開いているタブの id */
  active: string;
  tabs: EditorTab[];
}

/** タブ id・言語ごとのコードの保存キー */
export const tabCodeKey = (tab: string, lang: string) =>
  tab === FIRST_TAB ? `shojin:editor:code:${lang}` : `shojin:editor:tab:${tab}:code:${lang}`;

const defaultTabs = (lang: string): EditorTabs => ({ active: FIRST_TAB, tabs: [{ id: FIRST_TAB, name: "コード1", lang }] });

/**
 * 保存したタブの一覧を読む。無い・壊れているときは、タブを入れる前のコード(最初のタブのキー)を
 * そのまま開く1つのタブにする。fallbackLang は言語が読めないタブに使う
 */
export function parseTabs(raw: string | null, fallbackLang: string): EditorTabs {
  if (!raw) return defaultTabs(fallbackLang);
  try {
    const j = JSON.parse(raw) as Partial<EditorTabs>;
    const seen = new Set<string>();
    const tabs: EditorTab[] = [];
    for (const t of Array.isArray(j.tabs) ? j.tabs : []) {
      if (!t || typeof t.id !== "string" || !/^\d+$/.test(t.id) || seen.has(t.id)) continue;
      seen.add(t.id);
      const name = typeof t.name === "string" && t.name.trim() !== "" ? t.name.trim().slice(0, TAB_NAME_MAX) : `コード${t.id}`;
      tabs.push({ id: t.id, name, lang: typeof t.lang === "string" && t.lang ? t.lang : fallbackLang });
    }
    if (tabs.length === 0) return defaultTabs(fallbackLang);
    const active = typeof j.active === "string" && seen.has(j.active) ? j.active : tabs[0].id;
    return { active, tabs: tabs.slice(0, MAX_TABS) };
  } catch {
    return defaultTabs(fallbackLang);
  }
}

export function loadTabs(fallbackLang: string): EditorTabs {
  return parseTabs(readStore(TABS_KEY), readStore(EDITOR_LANG_KEY) ?? fallbackLang);
}

export function saveTabs(t: EditorTabs): void {
  writeStore(TABS_KEY, JSON.stringify(t));
  const a = t.tabs.find((x) => x.id === t.active);
  if (a) writeStore(EDITOR_LANG_KEY, a.lang);
}

/** 新しいタブの id(使ったことのある最大の番号 + 1。閉じたタブの id は使い回さないよう、いまある最大より大きくする) */
export function newTabId(t: EditorTabs): string {
  return String(Math.max(0, ...t.tabs.map((x) => Number(x.id))) + 1);
}

/** 新しいタブの名前: 「コードN」(N はタブの数 + 1 から、まだ使っていない番号) */
export function newTabName(t: EditorTabs): string {
  const names = new Set(t.tabs.map((x) => x.name));
  for (let n = t.tabs.length + 1; ; n++) {
    if (!names.has(`コード${n}`)) return `コード${n}`;
  }
}

/** 開いているタブの言語とコード(計算量タブの「エディターから読み込む」に使う)。コードが無ければ code は null */
export function loadEditorCode(fallbackLang: string): { lang: string; code: string | null } {
  const t = loadTabs(fallbackLang);
  const a = t.tabs.find((x) => x.id === t.active) ?? t.tabs[0];
  return { lang: a.lang, code: readStore(tabCodeKey(a.id, a.lang)) };
}
