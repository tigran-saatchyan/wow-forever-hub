/**
 * The map of Forever, drawn from the client files (tools/build_maps.py): the continents with the places that
 * matter, every zone, and a quest chain walked step by step: where to take a quest, where to do it, where
 * to hand it in, and what comes next. A character's completed quests mark how far they have come.
 */
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CHAINS, PLACES, type Chain, type ChainStep, type L, type Place } from "../lib/chains";
import { useI18n, type Key } from "../lib/i18n";
import MAPS from "../lib/maps.json";
import { store } from "../lib/store";
import { fullName, useCharacters, wowApi, type QuestInfo } from "../lib/wowApi";
import { QuestDetails, useTab } from "./characters/ArmoryTabs";

interface MapMeta {
  id: number; name: L; parent: number; type: number; w: number; h: number;
  onParent?: { x: number; y: number; sx: number; sy: number };
}
const ALL = (MAPS as { maps: MapMeta[] }).maps;
const BY_ID = new Map(ALL.map((m) => [m.id, m]));
const EK = 1415, KALIMDOR = 1414;
const CITY_MAPS = new Set([1453, 1454, 1455, 1456, 1457, 1458]);

export interface Pin { x: number; y: number; kind: "giver" | "do" | "turnin" | "city" | "dungeon" | "raid" | "hub" | "zone"; label: string; hot?: boolean; onClick?: () => void }

/** A point given on a zone map, carried up to its continent (null when the zone has no place there). */
function toContinent(map: number, x: number, y: number): { map: number; x: number; y: number } | null {
  const m = BY_ID.get(map);
  if (!m) return null;
  if (m.type === 2) return { map, x, y };
  if (!m.onParent) return null;
  const p = m.onParent;
  return { map: m.parent, x: (p.x + (x / 100) * p.sx) * 100, y: (p.y + (y / 100) * p.sy) * 100 };
}

/** One map image with pins on it; wheel or buttons to zoom, drag to move. */
export function MapView({ map, pins, focus }: { map: number; pins: Pin[]; focus?: { x: number; y: number } | null }) {
  const { lang } = useI18n();
  const m = BY_ID.get(map);
  const [z, setZ] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // a new map or a new focus: zoom in a little on the point that matters
    if (focus && box.current) {
      const zz = m?.type === 2 ? 2.2 : 1.6;
      const w = box.current.clientWidth, h = box.current.clientHeight;
      setZ(zz);
      setOff({ x: w / 2 - (focus.x / 100) * w * zz, y: h / 2 - (focus.y / 100) * h * zz });
    } else {
      setZ(1);
      setOff({ x: 0, y: 0 });
    }
  }, [map, focus?.x, focus?.y]); // eslint-disable-line react-hooks/exhaustive-deps
  const clamp = (o: { x: number; y: number }, zz: number) => {
    const el = box.current;
    if (!el) return o;
    const w = el.clientWidth, h = el.clientHeight;
    return { x: Math.min(0, Math.max(w - w * zz, o.x)), y: Math.min(0, Math.max(h - h * zz, o.y)) };
  };
  const zoom = (d: number, cx?: number, cy?: number) => {
    const el = box.current;
    if (!el) return;
    const zz = Math.min(5, Math.max(1, z * d));
    const px = cx ?? el.clientWidth / 2, py = cy ?? el.clientHeight / 2;
    setOff(clamp({ x: px - ((px - off.x) / z) * zz, y: py - ((py - off.y) / z) * zz }, zz));
    setZ(zz);
  };
  if (!m) return null;
  return (
    <div className="wm-frame">
      <div className="wm-title">{m.name[lang]}</div>
      <div
        ref={box} className="wm-box" style={{ aspectRatio: `${m.w} / ${m.h}` }}
        onWheel={(e) => { const r = e.currentTarget.getBoundingClientRect(); zoom(e.deltaY < 0 ? 1.25 : 0.8, e.clientX - r.left, e.clientY - r.top); }}
        onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, ox: off.x, oy: off.y }; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); }}
        onPointerMove={(e) => { const d = drag.current; if (d) setOff(clamp({ x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y }, z)); }}
        onPointerUp={() => { drag.current = null; }}
      >
        <div className="wm-layer" style={{ transform: `translate(${off.x}px, ${off.y}px) scale(${z})` }}>
          <img src={`/maps/${map}.webp`} alt={m.name[lang]} draggable={false} />
          {pins.map((p, i) => (
            <button key={i} className={`wm-pin ${p.kind} ${p.hot ? "hot" : ""}`} style={{ left: `${p.x}%`, top: `${p.y}%`, transform: `translate(-50%, -50%) scale(${1 / z})` }}
              title={p.label} onPointerDown={(e) => e.stopPropagation()} onClick={p.onClick}>
              <span className="wm-glyph">{GLYPH[p.kind]}</span>
              <span className="wm-label">{p.label}</span>
            </button>
          ))}
        </div>
        <div className="wm-zoom">
          <button onClick={() => zoom(1.4)} aria-label="+">+</button>
          <button onClick={() => zoom(1 / 1.4)} aria-label="−">−</button>
          <button onClick={() => (setZ(1), setOff({ x: 0, y: 0 }))} aria-label="1:1">⤢</button>
        </div>
      </div>
    </div>
  );
}
const GLYPH: Record<Pin["kind"], string> = { giver: "!", do: "✖", turnin: "?", city: "♜", dungeon: "⛰", raid: "☠", hub: "•", zone: "" };

type Phase = "giver" | "do" | "turnin";

export function WorldMap() {
  const { t, lang } = useI18n();
  const [sp, setSp] = useSearchParams();
  const chars = (useCharacters().data || []).filter((c) => !c.error);
  const [cid, setCid] = useState<number | null>(() => store.get<number | null>("mapChar", null));
  const char = chars.find((c) => c.id === cid) ?? chars[0];
  const faction = char?.summary?.[lang]?.faction === "ALLIANCE" ? "ALLIANCE" : "HORDE";
  const chainKey = sp.get("chain") ?? (faction === "ALLIANCE" ? "onyxia-alliance" : "onyxia-horde");
  const chain = CHAINS.find((c) => c.key === chainKey) ?? CHAINS[0];
  const done = useTab<{ ids?: number[] }>(char?.id ?? 0, "quests");
  const ids = useMemo(() => new Set(char ? done.data?.data?.ids || [] : []), [char, done.data]);
  const firstOpen = chain.steps.findIndex((s) => !ids.has(s.id));
  const stepParam = Number(sp.get("step"));
  const idx = Math.max(0, chain.steps.findIndex((s) => s.id === stepParam));
  const stepIdx = sp.get("step") ? idx : Math.max(0, firstOpen);
  const step = chain.steps[stepIdx];
  const [phase, setPhase] = useState<Phase>("giver");
  const [view, setView] = useState<"chain" | "world">(() => (sp.get("chain") ? "chain" : store.get("mapView", "chain")));
  const [continent, setContinent] = useState<number>(EK);
  const [zone, setZone] = useState<number | null>(null);
  useEffect(() => setPhase("giver"), [chain.key, step.id]);
  const go = (i: number) => setSp({ chain: chain.key, step: String(chain.steps[Math.max(0, Math.min(chain.steps.length - 1, i))].id) });
  const setChain = (k: string) => setSp({ chain: k });

  const place: Place = phase === "giver" ? step.giver : phase === "turnin" ? step.turnin : (step.at?.[0] ?? step.giver);
  const pinsOn = (map: number): Pin[] => {
    const out: Pin[] = [];
    const add = (p: Place, kind: Pin["kind"], ph: Phase) => {
      if (p.map === map) out.push({ x: p.x, y: p.y, kind, label: p.who[lang], hot: ph === phase, onClick: () => setPhase(ph) });
    };
    add(step.giver, "giver", "giver");
    (step.at || []).forEach((a) => add(a, "do", "do"));
    add(step.turnin, "turnin", "turnin");
    return out;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-3xl text-gold">{t("wm_title")}</h1>
        <div className="flex gap-1">
          {(["chain", "world"] as const).map((v) => (
            <button key={v} className={`chip ${view === v ? "border-gold/60 text-gold" : ""}`} onClick={() => (store.set("mapView", v), setView(v))}>{t(`wm_view_${v}` as Key)}</button>
          ))}
        </div>
        {chars.length > 0 && (
          <select className="input ml-auto w-auto py-1 text-sm" value={char?.id} onChange={(e) => (store.set("mapChar", Number(e.target.value)), setCid(Number(e.target.value)))}>
            {chars.map((c) => <option key={c.id} value={c.id}>{fullName(c, lang)}</option>)}
          </select>
        )}
      </div>

      {view === "world" ? (
        <World continent={continent} setContinent={setContinent} zone={zone} setZone={setZone} />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="space-y-3">
            <MapView map={place.map} pins={pinsOn(place.map)} focus={{ x: place.x, y: place.y }} />
            <Route step={step} phase={phase} setPhase={setPhase} />
          </div>
          <aside className="space-y-3">
            <div className="flex flex-wrap gap-1">
              {CHAINS.map((c) => <button key={c.key} className={`chip ${c.key === chain.key ? "border-gold/60 text-gold" : ""}`} onClick={() => setChain(c.key)}>{c.name[lang]}</button>)}
            </div>
            <p className="text-xs text-muted">{chain.level[lang]}</p>
            <StepCard chain={chain} i={stepIdx} ids={ids} who={char} go={go} />
            <ol className="wm-steps">
              {chain.steps.map((s, i) => (
                <li key={s.id}>
                  <button className={`raid-step ${ids.has(s.id) ? "done" : i === firstOpen ? "next" : "later"} ${i === stepIdx ? "cur" : ""}`} onClick={() => go(i)}>
                    <span className="raid-mark">{ids.has(s.id) ? "✓" : i === firstOpen ? "▶" : i + 1}</span>
                    <QuestTitle id={s.id} />
                  </button>
                </li>
              ))}
            </ol>
            <p className="text-[11px] text-muted">{t("wm_note")}</p>
          </aside>
        </div>
      )}
    </div>
  );
}

/** The three moves of a step, each on its own map: take it, do it, hand it in. */
function Route({ step, phase, setPhase }: { step: ChainStep; phase: Phase; setPhase: (p: Phase) => void }) {
  const { t, lang } = useI18n();
  const items: [Phase, Place | undefined, string][] = [
    ["giver", step.giver, "!"], ["do", step.at?.[0], "✖"], ["turnin", step.turnin, "?"],
  ];
  return (
    <div className="wm-route">
      {items.filter(([, p]) => p).map(([ph, p, g], i) => (
        <button key={ph} className={`wm-route-item ${ph} ${phase === ph ? "on" : ""}`} onClick={() => setPhase(ph)}>
          <span className="wm-route-n">{i + 1}</span>
          <span className="wm-glyph">{g}</span>
          <span className="grid text-left">
            <b className="text-sm">{t(`wm_ph_${ph}` as Key)}: {p!.who[lang]}</b>
            <span className="text-[11px] text-muted">{BY_ID.get(p!.map)?.name[lang]} · {p!.x.toFixed(0)}, {p!.y.toFixed(0)}{p!.note ? ` · ${p!.note[lang]}` : ""}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function StepCard({ chain, i, ids, who, go }: { chain: Chain; i: number; ids: Set<number>; who?: { summary?: Record<string, { name?: string; className?: string; race?: string }> | null } | undefined; go: (i: number) => void }) {
  const { t, lang } = useI18n();
  const s = chain.steps[i];
  const sum = who?.summary?.[lang];
  return (
    <AnimatePresence mode="wait">
      <motion.div key={s.id} className="char-stats" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25 }}>
        <div className="flex items-center justify-between gap-2">
          <span className="eyebrow">{t("wm_step", { a: i + 1, b: chain.steps.length })}{s.group ? ` · ${t("rd_any_order")}` : ""}</span>
          {ids.has(s.id) && <span className="text-xs text-good">✓ {t("rd_st_done")}</span>}
        </div>
        <div className="mt-1 font-display text-lg text-gold"><QuestTitle id={s.id} /></div>
        {s.dungeon && <div className="mt-0.5 text-xs text-[#ffb070]">{t(`wm_dg_${s.dungeon}` as Key)}</div>}
        <p className="mt-2 text-sm">{s.todo[lang]}</p>
        <QuestDetails id={s.id} who={{ name: sum?.name ?? "", cls: sum?.className ?? "", race: sum?.race ?? "" }} />
        <div className="mt-2 flex justify-between gap-2">
          <button className="btn text-sm" disabled={i === 0} onClick={() => go(i - 1)}>← {t("wm_prev")}</button>
          <button className="btn-primary text-sm" disabled={i === chain.steps.length - 1} onClick={() => go(i + 1)}>{t("wm_next")} →</button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

function QuestTitle({ id }: { id: number }) {
  const { lang } = useI18n();
  const q = useQuery<QuestInfo>({ queryKey: ["quest", id, lang], queryFn: () => wowApi.quest(id, lang), staleTime: Infinity, retry: false });
  return <span className="truncate">{q.data?.title || `#${id}`}</span>;
}

/** The continents with the places that matter; a zone opens on click from the list. */
function World({ continent, setContinent, zone, setZone }: { continent: number; setContinent: (m: number) => void; zone: number | null; setZone: (m: number | null) => void }) {
  const { t, lang } = useI18n();
  const zones = ALL.filter((m) => m.parent === continent && m.type === 3).sort((a, b) => a.name[lang].localeCompare(b.name[lang]));
  const pins: Pin[] = [];
  const target = zone ?? continent;
  for (const p of PLACES) {
    const at = zone ? (p.map === zone ? { map: zone, x: p.x, y: p.y } : null) : toContinent(p.map, p.x, p.y);
    if (at && at.map === target) pins.push({ x: at.x, y: at.y, kind: p.kind, label: p.name[lang], onClick: zone ? undefined : () => setZone(p.map) });
  }
  if (!zone) {
    for (const z of zones) {
      const c = z.onParent;
      // every zone is a quiet dot that names itself on hover; the capitals' own maps have their city pin already
      if (c && !CITY_MAPS.has(z.id)) pins.push({ x: (c.x + c.sx / 2) * 100, y: (c.y + c.sy / 2) * 100, kind: "zone", label: z.name[lang], onClick: () => setZone(z.id) });
    }
  }
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
      <MapView map={target} pins={pins} />
      <aside className="space-y-2">
        <div className="flex gap-1">
          {[EK, KALIMDOR].map((c) => (
            <button key={c} className={`chip ${continent === c && !zone ? "border-gold/60 text-gold" : ""}`} onClick={() => (setContinent(c), setZone(null))}>{BY_ID.get(c)?.name[lang]}</button>
          ))}
        </div>
        {zone && <button className="btn w-full text-sm" onClick={() => setZone(null)}>← {BY_ID.get(continent)?.name[lang]}</button>}
        <div className="eyebrow pt-1">{t("wm_zones")}</div>
        <ul className="max-h-[60vh] space-y-0.5 overflow-y-auto pr-1 text-sm">
          {zones.map((z) => (
            <li key={z.id}><button className={`w-full rounded px-2 py-0.5 text-left hover:bg-gold/10 ${zone === z.id ? "text-gold" : ""}`} onClick={() => setZone(z.id)}>{z.name[lang]}</button></li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
