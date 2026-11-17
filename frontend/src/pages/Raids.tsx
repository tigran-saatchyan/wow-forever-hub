/**
 * Getting ready for the raids that open on 9 December: what opens, and for every character how far the
 * Onyxia attunement (the Drakefire Amulet) has gone, step by step, from the quests Blizzard says are done.
 * The chain's quest ids are the original ones, checked against Forever's own quest data.
 */
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CHAINS, chainFor, type Chain, type ChainStep } from "../lib/chains";
import MAPS from "../lib/maps.json";
import { useI18n, type Key } from "../lib/i18n";
import { store } from "../lib/store";
import { fullName, useCharacters, wowApi, type Character, type QuestInfo } from "../lib/wowApi";
import { QuestDetails, useTab } from "./characters/ArmoryTabs";

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
  // one character at a time: the others fold to a line with their progress
  const [openId, setOpenRaw] = useState<number | null>(() => store.get<number | null>("raidOpen", null));
  const setOpenId = (v: number | null) => (store.set("raidOpen", v), setOpenRaw(v));
  const open = openId === null && chars.length === 1 ? chars[0].id : openId;
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

      {chars.map((c, i) => (
        <Attunement key={c.id} c={c} delay={0.1 + i * 0.05} open={open === c.id} toggle={() => setOpenId(open === c.id ? null : c.id)} />
      ))}
      {!chars.length && <p className="text-muted">{t("tr_none")}</p>}
    </div>
  );
}

const MAP_NAME = new Map((MAPS as { maps: { id: number; name: { ru: string; en: string } }[] }).maps.map((m) => [m.id, m.name]));

function Attunement({ c, delay, open, toggle }: { c: Character; delay: number; open: boolean; toggle: () => void }) {
  const { t, lang } = useI18n();
  const s = c.summary?.[lang];
  const done = useTab<{ count: number; ids?: number[] }>(c.id, "quests");
  const active = useTab<{ id: number; name: string }[]>(c.id, "quests_active");
  const [prep, setPrep] = useState<Record<string, boolean>>(() => store.get(`raidPrep:${c.id}`, {}));
  const chain = chainFor(s?.faction);
  const keys = CHAINS.find((x) => x.key === "keys")!;
  const ids = new Set(done.data?.data?.ids || []);
  const inLog = new Set((active.data?.data || []).map((q) => q.id));
  const nDone = chain.steps.filter((q) => ids.has(q.id)).length;
  const have = ids.has(chain.steps[chain.steps.length - 1].id);
  const next = chain.steps.find((q) => !ids.has(q.id));
  const toggleP = (k: string) => {
    const v = { ...prep, [k]: !prep[k] };
    setPrep(v);
    store.set(`raidPrep:${c.id}`, v);
  };
  return (
    <motion.section className={`panel raid-block ${open ? "open" : ""}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}>
      <button className="raid-head" onClick={toggle} aria-expanded={open}>
        <span className="raid-chev">{open ? "▾" : "▸"}</span>
        <span className="grid min-w-0 text-left">
          <span className="truncate font-display text-xl">{fullName(c, lang)}</span>
          <span className="text-xs text-muted">{t("ch_level", { l: s?.level ?? "?" })} · {s?.className}{next && !have ? <> · {t("rd_next_is")} <QuestName id={next.id} /></> : null}</span>
        </span>
        <span className={`ml-auto shrink-0 font-display ${have ? "text-good" : "text-gold"}`}>{have ? t("rd_have") : t("rd_progress", { a: nDone, b: chain.steps.length })}</span>
      </button>
      <div className="prof-bar mx-4"><span style={{ width: `${(nDone / chain.steps.length) * 100}%` }} /></div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3 }} className="overflow-hidden">
            <div className="p-4 pt-3">
              {done.isLoading ? <p className="text-sm text-muted">…</p> : !done.data?.available && !done.data?.data ? (
                <p className="text-sm text-muted">{t("rd_no_quests")}</p>
              ) : (
                <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
                  <div>
                    <div className="eyebrow mb-1">{chain.name[lang]}</div>
                    <p className="mb-2 text-xs text-[#ffb070]">{chain.level[lang]}{(s?.level ?? 0) < 55 ? ` · ${t("rd_level", { l: s?.level ?? "?" })}` : ""}</p>
                    <Steps chain={chain} ids={ids} inLog={inLog} next={next?.id} who={s} />
                  </div>
                  <div className="space-y-3">
                    <div className="char-stats">
                      <div className="eyebrow mb-1">{t("rd_keys")}</div>
                      <Steps chain={keys} ids={ids} inLog={inLog} who={s} />
                    </div>
                    <div className="char-stats">
                      <div className="eyebrow mb-1">{t("rd_prep")}</div>
                      <ul className="space-y-1 text-sm">
                        {PREP.map((k) => (
                          <li key={k}>
                            <label className="flex cursor-pointer items-start gap-2">
                              <input type="checkbox" className="mt-1" checked={!!prep[k]} onChange={() => toggleP(k)} />
                              <span className={prep[k] ? "text-muted line-through" : ""}>{t(k)}</span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}

/** A chain's steps: status, what to do, where to take and hand in, and a way onto the map. */
function Steps({ chain, ids, inLog, next, who }: { chain: Chain; ids: Set<number>; inLog: Set<number>; next?: number; who?: { name?: string; className?: string; race?: string; level?: number | null } }) {
  const level = who?.level ?? null;
  const { t, lang } = useI18n();
  const [open, setOpen] = useState<number | null>(null);
  const firstOpen = next ?? chain.steps.find((q) => !ids.has(q.id))?.id;
  const where = (p: ChainStep["giver"]) => `${p.who[lang]} — ${MAP_NAME.get(p.map)?.[lang] ?? ""} ${Math.round(p.x)}, ${Math.round(p.y)}`;
  let lastGroup: string | undefined;
  return (
    <ol className="space-y-0.5">
      {chain.steps.map((q) => {
        const st = ids.has(q.id) ? "done" : inLog.has(q.id) ? "log" : q.id === firstOpen ? "next" : "later";
        const head = q.group && q.group !== lastGroup ? <li className="px-1 pt-1 text-[11px] text-muted">{t("rd_any_order")}</li> : null;
        lastGroup = q.group;
        return (
          <FragmentLi key={q.id} head={head}>
            <button className={`raid-step ${st}`} onClick={() => setOpen(open === q.id ? null : q.id)} aria-expanded={open === q.id}>
              <span className="raid-mark">{st === "done" ? "✓" : st === "log" ? "●" : st === "next" ? "▶" : "·"}</span>
              <QuestName id={q.id} />
              {q.min && <MinLevel min={q.min} level={level} />}
              <span className="ml-auto shrink-0 text-[11px] text-muted">{t(`rd_st_${st}` as Key)}</span>
            </button>
            {open === q.id && (
              <div className="raid-detail">
                <p>{q.todo[lang]}</p>
                {q.dungeon && <p className="text-xs text-[#ffb070]">{t(`wm_dg_${q.dungeon}` as Key)}</p>}
                <ul className="mt-1 space-y-0.5 text-xs">
                  <li><b className="text-[#ffd100]">!</b> {t("wm_ph_giver")}: {where(q.giver)}{q.giver.note ? ` (${q.giver.note[lang]})` : ""}</li>
                  {(q.at || []).map((p, i) => <li key={i}><b className="text-[#ff5a3c]">✖</b> {t("wm_ph_do")}: {where(p)}{p.note ? ` (${p.note[lang]})` : ""}</li>)}
                  <li><b className="text-[#ffd100]">?</b> {t("wm_ph_turnin")}: {where(q.turnin)}{q.turnin.note ? ` (${q.turnin.note[lang]})` : ""}</li>
                </ul>
                <Link className="btn mt-2 inline-block text-xs" to={`/map?chain=${chain.key}&step=${q.id}`}>🗺 {t("rd_on_map")}</Link>
                <QuestDetails id={q.id} who={{ name: who?.name ?? "", cls: who?.className ?? "", race: who?.race ?? "" }} />
              </div>
            )}
          </FragmentLi>
        );
      })}
    </ol>
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

function FragmentLi({ head, children }: { head: React.ReactNode; children: React.ReactNode }) {
  return <>{head}<li>{children}</li></>;
}

/** A quest's name from Forever's own data, in the page's language. */
function QuestName({ id }: { id: number }) {
  const { lang } = useI18n();
  const q = useQuery<QuestInfo>({ queryKey: ["quest", id, lang], queryFn: () => wowApi.quest(id, lang), staleTime: Infinity, retry: false });
  return <span className="truncate">{q.data?.title || `#${id}`}{q.data?.area ? <span className="text-xs text-muted"> · {q.data.area}</span> : null}</span>;
}
