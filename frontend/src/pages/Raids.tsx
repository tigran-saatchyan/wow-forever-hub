/**
 * Getting ready for the raids: the countdown to 9 December and what opens, then every quest chain (attunements,
 * keys, reputations, legendaries) in the order to do them against every character, from the quests Blizzard
 * says are done. The chains themselves are walked on the map page.
 */
import { useActiveChar } from "../lib/activeChar";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useEffect, useState, type ReactNode } from "react";
import { ORDERED, STAGES, fits, progress, type Chain } from "../lib/chains";
import { ClassIcon } from "./Characters";
import { ChainLink } from "./map/ChainPanel";
import { useI18n, type Key } from "../lib/i18n";
import { store } from "../lib/store";
import { fullName, useCharacter, wowApi, type AhState, type Character, type ConsRecipe } from "../lib/wowApi";
import { RecipeBadge } from "./raids/RecipeBadge";
import { AhChip } from "../components/AhChip";
import { ItemHover, ItemIcon } from "../components/Wow";
import { useTab } from "./characters/ArmoryTabs";
import { PreRaid } from "./raids/PreRaid";

const OPENS = Date.UTC(2026, 11, 9, 4, 0); // 9 December, the weekly reset in Europe (Wednesday morning)

const RAIDS: { key: string; size: number; bosses: number | null; attune: boolean }[] = [
  { key: "barrow", size: 10, bosses: 8, attune: false },
  { key: "hyjal", size: 20, bosses: 13, attune: false },
  { key: "onyxia", size: 40, bosses: null, attune: true },
];

function useCountdown() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60e3);
    return () => clearInterval(id);
  }, []);
  const ms = Math.max(0, OPENS - now);
  return { open: ms === 0, d: Math.floor(ms / 864e5), h: Math.floor(ms / 36e5) % 24, m: Math.floor(ms / 6e4) % 60 };
}

export function Raids() {
  const { t } = useI18n();
  const cd = useCountdown();
  const { chars: all, char } = useActiveChar();
  const [favOn, setFavOn] = useState(() => store.get("raidsFavs", false));
  const favToggle = () => (store.set("raidsFavs", !favOn), setFavOn(!favOn));
  // the menu's character, or with the switch on, the starred ones (the picked one too, first)
  const chars = !char ? [] : favOn ? [char, ...all.filter((c) => c.favorite && c.id !== char.id)] : [char];
  return (
    <div className="space-y-5">
      <motion.section className="raid-hero" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="brand-sub">{t("rd_sub")}</div>
        <h1 className="font-display text-3xl text-gold sm:text-4xl">{t("rd_title")}</h1>
        <div className="mt-2 font-display text-2xl">
          {cd.open ? <span className="text-good">{t("rd_open")}</span> : t("rd_in", { d: cd.d, h: cd.h, m: cd.m })}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {RAIDS.map((r, i) => (
            <motion.div key={r.key} className="raid-card" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.08 }}>
              <div className="font-display text-xl text-gold">{t(`rd_${r.key}` as Key)}</div>
              <div className="mt-1 text-sm text-muted">{t("rd_size", { n: r.size })}{r.bosses ? ` · ${t("rd_bosses", { n: r.bosses })}` : ""}</div>
              <div className={`mt-2 text-sm ${r.attune ? "text-[#ffb070]" : "text-good"}`}>{t(r.attune ? "rd_attune" : "rd_no_attune")}</div>
            </motion.div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">{t("rd_note")}</p>
      </motion.section>

      <PreRaid char={char} />
      <Matrix chars={chars} extra={all.length > 1 && (
        <button className={`${favOn ? "btn-primary" : "btn"} shrink-0 py-1 text-sm`} aria-pressed={favOn} onClick={favToggle} title={t("rd_favs_h")}>{t("rd_favs")}</button>
      )} />
      <Prep chars={chars} />
      {!chars.length && <p className="text-muted">{t("tr_none")}</p>}
    </div>
  );
}

/** Every chain, stage by stage, as cards: each chain with its progress for the character picked in the menu (and
 * the starred ones with the switch on); a progress opens the chain on the map with that character. */
/** A section's title as a switch that folds it; the choice is kept in this browser. */
function useFold(key: string): [boolean, (title: string, extra?: ReactNode) => ReactNode] {
  const [open, setOpen] = useState(() => store.get(key, true));
  // anything else in the title row (a switch) sits on the right, outside the folding button
  const head = (title: string, extra?: ReactNode) => (
    <div className="flex items-center gap-3">
      <button type="button" className="cr-toggle min-w-0 flex-1" aria-expanded={open} onClick={() => (store.set(key, !open), setOpen(!open))}>
        <h2 className="panel-title">{title}</h2>
        <span className="cr-chev" aria-hidden>▾</span>
      </button>
      {extra}
    </div>
  );
  return [open, head];
}

function Matrix({ chars, extra }: { chars: Character[]; extra?: ReactNode }) {
  const { t, lang } = useI18n();
  const [open, head] = useFold("raidsChainsOpen");
  if (!chars.length) return null;
  const multi = chars.length > 1;
  return (
    <motion.section className="panel p-4" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
      {head(t("cn_matrix"), extra)}
      {open && <>
      <p className="mt-1 text-xs text-muted">{t("cn_matrix_h")}</p>
      {multi && (
        <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted">
          {chars.map((c) => <span key={c.id} className="flex items-center gap-1.5"><ClassIcon classId={c.summary?.[lang]?.classId ?? null} size={16} />{fullName(c, lang)}</span>)}
        </div>
      )}
      <div className="mt-3 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {STAGES.map((st) => {
          const list = ORDERED.filter((c) => c.stage === st.n && chars.some((ch) => fits(c, ch.summary?.[lang]?.faction, ch.summary?.[lang]?.classId)));
          if (!list.length) return null;
          return (
            <div key={st.n} className="cn-card">
              <div className="cn-stage-head">
                <span className="cn-stage-n">{st.n}</span>
                <span className="font-display text-gold">{st.name[lang]}</span>
                {!st.announced && <span className="cn-tag">{t("cn_not_announced")}</span>}
              </div>
              <ul className="mt-2 space-y-1.5">
                {list.map((c) => (
                  <li key={c.key} className="cn-row">
                    <div className="min-w-0 flex-1">
                      <ChainLink chain={c.key}>{c.name[lang]}</ChainLink>
                      <div className="text-[11px] text-muted">{t(`cn_cat_${c.category}` as Key)}{c.minLevel ? ` · ${t("cn_from_level", { l: c.minLevel })}` : ""}</div>
                    </div>
                    <div className="grid shrink-0 justify-items-end gap-1">
                      {chars.map((ch) => <Cell key={ch.id} c={c} ch={ch} multi={multi} />)}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      </>}
    </motion.section>
  );
}

function Cell({ c, ch, multi }: { c: Chain; ch: Character; multi: boolean }) {
  const { t, lang } = useI18n();
  const s = ch.summary?.[lang];
  const done = useTab<{ ids?: number[] }>(ch.id, "quests");
  const who = multi ? <ClassIcon classId={s?.classId ?? null} size={14} /> : null;
  if (!fits(c, s?.faction, s?.classId)) return multi ? <span className="flex items-center gap-1.5 text-xs text-muted">{who}—</span> : null;
  const p = progress(c, new Set(done.data?.data?.ids || []));
  const low = c.minLevel && (s?.level ?? 0) < c.minLevel;
  return (
    <ChainLink chain={c.key} char={ch.id}>
      <span className="flex items-center gap-1.5 text-xs" title={multi ? fullName(ch, lang) : undefined}>
        {who}
        {done.isLoading ? "…" : p.complete ? <span className="text-good">✓ {t("cn_finished")}</span> : <>
          <span className="cn-bar"><span style={{ width: `${p.total ? (p.done / p.total) * 100 : 0}%` }} /></span>
          <span className={`tabular-nums ${p.done ? "text-gold" : "text-muted"}`}>{p.done}/{p.total}</span>
        </>}
        {low && !p.complete ? <span className="text-[10px] text-bad">{t("cn_lvl_short", { l: c.minLevel! })}</span> : null}
      </span>
    </ChainLink>
  );
}

/** Getting ready for the raid, per character: what the hub checks by itself (the pre-raid gear against its list,
 * the fire resistance on the character sheet), and the shopping list to tick before the raid — each consumable on
 * its own, then repairs and reagents (ticks kept in this browser, cleared with one button for the next raid). */
function Prep({ chars }: { chars: Character[] }) {
  const { t } = useI18n();
  const [open, head] = useFold("raidsPrepOpen");
  if (!chars.length) return null;
  return (
    <motion.section className="panel p-4" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
      {head(t("rd_prep"))}
      {open && <div className="mt-3 space-y-4">{chars.map((c) => <PrepChar key={c.id} c={c} multi={chars.length > 1} />)}</div>}
    </motion.section>
  );
}

function PrepChar({ c, multi }: { c: Character; multi: boolean }) {
  const { t, lang } = useI18n();
  const pre = useQuery({ queryKey: ["prebis", c.id, lang], queryFn: () => wowApi.prebis(c.id, lang), staleTime: 5 * 60e3, retry: 3, retryDelay: (n) => 2000 * (n + 1) });
  const full = useCharacter(c.id).data;
  const key = `raidPrep:${c.id}`;
  const [ticks, setTicks] = useState<Record<string, boolean>>(() => store.get<Record<string, boolean>>(key, {}));
  const save = (v: Record<string, boolean>) => (setTicks(v), store.set(key, v));
  const d = pre.data?.available ? pre.data : null;
  const fire = full?.stats?.[lang]?.fire_resistance;
  // what to have on you: the list's consumables when the class has one, then repairs and reagents
  const manual: { k: string; id?: number; label: string; hint?: string; ah?: AhState | null; recipe?: ConsRecipe | null }[] = [
    ...(d?.consumables || []).map((x) => ({ k: `c:${x.id}`, id: x.id, label: t(`pr_c_${x.id}` as Key), hint: t(`pr_c_${x.id}_h` as Key), ah: x.ah, recipe: x.recipe })),
    ...(d?.consumables?.length || pre.isLoading || pre.isError ? [] : [{ k: "rp_consum", label: t("rp_consum") }]),
    { k: "rp_repair", label: t("rp_repair") },
  ];
  const done = manual.filter((x) => ticks[x.k]).length;
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]">
      <div>
        <div className="prebis-glabel flex items-center gap-2">
          {multi && <ClassIcon classId={c.summary?.[lang]?.classId ?? null} size={16} />}{t("rp_auto")}{multi ? ` — ${fullName(c, lang)}` : ""}
        </div>
        <ul className="space-y-1.5">
          <li className="cn-row">
            <span className="min-w-0 flex-1 text-sm">{t("rp_gear")}</span>
            {d ? <>
              <span className="cn-bar"><span style={{ width: `${d.total ? (d.owned / d.total) * 100 : 0}%` }} /></span>
              <span className={`text-sm tabular-nums ${d.owned >= d.total ? "text-good" : "text-[#ffb070]"}`}>
                {d.owned >= d.total ? `✓ ${d.owned}/${d.total}` : t("rp_have", { n: d.owned, t: d.total })}
              </span>
            </> : pre.isLoading ? <span className="text-xs text-muted">…</span>
              : pre.isError ? <button className="whitespace-nowrap text-xs text-[#ffb070] underline" onClick={() => pre.refetch()}>{t("rp_gear_err")}</button>
              : <span className="whitespace-nowrap text-xs text-muted" title={t("rp_gear_none_h")}>{t("rp_gear_none")}</span>}
          </li>
          <li className="cn-row">
            <span className="min-w-0 flex-1 text-sm">{t("rp_fire")}</span>
            <span className="text-sm tabular-nums">{typeof fire === "number" ? fire : <span className="whitespace-nowrap text-xs text-muted" title={t("rp_fire_none_h")}>{t("rp_fire_none")}</span>}</span>
          </li>
        </ul>
        {d && <p className="mt-1.5 text-xs text-muted">{t("rp_auto_h")}</p>}
      </div>
      <div>
        <div className="prebis-glabel flex items-center gap-2">
          {t("rp_manual")}
          <span className={done === manual.length ? "text-good" : "text-muted"}>{done}/{manual.length}</span>
          {done > 0 && <button className="btn ml-auto py-0.5 text-xs" onClick={() => save({})}>{t("rp_reset")}</button>}
        </div>
        <ul className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 24rem), 1fr))" }}>
          {manual.map((x) => (
            <li key={x.k} className={`cn-row ${ticks[x.k] ? "rp-done" : ""}`}>
              <input type="checkbox" className="shrink-0 cursor-pointer" checked={!!ticks[x.k]} aria-label={x.label}
                onChange={() => save({ ...ticks, [x.k]: !ticks[x.k] })} />
              {x.id && <ItemHover id={x.id}><ItemIcon itemId={x.id} size={28} /></ItemHover>}
              {/* name, what it gives and the recipe line in one column: no gap between them */}
              <span className="grid min-w-0 flex-1 leading-tight">
                {x.id ? <ItemHover id={x.id}><span className="block truncate text-sm">{x.label}</span></ItemHover>
                  : <span className="truncate text-sm">{x.label}</span>}
                {x.hint && <span className="truncate text-xs text-muted">{x.hint}</span>}
                {x.recipe && <span className="mt-0.5"><RecipeBadge r={x.recipe} /></span>}
              </span>
              {d?.market && x.id && x.ah && <AhChip id={x.id} ah={x.ah} />}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** "from level 58": red while the character is below it; "≈" when it is an estimate. */
export function MinLevel({ min, level }: { min: { level: number; sure: boolean }; level: number | null }) {
  const { t } = useI18n();
  const low = level != null && level < min.level;
  return (
    <span className={`ml-2 shrink-0 rounded px-1.5 text-[11px] ${low ? "bg-bad/15 text-bad" : "bg-good/10 text-good"}`}
      title={t(min.sure ? "rd_min_sure" : "rd_min_est")}>
      {t("rd_min", { l: `${min.sure ? "" : "≈"}${min.level}` })}
    </span>
  );
}
