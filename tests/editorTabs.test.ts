// エディターのコードのタブの読み込み(壊れたデータ・タブを入れる前のデータ)と、新しいタブの id・名前
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_TABS, newTabId, newTabName, parseTabs, tabCodeKey, TAB_NAME_MAX } from "../src/lib/editorTabs.ts";

test("parseTabs: 保存が無い・壊れているときは、タブを入れる前のコードを開く1つのタブ", () => {
  const one = { active: "1", tabs: [{ id: "1", name: "コード1", lang: "cpp" }] };
  assert.deepEqual(parseTabs(null, "cpp"), one);
  assert.deepEqual(parseTabs("{", "cpp"), one);
  assert.deepEqual(parseTabs('{"tabs":[]}', "cpp"), one);
  // 最初のタブはタブを入れる前と同じキー
  assert.equal(tabCodeKey("1", "cpp"), "shojin:editor:code:cpp");
  assert.equal(tabCodeKey("3", "cpp"), "shojin:editor:tab:3:code:cpp");
});

test("parseTabs: おかしなタブを飛ばし、名前を整え、開いているタブが無ければ先頭を開く", () => {
  const raw = JSON.stringify({
    active: "9",
    tabs: [
      { id: "2", name: "  A問題  ", lang: "python" },
      { id: "2", name: "重複", lang: "cpp" },
      { id: "x", name: "id が数字でない", lang: "cpp" },
      null,
      { id: "5", name: "", lang: "" },
      { id: "6", name: "あ".repeat(50), lang: "rust" },
    ],
  });
  const t = parseTabs(raw, "cpp");
  assert.equal(t.active, "2");
  assert.deepEqual(
    t.tabs.map((x) => [x.id, x.name, x.lang]),
    [
      ["2", "A問題", "python"],
      ["5", "コード5", "cpp"],
      ["6", "あ".repeat(TAB_NAME_MAX), "rust"],
    ],
  );
  const many = JSON.stringify({ active: "1", tabs: Array.from({ length: 30 }, (_, i) => ({ id: String(i + 1), name: `t${i}`, lang: "cpp" })) });
  assert.equal(parseTabs(many, "cpp").tabs.length, MAX_TABS);
});

test("newTabId / newTabName: id は使い回さず、名前はまだ無い「コードN」", () => {
  const t = {
    active: "4",
    tabs: [
      { id: "1", name: "コード1", lang: "cpp" },
      { id: "4", name: "コード3", lang: "cpp" },
    ],
  };
  assert.equal(newTabId(t), "5");
  assert.equal(newTabName(t), "コード4");
  assert.equal(newTabName({ active: "1", tabs: [{ id: "1", name: "A", lang: "cpp" }] }), "コード2");
});
