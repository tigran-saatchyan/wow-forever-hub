/** A small player in the header: the Undercity's music in a loop, Sylvanas' lament among it. */
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../lib/i18n";
import { PLAYLIST, player, usePlayer, type Repeat } from "../theme/music";
import { useTheme } from "../theme/ThemeProvider";

const fmt = (s: number) => (isFinite(s) && s > 0 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "0:00");
const REPEAT_NEXT: Record<Repeat, Repeat> = { all: "one", one: "shuffle", shuffle: "all" };
const REPEAT_ICON: Record<Repeat, string> = { all: "🔁", one: "🔂", shuffle: "🔀" };

export function MusicPlayer() {
  const { t, lang } = useI18n();
  const st = usePlayer();
  const { sound, setSound } = useTheme();
  // pressing play while all sound is off turns the sound on: the click is the wish to hear
  const play = (f: () => void) => () => {
    if (!sound) setSound(true);
    f();
  };
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const cur = PLAYLIST[st.index];

  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", off);
    addEventListener("keydown", esc);
    return () => (document.removeEventListener("mousedown", off), removeEventListener("keydown", esc));
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button className="btn gap-1.5 px-2" aria-expanded={open} title={t("mp_title")} onClick={() => setOpen(!open)}>
        {st.playing ? <span className="eq" aria-hidden><i /><i /><i /></span> : <span aria-hidden>♪</span>}
        <span className="hidden max-w-[9rem] truncate text-xs xl:inline">{st.playing ? cur[lang] : t("mp_title")}</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="music-panel absolute right-0 top-full z-50 mt-2 w-[min(340px,calc(100vw-24px))]"
            initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.16 }}
          >
            <div className="p-3">
              <div className="eyebrow">{t("mp_title")}</div>
              <div className="mt-0.5 truncate font-display text-base text-gold">{cur[lang]}</div>
              <input
                type="range" min={0} max={st.duration || 0} step={0.5} value={Math.min(st.time, st.duration || 0)}
                aria-label={t("mp_seek")} className="mt-2 w-full accent-[#74d654]"
                onChange={(e) => player.seek(+e.target.value)}
              />
              <div className="flex justify-between font-mono text-[11px] text-muted"><span>{fmt(st.time)}</span><span>{fmt(st.duration)}</span></div>
              <div className="mt-2 flex items-center gap-1.5">
                <button className="btn px-2.5" onClick={play(player.prev)} aria-label={t("mp_prev")} title={t("mp_prev")}>⏮</button>
                <button className="btn-primary px-3.5" onClick={st.playing ? player.toggle : play(player.toggle)} aria-label={st.playing ? t("mp_pause") : t("mp_play")}>
                  {st.playing ? "⏸" : "▶"}
                </button>
                <button className="btn px-2.5" onClick={play(player.next)} aria-label={t("mp_next")} title={t("mp_next")}>⏭</button>
                <button className="btn px-2.5" onClick={() => player.setRepeat(REPEAT_NEXT[st.repeat])} title={t(`mp_r_${st.repeat}`)} aria-label={t(`mp_r_${st.repeat}`)}>
                  {REPEAT_ICON[st.repeat]}
                </button>
                <input
                  type="range" min={0} max={1} step={0.01} value={st.volume} aria-label={t("mp_volume")}
                  className="ml-auto w-20 accent-[#74d654]" onChange={(e) => player.setVolume(+e.target.value)}
                />
              </div>
            </div>
            <ol className="max-h-64 overflow-y-auto border-t border-edge/60 py-1 text-sm">
              {PLAYLIST.map((tr, i) => (
                <li key={tr.id}>
                  <button
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition hover:bg-accent/10 ${i === st.index ? "text-gold" : ""}`}
                    onClick={play(() => player.pick(i))}
                  >
                    <span className="w-4 text-center text-xs">{i === st.index && st.playing ? "♪" : i + 1}</span>
                    <span className="flex-1 truncate">{tr[lang]}</span>
                    <span className={`mp-tag ${tr.group}`}>{t(`mp_g_${tr.group}`)}</span>
                  </button>
                </li>
              ))}
            </ol>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
