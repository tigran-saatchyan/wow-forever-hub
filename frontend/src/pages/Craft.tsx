/**
 * Crafting: what pays to craft across all characters at today's auction prices, whether to sell on the
 * auction house or to a vendor, and the cheapest way to level a profession with its shopping list.
 * Everything is worked out on the server (app/craft.py); this page shows it.
 */
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { SourcePanel } from "../components/SourcePanel";
import { Money } from "../components/Wow";
import { fmtDate, useI18n, type Key } from "../lib/i18n";
import { store } from "../lib/store";
import { wowApi, type RefItem } from "../lib/wowApi";
import { Item } from "./characters/ProfessionsTab";

interface Part extends RefItem { count: number; unit: number | null; src: "ah" | "vendor" | null }
interface Sale { ah: number | null; vendor: number | null; best: number | null; where: "ah" | "vendor" | null; qty: number }
interface Row {
  cid: number; char: string; prof: number; profName: string; skill: number | null; recipe: number; name: string;
  item: RefItem | null; made: number; known: boolean; color: "orange" | "yellow" | "green" | "gray" | null;
  cost: number | null; value: number | null; profit: number | null; margin: number | null; sale: Sale; parts: Part[];
}
interface Advice extends RefItem { ah: number | null; vendor: number | null; where: "ah" | "vendor"; qty: number; flip: number | null }
interface Market { configured: boolean; at?: string; items?: number; ok?: boolean }
interface Overview { status: "ready" | "building"; market?: Market; rows?: Row[]; advice?: Advice[] }
interface Step {
  id: number; name: string; item: RefItem | null; made: number; from: number; to: number; crafts: number;
  cost: number; back: number; learn: { source: string; item?: RefItem | null; price?: number | null } | null;
}
interface Plan { status: string; skill: number; target: number; steps: Step[]; reagents: (Part & { count: number })[]; total: number; gaps: number[] }

const COLOR: Record<string, string> = { orange: "#ff8040", yellow: "#ffff00", green: "#40c040", gray: "#909090" };

export function Craft() {
  const { t, lang } = useI18n();
  const q = useQuery({ queryKey: ["craft", lang], queryFn: () => wowApi.craft<Overview>(lang), staleTime: 5 * 60e3,
    refetchInterval: (qq) => (qq.state.data?.status === "building" ? 4000 : false) });
  const [panel, setPanel] = useState<RefItem | null>(null);
  const d = q.data;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="font-display text-3xl text-gold">{t("cr_title")}</h1>
        {d?.market?.configured && d.market.at && (
          <span className="text-sm text-muted">{t("cr_prices", { d: fmtDate(lang, d.market.at), n: d.market.items ?? 0 })}</span>
        )}
      </div>
      {d?.market && !d.market.configured && (
        <p className="panel p-3 text-sm">{t("cr_no_market")} <Link className="text-gold underline" to="/market">{t("nav_market")}</Link></p>
      )}
      {!d || d.status === "building" ? <p className="text-muted">{t("pf_building")}</p> : (
        <>
          <Profitable rows={d.rows || []} onOpen={setPanel} />
          <Leveling rows={d.rows || []} onOpen={setPanel} />
          <Where advice={d.advice || []} onOpen={setPanel} />
        </>
      )}
      <SourcePanel item={panel} onClose={() => setPanel(null)} />
    </div>
  );
}

function Section({ title, hint, children, delay = 0 }: { title: string; hint?: string; children: React.ReactNode; delay?: number }) {
  return (
    <motion.section className="panel p-4" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}>
      <h2 className="panel-title">{title}</h2>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
      <div className="mt-3">{children}</div>
    </motion.section>
  );
}

const Gold = ({ c, sign = false }: { c: number | null | undefined; sign?: boolean }) =>
  c == null ? <span className="text-muted">—</span> : (
    <span className={sign ? (c >= 0 ? "text-good" : "text-bad") : ""}>{sign && c < 0 ? "−" : sign && c > 0 ? "+" : ""}<Money c={Math.abs(c)} /></span>
  );

/** 1. What pays: every recipe of every character, by profit of one craft. */
function Profitable({ rows, onOpen }: { rows: Row[]; onOpen: (x: RefItem) => void }) {
  const { t } = useI18n();
  const [who, setWho] = useState<string>(() => store.get("crWho", "all"));
  const [onlyKnown, setOnlyKnown] = useState(() => store.get("crKnown", true));
  const [onlyProfit, setOnlyProfit] = useState(() => store.get("crProfit", false));
  const [open, setOpen] = useState<string | null>(null);
  const keys = useMemo(() => [...new Map(rows.map((r) => [`${r.cid}:${r.prof}`, `${r.char} · ${r.profName}`])).entries()], [rows]);
  const shown = rows
    .filter((r) => who === "all" || `${r.cid}:${r.prof}` === who)
    .filter((r) => !onlyKnown || r.known)
    .filter((r) => !onlyProfit || (r.profit ?? -1) > 0)
    .sort((a, b) => (b.profit ?? -Infinity) - (a.profit ?? -Infinity));
  const set = <T,>(k: string, v: T, f: (v: T) => void) => (store.set(k, v), f(v));
  return (
    <Section title={t("cr_profit_t")} hint={t("cr_profit_h")}>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <select className="input w-auto py-1" value={who} onChange={(e) => set("crWho", e.target.value, setWho)}>
          <option value="all">{t("cr_all")}</option>
          {keys.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <label className="chip cursor-pointer"><input type="checkbox" className="mr-1.5" checked={onlyKnown} onChange={(e) => set("crKnown", e.target.checked, setOnlyKnown)} />{t("cr_only_known")}</label>
        <label className="chip cursor-pointer"><input type="checkbox" className="mr-1.5" checked={onlyProfit} onChange={(e) => set("crProfit", e.target.checked, setOnlyProfit)} />{t("cr_only_profit")}</label>
        <span className="ml-auto text-xs text-muted">{t("cr_count", { n: shown.length })}</span>
      </div>
      <div className="swipe-x overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="text-left text-xs text-muted">
            <tr>
              <th className="p-1.5 font-normal">{t("cr_c_item")}</th>
              <th className="p-1.5 text-right font-normal">{t("cr_c_cost")}</th>
              <th className="p-1.5 text-right font-normal">{t("cr_c_ah")}</th>
              <th className="p-1.5 text-right font-normal">{t("cr_c_vendor")}</th>
              <th className="p-1.5 text-right font-normal">{t("cr_c_profit")}</th>
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, 300).map((r) => {
              const key = `${r.cid}:${r.recipe}`;
              const missing = r.parts.filter((p) => p.unit == null);
              return (
                <tr key={key} className="border-t border-edge/40 align-top">
                  <td className="p-1.5">
                    <span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: r.color ? COLOR[r.color] : "#555" }} />
                    {r.item ? <Item x={r.item} count={r.made > 1 ? r.made : null} onOpen={onOpen} /> : r.name}
                    {!r.known && <span className="pf-badge new ml-1.5">{t("cr_learnable")}</span>}
                    <div className="text-[11px] text-muted">{r.char} · {r.profName}{r.skill != null ? ` ${r.skill}` : ""}</div>
                    <button className="text-[11px] text-gold hover:underline" onClick={() => setOpen(open === key ? null : key)}>{t("cr_reagents")}</button>
                    {open === key && (
                      <ul className="mt-1 space-y-0.5 text-xs">
                        {r.parts.map((p) => (
                          <li key={p.id} className="flex gap-2">
                            <span><Item x={p} onOpen={onOpen} /> ×{p.count}</span>
                            <span className="text-muted">{p.unit != null ? <><Money c={p.unit} /> {t(p.src === "vendor" ? "cr_at_vendor" : "cr_at_ah")}</> : t("cr_no_price")}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="p-1.5 text-right">{r.cost != null ? <Money c={r.cost} /> : <span className="text-xs text-muted" title={missing.map((p) => p.name).join(", ")}>{t("cr_no_price")}</span>}</td>
                  <td className="p-1.5 text-right">
                    <span className={r.sale.where === "ah" ? "text-ink" : "text-muted"}><Gold c={r.sale.ah != null ? r.sale.ah * r.made : null} /></span>
                    {r.sale.qty > 0 && <div className="text-[11px] text-muted">{t("cr_on_sale", { n: r.sale.qty })}</div>}
                  </td>
                  <td className="p-1.5 text-right"><span className={r.sale.where === "vendor" ? "text-ink" : "text-muted"}><Gold c={r.sale.vendor != null ? r.sale.vendor * r.made : null} /></span></td>
                  <td className="p-1.5 text-right">
                    <Gold c={r.profit} sign />
                    {r.sale.where && r.profit != null && <div className="text-[11px] text-muted">{t(r.sale.where === "ah" ? "cr_sell_ah" : "cr_sell_vendor")}{r.margin != null ? ` · ${r.margin}%` : ""}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!shown.length && <p className="p-2 text-sm text-muted">{t("ar_empty")}</p>}
      </div>
    </Section>
  );
}

/** 2. The cheapest way to level one profession, with what to buy. */
function Leveling({ rows, onOpen }: { rows: Row[]; onOpen: (x: RefItem) => void }) {
  const { t, lang } = useI18n();
  const profs = useMemo(() => [...new Map(rows.map((r) => [`${r.cid}:${r.prof}`, r])).values()], [rows]);
  const [key, setKey] = useState<string>(() => store.get("crPlan", profs[0] ? `${profs[0].cid}:${profs[0].prof}` : ""));
  const cur = profs.find((r) => `${r.cid}:${r.prof}` === key) ?? profs[0];
  const [target, setTarget] = useState<number | null>(null);
  const [resale, setResale] = useState(() => store.get("crResale", true));
  const skill = cur?.skill ?? 1;
  const goal = target ?? Math.min(300, skill + 25);
  const q = useQuery({
    queryKey: ["craft-plan", cur?.cid, cur?.prof, goal, resale, lang],
    queryFn: () => wowApi.craftPlan<Plan>(cur!.cid, cur!.prof, goal, resale, lang),
    enabled: !!cur && goal > skill, staleTime: 5 * 60e3,
  });
  if (!cur) return null;
  const p = q.data;
  return (
    <Section title={t("cr_plan_t")} hint={t("cr_plan_h")} delay={0.05}>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <select className="input w-auto py-1" value={`${cur.cid}:${cur.prof}`} onChange={(e) => (store.set("crPlan", e.target.value), setKey(e.target.value), setTarget(null))}>
          {profs.map((r) => <option key={`${r.cid}:${r.prof}`} value={`${r.cid}:${r.prof}`}>{r.char} · {r.profName} ({r.skill ?? "?"})</option>)}
        </select>
        <span className="text-muted">{t("cr_from", { s: skill })}</span>
        <input type="number" className="input w-24 py-1" min={skill + 1} max={450} value={goal}
          onChange={(e) => setTarget(Math.max(skill + 1, Math.min(450, Number(e.target.value) || skill + 1)))} />
        <label className="chip cursor-pointer"><input type="checkbox" className="mr-1.5" checked={resale} onChange={(e) => (store.set("crResale", e.target.checked), setResale(e.target.checked))} />{t("cr_resale")}</label>
      </div>
      {q.isLoading && <p className="text-sm text-muted">…</p>}
      {p?.status === "ready" && (
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <ol className="space-y-2">
              {p.steps.map((s) => (
                <li key={s.id} className="char-stats">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-mono text-xs text-muted">{s.from} → {s.to}</span>
                    <span className="text-xs"><Gold c={s.cost} />{s.back ? <span className="text-muted"> · {t("cr_back")} <Money c={s.back} /></span> : null}</span>
                  </div>
                  <div className="mt-0.5">{t("cr_craft_n", { n: s.crafts })} {s.item ? <Item x={s.item} count={s.made > 1 ? s.made : null} onOpen={onOpen} /> : s.name}</div>
                  {s.learn && (
                    <div className="mt-0.5 text-xs text-[#ffb070]">
                      {t("cr_learn")}: {s.learn.item ? <><Item x={s.learn.item} onOpen={onOpen} />{s.learn.price ? <> · <Money c={s.learn.price} /></> : null}</> : t(s.learn.source === "trainer" ? "pf_src_trainer" as Key : "pf_src_auto" as Key)}
                    </div>
                  )}
                </li>
              ))}
            </ol>
            {p.gaps.length > 0 && <p className="mt-2 text-sm text-bad">{t("cr_gaps", { a: p.gaps[0], b: p.gaps[p.gaps.length - 1] + 1 })}</p>}
          </div>
          <div className="char-stats self-start">
            <div className="eyebrow mb-1.5">{t("cr_shopping")}</div>
            <ul className="space-y-1 text-sm">
              {p.reagents.map((x) => (
                <li key={x.id} className="flex justify-between gap-3">
                  <span><Item x={x} onOpen={onOpen} /> ×{x.count}</span>
                  <span className="text-xs text-muted">{x.unit != null ? <><Money c={x.unit * x.count} /> {t(x.src === "vendor" ? "cr_at_vendor" : "cr_at_ah")}</> : t("cr_no_price")}</span>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex justify-between border-t border-edge/40 pt-2 font-display">
              <span>{p.total < 0 ? t("cr_total_gain") : resale ? t("cr_total_net") : t("cr_total")}</span><Gold c={-p.total} sign />
            </div>
          </div>
        </div>
      )}
    </Section>
  );
}

/** 3. Materials and goods of the user's professions: the auction house or a vendor. */
function Where({ advice, onOpen }: { advice: Advice[]; onOpen: (x: RefItem) => void }) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const shown = advice.filter((a) => !q || a.name.toLowerCase().includes(q.toLowerCase()));
  const flips = advice.filter((a) => a.flip);
  return (
    <Section title={t("cr_where_t")} hint={t("cr_where_h")} delay={0.1}>
      {flips.length > 0 && (
        <div className="mb-3 rounded-md border border-good/40 bg-good/10 p-2.5 text-sm">
          <b className="text-good">{t("cr_flip_t")}</b>
          <ul className="mt-1 space-y-0.5">
            {flips.slice(0, 10).map((a) => (
              <li key={a.id}><Item x={a} onOpen={onOpen} /> — {t("cr_flip", { n: a.qty })} <Money c={a.flip} /></li>
            ))}
          </ul>
        </div>
      )}
      <input className="input mb-2 w-56 py-1 text-sm" placeholder={t("co_find")} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="swipe-x overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="text-left text-xs text-muted">
            <tr>
              <th className="p-1.5 font-normal">{t("cr_c_good")}</th>
              <th className="p-1.5 text-right font-normal">{t("cr_c_ah_net")}</th>
              <th className="p-1.5 text-right font-normal">{t("cr_c_vendor")}</th>
              <th className="p-1.5 font-normal">{t("cr_c_verdict")}</th>
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, 200).map((a) => (
              <tr key={a.id} className="border-t border-edge/40">
                <td className="p-1.5"><Item x={a} onOpen={onOpen} /></td>
                <td className="p-1.5 text-right"><Gold c={a.ah} /></td>
                <td className="p-1.5 text-right"><Gold c={a.vendor} /></td>
                <td className={`p-1.5 ${a.where === "vendor" ? "text-[#ffb070]" : "text-good"}`}>{t(a.where === "vendor" ? "cr_v_vendor" : "cr_v_ah")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
