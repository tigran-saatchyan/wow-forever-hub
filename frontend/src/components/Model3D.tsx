/** A creature's model from the game (by display id), drawn by Wowhead's viewer through the hub, see-through. */
import { useEffect, useRef, useState } from "react";
import { CONTENT, loadViewer, type Viewer } from "../theme/Lamenters";

export function Model3D({ display, className = "" }: { display: number; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    let viewer: Viewer | null = null;
    let gone = false;
    setShown(false);
    void loadViewer().then(() => {
      const el = box.current;
      if (gone || !el || !window.ZamModelViewer || !window.jQuery) return;
      const $ = window.jQuery as (e: Element) => unknown;
      viewer = new window.ZamModelViewer({
        type: 2, contentPath: CONTENT, container: $(el), aspect: el.clientWidth / el.clientHeight, hd: true,
        models: { type: 8, id: display },
      });
      setTimeout(() => !gone && setShown(true), 700);
    }).catch(() => {});
    return () => {
      gone = true;
      try { viewer?.destroy?.(); } catch { /* not built yet */ }
    };
  }, [display]);
  return <div ref={box} className={`model3d ${shown ? "on" : ""} ${className}`} aria-hidden />;
}
