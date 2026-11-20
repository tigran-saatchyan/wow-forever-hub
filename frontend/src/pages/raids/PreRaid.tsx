/**
 * Pre-raid best in slot for a class and specialization (the server's data/prebis): every slot's items — the one
 * that fits either way, or one for damage (hit capped) and one for hit (short of the cap) — against the chosen
 * character: the spell hit it has (talents and worn gear), what of the list it has (worn, or marked by hand), and
 * the items to go for next. Shown only for a character of that class playing that specialization.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence } from "framer-motion";
import { useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ItemIcon } from "../../components/Wow";
import { iconStyle, useIcons } from "../../lib/gameData";
import { useI18n, type Key } from "../../lib/i18n";
import { store } from "../../lib/store";
import { fullName, qColor, wowApi, type Character, type PreBis, type PreBisItem } from "../../lib/wowApi";
import { Compare } from "../throne/Bis";
import { ConsumablesPane, EnchantsPane, GuidePane, TalentsPane } from "./PreRaidTabs";
import { applySim, BuffBar, SimSettings, useSimCfg, type SimResult } from "./SimBuffs";

const TABS = ["items", "talents", "guide", "consumables", "enchants"] as const;

const Q = ["POOR", "COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY"];

export function PreRaid({ char }: { char: Character | null }) {
  const { t, lang } = useI18n();
  const q = useQuery({
    queryKey: ["prebis", char?.id, lang], enabled: !!char, queryFn: () => wowApi.prebis(char!.id, lang), staleTime: 5 * 60e3, retry: false,
  });
  const [open, setOpen] = useState(() => store.get("prebisOpen", true));
  const [tab, setTab] = useState<string>(() => store.get("prebisTab", "items"));
  const [sim, setSim] = useState(false);
  const [cfg, setCfg] = useSimCfg();
  if (!char || !q.data?.available) return null;
  const d = q.data;
  const cur = { c: char };
  const r = sim ? applySim(d, cfg) : null;
  const toggle = () => { store.set("prebisOpen", !open); setOpen(!open); };
  return (
    <section className="panel prebis p-4">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="flex items-center gap-2" onClick={toggle} aria-expanded={open}>
          <span className={`text-gold transition-transform ${open ? "" : "-rotate-90"}`} aria-hidden>▾</span>
          <h2 className="font-display text-xl text-gold">{t(`pr_title_${d.spec}` as Key)}</h2>
        </button>
        <span className="text-sm text-muted">{fullName(cur.c, lang)}</span>
        <span className="ml-auto text-sm text-muted">{t("pr_have", { n: d.owned, t: d.total })}</span>
        <button className={sim ? "btn-primary" : "btn"} onClick={() => setSim(!sim)} title={t("pr_sim_h")}>{t(sim ? "pr_sim_off" : "pr_sim")}</button>
        <SimSettings d={d} cfg={cfg} set={(c) => (setCfg(c), setSim(true))} />
      </div>
      {open && (
        <div className="mt-4 space-y-4">
          <HitBar d={d} r={r} />
          <StatSummary d={d} r={r} />
          {r && <BuffBar r={r} />}
          <div className="prebis-tabs" role="tablist">
            {TABS.map((k) => (
              <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""}
                onClick={() => (setTab(k), store.set("prebisTab", k))}>{t(`pr_tab_${k}` as Key)}</button>
            ))}
          </div>
          {tab === "items" && <>
            <Legend />
            <div className="grid gap-3 lg:grid-cols-2">
              {d.slots.map((r) => <SlotCard key={r.slot} r={r} cid={cur.c.id} sim={sim} />)}
            </div>
          </>}
          {tab === "talents" && <TalentsPane d={d} cid={cur.c.id} />}
          {tab === "guide" && <GuidePane d={d} />}
          {tab === "consumables" && <ConsumablesPane d={d} level={d.level} />}
          {tab === "enchants" && <EnchantsPane d={d} />}
        </div>
      )}
    </section>
  );
}

/** The spell hit: talents (at their real ranks) and worn gear now, with the list's items the character has, against the cap. */
function HitBar({ d, r }: { d: PreBis; r: SimResult | null }) {
  const { t } = useI18n();
  const icons = useIcons();
  const full = d.hit.talentList.reduce((a, x) => a + x.full, 0);
  // the simulation: the best combination worn, the hit talents at full rank
  const h = r ? { ...d.hit, talent: full, planned: r.hit, total: r.hit, gear: +(r.hit - full).toFixed(2),
    need: Math.max(0, +(d.hit.cap - r.hit).toFixed(2)), talentList: d.hit.talentList.map((x) => ({ ...x, rank: x.max })) } : d.hit;
  const pct = (v: number) => `${Math.min(100, (v / h.cap) * 100)}%`;
  const done = h.planned >= h.cap;
  return (
    <div className="prebis-hit">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="font-display text-lg">{t("pr_hit")}</span>
        <span className={`font-mono text-lg ${done ? "text-good" : "text-[#ffb070]"}`}>{h.planned}% / {h.cap}%</span>
        <span className="text-sm text-muted">{t("pr_hit_now", { n: h.total, a: h.talent, b: h.gear })}</span>
        <span className={`text-sm ${done ? "text-good" : "text-[#ffb070]"}`}>{done ? t("pr_hit_done") : t("pr_hit_need", { n: h.need })}</span>
      </div>
      <div className="prebis-bar" aria-hidden>
        <span className="tal" style={{ width: pct(h.talent) }} />
        <span className="gear" style={{ left: pct(h.talent), width: pct(Math.max(0, h.planned - h.talent)) }} />
      </div>
      {h.talentList.map((x) => (
        <div key={x.id} className="mt-2 flex items-center gap-2 text-sm">
          <span className="prebis-tal" style={iconStyle(icons.data, x.icon)} aria-hidden />
          <span>{x.name}: {x.rank}/{x.max}</span>
          <span className={x.rank >= x.max ? "text-good" : "text-[#ffb070]"}>
            {x.rank >= x.max ? t("pr_tal_full", { n: x.full }) : t("pr_tal_more", { n: ((x.max - x.rank) / x.max) * x.full, r: x.max - x.rank })}
          </span>
        </div>
      ))}
    </div>
  );
}

function Legend() {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      <span><span className="prebis-dot owned" /> {t("pr_lg_owned")}</span>
      <span><span className="prebis-dot focus" /> {t("pr_lg_focus")}</span>
      <span><span className="prebis-dot best" /> {t("pr_lg_best")}</span>
    </div>
  );
}

function SlotCard({ r, cid, sim }: { r: PreBis["slots"][number]; cid: number; sim: boolean }) {
  const { t } = useI18n();
  const name = t((["FINGER", "TRINKET", "TWO_HAND"].includes(r.slot) ? `pr_slot_${r.slot}` : `slot_${r.slot}`) as Key);
  const group = (k: "center" | "damage" | "hit", label: string, cls: string): ReactNode => r[k].length > 0 && (
    <div className={`prebis-group ${cls}`}>
      <div className="prebis-glabel">{label}</div>
      <ul className="space-y-1.5">{r[k].map((x) => <Row key={x.id} x={x} cid={cid} sim={sim} />)}</ul>
    </div>
  );
  return (
    <div className="prebis-slot">
      <div className="mb-2 flex items-baseline gap-2">
        <b className="font-display text-base text-[#f3e3b5]">{name}</b>
        {r.count > 1 && <span className="text-xs text-muted">×{r.count}</span>}
        {r.slot === "TWO_HAND" && <span className="text-xs text-muted">{t("pr_staff_note")}</span>}
      </div>
      {group("center", t("pr_both"), "both")}
      {r.center.length > 0 && (r.damage.length > 0 || r.hit.length > 0) && <div className="h-2" />}
      <div className="space-y-2">
        {group("damage", t("pr_damage"), "dmg")}
        {group("hit", t("pr_hitcol"), "hit")}
      </div>
    </div>
  );
}

function Row({ x, cid, sim }: { x: PreBisItem; cid: number; sim: boolean }) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const [hover, setHover] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const mark = useMutation({
    mutationFn: () => wowApi.prebisOwned(cid, x.id, !x.marked),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prebis", cid, lang] }),
  });
  return (
    <li className={`prebis-item ${sim ? (x.author ? "owned" : "alt") : `${x.owned ? "owned" : ""} ${x.focus ? "focus" : ""} ${x.alt ? "alt" : ""}`}`}>
      <span ref={anchor} tabIndex={0} className="inline-flex min-w-0 flex-1 items-center gap-2.5"
        onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onFocus={() => setHover(true)} onBlur={() => setHover(false)}>
        <ItemIcon itemId={x.id} quality={Q[x.q]} size={34} />
        <span className="grid min-w-0 leading-tight">
          <span className="truncate text-[15px]" style={{ color: qColor(Q[x.q]) }}>
            {x.author && <span className="prebis-best" title={t("pr_lg_best")}>★</span>}{x.name}
          </span>
          <span className="text-xs text-[#ffd100]/80">{t("pr_ilvl", { i: x.ilvl ?? "?" })}{x.req ? ` · ${t("pr_req", { n: x.req })}` : ""}</span>
          <span className="relative z-[1] text-xs text-muted"><Src x={x} /></span>
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {x.hit > 0 && <span className="prebis-hitbadge">{t("pr_hit_badge", { n: x.hit })}</span>}
        {x.worn ? <span className="text-xs text-good">✓ {t("bis_worn_tag")}</span> : (
          <button className={`prebis-mark ${x.marked ? "on" : ""}`} disabled={mark.isPending} onClick={() => mark.mutate()}
            title={t(x.marked ? "pr_unmark" : "pr_mark")}>{x.marked ? `✓ ${t("pr_have_it")}` : t("pr_have_q")}</button>
        )}
      </span>
      <AnimatePresence>
        {hover && x.full && anchor.current && <Compare a={x.full} b={x.wornItem ?? null} side="right" anchor={anchor.current} head={t("pr_from_list")} />}
      </AnimatePresence>
    </li>
  );
}

/** Where the item comes from, in a line: the boss and the dungeon (and its part), a crafting profession, the vendor. */
function Src({ x }: { x: PreBisItem }) {
  const { t } = useI18n();
  const nav = useNavigate();
  const s = x.src;
  const part = s.part ? ` (${t(`pr_part_${s.part}` as Key)})` : "";
  const lv = s.levels ? ` ${s.levels[0] === s.levels[1] ? s.levels[0] : `${s.levels[0]}–${s.levels[1]}`}` : "";
  const where = s.dungeonName ? `${s.dungeonName}${part}${lv}` : "";
  const go = s.entrance ? () => nav(`/map?pin=${s.entrance!.map},${s.entrance!.x},${s.entrance!.y}&label=${encodeURIComponent(s.dungeonName ?? "")}`) : null;
  const place = (txt: string) => go
    ? <button type="button" className="prebis-place" onClick={go} title={t("pr_on_map")}>{txt}</button> : <>{txt}</>;
  const extra = [s.note && t(`pr_note_${s.note}` as Key), x.note && t(`pr_note_${x.note}` as Key)].filter(Boolean).join(" · ");
  let main: ReactNode = "";
  if (s.kind === "boss") main = <>{s.bossName}{where ? <> · {place(where)}</> : null}</>;
  else if (s.kind === "bosses") main = s.note === "various" ? t("pr_src_various") : <>{t("pr_src_bosses", { n: (s.bossNames || []).length })}{where ? <> · {place(where)}</> : null}</>;
  else if (s.kind === "vendor") main = t("pr_src_vendor");
  else if (s.kind === "craft") main = t("pr_src_craft", { p: t(`pr_prof_${s.profession}` as Key) });
  else if (s.kind === "trash") main = <>{t("pr_src_trash_a")} {place(where)}{t("pr_src_trash_b")}</>;
  return <>{main}{extra ? ` · ${extra}` : ""}{s.bossNames && s.kind === "bosses" && s.bossNames.length ? <span className="hidden sm:inline"> — {s.bossNames.join(", ")}</span> : null}</>;
}

/** What the character has now (their base and worn gear), and with the simulation the best combination with all
 * that is switched on in its settings. */
function StatSummary({ d, r }: { d: PreBis; r: SimResult | null }) {
  const { t } = useI18n();
  if (!d.summary) return null;
  const a = d.summary.worn;
  const manaNow = d.summary.base ? d.summary.base.mana + 15 * a.int : null;
  const rows: [string, number | null, number | null, string][] = [
    ["hit", a.hit, r?.hit ?? null, "%"], ["crit", a.crit, r?.crit ?? null, "%"], ["shadow", a.shadow, r?.shadow ?? null, ""],
    ["sp", a.sp, r?.sp ?? null, ""], ["pen", a.pen, r?.pen ?? null, ""], ["int", a.int, r?.int ?? null, ""],
    ["spi", a.spi, r?.spi ?? null, ""], ["sta", a.sta, r?.sta ?? null, ""], ["mana", manaNow, r?.mana ?? null, ""],
    ["mp5", a.mp5, r?.mp5 ?? null, ""],
  ];
  return (
    <div className="space-y-2">
      <div className="prebis-sum">
        {rows.map(([k, x, y, u]) => {
          const diff = x != null && y != null ? +(y - x).toFixed(2) : null;
          return (
            <div key={k} className="cell">
              <div className="eyebrow">{t(`pr_sum_${k}` as Key)}</div>
              <div className="font-mono text-lg">{x ?? "—"}{x != null ? u : ""}</div>
              {r && y != null && <div className="text-xs">→ <b className="text-gold">{y}{u}</b>{diff != null && <> <span className={diff > 0 ? "text-good" : diff < 0 ? "text-bad" : "text-muted"}>({diff > 0 ? "+" : ""}{diff}{u})</span></>}</div>}
            </div>
          );
        })}
        {r && r.dmg > 1 && (
          <div className="cell">
            <div className="eyebrow">{t("pr_sum_dmg")}</div>
            <div className="font-mono text-lg text-gold">+{Math.round((r.dmg - 1) * 100)}%</div>
            <div className="text-xs text-muted">{t("pr_sum_dmg_h")}</div>
          </div>
        )}
      </div>
      {!d.summary.base && <p className="text-xs text-muted">{t("pr_sum_nobase")}</p>}
      {r && d.summary.base && <p className="text-xs text-muted">{t("pr_sum_base", { l: d.level ?? "?" })}</p>}
    </div>
  );
}
