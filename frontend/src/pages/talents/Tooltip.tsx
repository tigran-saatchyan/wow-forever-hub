import { useLayoutEffect, useRef, type ReactNode } from "react";
import { gateOk, levelsOf, type ClassData, type NoteItem, type PlacedTalent, type Ranks, type SaveFlag, type TalentIndex } from "../../engine";
import type { AbilityRow } from "../../lib/gameData";
import { useI18n } from "../../lib/i18n";

/** Strip client color codes and dim [[conditional]] text, as the prototype's fmtDesc does. */
export function Desc({ s }: { s: string }) {
  const clean = String(s ?? "").replace(/\|c[0-9A-Fa-f]{8}|\|r/g, "");
  return (
    <>
      {clean.split(/(\[\[[\s\S]*?\]\])/).map((p, i) =>
        p.startsWith("[[") ? <span key={i} className="opacity-55">{p.slice(2, -2)}</span> : p,
      )}
    </>
  );
}

const trim = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s);

/**
 * Tooltip above or below: first outside the trees (so no talent is covered), then next to the
 * hovered element, on the side with more room. Centered on the element horizontally.
 */
export function TipBox({ el, zone, children }: { el: HTMLElement; zone?: HTMLElement | null; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const tip = ref.current;
    if (!tip) return;
    const topLim = (document.querySelector("header")?.getBoundingClientRect().bottom || 0) + 8;
    const botLim = innerHeight - 8;
    const z = zone ? zone.getBoundingClientRect() : null;
    tip.style.width = "";
    if (z) {
      // a wider (so shorter) tooltip often fits in the free space above or below the trees
      for (const wd of [340, 460, 580]) {
        if (wd > innerWidth - 16) break;
        tip.style.width = wd + "px";
        const hh = tip.offsetHeight;
        if (z.top - hh - 10 >= topLim || z.bottom + 10 + hh <= botLim) break;
        tip.style.width = "";
      }
    }
    const r = el.getBoundingClientRect();
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8);
    let top: number;
    if (z && z.top - h - 10 >= topLim) top = z.top - h - 10;
    else if (z && z.bottom + 10 + h <= botLim) top = z.bottom + 10;
    else {
      const up = r.top - topLim;
      const down = botLim - r.bottom;
      if (up >= h + 12 && (up >= down || down < h + 12)) top = r.top - h - 12;
      else if (down >= h + 12) top = r.bottom + 12;
      else top = up > down ? Math.max(topLim, r.top - h - 12) : Math.min(botLim - h, r.bottom + 12);
    }
    tip.style.left = left + "px";
    tip.style.top = Math.max(8, top) + "px";
  });
  return (
    <div ref={ref} className="wow-tip pointer-events-none fixed z-50" style={{ left: -9999, top: 0 }}>
      {children}
    </div>
  );
}

function Affects({ ids, M, ranks }: { ids: number[]; M: TalentIndex; ranks: Ranks }) {
  const { t } = useI18n();
  const xs = ids.map((id) => M[id]).filter(Boolean);
  if (!xs.length) return null;
  return (
    <div className="aff-l">
      <span>{t("aff_title")}</span>{" "}
      {xs.map((y, i) => (
        <span key={y.id}>
          <b className={ranks[y.id] ? "on" : ""}>{y.name}{ranks[y.id] ? ` ${ranks[y.id]}/${y.max}` : ""}</b>
          {i < xs.length - 1 ? ", " : ""}
        </span>
      ))}
    </div>
  );
}

interface TalentTipProps {
  x: PlacedTalent;
  c: ClassData;
  M: TalentIndex;
  ranks: Ranks;
  order: number[];
  start: number;
  planner: boolean;
  changedIn?: string;
  pending: NoteItem[];
  links: number[];
  flag?: SaveFlag;
  flagName?: string;
  hint: boolean;
}

export function TalentTip({ x, c, M, ranks, order, start, planner, changedIn, pending, links, flag, flagName, hint }: TalentTipProps) {
  const { t } = useI18n();
  const r = ranks[x.id] || 0;
  const m = x.meta || {};
  const metaRows = [[m.cost, m.range], [m.cast, m.cd]].filter((p) => p[0] || p[1]);
  const reqs: string[] = [];
  if (x.gate && !gateOk(x, ranks)) reqs.push(t("req_points", { p: x.gate.points, t: c.tabs[x.tab].name }));
  for (const rid of x.requires || []) if (M[rid] && (ranks[rid] || 0) < M[rid].max) reqs.push(t("req_parent", { n: M[rid].name, m: M[rid].max }));
  const cur = r ? x.ranks[r - 1] : x.ranks[0];
  const next = r && r < x.max ? x.ranks[r] : null;
  const lv = planner ? levelsOf(order, x.id, start) : [];
  const flagKey = flag?.kind === "chain" ? "fl_tip_chain" : flag?.kind === "gone" ? "fl_tip_gone" : "fl_tip_changed";
  return (
    <>
      <h4>{x.name}</h4>
      <div className="r">{t("rank", { r, m: x.max })}{m.passive ? " · " + t("passive") : ""}</div>
      {metaRows.length > 0 && (
        <div className="meta">{metaRows.flatMap((p, i) => [<span key={i + "a"}>{p[0] || ""}</span>, <span key={i + "b"}>{p[1] || ""}</span>])}</div>
      )}
      {reqs.map((q) => <div key={q} className="req">{q}</div>)}
      <div className="d"><Desc s={cur} /></div>
      {next && (
        <div className="next"><div className="lbl">{t("next_rank")}</div><div className="d"><Desc s={next} /></div></div>
      )}
      {changedIn && <div className="chgnote">● {t("tc_changed", { b: changedIn })}</div>}
      {x.np
        ? (x.npNotes || []).slice(0, 3).map((n) => (
            <div key={n} className="note-x"><b>{t(x.np === "add" ? "np_tip_add" : "np_tip")}</b> {trim(n, 240)}</div>
          ))
        : pending.slice(0, 2).map((n) => <div key={n.t} className="note-x"><b>{t("cn_tip")}</b> {trim(n.t, 220)}</div>)}
      <Affects ids={links} M={M} ranks={ranks} />
      {lv.length > 0 && <div className="lvls">{t("pl_tip", { list: lv.map((l, i) => `${i + 1} — ${l}`).join(", ") })}</div>}
      {!r && flag && <div className="req mt-2">{t(flagKey, { n: flagName ?? "", r: flag.r })}</div>}
      {hint && <div className="hint">{t("tc_hint_desktop")}</div>}
    </>
  );
}

export function AbilityTip({ a, M, ranks }: { a: AbilityRow; M: TalentIndex; ranks: Ranks }) {
  const { t } = useI18n();
  return (
    <>
      <h4>{a.n}</h4>
      <div className="r">{t("ab_rank", { r: a.r, l: a.l })}{a.t ? " · " + t("ab_talent") : ""}</div>
      <div className="d"><Desc s={a.d || ""} /></div>
      <Affects ids={a.a || []} M={M} ranks={ranks} />
    </>
  );
}
