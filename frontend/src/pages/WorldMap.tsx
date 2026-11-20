/**
 * The map of Forever, drawn from the client files (tools/build_maps.py): the continents with the places that
 * matter, every zone, and a quest chain walked step by step: where to take a quest, where to do it, where
 * to hand it in, and what comes next. A character's completed quests mark how far they have come.
 */
import { setActiveChar, useActiveCharId } from "../lib/activeChar";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CHAINS, ORDERED, PLACES, fits, progress, stepDone, type Chain, type ChainStep, type L, type Place } from "../lib/chains";
import { ChainChars, ChainInfo, ChainPicker } from "./map/ChainPanel";
import { useI18n, type Key } from "../lib/i18n";
import MAPS from "../lib/maps.json";
import { req } from "../lib/api";
import { store } from "../lib/store";
import { fullName, useCharacters, wowApi, type QuestInfo } from "../lib/wowApi";
import { QuestDetails, useTab } from "./characters/ArmoryTabs";
import { MinLevel } from "./Raids";
import { Seamless, toWorld, type Focus, type WPin } from "../components/Seamless";

interface MapMeta {
  id: number; name: L; parent: number; type: number; w: number; h: number;
  onParent?: { x: number; y: number; sx: number; sy: number };
}
const ALL = (MAPS as { maps: MapMeta[] }).maps;
const BY_ID = new Map(ALL.map((m) => [m.id, m]));
const EK = 1415, KALIMDOR = 1414;

export interface Pin { x: number; y: number; kind: "giver" | "do" | "turnin" | "city" | "dungeon" | "raid" | "hub" | "zone"; label: string; hot?: boolean; onClick?: () => void }

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
  // the wheel zooms the map and never scrolls the page: a native listener, since React's is passive
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomRef.current(e.deltaY < 0 ? 1.25 : 0.8, e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [map]);
  if (!m) return null;
  return (
    <div className="wm-frame">
      <div className="wm-title">{m.name[lang]}</div>
      <div
        ref={box} className="wm-box" style={{ aspectRatio: `${m.w} / ${m.h}` }}
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
  const cid = useActiveCharId();
  const setCid = setActiveChar;
  const char = chars.find((c) => c.id === cid) ?? chars[0];
  const sum = char?.summary?.[lang];
  const faction = sum?.faction === "ALLIANCE" ? "ALLIANCE" : "HORDE";
  const who = { faction, classId: sum?.classId ?? null, level: sum?.level ?? null };
  const done = useTab<{ ids?: number[] }>(char?.id ?? 0, "quests");
  const ids = useMemo(() => new Set(char ? done.data?.data?.ids || [] : []), [char, done.data]);
  // no chain asked for: the first one in order this character still has to do
  const chainKey = sp.get("chain") ?? (ORDERED.find((c) => fits(c, faction, who.classId) && !progress(c, ids).complete) ?? ORDERED[0]).key;
  const chain = CHAINS.find((c) => c.key === chainKey) ?? CHAINS[0];
  // a step that is not a quest counts as done once a later quest is
  const doneAt = (i: number) => stepDone(chain.steps[i], ids) ?? chain.steps.slice(i + 1).some((x) => stepDone(x, ids));
  const firstOpen = chain.steps.findIndex((_, i) => !doneAt(i));
  const stepParam = Number(sp.get("step"));
  const idx = Math.max(0, chain.steps.findIndex((s) => s.id === stepParam));
  const stepIdx = sp.get("step") ? idx : Math.max(0, firstOpen);
  const step = chain.steps[stepIdx];
  const [phase, setPhase] = useState<Phase>("giver");
  const [view, setView] = useState<"chain" | "world">(() => (sp.get("chain") ? "chain" : sp.get("pin") ? "world" : store.get("mapView", "chain")));
  // a place sent from another page (a dungeon's way in): "map,x,y" and its name
  const pinAt = useMemo(() => {
    const p = (sp.get("pin") || "").split(",").map(Number);
    return p.length === 3 && p.every((n) => !Number.isNaN(n)) ? { map: p[0], x: p[1], y: p[2], label: sp.get("label") || "" } : null;
  }, [sp]);
  const [continent, setContinent] = useState<number>(EK);
  const [zone, setZone] = useState<number | null>(null);
  useEffect(() => setPhase("giver"), [chain.key, step.id]);
  // every request to look somewhere flies the map there, even to the place it already showed
  const [tick, setTick] = useState(0);
  const bump = () => setTick((n) => n + 1);
  const look = (ph: Phase) => { setPhase(ph); bump(); };
  const go = (i: number) => { bump(); setSp({ chain: chain.key, step: String(chain.steps[Math.max(0, Math.min(chain.steps.length - 1, i))].id) }); };
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

  // every place of the step on the one seamless map (null when one of them has no place on it)
  const chainPins = useMemo(() => {
    const out: WPin[] = [];
    const add = (p: Place, kind: Pin["kind"], ph: Phase) => {
      const w = toWorld(p.map, p.x, p.y);
      if (!w) return false;
      out.push({ ...w, kind, glyph: GLYPH[kind], label: p.who[lang], hot: ph === phase, onClick: () => look(ph) });
      return true;
    };
    const ok = add(step.giver, "giver", "giver") && (step.at || []).every((a) => add(a, "do", "do")) && add(step.turnin, "turnin", "turnin");
    return ok ? out : null;
  }, [step, phase, lang]);

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
          <select className="input ml-auto w-auto py-1 text-sm" value={char?.id} onChange={(e) => setCid(Number(e.target.value))}>
            {chars.map((c) => <option key={c.id} value={c.id}>{fullName(c, lang)}</option>)}
          </select>
        )}
      </div>

      {view === "world" ? (
        <World continent={continent} setContinent={setContinent} zone={zone} setZone={setZone} faction={faction} pinAt={pinAt} />
      ) : (
        <div className="space-y-4">
        <ChainPicker current={chain.key} ids={ids} who={who} pick={setChain} cid={char?.id ?? null} />
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="space-y-3">
            {chainPins ? (
              <Seamless pins={chainPins} focus={focusOf(place, tick)} />
            ) : (
              <MapView map={place.map} pins={pinsOn(place.map)} focus={{ x: place.x, y: place.y }} />
            )}
            <Route step={step} phase={phase} setPhase={look} />
            <div className="grid gap-3 lg:grid-cols-[1.5fr_1fr]">
              <ChainInfo c={chain} ids={ids} who={who} />
              <ChainChars c={chain} chars={chars} current={char?.id} choose={(id) => setCid(id)} />
            </div>
          </div>
          <aside className="space-y-3">
            <StepCard chain={chain} i={stepIdx} ids={ids} who={char} go={go} />
            <ol className="wm-steps">
              {chain.steps.map((s, i) => (
                <li key={s.id}>
                  <button className={`raid-step ${i < firstOpen || firstOpen < 0 ? "done" : i === firstOpen ? "next" : "later"} ${i === stepIdx ? "cur" : ""}`} onClick={() => go(i)}>
                    <span className="raid-mark">{i < firstOpen || firstOpen < 0 ? "✓" : i === firstOpen ? "▶" : i + 1}</span>
                    <StepTitle s={s} />
                    {s.min && <MinLevel min={s.min} level={char?.summary?.[lang]?.level ?? null} />}
                    {s.size && <span className="cn-size">{t("cn_size", { n: s.size })}</span>}
                  </button>
                </li>
              ))}
            </ol>
            <p className="text-[11px] text-muted">{t("wm_note")}</p>
          </aside>
        </div>
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

function StepCard({ chain, i, ids, who, go }: { chain: Chain; i: number; ids: Set<number>; who?: { summary?: Record<string, { name?: string; className?: string; race?: string; level?: number | null }> | null } | undefined; go: (i: number) => void }) {
  const { t, lang } = useI18n();
  const s = chain.steps[i];
  const sum = who?.summary?.[lang];
  return (
    <AnimatePresence mode="wait">
      <motion.div key={s.id} className="char-stats" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25 }}>
        <div className="flex items-center justify-between gap-2">
          <span className="eyebrow">{t("wm_step", { a: i + 1, b: chain.steps.length })}{s.group ? ` · ${t("rd_any_order")}` : ""}</span>
          {stepDone(s, ids) && <span className="text-xs text-good">✓ {t("rd_st_done")}</span>}
        </div>
        <div className="mt-1 flex items-center font-display text-lg text-gold"><StepTitle s={s} />{s.min && <MinLevel min={s.min} level={sum?.level ?? null} />}</div>
        {s.dungeon && <div className="mt-0.5 text-xs text-[#ffb070]">{t(`wm_dg_${s.dungeon}` as Key)}</div>}
        <p className="mt-2 text-sm">{s.todo[lang]}</p>
        {s.id > 0 && <QuestDetails id={s.id} who={{ name: sum?.name ?? "", cls: sum?.className ?? "", race: sum?.race ?? "" }} />}
        <div className="mt-2 flex justify-between gap-2">
          <button className="btn text-sm" disabled={i === 0} onClick={() => go(i - 1)}>← {t("wm_prev")}</button>
          <button className="btn-primary text-sm" disabled={i === chain.steps.length - 1} onClick={() => go(i + 1)}>{t("wm_next")} →</button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

/** A step's name: the quest's own title from Forever, or the step's title when it is not a quest. */
function StepTitle({ s }: { s: ChainStep }) {
  const { lang } = useI18n();
  return s.id > 0 ? <QuestTitle id={s.id} /> : <span className="truncate italic">{s.title?.[lang] ?? "—"}</span>;
}

function QuestTitle({ id }: { id: number }) {
  const { lang } = useI18n();
  const q = useQuery<QuestInfo>({ queryKey: ["quest", id, lang], queryFn: () => wowApi.quest(id, lang), staleTime: Infinity, retry: false });
  return <span className="truncate">{q.data?.title || `#${id}`}</span>;
}

function focusOf(p: Place, tick: number): Focus {
  const w = toWorld(p.map, p.x, p.y);
  return w ? { ...w, zoom: 5, tick } : null;
}

/** The seamless world: the places that matter, every zone named on the map; the list flies to a zone. */
function World({ continent, setContinent, zone, setZone, faction, pinAt }: { continent: number; setContinent: (m: number) => void; zone: number | null; setZone: (m: number | null) => void; faction: string; pinAt?: { map: number; x: number; y: number; label: string } | null }) {
  const { t, lang } = useI18n();
  // any quest by ForeverDB: where to take it and where to hand it in; the vendors of the player's side
  const [quest, setQuest] = useState<FdbQuest | null>(null);
  const [showVendors, setShowVendors] = useState(() => store.get("wmVendors", false));
  const vendors = useQuery({ queryKey: ["fdb-vendors"], queryFn: () => req<FdbVendorPin[]>("/api/fdb/vendors"), enabled: showVendors, staleTime: 3600e3 });
  const zones = ALL.filter((m) => m.parent === continent && m.type === 3).sort((a, b) => a.name[lang].localeCompare(b.name[lang]));
  const [focus, setFocus] = useState<Focus>(null);
  useEffect(() => {  // a place sent from another page: fly to it
    const w = pinAt ? toWorld(pinAt.map, pinAt.x, pinAt.y) : null;
    if (w) setFocus({ ...w, zoom: 5, tick: Date.now() });
  }, [pinAt?.map, pinAt?.x, pinAt?.y]); // eslint-disable-line react-hooks/exhaustive-deps
  const pins = useMemo(() => {
    const out: WPin[] = [];
    if (pinAt) {
      const w = toWorld(pinAt.map, pinAt.x, pinAt.y);
      if (w) out.push({ ...w, kind: "dungeon", glyph: "⚑", hot: true, label: pinAt.label, onClick: () => setFocus({ ...w, zoom: 5, tick: Date.now() }) });
    }
    for (const p of PLACES) {
      const w = toWorld(p.map, p.x, p.y);
      if (w) out.push({ ...w, kind: p.kind, glyph: GLYPH[p.kind], label: p.name[lang], onClick: () => setFocus({ ...w, zoom: 5, tick: Date.now() }) });
    }
    if (showVendors) {
      const mine = faction === "ALLIANCE" ? "Alliance" : "Horde";
      for (const v of vendors.data || []) {
        if (v.side && v.side !== mine && v.side !== "Both" && v.side !== "Neutral") continue;
        const w = toWorld(v.map, v.x, v.y);
        if (w) out.push({ ...w, kind: "vendor", glyph: "$", label: v.title ? `${v.name} <${v.title}>` : v.name, onClick: () => setFocus({ ...w, zoom: 5.5, tick: Date.now() }) });
      }
    }
    if (quest) {
      for (const [p, kind, g] of [[quest.starts, "giver", "!"], [quest.ends, "turnin", "?"]] as const) {
        const w = p?.map != null && p.x != null ? toWorld(p.map, p.x, p.y!) : null;
        if (w) out.push({ ...w, kind, glyph: g, hot: true, label: p!.name ?? "", onClick: () => setFocus({ ...w, zoom: 5, tick: Date.now() }) });
      }
    }
    return out;
  }, [lang, showVendors, vendors.data, quest, faction, pinAt]);
  const pick = (id: number) => { setZone(id); setFocus({ map: id, tick: Date.now() }); };
  const showQuest = (q: FdbQuest) => {
    setQuest(q);
    const p = q.starts?.map != null && q.starts.x != null ? q.starts : q.ends;
    const w = p?.map != null && p.x != null ? toWorld(p.map, p.x, p.y!) : null;
    if (w) setFocus({ ...w, zoom: 5, tick: Date.now() });
  };
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
      <Seamless pins={pins} focus={focus} onZone={setZone} />
      <aside className="space-y-2">
        <div className="flex gap-1">
          {[EK, KALIMDOR].map((c) => (
            <button key={c} className={`chip ${continent === c && !zone ? "border-gold/60 text-gold" : ""}`} onClick={() => (setContinent(c), setZone(null), setFocus({ map: c, tick: Date.now() }))}>{BY_ID.get(c)?.name[lang]}</button>
          ))}
        </div>
        <QuestFinder faction={faction} quest={quest} show={showQuest} clear={() => setQuest(null)} />
        <label className="chip cursor-pointer"><input type="checkbox" className="mr-1.5" checked={showVendors} onChange={(e) => (store.set("wmVendors", e.target.checked), setShowVendors(e.target.checked))} />{t("wm_vendors")}</label>
        <div className="eyebrow pt-1">{t("wm_zones")}</div>
        <ul className="max-h-[60vh] space-y-0.5 overflow-y-auto pr-1 text-sm">
          {zones.map((z) => (
            <li key={z.id}><button className={`w-full rounded px-2 py-0.5 text-left hover:bg-gold/10 ${zone === z.id ? "text-gold" : ""}`} onClick={() => pick(z.id)}>{z.name[lang]}</button></li>
          ))}
        </ul>
        <p className="text-[11px] text-muted">{t("wm_omap_note")}</p>
        <a className="text-[11px] text-gold hover:underline" href="https://foreverdb.net" target="_blank" rel="noopener noreferrer">{t("fdb_credit")}</a>
      </aside>
    </div>
  );
}

interface FdbPlace { type: string | null; id: number | null; name: string | null; map: number | null; x: number | null; y: number | null; zone: string | null; instance: string | null; source: string | null }
interface FdbQuest { id: number; name: string; level: number | null; req: number | null; side: string | null; zone: string | null; known: boolean; url: string;
  starts: FdbPlace | null; ends: FdbPlace | null; prev: { id: number; name: string; rel: string }[]; next: { id: number; name: string; rel: string }[] }
interface FdbVendorPin { npc: number; name: string; title: string | null; side: string | null; map: number; x: number; y: number; seen: boolean; goods: number }

/** Find any quest (ForeverDB): who gives it and where, who takes it back, the quests before and after it. */
function QuestFinder({ faction, quest, show, clear }: { faction: string; quest: FdbQuest | null; show: (q: FdbQuest) => void; clear: () => void }) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  useEffect(() => { const h = setTimeout(() => setTerm(q.trim()), 400); return () => clearTimeout(h); }, [q]);
  const side = faction === "ALLIANCE" ? "alliance" : "horde";
  const found = useQuery({ queryKey: ["fdb-quests", term, side], enabled: term.length >= 3, staleTime: 3600e3,
    queryFn: () => req<{ id: number; name: string; level: number | null; req: number | null; zone: string | null }[]>(`/api/fdb/quests?q=${encodeURIComponent(term)}&side=${side}`) });
  const open = async (id: number) => show(await req<FdbQuest>(`/api/fdb/quests/${id}`));
  const where = (p: FdbPlace | null) => p ? `${p.name ?? "?"}${p.zone ? ` · ${p.zone}` : p.instance ? ` · ${p.instance}` : ""}${p.x != null ? ` ${p.x.toFixed(0)}, ${p.y?.toFixed(0)}` : ""}` : "—";
  return (
    <div className="space-y-1.5">
      <input className="input w-full py-1 text-sm" placeholder={t("wm_quest_find")} value={q} onChange={(e) => setQ(e.target.value)} />
      {!quest && term.length >= 3 && (
        <ul className="max-h-48 space-y-0.5 overflow-y-auto text-sm">
          {(found.data || []).map((x) => (
            <li key={x.id}><button className="w-full rounded px-2 py-0.5 text-left hover:bg-gold/10" onClick={() => void open(x.id)}>
              {x.name} <span className="text-xs text-muted">{x.level ?? ""}{x.zone ? ` · ${x.zone}` : ""}</span></button></li>
          ))}
          {found.data && !found.data.length && <li className="text-xs text-muted">{t("ar_empty")}</li>}
        </ul>
      )}
      {quest && (
        <div className="char-stats space-y-1 text-sm">
          <div className="flex items-start justify-between gap-2">
            <b className="text-gold">{quest.name}</b>
            <button className="text-xs text-muted hover:text-gold" onClick={clear}>✕</button>
          </div>
          <div className="text-xs text-muted">{t("wm_q_level", { l: quest.level ?? "?", r: quest.req ?? "?" })}{quest.zone ? ` · ${quest.zone}` : ""}</div>
          <div className="text-xs"><span className="text-[#ffd100]">! </span>{where(quest.starts)}</div>
          <div className="text-xs"><span className="text-[#ffd100]">? </span>{where(quest.ends)}</div>
          {quest.prev.length > 0 && <div className="text-xs">{t("wm_q_prev")}: {quest.prev.map((p, i) => <span key={p.id}>{i ? ", " : ""}<button className="text-gold hover:underline" onClick={() => void open(p.id)}>{p.name}</button></span>)}</div>}
          {quest.next.length > 0 && <div className="text-xs">{t("wm_q_next")}: {quest.next.map((p, i) => <span key={p.id}>{i ? ", " : ""}<button className="text-gold hover:underline" onClick={() => void open(p.id)}>{p.name}</button></span>)}</div>}
        </div>
      )}
    </div>
  );
}
