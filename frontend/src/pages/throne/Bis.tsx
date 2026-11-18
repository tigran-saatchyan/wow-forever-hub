/**
 * The throne room's BiS mode: the best gear for the character's class, specialization and level in the slots
 * (worked out on the server, app/bis.py), up to three per slot to choose from, a comparison with what is worn
 * on hover, and where to get it on click. The picks stay until the character's level changes.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { ItemIcon } from "../../components/Wow";
import { allTalents } from "../../engine";
import { iconStyle, useIcons, useTalents } from "../../lib/gameData";
import { mapTalents } from "../../lib/charTalents";
import { useI18n, type Key } from "../../lib/i18n";
import { QUALITY, wowApi, type Character } from "../../lib/wowApi";

export interface BisItem {
  id: number; name: string; q: number; ilvl: number; req: number; stats: Record<string, number>;
  armor: number | null; dps: number | null; speed: number | null; spells: string[]; two: boolean; score: number;
}
export interface BisSlot { options: BisItem[]; pick: number; worn: BisItem | null; wornId: number | null; wornRank: number | null; ok: boolean }
export interface BisData {
  status: "ready" | "nodata"; class: string; specs: string[]; spec: string; specSaved?: boolean; level: number;
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
export function BisBar({ on, setOn, data, spec, setSpec, tabs }: {
  on: boolean; setOn: (v: boolean) => void; data?: BisData; spec: string | null; setSpec: (s: string) => void;
  tabs: { name: string; icon: string }[];
}) {
  const { t } = useI18n();
  const icons = useIcons();
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
                <button key={k} className={`bis-spec ${k === spec ? "on" : ""}`} onClick={() => setSpec(k)} title={tabs[i]?.name ?? k}>
                  {tabs[i] && <span className="bis-spec-ico" style={iconStyle(icons.data, tabs[i].icon)} />}
                  <span>{tabs[i]?.name ?? k}</span>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
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
      <span className="bis-icon-wrap" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
        {x ? (
          <button className="tr-gear-icon bis-icon" onClick={() => onOpen(x)} aria-label={`${name}: ${x.name}`}>
            <ItemIcon itemId={x.id} quality={Q[x.q]} size={size} />
            <span className="bis-rank-badge" title={t("bis_rank", { n: (s?.pick ?? 0) + 1 })}>{(s?.pick ?? 0) + 1}</span>
            {s?.ok && <span className="bis-tick" aria-hidden>✓</span>}
          </button>
        ) : (
          <span className="slot-empty tr-gear-icon" style={{ width: size, height: size }} title={empty ? t("bis_two_hand") : t("bis_none")}>{empty ? "—" : name.slice(0, 1)}</span>
        )}
        {s && s.options.length > 1 && (
          <button className="bis-arrow" onClick={() => setMenu(!menu)} aria-label={t("bis_other")}>▾</button>
        )}
        <AnimatePresence>
          {hover && x && !menu && <Compare a={x} b={s?.worn ?? null} side={side} />}
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
function Compare({ a, b, side }: { a: BisItem; b: BisItem | null; side: string }) {
  const { t } = useI18n();
  const keys = [...new Set([...Object.keys(a.stats), ...Object.keys(b?.stats || {})])];
  const extra = (x: BisItem | null) => [
    ...(x?.armor ? [["ARMOR", x.armor] as const] : []), ...(x?.dps ? [["DPS", x.dps] as const] : []),
  ];
  const ex = new Map([...extra(a)]), exb = new Map([...extra(b)]);
  const all = [...keys, ...[...new Set([...ex.keys(), ...exb.keys()])]];
  const val = (x: BisItem | null, k: string) => (x ? (x.stats[k] ?? (k === "ARMOR" ? x.armor : k === "DPS" ? x.dps : 0) ?? 0) : 0);
  return (
    <motion.div className={`bis-compare ${side}`} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
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
    </motion.div>
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
          <div className="text-[11px] text-[#ffd100]">{t("bis_ilvl", { i: x.ilvl })}{x.req ? ` · ${t("bis_req", { l: x.req })}` : ""}</div>
          {x.armor ? <div className="text-xs">{x.armor} {statName(t, "ARMOR")}</div> : null}
          {x.dps ? <div className="text-xs">{x.dps.toFixed(1)} {statName(t, "DPS")}{x.speed ? ` · ${x.speed.toFixed(2)}` : ""}</div> : null}
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
