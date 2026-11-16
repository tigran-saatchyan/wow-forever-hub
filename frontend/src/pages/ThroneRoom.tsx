/**
 * The throne room of the Undercity, the hub's home page: your main servant stands on the dais before the
 * Dark Lady's throne, in Blizzard's own render of the character (their real gear), between the Forsaken
 * banners from the game client, plague braziers and the mist of the Royal Quarter. Below, their chronicle,
 * strength, professions and the orders of the day.
 */
import { AnimatePresence, motion, useMotionValue, useSpring, useTransform, type MotionValue } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ItemHover, ItemIcon } from "../components/Wow";
import { iconStyle, useIcons, useTalents } from "../lib/gameData";
import { fmtDate, useI18n, type Key } from "../lib/i18n";
import { store } from "../lib/store";
import { fullName, media, qColor, useCharacter, useCharacters, type Character, type EquipItem } from "../lib/wowApi";
import { CONTENT, loadViewer, type Viewer } from "../theme/Lamenters";
import { sylvanasLine } from "../theme/music";
import { Professions } from "./characters/CharacterSheet";
import { Brazier, WORDS } from "./dashboard/Throne";
import { Orders } from "./dashboard/Orders";

const LEFT = ["HEAD", "NECK", "SHOULDER", "BACK", "CHEST", "WRIST", "HANDS", "WAIST"];
const RIGHT = ["LEGS", "FEET", "FINGER_1", "FINGER_2", "TRINKET_1", "TRINKET_2", "MAIN_HAND", "OFF_HAND", "RANGED"];

/** Where the character is in Blizzard's render (it is a 1600×1200 canvas with the figure off-centre). */
type Box = { x: number; y: number; w: number; h: number; W: number; H: number };
function useFigure(src: string | null): Box | null {
  const [box, setBox] = useState<Box | null>(null);
  useEffect(() => {
    setBox(null);
    if (!src) return;
    let gone = false;
    const img = new Image();
    img.onload = () => {
      const W = img.naturalWidth, H = img.naturalHeight, k = 400 / W;
      const cv = document.createElement("canvas");
      cv.width = 400; cv.height = Math.round(H * k);
      const g = cv.getContext("2d", { willReadFrequently: true });
      if (!g) return;
      g.drawImage(img, 0, 0, cv.width, cv.height);
      let d: Uint8ClampedArray;
      try { d = g.getImageData(0, 0, cv.width, cv.height).data; } catch { return; }
      let x0 = cv.width, y0 = cv.height, x1 = 0, y1 = 0;
      for (let y = 0; y < cv.height; y++)
        for (let x = 0; x < cv.width; x++)
          if (d[(y * cv.width + x) * 4 + 3] > 16) {
            if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
          }
      if (gone || x1 <= x0) return;
      setBox({ x: x0 / k, y: y0 / k, w: (x1 - x0 + 1) / k, h: (y1 - y0 + 1) / k, W, H });
    };
    img.src = src;
    return () => { gone = true; };
  }, [src]);
  return box;
}

/** The Banshee Queen herself at the throne: the game's model (creature 10181's line, display 28213), by Wowhead's viewer. */
const SYLVANAS = 28213;
function Sylvanas() {
  const box = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    let viewer: Viewer | null = null;
    let gone = false;
    void loadViewer().then(() => {
      const el = box.current;
      if (gone || !el || !window.ZamModelViewer || !window.jQuery) return;
      const $ = window.jQuery as (e: Element) => unknown;
      viewer = new window.ZamModelViewer({
        type: 2, contentPath: CONTENT, container: $(el), aspect: el.clientWidth / el.clientHeight, hd: true,
        models: { type: 8, id: SYLVANAS },
      });
      setTimeout(() => !gone && setShown(true), 900); // let the model load before she fades in
    }).catch(() => {});
    return () => {
      gone = true;
      try { viewer?.destroy?.(); } catch { /* not built yet */ }
    };
  }, []);
  return <div ref={box} className={`tr-queen ${shown ? "on" : ""}`} aria-hidden />;
}

/** A layer that drifts against the mouse: deeper layers move less. */
function Layer({ mx, my, depth, className, children }: { mx: MotionValue<number>; my: MotionValue<number>; depth: number; className?: string; children?: React.ReactNode }) {
  const x = useTransform(mx, (v) => v * depth);
  const y = useTransform(my, (v) => v * depth * 0.6);
  return <motion.div className={className} style={{ x, y }} aria-hidden>{children}</motion.div>;
}

function Gear({ x, slot, i }: { x?: EquipItem; slot: string; i: number }) {
  const { t } = useI18n();
  if (!x) return null;
  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.6, filter: "blur(6px)" }}
      animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
      transition={{ delay: 0.9 + i * 0.06, duration: 0.5 }}
      className="tr-gear"
    >
      <ItemHover
        id={x.id}
        fallback={{ id: x.id, name: x.name, quality: x.quality, level: x.ilvl, slot: x.slotName, stats: x.stats || [], spells: [] }}
      >
        <span tabIndex={0} className="block outline-none" aria-label={`${t(`slot_${slot}` as Key)}: ${x.name}`}>
          <ItemIcon src={x.icon} quality={x.quality} size={40} />
        </span>
      </ItemHover>
    </motion.span>
  );
}

function Hero({ c, box, poke }: { c: Character; box: Box; poke: number }) {
  const src = media(c.model)!;
  // crop the canvas to the figure; the figure's box is what the stage sizes
  const style = {
    width: `${(box.W / box.w) * 100}%`,
    left: `${(-box.x / box.w) * 100}%`,
    top: `${(-box.y / box.h) * 100}%`,
  };
  return (
    <motion.div
      key={c.id}
      className="tr-hero"
      style={{ aspectRatio: `${box.w} / ${box.h}` }}
      initial={{ opacity: 0, y: 60, filter: "blur(14px) brightness(3) saturate(0)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px) brightness(1) saturate(1)" }}
      exit={{ opacity: 0, y: 20, filter: "blur(10px) brightness(2) saturate(0)" }}
      transition={{ duration: 1.4, ease: [0.2, 0.7, 0.2, 1] }}
    >
      <div className="tr-hero-float">
        <img src={src} alt="" className="tr-hero-img" style={style} draggable={false} />
        <img src={src} alt="" className="tr-hero-ghost" style={style} draggable={false} aria-hidden />
        {poke > 0 && <span key={poke} className="tr-poke" aria-hidden />}
      </div>
    </motion.div>
  );
}

export function ThroneRoom() {
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const chars = useCharacters();
  const D = useTalents(lang);
  const icons = useIcons();
  const list = (chars.data || []).filter((x) => !x.error);
  const [sel, setSel] = useState<number | null>(() => store.get<number | null>("throneSel", null));
  const mainId = (list.find((x) => x.id === sel) ?? list[0])?.id ?? null;
  const q = useCharacter(mainId);
  const c = q.data;
  const box = useFigure(media(c?.model) ?? null);
  const [w, setW] = useState(() => Math.floor(Math.random() * WORDS.length));
  const [poke, setPoke] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setW((x) => (x + 1) % WORDS.length), 9000);
    return () => clearInterval(id);
  }, []);

  const mx = useSpring(useMotionValue(0), { stiffness: 40, damping: 18 });
  const my = useSpring(useMotionValue(0), { stiffness: 40, damping: 18 });
  const move = (e: React.MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    mx.set(((e.clientX - r.left) / r.width - 0.5) * -2);
    my.set(((e.clientY - r.top) / r.height - 0.5) * -2);
  };

  const s = c?.summary?.[lang];
  const k = D.data?.classes.find((x) => x.id === s?.classId);
  const eq = new Map((c?.equipment?.[lang] || []).map((x) => [x.slot, x]));
  const st = c?.stats?.[lang] as Record<string, number | string> | undefined;
  const pick = (id: number) => (setSel(id), store.set("throneSel", id));

  return (
    <div className="space-y-5">
      <section className="tr-stage" onMouseMove={move} onMouseLeave={() => (mx.set(0), my.set(0))}>
        {/* the hall, from the far wall forward */}
        <Layer mx={mx} my={my} depth={8} className="tr-bg" />
        <Layer mx={mx} my={my} depth={12} className="tr-clouds"><i /><i /></Layer>
        <div className="tr-shafts" aria-hidden><i /><i /><i /></div>
        <Layer mx={mx} my={my} depth={16} className="tr-throne-glow" />
        <Layer mx={mx} my={my} depth={18} className="tr-queen-wrap"><Sylvanas /></Layer>
        <Layer mx={mx} my={my} depth={22} className="tr-banners">
          <img src="/undercity/banner.webp" alt="" className="tr-banner left" draggable={false} />
          <img src="/undercity/banner.webp" alt="" className="tr-banner right" draggable={false} />
        </Layer>
        <Layer mx={mx} my={my} depth={28} className="tr-braziers">
          <Brazier side="left" />
          <Brazier side="right" />
        </Layer>

        {/* the dais: the crest as a sigil in the floor, a pillar of plague light, the servant on it */}
        {/* the dais and the servant stay put: only the hall behind them drifts with the mouse */}
        <div className="tr-dais" aria-hidden>
          <div className="tr-sigil"><img src="/undercity/crest.webp" alt="" draggable={false} /></div>
          <div className="tr-pillar" />
        </div>
        <div className="tr-hero-wrap">
          <button className="tr-hero-btn" onClick={() => setPoke((p) => p + 1)} title={t("tr_poke")} aria-label={t("tr_poke")}>
            <AnimatePresence mode="wait">
              {c && box && <Hero key={c.id} c={c} box={box} poke={poke} />}
            </AnimatePresence>
          </button>
          {c && box && (
            <>
              <div className="tr-gear-col left">{LEFT.map((sl, i) => <Gear key={sl} slot={sl} x={eq.get(sl)} i={i} />)}</div>
              <div className="tr-gear-col right">{RIGHT.map((sl, i) => <Gear key={sl} slot={sl} x={eq.get(sl)} i={i + LEFT.length} />)}</div>
            </>
          )}
        </div>
        <div className="tr-wisps" aria-hidden>{Array.from({ length: 14 }, (_, i) => <i key={i} style={{ left: `${(i * 53) % 100}%`, animationDelay: `${(i * 1.7) % 11}s`, animationDuration: `${9 + (i % 5) * 2}s` }} />)}</div>
        <div className="tr-mist" aria-hidden><i /><i /></div>

        <button className="tr-voice btn-primary text-sm" onClick={() => sylvanasLine(lang)}>☠ {t("uc_voice")}</button>

        {/* who stands before the throne */}
        {list.length > 1 && (
          <div className="tr-servants" title={t("tr_choose")}>
            {list.slice(0, 8).map((x) => (
              <button key={x.id} onClick={() => pick(x.id)} className={`tr-servant ${x.id === mainId ? "on" : ""}`} aria-label={fullName(x, lang)} title={fullName(x, lang)}>
                {x.avatar ? <img src={media(x.avatar)!} alt="" /> : <span>{(x.summary?.[lang]?.name || x.name).slice(0, 1)}</span>}
              </button>
            ))}
          </div>
        )}

        {/* the name plate */}
        <div className="tr-plate">
          {c ? (
            <AnimatePresence mode="wait">
              <motion.div key={c.id} initial={{ opacity: 0, y: 16, filter: "blur(8px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.8, delay: 0.5 }}>
                <div className="brand-sub">{t("tr_servant")}</div>
                <h1 className="tr-name">{fullName(c, lang)}</h1>
                <div className="mt-1 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm">
                  <span className="flex items-center gap-1.5">
                    {k && <span className="h-5 w-5 rounded-sm border border-black" style={iconStyle(icons.data, k.icon)} />}
                    <span style={{ color: k?.color }}>{t("ch_level", { l: s?.level ?? "?" })} · {s?.race} {s?.className}</span>
                  </span>
                  <span className="text-ink/80">{s?.guild?.name ? `<${s.guild.name}>` : t("tr_noguild")}</span>
                  {s?.ilvl ? <span className="text-gold">{t("ch_ilvl", { i: s.ilvl })}</span> : null}
                </div>
              </motion.div>
            </AnimatePresence>
          ) : (
            !chars.isLoading && (
              <button className="text-muted hover:text-gold" onClick={() => nav("/characters")}>{t("tr_none")}</button>
            )
          )}
          <div className="tr-words">
            <AnimatePresence mode="wait">
              <motion.p key={w} className="throne-quote text-base sm:text-lg"
                initial={{ opacity: 0, y: 6, filter: "blur(4px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -6, filter: "blur(4px)" }} transition={{ duration: 0.6 }}>
                «{WORDS[w][lang]}» <span className="not-italic text-muted">— {t("uc_sylvanas")}</span>
              </motion.p>
            </AnimatePresence>
          </div>
        </div>
      </section>

      {c && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Chronicle c={c} />
          <motion.section className="panel p-4" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
            <h2 className="panel-title mb-3">{t("tr_vitals")}</h2>
            {st ? (
              <div className="space-y-2">
                <div className="char-bars">
                {typeof st.health === "number" && <Vital label={t("st_health")} v={st.health} cls="hp" />}
                {typeof st.power === "number" && <Vital label={String(st.powerName ?? t("st_power"))} v={st.power} cls="mp" />}
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 pt-2 text-sm">
                  {["strength", "agility", "stamina", "intellect", "spirit", "armor"].filter((x) => typeof st[x] === "number").map((x) => (
                    <div key={x} className="flex justify-between"><span className="text-[#ffd100]">{t(`st_${x}` as Key)}</span><span className="font-mono tabular-nums">{st[x]}</span></div>
                  ))}
                </div>
              </div>
            ) : <p className="text-sm text-muted">{t("ch_no_stats")}</p>}
          </motion.section>
          <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
            <Professions c={c} />
          </motion.section>
        </div>
      )}
      <Orders />
    </div>
  );
}

function Vital({ label, v, cls }: { label: string; v: number; cls: string }) {
  return (
    <div className={`bar ${cls} tr-vital`}>
      <span>{label}</span><b>{v}</b>
    </div>
  );
}

function Chronicle({ c }: { c: Character }) {
  const { t, lang } = useI18n();
  const s = c.summary?.[lang];
  const eq = c.equipment?.[lang] || [];
  const epic = eq.filter((x) => x.quality === "EPIC" || x.quality === "LEGENDARY").length;
  const rare = eq.filter((x) => x.quality === "RARE").length;
  const rows: [string, React.ReactNode][] = [
    [t("tr_gear"), <span key="g">{eq.length} · <span style={{ color: qColor("RARE") }}>{rare}</span> · <span style={{ color: qColor("EPIC") }}>{epic}</span></span>],
  ];
  if (s?.ruleset) rows.unshift([t("tr_ruleset"), s.ruleset]);
  return (
    <motion.section className="panel p-4" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
      <h2 className="panel-title mb-3">{t("tr_chronicle")}</h2>
      <div className="flex items-center gap-3">
        {c.avatar && <img src={media(c.avatar)!} alt="" className="h-14 w-14 rounded-md border border-gold/40" />}
        <div className="min-w-0">
          <div className="truncate font-display text-lg">{fullName(c, lang)}</div>
          <div className="text-xs text-muted">{s?.gender === "FEMALE" ? "♀" : "♂"} {s?.race} {s?.className}</div>
        </div>
      </div>
      <dl className="mt-3 space-y-1 text-sm">
        {rows.map(([a, b]) => (
          <div key={a} className="flex justify-between gap-3"><dt className="text-muted">{a}</dt><dd>{b}</dd></div>
        ))}
        {s?.lastLogin ? <p className="pt-1 text-xs text-muted">{t("tr_last", { d: fmtDate(lang, s.lastLogin) })}</p> : null}
      </dl>
    </motion.section>
  );
}
