/**
 * Crafting: what pays to craft across all characters at today's auction prices, whether to sell on the
 * auction house or to a vendor, and the cheapest way to level a profession with its shopping list.
 * Everything is worked out on the server (app/craft.py); this page shows it.
 */
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CharProfPicker, ProfIcon, profKey } from "../components/CharProfPicker";
import { ClassIcon } from "./Characters";
import { SourcePanel } from "../components/SourcePanel";
import { ProfGear } from "./craft/ProfGear";
import { RaidCraft } from "./craft/RaidCraft";
import { Money, parseMoney } from "../components/Wow";
import { markSeen, signalKey, useSeen, useSignals } from "../lib/signals";
import { fmtDate, useI18n, type Key } from "../lib/i18n";
import { store } from "../lib/store";
import { fullName, useCharacters, wowApi, type RefItem } from "../lib/wowApi";
import { Item } from "./characters/ProfessionsTab";

interface Part extends RefItem { count: number; unit: number | null; src: "ah" | "vendor" | null }
interface Sale { ah: number | null; vendor: number | null; best: number | null; where: "ah" | "vendor" | null; qty: number }
interface Row {
  cid: number; char: string; prof: number; profName: string; skill: number | null; recipe: number; name: string;
  item: RefItem | null; made: number; known: boolean; color: "orange" | "yellow" | "green" | "gray" | null;
  cost: number | null; value: number | null; profit: number | null; margin: number | null; sale: Sale; parts: Part[];
}
interface Advice extends RefItem { ah: number | null; vendor: number | null; where: "ah" | "vendor"; qty: number; flip: number | null; de?: number | null }
interface FdbVendor { npc: number; name: string; zone: string | null; x: number | null; y: number | null; price: number | null; seen: boolean | null; costs: { name: string; amount: number }[] }
interface FdbLearn { ways: string[]; skill: number | null; item: number | null; vendors: { horde: FdbVendor[]; alliance: FdbVendor[] } }
interface Market { configured: boolean; at?: string; items?: number; ok?: boolean; every?: number; left?: number | null }
interface Overview { status: "ready" | "building"; market?: Market; rows?: Row[]; advice?: Advice[] }
interface Step {
  id: number; name: string; item: RefItem | null; made: number; from: number; to: number; crafts: number;
  cost: number; back: number; learn: { source: string; item?: RefItem | null; price?: number | null; fdb?: FdbLearn | null } | null;
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
          <span className="text-sm text-muted">
            {t("cr_prices", { d: fmtDate(lang, d.market.at), n: d.market.items ?? 0 })}
            {d.market.left != null ? <> · <NextUpdate left={d.market.left} since={q.dataUpdatedAt} every={d.market.every} /></> : null}
          </span>
        )}
      </div>
      {d?.market && !d.market.configured && (
        <p className="panel p-3 text-sm">{t("cr_no_market")} <Link className="text-gold underline" to="/market">{t("nav_market")}</Link></p>
      )}
      {!d || d.status === "building" ? <p className="text-muted">{t("pf_building")}</p> : (
        <>
          <ProfOverview />
          <Section id="gear" title={t("pg_title")} hint={t("pg_hint")}><ProfGear onOpen={setPanel} /></Section>
          <Section id="raid" title={t("rc_title")} hint={t("rc_hint")}><RaidCraft onOpen={setPanel} /></Section>
          <SignalsBlock onOpen={setPanel} />
          <Profitable rows={d.rows || []} onOpen={setPanel} />
          <Leveling rows={d.rows || []} onOpen={setPanel} />
          <Where advice={d.advice || []} onOpen={setPanel} />
        </>
      )}
      <SourcePanel item={panel} onClose={() => setPanel(null)} />
    </div>
  );
}

/** Every character's professions at a glance: skill against the cap, primary first. */
function ProfOverview() {
  const { t, lang } = useI18n();
  const chars = (useCharacters().data || []).filter((c) => !c.error && c.profs?.[lang]?.length);
  if (!chars.length) return null;
  const sorted = [...chars.filter((c) => c.favorite), ...chars.filter((c) => !c.favorite)];
  return (
    <Section id="overview" title={t("cr_over_t")} hint={t("cr_over_h")}>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {sorted.map((c) => {
          const s = c.summary?.[lang];
          const ps = [...(c.profs?.[lang] || [])].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "primary" ? -1 : 1));
          return (
            <div key={c.id} className="cr-over">
              <div className="flex items-center gap-2">
                <ClassIcon classId={s?.classId ?? null} size={22} />
                <b className="truncate">{c.favorite && <span className="text-[#ffd100]">★ </span>}{fullName(c, lang)}</b>
                <span className="ml-auto text-xs text-muted">{t("ch_level", { l: s?.level ?? "?" })}</span>
              </div>
              <ul className="mt-2 space-y-1.5">
                {ps.map((p) => {
                  const pct = p.skill != null && p.max ? Math.min(100, (p.skill / p.max) * 100) : 0;
                  return (
                    <li key={`${p.id}-${p.name}`} className={`flex items-center gap-2 text-sm ${p.kind === "secondary" ? "opacity-75" : ""}`}>
                      {p.id ? <ProfIcon id={p.id} size={18} /> : null}
                      <span className="w-28 truncate">{p.name}</span>
                      <span className="cr-over-bar"><span style={{ width: `${pct}%` }} className={p.skill != null && p.max && p.skill >= p.max ? "full" : ""} /></span>
                      <span className="w-16 text-right tabular-nums text-xs text-muted">{p.skill ?? "?"}/{p.max ?? "?"}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/** Time to the next auction snapshot (the server fetches the house every `every` minutes), ticking. */
function NextUpdate({ left: left0, since, every }: { left: number; since: number; every?: number }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const h = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(h); }, []);
  // seconds left as the server counted them when the page got the data, less the time since (no clock compare)
  const left = left0 - Math.round((now - since) / 1000);
  // once it is due, look again every half minute until the new snapshot is in
  useEffect(() => {
    if (left <= 0 && left % 30 === 0) {
      qc.invalidateQueries({ queryKey: ["craft"] });
      qc.invalidateQueries({ queryKey: ["craft-signals"] });
    }
  }, [left <= 0 && Math.floor(-left / 30)]); // eslint-disable-line react-hooks/exhaustive-deps
  if (left <= 0) return <span className="text-gold">{t("cr_updating")}</span>;
  const h = Math.floor(left / 3600), m = Math.floor(left / 60) % 60, sec = left % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return <span title={every ? t("cr_every", { n: every }) : undefined}>{t("cr_next_update")} <b className="font-mono text-ink">{h ? `${h}:${pad(m)}` : m}:{pad(sec)}</b></span>;
}

/** A block of the page that folds away; whether it is open is remembered. */
function Section({ id, title, hint, children, delay = 0 }: { id: string; title: string; hint?: string; children: React.ReactNode; delay?: number }) {
  const [open, setOpen] = useState(() => store.get(`crOpen:${id}`, true));
  const toggle = () => { store.set(`crOpen:${id}`, !open); setOpen(!open); };
  return (
    <motion.section className="panel p-4" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}>
      <button type="button" className="cr-toggle" aria-expanded={open} onClick={toggle}>
        <h2 className="panel-title">{title}</h2>
        <span className="cr-chev" aria-hidden>▾</span>
      </button>
      {open && (
        <>
          {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
          <div className="mt-3">{children}</div>
        </>
      )}
    </motion.section>
  );
}

const Gold = ({ c, sign = false }: { c: number | null | undefined; sign?: boolean }) =>
  c == null ? <span className="text-muted">—</span> : (
    <span className={sign ? (c >= 0 ? "text-good" : "text-bad") : ""}>{sign && c < 0 ? "−" : sign && c > 0 ? "+" : ""}<Money c={Math.abs(c)} /></span>
  );

const fmtMoney = (c: number) => {
  const g = Math.floor(c / 10000), sv = Math.floor(c / 100) % 100, cu = c % 100;
  return [g ? `${g}g` : "", sv ? `${sv}s` : "", cu || (!g && !sv) ? `${cu}c` : ""].filter(Boolean).join(" ");
};

/** 0. Signals: what pays right now, new ones marked; the thresholds are the user's. */
function SignalsBlock({ onOpen }: { onOpen: (x: RefItem) => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const q = useSignals();
  const seen = useSeen();
  const d = q.data;
  const [edit, setEdit] = useState(false);
  const [mc, setMc] = useState("");
  const [mf, setMf] = useState("");
  // what is on screen now counts as seen when the page is left (the badges are for what came since)
  useEffect(() => () => {
    if (d) markSeen([...(d.crafts || []).map(signalKey.craft), ...(d.flips || []).map(signalKey.flip)]);
  }, [d]);
  if (!d || d.status !== "ready") return null;
  const crafts = d.crafts || [], flips = d.flips || [];
  const save = async () => {
    const b = { minCraft: parseMoney(mc) ?? d.cfg!.minCraft, minFlip: parseMoney(mf) ?? d.cfg!.minFlip };
    await wowApi.setSignalCfg(b);
    setEdit(false);
    qc.invalidateQueries({ queryKey: ["craft-signals"] });
  };
  const New = ({ k }: { k: string }) => (seen.has(k) ? null : <span className="sg-new">{t("sg_new")}</span>);
  return (
    <Section id="signals" title={t("sg_title")} hint={t("sg_hint", { c: fmtMoney(d.cfg!.minCraft), f: fmtMoney(d.cfg!.minFlip) })}>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        {!edit ? (
          <button className="btn text-xs" onClick={() => (setMc(fmtMoney(d.cfg!.minCraft)), setMf(fmtMoney(d.cfg!.minFlip)), setEdit(true))}>{t("sg_edit")}</button>
        ) : (
          <>
            <label className="flex items-center gap-1">{t("sg_min_craft")} <input className="input w-28 py-1" value={mc} onChange={(e) => setMc(e.target.value)} /></label>
            <label className="flex items-center gap-1">{t("sg_min_flip")} <input className="input w-28 py-1" value={mf} onChange={(e) => setMf(e.target.value)} /></label>
            <button className="btn-primary text-xs" onClick={save}>{t("mk_save")}</button>
          </>
        )}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <div className="eyebrow mb-1">⚗ {t("sg_crafts", { n: crafts.length })}</div>
          {!crafts.length ? <p className="text-sm text-muted">{t("sg_none")}</p> : (
            <ul className="space-y-1.5 text-sm">
              {crafts.slice(0, 30).map((s) => (
                <li key={signalKey.craft(s)} className="sg-row">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    {s.item ? <Item x={s.item} count={s.made > 1 ? s.made : null} onOpen={onOpen} /> : s.name}
                    <New k={signalKey.craft(s)} />
                    <span className="ml-auto font-display text-good">+<Money c={s.profit} /></span>
                  </div>
                  <div className="text-[11px] text-muted">
                    {s.char} · {s.profName} · {t("sg_buy_for")} <Money c={s.cost} /> → {t(s.sale.where === "vendor" ? "cr_sell_vendor" : "cr_sell_ah")} <Money c={s.value} />
                  </div>
                  <div className="text-[11px] text-muted">
                    {s.parts.map((p, i) => <span key={p.id}>{i ? ", " : ""}{p.name} ×{p.count}{p.src === "vendor" ? ` (${t("cr_at_vendor")})` : ""}</span>)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <div className="eyebrow mb-1">💰 {t("sg_flips", { n: flips.length })}</div>
          {!flips.length ? <p className="text-sm text-muted">{t("sg_none")}</p> : (
            <ul className="space-y-1.5 text-sm">
              {flips.slice(0, 30).map((f) => (
                <li key={signalKey.flip(f)} className="sg-row">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <Item x={f} onOpen={onOpen} />
                    <New k={signalKey.flip(f)} />
                    <span className="ml-auto font-display text-good">+<Money c={f.profit} /></span>
                  </div>
                  <div className="text-[11px] text-muted">{t("sg_flip_line", { n: f.qty })} <Money c={f.buy} /> → {t("cr_at_vendor")} <Money c={f.sell} /></div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Section>
  );
}

/** 1. What pays: every recipe of every character, by profit of one craft. */
function Profitable({ rows, onOpen }: { rows: Row[]; onOpen: (x: RefItem) => void }) {
  const { t } = useI18n();
  const [who, setWho] = useState<string>(() => store.get("crWho", "all"));
  const [onlyKnown, setOnlyKnown] = useState(() => store.get("crKnown", true));
  const [onlyProfit, setOnlyProfit] = useState(() => store.get("crProfit", false));
  const [open, setOpen] = useState<string | null>(null);
  const opts = useMemo(() => [...new Map(rows.map((r) => [profKey(r), r])).values()], [rows]);
  const shown = rows
    .filter((r) => who === "all" || `${r.cid}:${r.prof}` === who)
    .filter((r) => !onlyKnown || r.known)
    .filter((r) => !onlyProfit || (r.profit ?? -1) > 0)
    .sort((a, b) => (b.profit ?? -Infinity) - (a.profit ?? -Infinity));
  const set = <T,>(k: string, v: T, f: (v: T) => void) => (store.set(k, v), f(v));
  return (
    <Section id="profit" title={t("cr_profit_t")} hint={t("cr_profit_h")}>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <CharProfPicker options={opts} value={who} all={t("cr_all")} onChange={(k) => set("crWho", k, setWho)} />
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
    <Section id="plan" title={t("cr_plan_t")} hint={t("cr_plan_h")} delay={0.05}>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <CharProfPicker options={profs} value={profKey(cur)} onChange={(k) => (store.set("crPlan", k), setKey(k), setTarget(null))} />
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
                      {s.learn.fdb && <LearnWhere l={s.learn.fdb} />}
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
  const [minFlip, setMinFlip] = useState<number>(() => store.get("crFlipMin", 1));
  const [minText, setMinText] = useState(() => fmtMoney(minFlip));
  const flips = advice.filter((a) => a.flip && a.flip >= minFlip);
  const saveMin = (v: string) => {
    setMinText(v);
    const c = parseMoney(v);
    if (c != null) { store.set("crFlipMin", c); setMinFlip(c); }
  };
  return (
    <Section id="where" title={t("cr_where_t")} hint={t("cr_where_h")} delay={0.1}>
      <label className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        {t("cr_flip_min")}
        <input className="input w-28 py-1" value={minText} onChange={(e) => saveMin(e.target.value)} placeholder="1s" />
        <span className="text-xs text-muted">{t("cr_flip_min_h")}</span>
      </label>
      {flips.length > 0 ? (
        <div className="mb-3 rounded-md border border-good/40 bg-good/10 p-2.5 text-sm">
          <b className="text-good">{t("cr_flip_t")}</b>
          <ul className="mt-1 space-y-0.5">
            {flips.slice(0, 10).map((a) => (
              <li key={a.id}><Item x={a} onOpen={onOpen} /> — {t("cr_flip", { n: a.qty })} <Money c={a.flip} /></li>
            ))}
          </ul>
        </div>
      ) : <p className="mb-3 text-sm text-muted">{t("cr_flip_none")}</p>}
      <input className="input mb-2 w-56 py-1 text-sm" placeholder={t("co_find")} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="swipe-x overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="text-left text-xs text-muted">
            <tr>
              <th className="p-1.5 font-normal">{t("cr_c_good")}</th>
              <th className="p-1.5 text-right font-normal">{t("cr_c_ah_net")}</th>
              <th className="p-1.5 text-right font-normal">{t("cr_c_vendor")}</th>
              <th className="p-1.5 text-right font-normal" title={t("cr_c_de_h")}>{t("cr_c_de")}</th>
              <th className="p-1.5 font-normal">{t("cr_c_verdict")}</th>
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, 200).map((a) => (
              <tr key={a.id} className="border-t border-edge/40">
                <td className="p-1.5"><Item x={a} onOpen={onOpen} /></td>
                <td className="p-1.5 text-right"><Gold c={a.ah} /></td>
                <td className="p-1.5 text-right"><Gold c={a.vendor} /></td>
                <td className={`p-1.5 text-right ${a.de && a.de > Math.max(a.ah ?? 0, a.vendor ?? 0) ? "text-[#c58cff]" : "text-muted"}`}>{a.de ? <Gold c={a.de} /> : "—"}</td>
                <td className={`p-1.5 ${a.where === "vendor" ? "text-[#ffb070]" : "text-good"}`}>{t(a.where === "vendor" ? "cr_v_vendor" : "cr_v_ah")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

/** Where a recipe is learned, by ForeverDB: the vendors of the player's side (place, price or Merchant's Favor). */
function LearnWhere({ l }: { l: FdbLearn }) {
  const { t } = useI18n();
  const vs = [...(l.vendors.horde || []), ...(l.vendors.alliance || [])].slice(0, 2);
  return (
    <div className="mt-0.5 text-[11px] text-muted">
      {l.ways.length > 0 && <span>{l.ways.map((w) => t(`cr_way_${w}` as Key)).join(", ")}{l.skill ? ` · ${t("cr_from", { s: l.skill })}` : ""}</span>}
      {vs.map((v) => (
        <div key={v.npc}>
          {v.name}{v.zone ? ` · ${v.zone}` : ""}{v.x != null ? ` ${v.x.toFixed(0)}, ${v.y?.toFixed(0)}` : ""}
          {v.costs.length ? ` · ${v.costs.map((c) => `${c.amount} ${c.name}`).join(", ")}` : v.price ? <> · <Money c={v.price} /></> : null}
          {v.seen ? <span className="text-good"> · {t("so_seen_forever")}</span> : null}
        </div>
      ))}
    </div>
  );
}
