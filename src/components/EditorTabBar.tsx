import { useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { MAX_TABS, TAB_NAME_MAX } from "../lib/editorTabs";
import type { EditorTabs } from "../lib/editorTabs";

interface Props {
  tabs: EditorTabs;
  onSwitch: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, name: string) => void;
  onClose: (id: string) => void;
  /** 右端に置くコードへの操作(計算量を調べる・テンプレートに戻す) */
  children?: ReactNode;
}

/**
 * エディターのコードのタブ。押すと切り替え、名前はダブルクリックか ✎ で変える(Enter で決定・Esc で取り消し)。
 * 矢印キーで隣のタブへ移る(タブが1つなら閉じるボタンは出さない)
 */
export function EditorTabBar({ tabs, onSwitch, onAdd, onRename, onClose, children }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  const startRename = (id: string) => {
    const t = tabs.tabs.find((x) => x.id === id);
    if (!t) return;
    setDraft(t.name);
    setEditing(id);
  };

  const commit = () => {
    if (editing === null) return;
    const name = draft.trim().slice(0, TAB_NAME_MAX);
    // 空にしたときは元の名前のまま
    if (name !== "") onRename(editing, name);
    setEditing(null);
  };

  const focusTab = (id: string) =>
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLButtonElement>(`[data-tab="${id}"]`)?.focus());

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, id: string) => {
    const i = tabs.tabs.findIndex((t) => t.id === id);
    if (e.key === "F2") {
      e.preventDefault();
      startRename(id);
      return;
    }
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const next = tabs.tabs[(i + step + tabs.tabs.length) % tabs.tabs.length];
    onSwitch(next.id);
    focusTab(next.id);
  };

  const full = tabs.tabs.length >= MAX_TABS;

  return (
    <div className="editor-tabs">
      <div className="editor-tab-list" role="tablist" aria-label="コードのタブ" ref={listRef}>
        {tabs.tabs.map((t) => {
          const on = t.id === tabs.active;
          return (
            <div key={t.id} className={on ? "editor-tab on" : "editor-tab"}>
              {editing === t.id ? (
                <input
                  className="editor-tab-input"
                  value={draft}
                  maxLength={TAB_NAME_MAX}
                  aria-label="タブの名前"
                  autoFocus
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commit}
                  onKeyDown={(e) => {
                    // 日本語入力の確定の Enter では決めない
                    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commit();
                      focusTab(t.id);
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      setEditing(null);
                      focusTab(t.id);
                    }
                  }}
                  style={{ width: `${Math.max(4, Math.min(TAB_NAME_MAX, draft.length + 1))}em` }}
                />
              ) : (
                <button
                  type="button"
                  role="tab"
                  data-tab={t.id}
                  aria-selected={on}
                  tabIndex={on ? 0 : -1}
                  className="editor-tab-name"
                  onClick={() => onSwitch(t.id)}
                  onDoubleClick={() => startRename(t.id)}
                  onKeyDown={(e) => onTabKey(e, t.id)}
                  title={`${t.name}(ダブルクリックか F2 で名前を変更)`}
                >
                  {t.name}
                </button>
              )}
              {on && editing !== t.id && (
                <button
                  type="button"
                  className="editor-tab-icon"
                  onClick={() => startRename(t.id)}
                  aria-label={`タブ「${t.name}」の名前を変える`}
                  title="名前を変える"
                >
                  ✎
                </button>
              )}
              {tabs.tabs.length > 1 && editing !== t.id && (
                <button
                  type="button"
                  className="editor-tab-icon"
                  onClick={() => onClose(t.id)}
                  aria-label={`タブ「${t.name}」を閉じる`}
                  title="タブを閉じる"
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className="editor-tab-add"
        onClick={onAdd}
        disabled={full}
        aria-label="新しいタブ"
        title={full ? `タブは ${MAX_TABS} 個までです` : "新しいタブ(いまの言語のテンプレートで始めます)"}
      >
        +
      </button>
      {children}
    </div>
  );
}
