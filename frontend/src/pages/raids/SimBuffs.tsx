/**
 * The simulation's moment before the pull: on top of the best combination of gear, what the player has on —
 * food, elixirs, a flask, the potion drunk at the pull, a weapon oil, the guide's enchantments, other classes' buffs
 * and buffs other players give through a talent. Every value comes from the game's files (the server's
 * data/sim_buffs.json); the choice is kept in this browser. The buffs show as the game shows them: icons with the
 * time left under them, and a tooltip with what each gives.
 */
import { useEffect, useRef, useState } from "react";
import { EdgeTip, useEdgeTip } from "../../components/EdgeTip";
import { useI18n, type Key, type Lang } from "../../lib/i18n";
import { store } from "../../lib/store";
import { media, type PreBis, type SimBuff, type SimEffect, type SimStats } from "../../lib/wowApi";

export interface SimCfg { on: string[]; enchants: boolean }
// the pre-pull of the guide: its food, elixirs, flask, potion and oil, the enchantments, the usual raid buffs
export const FULL: SimCfg = {
  on: ["food:13935", "elixir:13454", "elixir:9264", "flask:13512", "potion:250937", "oil:20749",
    "class:23028", "class:21564", "class:27681", "class:21850", "class:10497"],
  enchants: true,
};
const NONE: SimCfg = { on: [], enchants: false };
const ONE = new Set(["food", "flask", "oil", "potion"]); // the game keeps one of these at a time
const GROUPS = ["food", "elixir", "flask", "potion", "oil", "class", "talent"] as const;

export function useSimCfg(): [SimCfg, (c: SimCfg) => void] {
  const [c, setC] = useState<SimCfg>(() => store.get<SimCfg>("prebisSimCfg", FULL));
  return [c, (v) => (store.set("prebisSimCfg", v), setC(v))];
}

export interface SimResult extends SimStats { mana: number | null; dmg: number; active: SimBuff[]; enchantSp: number; bursts: { b: SimBuff; total: number }[] }

/** A short burst (Mana Tide: 13 sec) is mana once, not a lasting regeneration: counted apart. */
const isBurst = (b: SimBuff) => b.dur != null && b.dur > 0 && b.dur < 60000 && !!b.eff.mp5;
/** All the mana a burst gives over its time. */
const burstTotal = (b: SimBuff) => (b.eff.tick ? b.eff.tick.n * Math.floor(b.dur! / 1000 / b.eff.tick.every) : Math.round((b.eff.mp5 ?? 0) * b.dur! / 5000));
/** One decimal when there is one: 31.25 shows as 31.3, not 31. */
export const fmt1 = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

/** The best combination with the chosen buffs: flat values first, then the per-cent ones on the totals. */
export function applySim(d: PreBis, cfg: SimCfg): SimResult | null {
  if (!d.summary) return null;
  const s = d.summary.sim;
  const all = d.buffs || [];
  const on = new Set(cfg.on);
  const active = all.filter((b) => on.has(b.key) && (!b.needs || on.has(b.needs)));
  const add = (k: keyof SimEffect) => active.reduce((a, b) => a + (k === "mp5" && isBurst(b) ? 0 : ((b.eff[k] as number | undefined) ?? 0)), 0);
  const pct = (k: "int" | "spi" | "sta") => active.reduce((a, b) => a * (1 + (b.eff.pct?.[k] ?? 0) / 100), 1);
  const enchantSp = cfg.enchants ? (d.summary.enchants || []).reduce((a, e) => a + (e.sp ?? 0), 0) : 0;
  const shadowOnly = active.reduce((a, b) => a + (b.eff.school?.shadow ?? 0), 0);
  const sp = s.sp + add("sp") + enchantSp;
  const int = Math.round((s.int + add("int")) * pct("int"));
  const spi = Math.round((s.spi + add("spi")) * pct("spi"));
  const sta = Math.round((s.sta + add("sta")) * pct("sta"));
  const base = d.summary.base;
  return {
    ...s, sp, int, spi, sta,
    shadow: s.shadow - s.sp + sp + shadowOnly,
    crit: +(s.crit + add("crit")).toFixed(2), hit: +(s.hit + add("hit")).toFixed(2),
    mp5: +(s.mp5 + add("mp5")).toFixed(2),
    mana: base ? base.mana + 15 * int + add("mana") : null,
    dmg: active.reduce((a, b) => a * (1 + (b.eff.dmgPct ?? 0) / 100), 1),
    active, enchantSp, bursts: active.filter(isBurst).map((b) => ({ b, total: burstTotal(b) })),
  };
}

const icon = (n: string | null | undefined) => media(`https://wow.zamimg.com/images/wow/icons/large/${n || "inv_misc_questionmark"}.jpg`);

export function SpellIcon({ name, size = 28 }: { name: string | null | undefined; size?: number }) {
  return <img src={icon(name)} alt="" width={size} height={size} className="flex-none rounded border border-black" style={{ width: size, height: size }} />;
}

/** "1 h", "15 min", "30 sec"; nothing for an aura that lasts while its source is near. */
function useDur() {
  const { t } = useI18n();
  return (ms: number | null) => {
    if (ms == null || ms < 0) return "";
    const s = Math.round(ms / 1000);
    return s >= 3600 ? t("sb_h", { n: Math.round(s / 360) / 10 }) : s >= 60 ? t("sb_m", { n: Math.round(s / 60) }) : t("sb_s", { n: s });
  };
}

/** What a buff gives, line by line, in the game's wording. */
export function effectLines(e: SimEffect, t: (k: Key, v?: Record<string, string | number>) => string, b?: SimBuff, all?: SimBuff[], lang: Lang = "ru"): string[] {
  const out: string[] = [];
  // a talent that strengthens another buff is not a buff of its own: say what it strengthens
  if (b?.boost && b.needs) {
    const of = all?.find((x) => x.key === b.needs);
    return [t("sb_e_boost", { n: b.boost, s: of ? of.name[lang] : "" })];
  }
  if (e.tick) {
    const per5 = fmt1(+(e.tick.n * 5 / e.tick.every).toFixed(2));
    if (b && isBurst(b)) out.push(t("sb_e_tick_burst", { n: e.tick.n, s: e.tick.every, t: burstTotal(b), d: Math.round(b.dur! / 1000) }));
    else if (e.tick.every === 5) out.push(t("sb_e_mp5", { n: e.tick.n }));
    else out.push(t("sb_e_tick", { n: e.tick.n, s: e.tick.every, m: per5 }));
  }
  for (const k of ["sp", "int", "spi", "sta", "str", "agi", "crit", "hit", "mp5", "mana", "hp", "dmgPct"] as const) {
    const v = e[k];
    if (k === "mp5" && e.tick) continue;
    if (v) out.push(t(`sb_e_${k}` as Key, { n: v }));
  }
  for (const [k, v] of Object.entries(e.school || {})) if (v) out.push(t("sb_e_school", { n: v, s: t(`sb_school_${k}` as Key) }));
  const pct = Object.entries(e.pct || {}).filter(([, v]) => v);
  if (pct.length === 5) out.push(t("sb_e_pct_all", { n: pct[0][1]! }));
  else for (const [k, v] of pct) out.push(t("sb_e_pct", { n: v!, s: t(`sb_stat_${k}` as Key) }));
  return out;
}

function Tip({ b, boosts }: { b: SimBuff; boosts: SimBuff[] }) {
  const { t, lang } = useI18n();
  const dur = useDur();
  return (
    <div className="max-w-[19rem]">
      <div className="text-[#ffd100]">{b.aura[lang]}</div>
      {effectLines(b.eff, t, b).map((l) => <div key={l} className="text-good">{l}</div>)}
      {boosts.map((x) => <div key={x.key} className="text-good">{t("sb_boosted", { n: x.boost ?? 0, s: x.talentName?.[lang] ?? "" })}</div>)}
      <div className="mt-1 text-muted">{dur(b.dur) ? t("sb_left", { d: dur(b.dur) }) : t("sb_aura")}</div>
      {b.item && <div className="mt-1 text-xs text-muted">{t("sb_from_item", { n: b.name[lang] })}</div>}
      {b.class && b.group === "class" && <div className="mt-1 text-xs" style={{ color: b.class.color }}>{t("sb_from_class", { c: b.class.name[lang] })}</div>}
      {b.class && b.group === "talent" && (
        <div className="mt-1 text-xs" style={{ color: b.class.color }}>{t("sb_from_talent", { c: b.class.name[lang], s: b.spec!.name[lang], n: b.talentName![lang] })}</div>
      )}
    </div>
  );
}

/** One buff of the bar: its icon, the time under it, the tooltip kept on screen. */
function Buff({ b, time, boosts }: { b: SimBuff; time: string; boosts: SimBuff[] }) {
  const { anchor, open, bind } = useEdgeTip();
  return (
    <span {...bind} className="sb-buff" tabIndex={0}>
      <SpellIcon name={b.icon} size={34} />
      <span className="sb-time">{time}</span>
      <EdgeTip anchor={anchor} open={open}><Tip b={b} boosts={boosts} /></EdgeTip>
    </span>
  );
}

/** The buffs on the character, as the game's buff bar shows them. */
export function BuffBar({ r }: { r: SimResult }) {
  const { t } = useI18n();
  const dur = useDur();
  if (!r.active.length && !r.enchantSp) return null;
  return (
    <div className="sb-bar" aria-label={t("sb_bar")}>
      {r.active.filter((b) => !b.boost).map((b) => (
        <Buff key={b.key} b={b} time={dur(b.dur)} boosts={r.active.filter((x) => x.boost && x.needs === b.key)} />
      ))}
      {r.enchantSp > 0 && <span className="ml-2 self-center text-xs text-muted">{t("sb_ench_sum", { n: r.enchantSp })}</span>}
    </div>
  );
}

/** The gear next to the Simulate button: what the simulation counts. */
export function SimSettings({ d, cfg, set }: { d: PreBis; cfg: SimCfg; set: (c: SimCfg) => void }) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", off);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", off); document.removeEventListener("keydown", esc); };
  }, [open]);
  const all = d.buffs || [];
  const on = new Set(cfg.on);
  const toggle = (b: SimBuff) => {
    const next = new Set(on);
    if (next.has(b.key)) {
      next.delete(b.key);
      all.filter((x) => x.needs === b.key).forEach((x) => next.delete(x.key)); // no totem, nothing to strengthen
    } else {
      if (ONE.has(b.group)) all.filter((x) => x.group === b.group).forEach((x) => next.delete(x.key));
      next.add(b.key);
      if (b.needs) next.add(b.needs); // the talent comes with the totem it strengthens
    }
    set({ ...cfg, on: [...next] });
  };
  const dur = useDur();
  const row = (b: SimBuff) => {
    return (
      <label key={b.key} className={`sb-row ${on.has(b.key) ? "on" : ""}`}>
        <input type={ONE.has(b.group) ? "radio" : "checkbox"} name={ONE.has(b.group) ? `sb-${b.group}` : undefined}
          checked={on.has(b.key)} onChange={() => toggle(b)}
          onClick={(e) => { if (ONE.has(b.group) && on.has(b.key)) { e.preventDefault(); toggle(b); } }} />
        <SpellIcon name={b.item ? b.itemIcon ?? b.icon : b.group === "talent" ? b.talentIcon ?? b.icon : b.icon} size={26} />
        <span className="grid min-w-0 leading-tight">
          <span>{b.name[lang]}{dur(b.dur) ? <span className="text-muted"> · {dur(b.dur)}</span> : null}</span>
          <span className="text-xs text-good">{effectLines(b.eff, t, b, all, lang).join(", ")}</span>
          {b.class && (
            <span className="text-xs" style={{ color: b.class.color }}>
              {b.group === "talent" ? t("sb_talent_line", { c: b.class.name[lang], s: b.spec!.name[lang], n: b.talentName![lang] }) : b.class.name[lang]}
            </span>
          )}
        </span>
      </label>
    );
  };
  const ench = d.summary?.enchants || [];
  return (
    <div ref={box} className="relative">
      <button className="btn px-2.5" aria-expanded={open} title={t("sb_title")} aria-label={t("sb_title")} onClick={() => setOpen(!open)}>⚙</button>
      {open && (
        <div className="sb-pop">
          <div className="flex flex-wrap items-center gap-2">
            <b className="font-display text-gold">{t("sb_title")}</b>
            <button className="btn ml-auto py-1 text-xs" onClick={() => set(FULL)}>{t("sb_full")}</button>
            <button className="btn py-1 text-xs" onClick={() => set(NONE)}>{t("sb_none")}</button>
          </div>
          <p className="text-xs text-muted">{t("sb_hint")}</p>
          <div className="sb-cols">
            {GROUPS.map((g) => {
              const xs = all.filter((b) => b.group === g);
              if (!xs.length) return null;
              return (
                <section key={g}>
                  <div className="eyebrow mb-1">{t(`sb_g_${g}` as Key)}</div>
                  <div className="space-y-1">{xs.map(row)}</div>
                  {g === "oil" && (
                    <div className="mt-3">
                      <div className="eyebrow mb-1">{t("sb_g_enchants")}</div>
                      <label className={`sb-row ${cfg.enchants ? "on" : ""}`}>
                        <input type="checkbox" checked={cfg.enchants} onChange={() => set({ ...cfg, enchants: !cfg.enchants })} />
                        <span className="grid leading-tight">
                          <span>{t("sb_ench_all")}</span>
                          <span className="text-xs text-good">
                            {ench.map((e) => `${t(`slot_${e.slot}` as Key)}${e.sp != null ? ` +${e.sp}` : ` (${t("sb_ench_nonum")})`}`).join(", ")}
                          </span>
                        </span>
                      </label>
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
