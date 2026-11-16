/**
 * Getting ready for the raids that open on 9 December: what opens, and for every character how far the
 * Onyxia attunement (the Drakefire Amulet) has gone, step by step, from the quests Blizzard says are done.
 * The chain's quest ids are the original ones, checked against Forever's own quest data.
 */
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
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

// the Drakefire Amulet chain; a nested list is a set of quests done in any order
type Step = number | number[];
const CHAIN: Record<"HORDE" | "ALLIANCE", Step[]> = {
  HORDE: [4903, 4941, 4974, 6566, 6567, 6568, 6569, 6570, [6582, 6583, 6584, 6585], 6601, 6602],
  ALLIANCE: [4182, 4183, 4184, 4185, 4186, 4223, 4224, 4241, 4242, 4264, 4282, 4322, 6402, 6403, 6501, 6502],
};
// keys that save a lot of walking in the same dungeons: Seal of Ascension (Upper Blackrock Spire), Shadowforge Key
const KEYS = [4743, 3802];
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

      {chars.map((c, i) => <Attunement key={c.id} c={c} delay={0.1 + i * 0.05} />)}
      {!chars.length && <p className="text-muted">{t("tr_none")}</p>}
    </div>
  );
}

function Attunement({ c, delay }: { c: Character; delay: number }) {
  const { t, lang } = useI18n();
  const s = c.summary?.[lang];
  const done = useTab<{ count: number; ids?: number[] }>(c.id, "quests");
  const active = useTab<{ id: number; name: string }[]>(c.id, "quests_active");
  const [open, setOpen] = useState<number | null>(null);
  const [prep, setPrep] = useState<Record<string, boolean>>(() => store.get(`raidPrep:${c.id}`, {}));
  const faction = s?.faction === "ALLIANCE" ? "ALLIANCE" : "HORDE";
  const chain = CHAIN[faction];
  const ids = new Set(done.data?.data?.ids || []);
  const inLog = new Set((active.data?.data || []).map((q) => q.id));
  const flat = chain.flat();
  const nDone = flat.filter((q) => ids.has(q)).length;
  const have = ids.has(flat[flat.length - 1]);
  const next = flat.find((q) => !ids.has(q));
  const who = { name: s?.name ?? "", cls: s?.className ?? "", race: s?.race ?? "" };
  const toggle = (k: string) => {
    const v = { ...prep, [k]: !prep[k] };
    setPrep(v);
    store.set(`raidPrep:${c.id}`, v);
  };
  const row = (q: number) => {
    const st = ids.has(q) ? "done" : inLog.has(q) ? "log" : q === next ? "next" : "later";
    return (
      <li key={q}>
        <button className={`raid-step ${st}`} onClick={() => setOpen(open === q ? null : q)} aria-expanded={open === q}>
          <span className="raid-mark">{st === "done" ? "✓" : st === "log" ? "●" : st === "next" ? "▶" : "·"}</span>
          <QuestName id={q} />
          <span className="ml-auto text-[11px] text-muted">{t(`rd_st_${st}` as Key)}</span>
        </button>
        {open === q && <QuestDetails id={q} who={who} />}
      </li>
    );
  };
  return (
    <motion.section className="panel p-4" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-xl">{fullName(c, lang)}</h2>
        <span className="text-sm text-muted">{t("ch_level", { l: s?.level ?? "?" })} · {s?.className}</span>
        <span className={`ml-auto font-display ${have ? "text-good" : "text-gold"}`}>
          {have ? t("rd_have") : t("rd_progress", { a: nDone, b: flat.length })}
        </span>
      </div>
      <div className="prof-bar mt-2"><span style={{ width: `${(nDone / flat.length) * 100}%` }} /></div>
      {done.isLoading ? <p className="mt-2 text-sm text-muted">…</p> : !done.data?.available && !done.data?.data ? (
        <p className="mt-2 text-sm text-muted">{t("rd_no_quests")}</p>
      ) : (
        <div className="mt-3 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          <div>
            <div className="eyebrow mb-1">{t(faction === "HORDE" ? "rd_chain_h" : "rd_chain_a")}</div>
            {(s?.level ?? 0) < 55 && !nDone && <p className="mb-1 text-xs text-[#ffb070]">{t("rd_level", { l: s?.level ?? "?" })}</p>}
            <ol className="space-y-0.5">
              {chain.map((step, i) => Array.isArray(step) ? (
                <li key={i} className="rounded border border-edge/40 p-1">
                  <div className="px-1 text-[11px] text-muted">{t("rd_any_order")}</div>
                  <ul>{step.map(row)}</ul>
                </li>
              ) : row(step))}
            </ol>
          </div>
          <div className="space-y-3">
            <div className="char-stats">
              <div className="eyebrow mb-1">{t("rd_keys")}</div>
              <ul className="space-y-0.5">{KEYS.map(row)}</ul>
            </div>
            <div className="char-stats">
              <div className="eyebrow mb-1">{t("rd_prep")}</div>
              <ul className="space-y-1 text-sm">
                {PREP.map((k) => (
                  <li key={k}>
                    <label className="flex cursor-pointer items-start gap-2">
                      <input type="checkbox" className="mt-1" checked={!!prep[k]} onChange={() => toggle(k)} />
                      <span className={prep[k] ? "text-muted line-through" : ""}>{t(k)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </motion.section>
  );
}

/** A quest's name from Forever's own data, in the page's language. */
function QuestName({ id }: { id: number }) {
  const { lang } = useI18n();
  const q = useQuery<QuestInfo>({ queryKey: ["quest", id, lang], queryFn: () => wowApi.quest(id, lang), staleTime: Infinity, retry: false });
  return <span className="truncate">{q.data?.title || `#${id}`}{q.data?.area ? <span className="text-xs text-muted"> · {q.data.area}</span> : null}</span>;
}
