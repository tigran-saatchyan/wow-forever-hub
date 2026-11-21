/**
 * A tooltip that never leaves the screen: shown beside its anchor while the anchor is hovered or focused, under it
 * (above when there is no room below), moved in from the edges of the window. Drawn on the page's top level, so
 * no panel cuts it off.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const GAP = 6, MARGIN = 8;

export function useEdgeTip() {
  const anchor = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const bind = {
    // the ref object itself, not a new callback each render: a new callback is detached and attached again on
    // every render, after the tooltip inside has measured, which then finds no anchor
    ref: anchor as React.RefObject<HTMLSpanElement>,
    onMouseEnter: () => setOpen(true), onMouseLeave: () => setOpen(false),
    onFocus: () => setOpen(true), onBlur: () => setOpen(false),
  };
  return { anchor, open, bind };
}

export function EdgeTip({ anchor, open, children, className = "" }:
  { anchor: React.RefObject<HTMLElement | null>; open: boolean; children: ReactNode; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  // measured after every render while open (the box has its size only once drawn); set only when it moves
  useLayoutEffect(() => {
    if (!open || !anchor.current || !box.current) return;
    const a = anchor.current.getBoundingClientRect();
    const b = box.current.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const left = Math.round(Math.min(Math.max(MARGIN, a.left + a.width / 2 - b.width / 2), vw - b.width - MARGIN));
    const below = a.bottom + GAP;
    const top = Math.round(below + b.height <= vh - MARGIN ? below : Math.max(MARGIN, a.top - GAP - b.height));
    if (!pos || pos.left !== left || pos.top !== top) setPos({ left, top });
  });
  useLayoutEffect(() => { if (!open) setPos(null); }, [open]);
  if (!open) return null;
  return createPortal(
    <div ref={box} role="tooltip" className={`wow-tip edge-tip ${className}`}
      style={{ position: "fixed", left: pos?.left ?? -9999, top: pos?.top ?? -9999, zIndex: 200 }}>
      {children}
    </div>,
    document.body,
  );
}
