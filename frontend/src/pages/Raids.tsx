/**
 * Getting ready for the raids: the countdown to 9 December and what opens, then every quest chain (attunements,
 * keys, reputations, legendaries) in the order to do them against every character, from the quests Blizzard
 * says are done. The chains themselves are walked on the map page.
 */
import { useQueries } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { ORDERED, STAGES, fits, progress, type Chain } from "../lib/chains";
import { ClassIcon } from "./Characters";
import { ChainLink } from "./map/ChainPanel";
import { useI18n, type Key } from "../lib/i18n";
import { store } from "../lib/store";
import { fullName, useCharacters, wowApi, type Character } from "../lib/wowApi";
import { useTab } from "./characters/ArmoryTabs";
import { PreRaid } from "./raids/PreRaid";
import { ConsumablesPane } from "./raids/PreRaidTabs";

const OPENS = Date.UTC(2026, 11, 9, 4, 0); // 9 December, the weekly reset in Europe (Wednesday morning)

const RAIDS: { key: string; size: number; bosses: number | null; attune: boolean }[] = [
  { key: "barrow", size: 10, bosses: 8, attune: false },
  { key: "hyjal", size: 20, bosses: 13, attune: false },
  { key: "onyxia", size: 40, bosses: null, attune: true },
];

const PREP = ["rp_fire", "rp_consum", "rp_gear", "rp_repair"] as const;

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
  const chars = (useCharacters().data || []).filter((c) => !c.error);
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

      <PreRaid chars={chars} />
      <Matrix chars={chars} />
      <Prep chars={chars} />
      {!chars.length && <p className="text-muted">{t("tr_none")}</p>}
    </div>
  );
}

/** Every chain, stage by stage, against every character: done, how far, or not for them; a cell opens the
 * chain on the map with that character. */
function Matrix({ chars }: { chars: Character[] }) {
  const { t, lang } = useI18n();
  if (!chars.length) return null;
  return (
    <motion.section className="panel p-4" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
      <h2 className="panel-title">{t("cn_matrix")}</h2>
      <p className="mt-1 text-xs text-muted">{t("cn_matrix_h")}</p>
      <div className="swipe-x mt-3 overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="p-1.5 font-normal" />
              {chars.map((c) => <th key={c.id} className="p-1.5 font-normal"><span className="flex items-center gap-1.5"><ClassIcon classId={c.summary?.[lang]?.classId ?? null} size={18} />{fullName(c, lang)}</span></th>)}
            </tr>
          </thead>
          <tbody>
            {STAGES.map((st) => {
              const list = ORDERED.filter((c) => c.stage === st.n && chars.some((ch) => fits(c, ch.summary?.[lang]?.faction, ch.summary?.[lang]?.classId)));
              if (!list.length) return null;
              return [
                <tr key={`s${st.n}`}><td colSpan={chars.length + 1} className="px-1.5 pb-1 pt-3">
                  <span className="cn-stage-head"><span className="cn-stage-n">{st.n}</span>
                  <span className="font-display text-gold">{st.name[lang]}</span>
                  {!st.announced && <span className="cn-tag">{t("cn_not_announced")}</span>}</span>
                </td></tr>,
                ...list.map((c) => (
                  <tr key={c.key} className="border-t border-edge/30">
                    <td className="p-1.5">
                      <ChainLink chain={c.key}>{c.name[lang]}</ChainLink>
                      <div className="text-[11px] text-muted">{t(`cn_cat_${c.category}` as Key)}{c.minLevel ? ` · ${t("cn_from_level", { l: c.minLevel })}` : ""}</div>
                    </td>
                    {chars.map((ch) => <Cell key={ch.id} c={c} ch={ch} />)}
                  </tr>
                )),
              ];
            })}
          </tbody>
        </table>
      </div>
    </motion.section>
  );
}

function Cell({ c, ch }: { c: Chain; ch: Character }) {
  const { t, lang } = useI18n();
  const s = ch.summary?.[lang];
  const done = useTab<{ ids?: number[] }>(ch.id, "quests");
  if (!fits(c, s?.faction, s?.classId)) return <td className="p-1.5 text-xs text-muted">—</td>;
  const p = progress(c, new Set(done.data?.data?.ids || []));
  const low = c.minLevel && (s?.level ?? 0) < c.minLevel;
  return (
    <td className="p-1.5">
      <ChainLink chain={c.key} char={ch.id}>
        {done.isLoading ? "…" : p.complete ? <span className="text-good">✓ {t("cn_finished")}</span>
          : <span className={p.done ? "text-gold" : "text-muted"}>{p.done}/{p.total}</span>}
      </ChainLink>
      {low && !p.complete ? <div className="text-[11px] text-bad">{t("cn_from_level", { l: c.minLevel! })}</div> : null}
    </td>
  );
}

/** Getting ready for Onyxia, ticked per character (kept in this browser). */
function Prep({ chars }: { chars: Character[] }) {
  const { t, lang } = useI18n();
  const [prep, setPrep] = useState<Record<number, Record<string, boolean>>>(() =>
    Object.fromEntries(chars.map((c) => [c.id, store.get<Record<string, boolean>>(`raidPrep:${c.id}`, {})])));
  if (!chars.length) return null;
  const toggle = (id: number, k: string) => {
    const v = { ...(prep[id] || {}), [k]: !(prep[id] || {})[k] };
    setPrep({ ...prep, [id]: v });
    store.set(`raidPrep:${id}`, v);
  };
  return (
    <motion.section className="panel p-4" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
      <h2 className="panel-title">{t("rd_prep")}</h2>
      <div className="swipe-x mt-3 overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead><tr className="text-left text-xs text-muted"><th className="p-1.5" />{chars.map((c) => <th key={c.id} className="p-1.5 font-normal">{fullName(c, lang)}</th>)}</tr></thead>
          <tbody>
            {PREP.map((k) => (
              <tr key={k} className="border-t border-edge/30">
                <td className="p-1.5">{t(k)}</td>
                {chars.map((c) => <td key={c.id} className="p-1.5"><input type="checkbox" checked={!!prep[c.id]?.[k]} onChange={() => toggle(c.id, k)} /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <PrepConsumables chars={chars} />
    </motion.section>
  );
}

/** The consumables of the pre-raid list, for the characters that have one (cached with the section above). */
function PrepConsumables({ chars }: { chars: Character[] }) {
  const { t, lang } = useI18n();
  const qs = useQueries({ queries: chars.map((c) => ({ queryKey: ["prebis", c.id, lang], queryFn: () => wowApi.prebis(c.id, lang), staleTime: 5 * 60e3, retry: false })) });
  const fit = chars.map((c, i) => ({ c, d: qs[i].data })).filter((x) => x.d?.available && x.d.consumables?.length);
  if (!fit.length) return null;
  return (
    <div className="mt-4 space-y-3">
      {fit.map(({ c, d }) => (
        <div key={c.id}>
          <div className="prebis-glabel">{t("pr_tab_consumables")} — {fullName(c, lang)}</div>
          <ConsumablesPane d={d!} level={d!.level} />
        </div>
      ))}
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
