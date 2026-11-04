import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { canAdd, canRemove, npAvailable, pendingNotes, type OrderProblem, type PlacedTalent } from "../engine";
import {
  iconStyle, useAbilities, useDiffs, useIcons, useIndex, useNews, useNotes, useTalents,
} from "../lib/gameData";
import { useI18n } from "../lib/i18n";
import { store } from "../lib/store";
import { useTheme } from "../theme/ThemeProvider";
import { ClassNotes, NotesBar } from "./talents/ClassNotes";
import { PlanBar, Planner } from "./talents/Planner";
import { Skills, type SkillRow } from "./talents/Skills";
import { Saves } from "./talents/Saves";
import { TalentTree, type TreeMarks } from "./talents/TalentTree";
import { AbilityTip, TalentTip, TipBox } from "./talents/Tooltip";
import { useCalculator } from "./talents/useCalculator";

const touchDevice = () => matchMedia("(hover: none)").matches;
const smooth = (): ScrollBehavior => (matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");

type Tip = { kind: "tal"; x: PlacedTalent; el: HTMLElement } | { kind: "ab"; a: SkillRow; el: HTMLElement };

export function Talents() {
  const { t, lang } = useI18n();
  const { sfx } = useTheme();
  const base = useTalents(lang).data;
  const notes = useNotes().data;
  const news = useNews().data;
  const icons = useIcons().data;
  const idx = useIndex().data;
  const abil = useAbilities(lang).data;
  const calc = useCalculator(base, notes);
  const [tip, setTip] = useState<Tip | null>(null);
  const [sheet, setSheet] = useState<Tip | null>(null);
  const [mobileTab, setMobileTab] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [planner, setPlannerState] = useState(() => store.get("planner", true));
  const [skillsOpen, setSkillsState] = useState(() => store.get("skills", true));
  const [rowHover, setRowHover] = useState<number | null>(null);
  const [flash, setFlash] = useState<number | null>(null);
  const [notesOpen, setNotesOpenState] = useState(() => store.get("cnOpen", false));
  const [notesSeen, setNotesSeen] = useState(() => store.get("notesSeen", ""));
  const [touch] = useState(touchDevice);
  const trees = useRef<HTMLDivElement>(null);
  const toastT = useRef<number>();

  // talents changed in the newest build that changed anything: a dot in the corner of the slot
  const lastChanged = (idx?.builds || []).filter((b) => b.changes).at(-1)?.version;
  const lastDiff = useDiffs(lastChanged ? [lastChanged] : [], lang)[lastChanged ?? ""];
  const changed = useMemo(() => {
    const m = new Map<number, string>();
    for (const ch of lastDiff?.changes || [])
      if (ch.class === calc.s?.cls && !(ch.kind === "text" && !ch.numbers)) m.set(ch.node, lastChanged!);
    return m;
  }, [lastDiff, calc.s?.cls, lastChanged]);

  // phones show one tree: the one the previewed plan step goes into
  useEffect(() => {
    const s = calc.s;
    if (calc.preview != null && s) {
      const x = calc.M[s.order[calc.preview]];
      if (x) setMobileTab(x.tab);
    }
  }, [calc.preview]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const close = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (!el.closest(".sheet,.slot,.ab")) setSheet(null);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  const D = calc.D;
  if (!D || !calc.s || !calc.c) return <p className="text-muted">…</p>;
  const { s, c, M, talented, start, total, used, split, shown, preview, flags } = calc;
  const left = total - used;
  const links = abil?.talentLinks?.[c.token] || {};

  const toast = (text: string) => {
    setMsg(text);
    clearTimeout(toastT.current);
    toastT.current = window.setTimeout(() => setMsg(null), 2400);
  };
  const setPlanner = (on: boolean) => {
    store.set("planner", on);
    setPlannerState(on);
    if (!on) calc.setPreview(null);
  };
  const setSkills = (on: boolean) => (store.set("skills", on), setSkillsState(on));
  const setNotesOpen = (on: boolean) => (store.set("cnOpen", on), setNotesOpenState(on));
  const add = (id: number) => {
    const r = calc.add(id);
    sfx(r === "max" ? "max" : r ? "add" : "error");
  };
  const remove = (id: number) => sfx(calc.remove(id) ? "remove" : "error");
  const problem = (p: OrderProblem) => {
    sfx("error");
    const why = p.kind === "gate" ? t("pl_why_gate", { p: p.points, t: p.tab }) : t("pl_why_req", { n: p.parent, m: p.max });
    toast(t("pl_bad", { n: p.x.name, l: start + p.i, why }));
  };
  const showTalent = (id: number) => {
    const x = M[id];
    if (!x) return;
    setMobileTab(x.tab);
    requestAnimationFrame(() => {
      document.querySelector(`.slot[data-id="${id}"]`)?.scrollIntoView({ behavior: smooth(), block: "center" });
      setFlash(id);
      setTimeout(() => setFlash((f) => (f === id ? null : f)), 1800);
    });
  };

  const active = tip ?? sheet;
  // only a spell hovered in the skills list lights up the talents that modify it
  const aff = new Set<number>(active?.kind === "ab" ? active.a.a || [] : []);
  const skillTalent = active?.kind === "ab" ? active.a.fromTalent ?? null : null;
  const marks: TreeMarks = {
    levels: new Map(planner && preview == null ? s.order.map((id, i) => [id, start + i] as const).reverse() : []),
    changed: new Set(changed.keys()),
    pending: new Set(calc.np ? [] : Object.keys(M).map(Number).filter((id) => pendingNotes(notes, c.token, id).length)),
    flags, hl: rowHover ?? skillTalent, flash, aff,
  };
  const flagsLive = flags && [...flags.items.values()].some((f) => !(s.ranks[f.id] || 0));
  const npOk = npAvailable(notes, c.token);
  const lgEff = !talented ? "" : !s.legacy ? t("lg_eff_none")
    : total === Math.min(51, Math.max(0, s.level - 9)) && total >= 51 ? t("lg_eff_max", { s: start, l: s.level })
    : t("lg_eff", { s: start, l: s.level, p: total, b: Math.max(0, Math.min(51, s.level - 9)) });

  const talentTip = (x: PlacedTalent, hint: boolean) => (
    <TalentTip
      x={x} c={c} M={M} ranks={shown} order={s.order} start={start} planner={planner && !!s.ranks[x.id]}
      changedIn={changed.get(x.id)} pending={calc.np ? [] : pendingNotes(notes, c.token, x.id)} links={[]}
      flag={flags?.items.get(x.id)} flagName={flags?.name} hint={hint}
    />
  );

  return (
    <div className="space-y-4" style={{ ["--class" as string]: c.color }}>
      {/* class picker */}
      <div className="flex flex-wrap gap-2">
        {D.classes.map((k) => (
          <button
            key={k.token}
            onClick={() => (calc.selectClass(k.token), setTip(null), sfx("open"))}
            className={`btn ${k.token === c.token ? "border-[var(--cc)] text-[var(--cc)] shadow-[0_0_14px_-4px_var(--cc)]" : ""}`}
            style={{ ["--cc" as string]: k.color }}
          >
            <span className="h-5 w-5 rounded-sm" style={iconStyle(icons, k.icon)} />
            {k.name}
          </button>
        ))}
      </div>

      {/* counters + controls */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div>
          <span className={`font-display text-4xl ${left < 0 ? "text-bad" : "text-ink"}`}>{left}</span>{" "}
          <span className="font-mono text-sm text-muted">{t("points_left")}</span>{" "}
          <span className="ml-2 font-mono text-sm text-muted">{split.join(" / ")}</span>
        </div>
        <label className="flex flex-1 items-center gap-3 text-sm sm:min-w-[260px] sm:max-w-[360px]">
          <span className="text-muted">{t("level")}</span>
          <input type="range" min={start} max={60} value={s.level} onChange={(e) => calc.setLevel(+e.target.value)} className="flex-1 accent-[#ffd100]" />
          <span className="w-6 font-mono text-gold">{s.level}</span>
        </label>
        <div className="ml-auto flex flex-wrap gap-2">
          {!planner && <button className="btn xl:hidden" onClick={() => setPlanner(true)}>{t("pl_title")}</button>}
          {!skillsOpen && <button className="btn xl:hidden" onClick={() => setSkills(true)}>{t("sk_title")}</button>}
          {(npOk || calc.np) && (
            <button className="btn" aria-pressed={calc.np} onClick={() => (calc.np ? calc.leaveNp() : calc.enterNp(), sfx("open"))}>
              {t(calc.np ? "np_off" : "np_on")}
            </button>
          )}
          <button className="btn" onClick={() => (calc.resetAll(), sfx("remove"))}>{t("reset_all")}</button>
          <button className="btn-primary" onClick={() => (navigator.clipboard?.writeText(location.href).then(() => toast(t("copied")), () => toast(t("tc_copy_fail"))), sfx("click"))}>
            {t("copy_link")}
          </button>
        </div>
      </div>

      {/* Legacy: Talented */}
      {talented && (
        <div className="panel flex flex-wrap items-center gap-x-3.5 gap-y-2.5 px-3.5 py-2.5 text-sm" style={{ background: "linear-gradient(90deg, rgb(var(--gold) / .09), rgb(var(--panel) / .85))" }}>
          <span className="h-[34px] w-[34px] rounded border border-gold/50" style={iconStyle(icons, talented.icon)} />
          <div className="grid min-w-0">
            <b className="font-semibold">{talented.name}</b>
            <span className="text-xs text-muted">{t("legacy_hint")}</span>
          </div>
          <div className="flex overflow-hidden rounded-md border border-edge">
            {[0, ...talented.tiers.map((_, i) => i + 1)].map((k) => (
              <button
                key={k}
                onClick={() => (calc.setLegacy(k), sfx("click"))}
                title={k ? t("legacy_tier", { k, l: talented.tiers[k - 1].start }) : ""}
                className={`min-w-[38px] px-2 py-1.5 font-mono ${k === s.legacy ? "bg-gold/25 text-ink" : "text-muted hover:text-ink"}`}
              >
                {k || t("legacy_none")}
              </button>
            ))}
          </div>
          <span className="min-w-0 flex-[1_1_260px] text-[13px] text-muted">{lgEff}</span>
        </div>
      )}

      {flagsLive && flags && (
        <div className="panel flex flex-wrap items-center gap-3 border-bad/60 px-3.5 py-2.5 text-sm">
          <b>{t("fl_banner", { n: flags.name })}</b>
          <span className="flex items-center gap-1.5 text-muted">
            <span className="inline-block h-3 w-3 rounded-sm bg-bad" />{t("fl_changed")}
            <span className="ml-2 inline-block h-3 w-3 rounded-sm bg-[#ff9a3c]" />{t("fl_chain")}
          </span>
          <button className="btn ml-auto" onClick={() => calc.setFlags(null)}>{t("fl_hide")}</button>
        </div>
      )}

      {calc.np && notes && (
        <div className="npbar">
          <span><b>{t("np_title", { d: new Date(notes.source.posted).toLocaleDateString(lang === "ru" ? "ru-RU" : "en-GB", { day: "numeric", month: "long" }) })}</b> {t("np_text")}</span>
          <span className="flex items-center gap-1.5 text-[12.5px] text-muted">
            <i className="inline-block h-3 w-3 rounded-[3px] border-2 border-dashed border-[#c79bff]" />{t("np_new")}
            <i className="ml-1.5 inline-block h-3 w-3 rounded-[3px] border-2 border-[#c79bff]" />{t("np_chg")}
          </span>
          <button className="btn ml-auto" onClick={() => calc.leaveNp()}>{t("np_off")}</button>
        </div>
      )}

      {!calc.np && (
        <NotesBar
          news={news?.topics} N={notes} c={c} build={D.build} seen={notesSeen}
          onSeen={(k) => (store.set("notesSeen", k), setNotesSeen(k))}
          onGo={() => (setNotesOpen(true), requestAnimationFrame(() => document.getElementById("class-notes")?.scrollIntoView({ behavior: smooth(), block: "start" })))}
        />
      )}

      <PlanBar calc={calc} />

      {left < 0 && <p className="text-sm text-bad">{t("over_budget", { l: s.level, n: -left })}</p>}

      {/* trees + plan rail, the plan exactly as tall as the trees */}
      <div className={`grid gap-3 ${planner || skillsOpen ? "xl:grid-cols-[minmax(0,1fr)_330px]" : "xl:grid-cols-[minmax(0,1fr)_44px]"}`}>
        <div className="min-w-0">
          <div className="mb-2 flex gap-1 md:hidden">
            {c.tabs.map((tb, i) => (
              <button key={tb.id} onClick={() => setMobileTab(i)} className={`btn min-w-0 flex-1 justify-center px-1 text-xs ${i === mobileTab ? "text-gold" : ""}`}>
                <span className="truncate">{tb.name}</span> {split[i]}
              </button>
            ))}
          </div>
          <div ref={trees} className="trees grid gap-3 md:grid-cols-3">
            {c.tabs.map((_, i) => (
              <div key={i} className={i === mobileTab ? "" : "hidden md:block"}>
                <TalentTree
                  c={c} ti={i} M={M} ranks={shown} full={s.ranks} preview={preview != null} total={total} icons={icons}
                  marks={marks} touch={touch}
                  onAdd={add} onRemove={remove} onReset={() => (calc.resetTab(i), sfx("remove"))}
                  onHover={(x, el) => setTip(x && el ? { kind: "tal", x, el } : null)}
                  onTap={(x) => setSheet({ kind: "tal", x, el: document.body })}
                />
              </div>
            ))}
          </div>
        </div>

        {planner || skillsOpen ? (
          <aside className="relative min-h-[420px] max-xl:h-[600px]">
            <div className="absolute inset-0 flex flex-col gap-2">
              {planner ? (
                <section className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-edge/70 bg-panel/90">
                  <Planner
                    calc={calc} icons={icons} touch={touch}
                    onClose={() => setPlanner(false)} onRowHover={setRowHover} onProblem={problem}
                    onAuto={() => (calc.autoOrder(), toast(t("pl_auto_done")), sfx("click"))}
                  />
                </section>
              ) : (
                <button className="bar-collapsed" onClick={() => setPlanner(true)}>
                  <span className="text-gold" aria-hidden="true">«</span>{t("pl_title")}
                  <span className="ml-auto font-mono text-xs text-[#ffd100]">{s.order.length || ""}</span>
                </button>
              )}
              {skillsOpen ? (
                <section className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-edge/70 bg-panel/90">
                  <Skills
                    calc={calc} icons={icons} abilities={abil?.classes?.[c.token] || []} links={links} touch={touch}
                    onClose={() => setSkills(false)}
                    onSkill={(a, el) => (touch ? setSheet(a && el ? { kind: "ab", a, el } : null) : setTip(a && el ? { kind: "ab", a, el } : null))}
                  />
                </section>
              ) : (
                <button className="bar-collapsed" onClick={() => setSkills(true)}>
                  <span className="text-gold" aria-hidden="true">«</span>{t("sk_title")}
                </button>
              )}
            </div>
          </aside>
        ) : (
          <div className="hidden flex-col gap-2 xl:flex">
            <button className="rail flex flex-1" onClick={() => setPlanner(true)}>
              <span className="text-lg leading-none text-gold" aria-hidden="true">«</span>
              <span className="text-[13.5px] font-medium [writing-mode:vertical-rl]">{t("pl_title")}</span>
              <span className="font-mono text-xs text-[#ffd100]">{s.order.length || ""}</span>
            </button>
            <button className="rail flex flex-1" onClick={() => setSkills(true)}>
              <span className="text-lg leading-none text-gold" aria-hidden="true">«</span>
              <span className="text-[13.5px] font-medium [writing-mode:vertical-rl]">{t("sk_title")}</span>
            </button>
          </div>
        )}
      </div>

      <p className="max-w-[90ch] text-xs leading-relaxed text-muted">
        {left < 0 ? t("tc_over", { l: s.level }) + ". " : ""}{t("data_note", { b: D.build })}
      </p>

      {notes && !calc.np && (
        <ClassNotes N={notes} c={c} M={M} icons={icons} build={D.build} open={notesOpen} setOpen={setNotesOpen} onTalent={showTalent} />
      )}

      {base && (
        <Saves
          D={base} c={c} level={s.level} legacy={s.legacy} ranks={s.ranks} order={s.order} split={split} icons={icons}
          np={calc.np} activeSave={calc.activeSave} setActiveSave={calc.setActiveSave} clearFlags={() => calc.setFlags(null)} toast={toast}
          onOpen={(sv) => {
            const r = calc.openSave(sv);
            sfx("open");
            if (!r) return;
            const per = [0, 0, 0];
            for (const [id] of Object.entries(r.a.ranks)) {
              const x = r.cls.tabs.findIndex((tb) => tb.talents.some((y) => y.id === +id));
              if (x >= 0) per[x] += r.a.ranks[+id];
            }
            setMobileTab(per.indexOf(Math.max(...per)));
            window.scrollTo({ top: 0, behavior: smooth() });
          }}
        />
      )}

      {createPortal(
        <>
      {tip && !sheet && (
        <TipBox el={tip.el} zone={tip.kind === "tal" ? trees.current : null}>
          {tip.kind === "tal" ? talentTip(tip.x, true) : <AbilityTip a={tip.a} M={M} ranks={shown} />}
        </TipBox>
      )}

      {/* phones: a bottom sheet with + and − instead of hover and right click */}
      {sheet && (
        <div className="sheet wow-tip">
          {sheet.kind === "tal" ? (
            <>
              {talentTip(M[sheet.x.id], false)}
              <div className="mt-3 flex gap-2">
                <button className="btn flex-1 justify-center" disabled={!canRemove(M[sheet.x.id], c, M, s.ranks)} onClick={() => remove(sheet.x.id)}>− {t("tc_remove")}</button>
                <button className="btn-primary flex-1 justify-center" disabled={!canAdd(M[sheet.x.id], c, M, s.ranks, total)} onClick={() => add(sheet.x.id)}>+ {t("tc_add")}</button>
              </div>
            </>
          ) : <AbilityTip a={sheet.a} M={M} ranks={shown} />}
        </div>
      )}

      <AnimatePresence>
        {msg && (
          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
            className="panel fixed bottom-6 left-1/2 z-[70] max-w-[90vw] -translate-x-1/2 px-4 py-2 text-sm text-gold"
          >
            {msg}
          </motion.div>
        )}
      </AnimatePresence>
        </>,
        document.body,
      )}
    </div>
  );
}
