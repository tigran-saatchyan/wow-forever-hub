/**
 * Sylvanas' Lamenters: the two banshees her music box summons in the game ("Lament of the Highborne",
 * spell 73331, creature 39048). They are the game's own banshee model (display 10702, magenta), drawn by
 * Wowhead's 3D model viewer, see-through as in the game, at the sides of the screen while the Lament plays.
 * The viewer's files come through the hub (/api/media/zam), since wow.zamimg.com refuses other sites.
 */
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef } from "react";
import { PLAYLIST, usePlayer } from "./music";

const LAMENT = 53221;
const DISPLAY = 10702;
const CONTENT = "/api/media/zam/live/";

type Viewer = { destroy?: () => void };
declare global {
  interface Window {
    ZamModelViewer?: new (o: unknown) => Viewer;
    jQuery?: unknown;
    $?: unknown;
    WH?: unknown;
    CONTENT_PATH?: string;
  }
}

let loading: Promise<void> | null = null;
function script(src: string) {
  return new Promise<void>((ok, fail) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => ok();
    s.onerror = () => fail(new Error(src));
    document.head.appendChild(s);
  });
}
/** jQuery (the viewer needs it) and the viewer itself, once. */
function loadViewer() {
  if (!loading) {
    window.CONTENT_PATH = CONTENT;
    window.WH = window.WH || { debug: () => {}, defaultAnimation: "Stand", WebP: { getImageExtension: () => ".webp" } };
    // the viewer expects jQuery as a global; it is bundled, not taken from a CDN
    loading = import("jquery")
      .then((m) => {
        window.jQuery = window.$ = m.default;
      })
      .then(() => script(CONTENT + "viewer/viewer.min.js"));
  }
  return loading;
}

function Lamenter({ side }: { side: "left" | "right" }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let viewer: Viewer | null = null;
    let gone = false;
    void loadViewer().then(() => {
      const el = box.current;
      if (gone || !el || !window.ZamModelViewer || !window.jQuery) return;
      const $ = window.jQuery as (e: Element) => unknown;
      viewer = new window.ZamModelViewer({
        type: 2, contentPath: CONTENT, container: $(el), aspect: el.clientWidth / el.clientHeight, hd: true,
        models: { type: 8, id: DISPLAY },
      });
    }).catch(() => {});
    return () => {
      gone = true;
      try {
        viewer?.destroy?.();
      } catch {
        /* the viewer may not be fully built yet */
      }
    };
  }, []);
  return <div ref={box} className={`lamenter ${side}`} />;
}

export function Lamenters() {
  const st = usePlayer();
  const on = st.playing && PLAYLIST[st.index]?.id === LAMENT;
  return (
    <AnimatePresence>
      {on && (
        <motion.div
          key="lamenters" aria-hidden className="pointer-events-none fixed inset-0 z-[5] overflow-hidden"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 2.2 }}
        >
          <Lamenter side="left" />
          <Lamenter side="right" />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
