import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { runsOf, type PlacedTalent } from "../engine";
import { iconStyle, useIcons, useTalents } from "../lib/gameData";
import { useI18n } from "../lib/i18n";
import { useTheme } from "../theme/ThemeProvider";
import { Saves } from "./talents/Saves";
import { TalentTree } from "./talents/TalentTree";
import { Tooltip } from "./talents/Tooltip";
import { useCalculator } from "./talents/useCalculator";

export function Talents() {
  const { t, lang } = useI18n();
  const { sfx } = useTheme();
  const D = useTalents(lang).data;
  const icons = useIcons().data;
  const calc = useCalculator(D);
  const [tip, setTip] = useState<{ x: PlacedTalent; el: HTMLElement } | null>(null);
  const [mobileTab, setMobileTab] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);

  const toast = (s: string) => {
    setMsg(s);
    setTimeout(() => setMsg(null), 2000);
  };

  if (!D || !calc.s || !calc.c) return <p className="text-muted">…</p>;
  const { s, c, M, talented, start, total, used, split } = calc;
  const left = total - used;

  const add = (id: number) => {
    const r = calc.add(id);
    sfx(r === "max" ? "max" : r ? "add" : "error");
  };
  const remove = (id: number) => sfx(calc.remove(id) ? "remove" : "error");

  return (
    <div className="space-y-4" style={{ ["--class" as string]: c.color }}>
      {/* class picker */}
      <div className="flex flex-wrap gap-2">
        {D.classes.map((k) => (
          <button
            key={k.token}
            onClick={() => (calc.selectClass(k.token), sfx("open"))}
            className={`btn ${k.token === c.token ? "border-[var(--cc)] text-[var(--cc)] shadow-[0_0_14px_-4px_var(--cc)]" : ""}`}
            style={{ ["--cc" as string]: k.color }}
          >
            <span className="h-5 w-5 rounded-sm" style={iconStyle(icons, k.icon)} />
            {k.name}
          </button>
        ))}
      </div>

      {/* counters + controls */}
      <div className="panel flex flex-wrap items-center gap-4 p-3">
        <div>
          <span className={`font-display text-3xl ${left < 0 ? "text-bad" : "text-gold"}`}>{left}</span>{" "}
          <span className="text-sm text-muted">{t("points_left")}</span>{" "}
          <span className="font-mono text-sm text-muted">{split.join(" / ")}</span>
        </div>
        <label className="flex flex-1 items-center gap-3 text-sm sm:min-w-[260px]">
          <span className="eyebrow">{t("level")}</span>
          <input type="range" min={start} max={60} value={s.level} onChange={(e) => calc.setLevel(+e.target.value)} className="flex-1 accent-[rgb(var(--gold))]" />
          <span className="w-6 font-display text-gold">{s.level}</span>
        </label>
        <div className="flex gap-2">
          <button className="btn" onClick={() => (calc.resetAll(), sfx("remove"))}>{t("reset_all")}</button>
          <button className="btn-primary" onClick={() => (navigator.clipboard?.writeText(location.href), toast(t("copied")), sfx("click"))}>
            {t("copy_link")}
          </button>
        </div>
      </div>

      {/* Legacy: Talented */}
      {talented && (
        <div className="panel flex flex-wrap items-center gap-3 p-3 text-sm">
          <span className="h-8 w-8 rounded border border-gold/50" style={iconStyle(icons, talented.icon)} />
          <div className="min-w-[180px] flex-1">
            <b className="text-gold">{talented.name}</b>
            <p className="text-xs text-muted">{t("legacy_hint")}</p>
          </div>
          <div className="flex overflow-hidden rounded-md border border-edge">
            {[0, ...talented.tiers.map((_, i) => i + 1)].map((k) => (
              <button
                key={k}
                onClick={() => (calc.setLegacy(k), sfx("click"))}
                title={k ? t("legacy_tier", { k, l: talented.tiers[k - 1].start }) : ""}
                className={`px-3 py-1 ${k === s.legacy ? "bg-accent/30 text-gold" : "text-muted hover:text-ink"}`}
              >
                {k || t("legacy_none")}
              </button>
            ))}
          </div>
        </div>
      )}

      {left < 0 && <p className="text-sm text-bad">{t("over_budget", { l: s.level, n: -left })}</p>}

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div>
          {/* phones: one tree at a time */}
          <div className="mb-2 flex gap-1 md:hidden">
            {c.tabs.map((tb, i) => (
              <button key={tb.id} onClick={() => setMobileTab(i)} className={`btn min-w-0 flex-1 justify-center px-1 text-xs ${i === mobileTab ? "text-gold" : ""}`}>
                <span className="truncate">{tb.name}</span> {split[i]}
              </button>
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {c.tabs.map((_, i) => (
              <div key={i} className={i === mobileTab ? "" : "hidden md:block"}>
                <TalentTree
                  c={c} ti={i} M={M} ranks={s.ranks} total={total} spentTab={split[i]} icons={icons}
                  onAdd={add} onRemove={remove} onReset={() => (calc.resetTab(i), sfx("remove"))}
                  onHover={(x, el) => setTip(x && el ? { x, el } : null)}
                />
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">{t("data_note", { b: D.build })}</p>
        </div>

        <div className="space-y-4">
          <section className="panel p-4">
            <h2 className="panel-title mb-3">{t("plan_title")}</h2>
            <ol className="max-h-[420px] space-y-1 overflow-auto pr-1 text-sm">
              {runsOf(s.order).map((r) => {
                const x = M[r.id];
                const a = start + r.start;
                const b = a + r.len - 1;
                return (
                  <li key={r.start} className="flex items-center gap-2">
                    <span className="w-12 shrink-0 font-mono text-xs text-gold">{a === b ? a : `${a}–${b}`}</span>
                    <span className="h-5 w-5 shrink-0 rounded-sm" style={iconStyle(icons, x.icon)} />
                    <span className="truncate">{x.name}</span>
                    <span className="ml-auto text-xs text-muted">{c.tabs[x.tab].name}</span>
                  </li>
                );
              })}
            </ol>
          </section>
          <Saves
            D={D} c={c} level={s.level} legacy={s.legacy} ranks={s.ranks} order={s.order} split={split} toast={toast}
            onOpen={(sv) => {
              const a = calc.openSave(sv);
              sfx("open");
              if (a?.broken) toast(t("broken"));
            }}
          />
        </div>
      </div>

      {tip && <Tooltip x={tip.x} el={tip.el} c={c} M={M} ranks={s.ranks} order={s.order} start={start} />}
      <AnimatePresence>
        {msg && (
          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
            className="panel fixed bottom-6 left-1/2 z-50 -translate-x-1/2 px-4 py-2 text-sm text-gold"
          >
            {msg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
