/**
 * The throne room's BiS mode: the best gear for the character's class, specialization and level in the slots
 * (worked out on the server, app/bis.py), up to three per slot to choose from, a comparison with what is worn
 * on hover, and where to get it on click. The picks stay until the character's level changes.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ItemIcon } from "../../components/Wow";
import { allTalents } from "../../engine";
import { iconStyle, useIcons, useTalents } from "../../lib/gameData";
import { mapTalents } from "../../lib/charTalents";
import { useI18n, type Key } from "../../lib/i18n";
import { QUALITY, wowApi, type Character } from "../../lib/wowApi";

export interface BisItem {
  id: number; name: string; q: number; ilvl: number; req: number; stats: Record<string, number>;
  armor: number | null; dps: number | null; speed: number | null; spells: string[]; two: boolean; score: number;
  src?: Src | null;
}
/** Where it comes from, in one line (app/routers/sources.py brief). */
export interface Src { kind: "quest" | "drop" | "world" | "vendor" | "craft"; name: string; where?: string | null; rate?: number | null; chain?: boolean; copper?: number | null; more: number; classic?: boolean; skill?: number | null }

export function SrcLine({ s }: { s?: Src | null }) {
  const { t } = useI18n();
  if (!s) return null;
  const pct = s.rate != null ? ` · ${(s.rate * 100).toFixed(s.rate < 0.1 ? 1 : 0)}%` : "";
  const more = s.more > 0 ? <span className="bis-src-more"> +{s.more}</span> : null;
  const txt = s.kind === "quest" ? t(s.chain ? "bis_src_chain" : "bis_src_quest", { n: s.name })
    : s.kind === "drop" ? `${s.name}${s.where ? ` · ${s.where}` : ""}${pct}`
    : s.kind === "world" ? t("bis_src_world", { n: s.name }) + (s.where ? ` · ${s.where}` : "") + pct
    : s.kind === "vendor" ? t("bis_src_vendor", { n: s.name })
    : t("bis_src_craft", { p: `${s.where ?? ""}${s.skill ? ` (${s.skill})` : ""}`, n: s.name });
  return <div className={`bis-src ${s.kind}`} title={s.classic ? t("so_classic_note") : undefined}>{txt}{more}</div>;
}
export interface BisSlot { options: BisItem[]; pick: number; worn: BisItem | null; wornId: number | null; wornRank: number | null; ok: boolean }
export interface BisData {
  status: "ready" | "nodata"; class: string; specs: string[]; spec: string; specSaved?: boolean; level: number;
  customBase?: string; customSet?: boolean; weights?: Record<string, number>; classId?: number;
  twoHand: boolean; slots: Record<string, BisSlot>; have: number; total: number; complete: boolean; cheer: boolean;
  maxIlvl: number;
}

const Q = ["POOR", "COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY"];
export const qCol = (q: number) => QUALITY[Q[q] ?? "COMMON"];

export function useBis(cid: number | null, spec: string | null) {
  const { lang } = useI18n();
  return useQuery({
    // asked even when the mode is off: worn gear that is BiS is marked in the normal view too
    queryKey: ["bis", cid, spec, lang], enabled: !!cid, staleTime: 5 * 60e3,
    queryFn: () => wowApi.bis<BisData>(cid!, spec, lang),
  });
}

/** The talent trees of the character's class (names, icons, background art) and the one with most points. */
export function useTrees(c: Character | undefined) {
  const { lang } = useI18n();
  const D = useTalents(lang);
  return useMemo(() => {
    const cls = D.data?.classes.find((x) => x.id === c?.summary?.[lang]?.classId);
    if (!cls) return { tabs: [], main: null as number | null };
    const ranks = c?.talents ? mapTalents(cls, c.talents).ranks : {};
    const pts = cls.tabs.map(() => 0);
    for (const x of allTalents(cls)) pts[x.tab] += ranks[x.id] || 0;
    const top = Math.max(...pts);
    return { tabs: cls.tabs, main: top > 0 ? pts.indexOf(top) : null };
  }, [D.data, c, lang]);
}

/** The one switch of the throne room, the specialization and how much of the set is worn. */
export function BisBar({ on, setOn, data, spec, setSpec, tabs, cid }: {
  on: boolean; setOn: (v: boolean) => void; data?: BisData; spec: string | null; setSpec: (s: string) => void;
  tabs: { name: string; icon: string }[]; cid: number | null;
}) {
  const { t } = useI18n();
  const icons = useIcons();
  const [edit, setEdit] = useState(false);
  const label = (k: string, i: number) => tabs[i]?.name ?? t(`bis_spec_${k}` as Key);
  return (
    <div className="bis-bar">
      {/* the switch stays in the middle: the count to its left, the specializations open to its right */}
      <div className="bis-bar-left">
        {data?.status === "ready" && (
          <span className={`bis-count ${data.complete ? "full" : ""}`} title={t("bis_count_h")}>BiS: {data.have}/{data.total}</span>
        )}
      </div>
      <div className="bis-switch" role="tablist">
        <button role="tab" aria-selected={!on} className={!on ? "on" : ""} onClick={() => setOn(false)}>{t("bis_worn")}</button>
        <button role="tab" aria-selected={on} className={on ? "on" : ""} onClick={() => setOn(true)}>BiS</button>
      </div>
      <div className="bis-bar-right">
        <AnimatePresence>
          {on && data?.specs && (
            <motion.div className="bis-specs" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }}>
              {data.specs.map((k, i) => (
                <button key={k} className={`bis-spec ${k === spec ? "on" : ""}`} onClick={() => setSpec(k)} title={label(k, i)}>
                  {tabs[i] && <span className="bis-spec-ico" style={iconStyle(icons.data, tabs[i].icon)} />}
                  <span>{label(k, i)}</span>
                </button>
              ))}
              <button className={`bis-spec ${spec === "custom" ? "on" : ""}`} onClick={() => (data.customSet ? setSpec("custom") : setEdit(true))} title={t("bis_custom_h")}>
                <span>{t("bis_custom")}</span>
              </button>
              <button className="bis-spec px-2" onClick={() => setEdit(true)} title={t("bis_custom_edit")} aria-label={t("bis_custom_edit")}>⚙</button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {edit && data && cid && <WeightEditor data={data} cid={cid} label={label} onClose={() => setEdit(false)} onSaved={() => (setEdit(false), setSpec("custom"))} />}
    </div>
  );
}

// stat groups the weights use (app/bis.py GROUPS) and single stats worth offering
const W_KEYS = ["sp", "heal", "INTELLECT", "SPIRIT", "STAMINA", "STRENGTH", "AGILITY", "ap", "rap", "crit", "hit", "haste",
  "mp5", "exp", "tank", "armor", "dps", "dps_off", "dps_ranged", "dps_wand", "BONUS_STAT_SHADOW_DAMAGE_DONE",
  "BONUS_STAT_HOLY_DAMAGE_DONE", "BONUS_STAT_FIRE_DAMAGE_DONE", "BONUS_STAT_FROST_DAMAGE_DONE",
  "BONUS_STAT_ARCANE_DAMAGE_DONE", "BONUS_STAT_NATURE_DAMAGE_DONE"];

/** The player's own weights: start from a specialization, change any number, save; the BiS mode then uses them. */
function WeightEditor({ data, cid, label, onClose, onSaved }: { data: BisData; cid: number; label: (k: string, i: number) => string; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [base, setBase] = useState(data.customBase ?? data.specs[0]);
  const [w, setW] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(data.weights || {}).map(([k, v]) => [k, String(v)])));
  const [busy, setBusy] = useState(false);
  // a new starting specialization: its own numbers as the start
  const loadBase = async (b: string) => {
    setBase(b);
    const d = await wowApi.bis<BisData>(cid, b, "en");
    setW(Object.fromEntries(Object.entries(d.weights || {}).map(([k, v]) => [k, String(v)])));
  };
  const save = async () => {
    setBusy(true);
    const weights = Object.fromEntries(Object.entries(w).filter(([, v]) => v.trim() !== "" && !Number.isNaN(Number(v))).map(([k, v]) => [k, Number(v)]));
    await wowApi.bisCustom(cid, { base, weights });
    await qc.invalidateQueries({ queryKey: ["bis", cid] });
    setBusy(false);
    onSaved();
  };
  const keys = [...new Set([...W_KEYS.filter((k) => k in w), ...Object.keys(w), ...W_KEYS])];
  return createPortal(
    <div className="fixed inset-0 z-[95] grid place-items-center bg-black/60 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bis-weights panel w-full max-w-lg p-4">
        <h2 className="panel-title">{t("bis_custom_t")}</h2>
        <p className="mt-1 text-xs text-muted">{t("bis_custom_p")}</p>
        <label className="mt-3 flex items-center gap-2 text-sm">{t("bis_custom_base")}
          <select className="input w-auto py-1" value={base} onChange={(e) => void loadBase(e.target.value)}>
            {data.specs.map((k, i) => <option key={k} value={k}>{label(k, i)}</option>)}
          </select>
        </label>
        <div className="mt-3 grid max-h-[50vh] grid-cols-2 gap-x-4 gap-y-1.5 overflow-y-auto pr-1 text-sm">
          {keys.map((k) => (
            <label key={k} className="flex items-center justify-between gap-2">
              <span className="truncate">{weightName(t, k)}</span>
              <input className="input w-20 py-0.5 text-right" inputMode="decimal" value={w[k] ?? ""} placeholder="0"
                onChange={(e) => setW({ ...w, [k]: e.target.value.replace(",", ".") })} />
            </label>
          ))}
        </div>
        <div className="mt-4 flex justify-between gap-2">
          <button className="btn text-sm" onClick={() => void loadBase(base)}>{t("bis_custom_reset")}</button>
          <span className="flex gap-2">
            <button className="btn text-sm" onClick={onClose}>{t("so_close")}</button>
            <button className="btn-primary text-sm" disabled={busy} onClick={() => void save()}>{t("bis_custom_save")}</button>
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function weightName(t: (k: Key) => string, k: string): string {
  const own = `bis_w_${k}` as Key;
  const s = t(own);
  return s === own ? statName(t, k).replace(/^к /, "") : s;
}

/** One slot in BiS mode: the picked item, a small arrow under it for the other two, a comparison on hover. */
export function BisGear({ slot, s, side, size, i, onPick, onOpen, empty }: {
  slot: string; s?: BisSlot; side: "left" | "right" | "none"; size: number; i: number;
  onPick: (slot: string, n: number) => void; onOpen: (x: BisItem) => void; empty?: boolean;
}) {
  const { t } = useI18n();
  const [menu, setMenu] = useState(false);
  const [hover, setHover] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!menu) return;
    const off = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, [menu]);
  const name = t(`slot_${slot}` as Key);
  const x = s?.options[s.pick];
  return (
    <motion.div ref={box} className={`tr-gear ${side} bis-cell ${s?.ok ? "ok" : ""} ${menu || hover ? "raise" : ""}`}
      initial={{ opacity: 0, filter: "blur(6px)" }} animate={{ opacity: 1, filter: "blur(0px)" }} transition={{ delay: 0.1 + i * 0.03, duration: 0.4 }}>
      <span ref={anchor} className="bis-icon-wrap" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
        {x ? (
          <button className="tr-gear-icon bis-icon" onClick={() => onOpen(x)} aria-label={`${name}: ${x.name}`}>
            <ItemIcon itemId={x.id} quality={Q[x.q]} size={size} />
            <span className="bis-rank-badge" title={t("bis_rank", { n: (s?.pick ?? 0) + 1 })}>{(s?.pick ?? 0) + 1}</span>
            {s?.ok && <span className="bis-tick" aria-hidden>✓</span>}
          </button>
        ) : (
          <span className="slot-empty tr-gear-icon" style={{ width: size, height: size }} title={empty ? t("bis_two_hand") : t("bis_none")}>{empty ? "—" : name.slice(0, 1)}</span>
        )}
        {s && s.options.length > 1
          ? <button className="bis-arrow" onClick={() => setMenu(!menu)} aria-label={t("bis_other")}>▾</button>
          : <span className="bis-arrow-space" aria-hidden />}
        <AnimatePresence>
          {hover && x && !menu && anchor.current && <Compare a={x} b={s?.worn ?? null} side={side} anchor={anchor.current} />}
        </AnimatePresence>
      </span>
      {x && side !== "none" && (
        <span className="tr-gear-text">
          <span className="tr-gear-name" style={{ color: qCol(x.q) }}>{x.name}</span>
          <span className="tr-gear-sub"><span>{x.ilvl}</span>{s?.wornRank != null
            ? <span className="text-good">{t("bis_worn_rank", { n: s.wornRank + 1 })}</span>
            : s?.ok ? <span className="text-good">{t("bis_better")}</span> : null}</span>
        </span>
      )}
      <AnimatePresence>
        {menu && s && (
          <motion.div className={`bis-menu ${side}`} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}>
            {s.options.map((o, n) => {
              const d = s.worn ? o.score - s.worn.score : null;
              return (
                <button key={o.id} className={`bis-opt ${n === s.pick ? "on" : ""}`} onClick={() => { onPick(slot, n); setMenu(false); }}>
                  <span className="bis-rank">{n + 1}</span>
                  <ItemIcon itemId={o.id} quality={Q[o.q]} size={26} />
                  <span className="grid min-w-0 text-left">
                    <span className="truncate" style={{ color: qCol(o.q) }}>{o.name}{s.wornId === o.id ? <span className="bis-worn-tag">{t("bis_worn_tag")}</span> : null}</span>
                    <span className="text-[11px] text-muted">{t("bis_ilvl", { i: o.ilvl })}{d != null ? <> · <Delta v={d} base={s.worn!.score} /></> : null}</span>
                    <SrcLine s={o.src} />
                  </span>
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function Delta({ v, base }: { v: number; base: number }) {
  const pct = base > 0 ? Math.round((v / base) * 100) : null;
  return <span className={v > 0 ? "text-good" : v < 0 ? "text-bad" : "text-muted"}>{v > 0 ? "+" : ""}{pct != null ? `${pct}%` : v.toFixed(0)}</span>;
}

/** The game's two-column comparison: the BiS item, what is worn, and the difference in every stat. */
function Compare({ a, b, side, anchor }: { a: BisItem; b: BisItem | null; side: string; anchor: HTMLElement }) {
  const { t } = useI18n();
  // drawn over the whole page (a portal), beside the slot: the hall's name plate and the other slots can't cover it
  const r = anchor.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight, W = Math.min(420, vw - 16);
  const pos: React.CSSProperties = { position: "fixed", width: W };
  if (side === "none") {
    pos.left = r.left + r.width / 2 - W / 2;
    pos.bottom = vh - r.top + 10;
  } else {
    pos.left = side === "left" ? r.left - W - 12 : r.right + 12;
    if (r.top > vh / 2) pos.bottom = vh - r.bottom - 8;
    else pos.top = r.top - 8;
  }
  pos.left = Math.max(8, Math.min(vw - W - 8, pos.left as number));
  const keys = [...new Set([...Object.keys(a.stats), ...Object.keys(b?.stats || {})])];
  const extra = (x: BisItem | null) => [
    ...(x?.armor ? [["ARMOR", x.armor] as const] : []), ...(x?.dps ? [["DPS", x.dps] as const] : []),
  ];
  const ex = new Map([...extra(a)]), exb = new Map([...extra(b)]);
  const all = [...keys, ...[...new Set([...ex.keys(), ...exb.keys()])]];
  const val = (x: BisItem | null, k: string) => (x ? (x.stats[k] ?? (k === "ARMOR" ? x.armor : k === "DPS" ? x.dps : 0) ?? 0) : 0);
  return (
    createPortal(<motion.div className="bis-compare" style={pos} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
      <div className="bis-cmp-cols">
        <ItemCard x={a} head={t("bis_this")} />
        <ItemCard x={b} head={t("bis_worn_now")} />
      </div>
      <div className="bis-cmp-diff">
        {all.map((k) => {
          const d = Math.round((val(a, k) - val(b, k)) * 10) / 10;
          if (!d) return null;
          return <div key={k} className={d > 0 ? "text-good" : "text-bad"}>{d > 0 ? "+" : ""}{d} {statName(t, k)}</div>;
        })}
        <div className="bis-cmp-total">
          {b ? <>{t("bis_total")}: <Delta v={a.score - b.score} base={b.score} /></> : t("bis_slot_empty")}
        </div>
      </div>
    </motion.div>, document.body)
  );
}

function ItemCard({ x, head }: { x: BisItem | null; head: string }) {
  const { t } = useI18n();
  return (
    <div className="bis-card">
      <div className="eyebrow mb-1">{head}</div>
      {!x ? <div className="text-sm text-muted">—</div> : (
        <>
          <div className="font-semibold" style={{ color: qCol(x.q) }}>{x.name}</div>
          <SrcLine s={x.src} />
          <div className="text-[11px] text-[#ffd100]">{t("bis_ilvl", { i: x.ilvl })}{x.req ? ` · ${t("bis_req", { l: x.req })}` : ""}</div>
          {x.armor ? <div className="text-xs">{x.armor} {statName(t, "ARMOR")}</div> : null}
          {x.dps ? <div className="text-xs">{x.dps.toFixed(1)} {statName(t, "DPS")}{x.speed ? ` · ${(x.speed / 1000).toFixed(2)}` : ""}</div> : null}
          {Object.entries(x.stats).map(([k, v]) => <div key={k} className="text-xs">+{v} {statName(t, k)}</div>)}
          {x.spells.map((sp, i) => <div key={i} className="text-xs text-[#1eff00]">{sp}</div>)}
        </>
      )}
    </div>
  );
}

const STAT: Record<string, Key> = {
  STRENGTH: "st_strength", AGILITY: "st_agility", STAMINA: "st_stamina", INTELLECT: "st_intellect", SPIRIT: "st_spirit",
  ARMOR: "st_armor",
};
export function statName(t: (k: Key) => string, k: string): string {
  if (STAT[k]) return t(STAT[k]);
  const own = `bis_st_${k}` as Key;
  const s = t(own);
  return s === own ? k.toLowerCase().replace(/_/g, " ") : s;
}

/** Changing a pick or the specialization: save it and look again. */
export function useBisActions(cid: number | null) {
  const qc = useQueryClient();
  return {
    pick: async (spec: string, slot: string, pick: number) => {
      if (!cid) return;
      await wowApi.bisPick(cid, { spec, slot, pick });
      await qc.invalidateQueries({ queryKey: ["bis", cid] });
    },
    spec: async (spec: string) => {
      if (!cid) return;
      await wowApi.bisSpec(cid, spec);
      await qc.invalidateQueries({ queryKey: ["bis", cid] });
    },
  };
}

/** In the normal view: a worn item that is one of the three best for the slot gets its place. */
export function WornRank({ s }: { s?: BisSlot }) {
  const { t } = useI18n();
  if (s?.wornRank == null) return null;
  return <span className="bis-worn-badge" title={t("bis_worn_rank", { n: s.wornRank + 1 })}>BiS {s.wornRank + 1}</span>;
}
