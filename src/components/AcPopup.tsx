import { createPortal } from "react-dom";

/**
 * 識別子補完のポップアップ。
 *
 * document.body へポータルで出す。エディターは .editor-pane と .editor-card が
 * 二重に overflow: hidden で、さらに .page > * の登場アニメーションが transform を
 * 当てる間は position: fixed の包含ブロックにもなるため、DOM上の子として置くと
 * どうやっても切られてしまう。
 */
export function AcPopup({
  items,
  index,
  x,
  y,
  above,
  onPick,
  onHover,
}: {
  items: string[];
  index: number;
  x: number;
  y: number;
  above: boolean;
  onPick: (word: string) => void;
  onHover: (i: number) => void;
}) {
  return createPortal(
    <ul
      className={above ? "ac-popup above" : "ac-popup"}
      style={{ left: x, top: y }}
      role="listbox"
      aria-label="補完候補"
    >
      {items.map((w, i) => (
        <li
          key={w}
          role="option"
          aria-selected={i === index}
          className={i === index ? "ac-opt on" : "ac-opt"}
          // クリック前にblurするとポップアップが閉じてクリックが届かない
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={() => onHover(i)}
          onClick={() => onPick(w)}
        >
          {w}
        </li>
      ))}
    </ul>,
    document.body,
  );
}
