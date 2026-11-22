/**
 * Raid consumables to craft (the server's /api/craft/raid, from data/raid_consumables.json): flasks, elixirs, food,
 * potions, protection potions, weapon oils and stones — what each gives and who it suits, the recipe's profession
 * and skill, which of the user's characters know it or can learn it, the reagents' cost against the price on the
 * auction house now, and how many are up: few or none, before the raids open, is the chance to supply it first.
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AhChip } from "../../components/AhChip";
import { EdgeTip, useEdgeTip } from "../../components/EdgeTip";
import { ProfIcon } from "../../components/CharProfPicker";
import { ItemHover, ItemIcon, Money } from "../../components/Wow";
import { req } from "../../lib/api";
import { useI18n, type Key } from "../../lib/i18n";
import { store } from "../../lib/store";
import { fullName, qColor, useCharacters, type RefItem } from "../../lib/wowApi";

const Q = ["POOR", "COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY"];
const ROLES = ["caster", "healer", "melee", "hunter", "tank", "all"] as const;
const KINDS = ["flask", "elixir", "food", "potion", "protection", "weapon", "bandage"] as const;
const PROF_ID: Record<string, number> = { alchemy: 171, cooking: 185, "first-aid": 129, enchanting: 333, blacksmithing: 164, engineering: 202, leatherworking: 165, tailoring: 197 };

type Eff = Record<string, number | Record<string, number>>;
interface Row {
  kind: string; eff: Eff; ms: number | null; roles: string[]; prof: string; profName: string; spell: number; need: number;
  item: { id: number; name: string; q?: number | null }; who: { cid: number; name: string; state: "known" | "learn" | "low"; skill: number | null }[];
  cost: number | null; made: number; sale: { ah: number | null; vendor: number | null; best: number | null; qty: number } | null; profit: number | null;
  recipe: { name: string; item: { id: number; name: string; q?: number | null } | null; source: string | null };
  learn: { ways: string[]; skill: number | null; vendors: { npc: number; name: string; zone: string | null; x: number | null; y: number | null;
    price: number | null; seen: boolean | null; costs: { name: string; amount: number }[] }[] } | null;
}

/** How to get a recipe one lacks: a line (where, and the first vendor), the details on hover. */
function HowToGet({ x }: { x: Row }) {
  const { t } = useI18n();
  const tip = useEdgeTip();
  const ways = x.learn?.ways?.length ? x.learn.ways : x.recipe.source ? [x.recipe.source] : [];
  const v = x.learn?.vendors?.[0];
  return (
    <span {...tip.bind} tabIndex={0} className="mt-0.5 block cursor-help text-[11px] text-[#9fd0ff]">
      📜 {ways.map((w) => t(`cr_way_${w}` as Key)).join(", ") || t("rc_get_unknown")}{v ? ` · ${v.name}${v.zone ? `, ${v.zone}` : ""}` : ""}
      <EdgeTip anchor={tip.anchor} open={tip.open}>
        <span className="block max-w-[22rem] text-[13px]">
          <span className="block text-[#ffd100]">{x.recipe.name}</span>
          <span className="block">{t("rc_get_skill", { p: x.profName, n: x.learn?.skill ?? x.need })}</span>
          {x.recipe.item && (
            <span className="mt-1 flex items-center gap-1.5"><ItemIcon itemId={x.recipe.item.id} size={16} />{x.recipe.item.name}</span>
          )}
          <span className="mt-1 block text-muted">{t("rc_where")}: {ways.map((w) => t(`cr_way_${w}` as Key)).join(", ") || t("rc_get_unknown")}</span>
          {(x.learn?.vendors || []).map((u) => (
            <span key={u.npc} className="block text-xs">
              {u.name}{u.zone ? ` · ${u.zone}` : ""}{u.x != null ? ` ${u.x.toFixed(0)}, ${u.y?.toFixed(0)}` : ""}
              {u.costs.length ? ` · ${u.costs.map((c) => `${c.amount} ${c.name}`).join(", ")}` : u.price ? <> · <Money c={u.price} /></> : null}
              {u.seen ? <span className="text-good"> · {t("so_seen_forever")}</span> : null}
            </span>
          ))}
        </span>
      </EdgeTip>
    </span>
  );
}
interface Resp { status: string; market?: { configured: boolean }; items?: Row[] }

/** What a consumable gives, short: "+35 spell damage", "+25 Agility, +2% crit", "absorbs 2600 fire". */
function lines(e: Eff, t: (k: Key, v?: Record<string, string | number>) => string): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(e)) {
    if (typeof v === "object") {
      for (const [s, n] of Object.entries(v)) out.push(t(`rc2_${k}` as Key, { n, s: t(`sb_school_${s}` as Key) }));
    } else out.push(v ? t(`rc2_${k}` as Key, { n: v }) : t("rc2_unknown", { s: t(`rc2_${k}` as Key, { n: "?" }) }));
  }
  return out;
}

function dur(ms: number | null, t: (k: Key, v?: Record<string, string | number>) => string): string {
  if (!ms || ms <= 0) return "";
  const s = Math.round(ms / 1000);
  return s >= 3600 ? t("sb_h", { n: Math.round(s / 360) / 10 }) : s >= 60 ? t("sb_m", { n: Math.round(s / 60) }) : t("sb_s", { n: s });
}

export function RaidCraft({ onOpen }: { onOpen: (x: RefItem) => void }) {
  const { t, lang } = useI18n();
  const q = useQuery({ queryKey: ["craft-raid", lang], queryFn: () => req<Resp>(`/api/craft/raid?lang=${lang}`), staleTime: 5 * 60e3,
    refetchInterval: (qq) => (qq.state.data?.status === "building" ? 5000 : false) });
  const [role, setRole] = useState<string>(() => store.get("rcRole", "all"));
  const [kind, setKind] = useState<string>(() => store.get("rcKind", "all"));
  const [mine, setMine] = useState<boolean>(() => store.get("rcMine", false));
  const [sort, setSort] = useState<string>(() => store.get("rcSort", "profit"));
  const [prof, setProf] = useState<string>(() => store.get("rcProf", "all"));
  const [pick, setPick] = useState<number | null>(() => store.get<number | null>("rcChar", null));
  const chars = (useCharacters().data || []).filter((c) => !c.error);
  const set = <T,>(k: string, f: (v: T) => void) => (v: T) => (store.set(k, v), f(v));
  const d = q.data;
  if (!d || d.status !== "ready") return <p className="text-sm text-muted">{t("pf_building")}</p>;
  const market = !!d.market?.configured;
  // the professions of the list; the user's characters that have the chosen one (picked by itself when one)
  const profs = [...new Set((d.items || []).map((x) => x.prof))];
  const hasProf = (cid: number, slug: string) => (chars.find((c) => c.id === cid)?.profs?.[lang] || []).some((p) => p.id === PROF_ID[slug]);
  const makers = prof === "all" ? [] : chars.filter((c) => hasProf(c.id, prof));
  const maker = makers.find((c) => c.id === pick) ?? makers[0] ?? null;
  const whoOf = (x: Row) => (maker ? x.who.filter((w) => w.cid === maker.id) : x.who);
  let rows = (d.items || []).filter((x) => (role === "all" || x.roles.includes(role)) && (kind === "all" || x.kind === kind)
    && (prof === "all" || x.prof === prof) && (!mine || whoOf(x).some((w) => w.state !== "low")));
  const key = (x: Row) => sort === "profit" ? -(x.profit ?? -1e12) : sort === "price" ? -(x.sale?.ah ?? -1) : sort === "scarce" ? (x.sale?.qty ?? 0) : 0;
  rows = [...rows].sort((a, b) => key(a) - key(b));
  const chip = (on: boolean) => `chip ${on ? "border-gold/60 text-gold" : ""}`;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs text-muted">{t("rc_prof")}</span>
        <button className={chip(prof === "all")} onClick={() => set("rcProf", setProf)("all")}>{t("rc_kind_all")}</button>
        {profs.map((p) => {
          const mineToo = chars.some((c) => hasProf(c.id, p));
          const name = (d.items || []).find((x) => x.prof === p)?.profName ?? p;
          return (
            <button key={p} className={`${chip(prof === p)} flex items-center gap-1.5 ${mineToo ? "" : "opacity-60"}`}
              title={mineToo ? undefined : t("rc_prof_none")} onClick={() => set("rcProf", setProf)(p)}>
              <ProfIcon id={PROF_ID[p] ?? 0} size={14} />{name}{mineToo && <span className="text-good">•</span>}
            </button>
          );
        })}
        {prof !== "all" && (makers.length > 1 ? (
          <select className="input ml-2 w-auto py-1 text-sm" value={maker?.id ?? ""} onChange={(e) => set<number | null>("rcChar", setPick)(+e.target.value)}>
            {makers.map((c) => <option key={c.id} value={c.id}>{fullName(c, lang)}</option>)}
          </select>
        ) : maker ? <span className="ml-2 text-sm">{fullName(maker, lang)}</span> : <span className="ml-2 text-xs text-muted">{t("rc_prof_none")}</span>)}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs text-muted">{t("rc_for")}</span>
        {["all", ...ROLES.filter((r) => r !== "all")].map((r) => (
          <button key={r} className={chip(role === r)} onClick={() => set("rcRole", setRole)(r)}>{t(`rc_role_${r}` as Key)}</button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs text-muted">{t("rc_what")}</span>
        {["all", ...KINDS].map((k) => (
          <button key={k} className={chip(kind === k)} onClick={() => set("rcKind", setKind)(k)}>{t(`rc_kind_${k}` as Key)}</button>
        ))}
        <label className="chip ml-2 cursor-pointer"><input type="checkbox" className="mr-1.5" checked={mine} onChange={() => set("rcMine", setMine)(!mine)} />{t(maker ? "rc_mine_one" : "rc_mine")}</label>
        <select className="input ml-auto w-auto py-1 text-sm" value={sort} onChange={(e) => set("rcSort", setSort)(e.target.value)}>
          {["profit", "price", "scarce"].map((s) => <option key={s} value={s}>{t(`rc_sort_${s}` as Key)}</option>)}
        </select>
      </div>
      {!market && <p className="text-xs text-muted">{t("cr_no_market")}</p>}
      <div className="swipe-x overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="p-1.5 font-normal">{t("rc_col_item")}</th><th className="p-1.5 font-normal">{t("rc_col_for")}</th>
              <th className="p-1.5 font-normal">{t("rc_col_recipe")}</th><th className="p-1.5 text-right font-normal">{t("rc_col_cost")}</th>
              <th className="p-1.5 text-right font-normal">{t("rc_col_ah")}</th><th className="p-1.5 text-right font-normal">{t("rc_col_profit")}</th><th />
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => {
              const ah = x.sale?.ah;
              const scarce = market && (!x.sale?.qty || x.sale.qty < 10);
              return (
                <tr key={x.spell} className="border-t border-edge/30 align-top">
                  <td className="p-1.5">
                    <span className="flex items-start gap-2">
                      <ItemHover id={x.item.id}><span className="shrink-0"><ItemIcon itemId={x.item.id} quality={x.item.q != null ? Q[x.item.q] : undefined} size={28} /></span></ItemHover>
                      <span className="grid min-w-0 leading-tight">
                        <button type="button" className="truncate text-left hover:underline" style={{ color: x.item.q != null ? qColor(Q[x.item.q]) : undefined }}
                          onClick={() => onOpen(x.item)}>{x.item.name}</button>
                        <span className="text-[11px] text-good">{lines(x.eff, t).join(", ")}{dur(x.ms, t) ? <span className="text-muted"> · {dur(x.ms, t)}</span> : null}</span>
                        <span className="text-[11px] text-muted">{t(`rc_kind_${x.kind}` as Key)}</span>
                      </span>
                    </span>
                  </td>
                  <td className="p-1.5 text-xs">{x.roles.map((r) => t(`rc_role_${r}` as Key)).join(", ")}</td>
                  <td className="p-1.5 text-xs">
                    <span className="flex items-center gap-1.5"><ProfIcon id={PROF_ID[x.prof] ?? 0} size={14} />{x.profName} {x.need}</span>
                    {!whoOf(x).some((w) => w.state === "known") && <HowToGet x={x} />}
                    {whoOf(x).map((w) => (
                      <span key={w.cid} className={`block ${w.state === "known" ? "text-good" : w.state === "learn" ? "text-[#ffd100]" : "text-bad"}`}>
                        {w.name}: {t(`rc_state_${w.state}` as Key, { n: w.skill ?? "?" })}
                      </span>
                    ))}
                  </td>
                  <td className="p-1.5 text-right">{x.cost != null ? <Money c={x.cost} /> : "—"}{x.made > 1 && <div className="text-[11px] text-muted">{t("rc_makes", { n: x.made })}</div>}</td>
                  <td className="p-1.5 text-right">
                    {ah ? <Money c={ah} /> : <span className="text-muted">—</span>}
                    {market && <div className={`text-[11px] ${scarce ? "text-[#ffb070]" : "text-muted"}`}>{x.sale?.qty ? t("rc_up", { n: x.sale.qty }) : t("rc_none_up")}</div>}
                  </td>
                  <td className={`p-1.5 text-right ${x.profit == null ? "text-muted" : x.profit >= 0 ? "text-good" : "text-bad"}`}>
                    {x.profit != null ? <>{x.profit < 0 ? "−" : ""}<Money c={Math.abs(x.profit)} /></> : "—"}
                  </td>
                  <td className="p-1.5 text-right">{market && <AhChip id={x.item.id} ah={{ price: ah ? { min: ah, median: ah, quantity: x.sale?.qty ?? 0, ts: "" } : null, tracked: false }} />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted">{t("rc_note")}</p>
    </div>
  );
}
