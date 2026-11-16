/** A character's talents as the three trees of the calculator, read-only, with a link to edit them there. */
import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { byId, type ClassData, type PlacedTalent } from "../../engine";
import { characterLink, mapTalents } from "../../lib/charTalents";
import { useIcons, useIndex } from "../../lib/gameData";
import { useI18n } from "../../lib/i18n";
import type { Character } from "../../lib/wowApi";
import { TalentTree, type TreeMarks } from "../talents/TalentTree";
import { TalentTip, TipBox } from "../talents/Tooltip";

const NO_MARKS: TreeMarks = {
  levels: new Map(), changed: new Set(), pending: new Set(), flags: null, hl: null, flash: null, aff: new Set(),
};
const noop = () => {};

export function TalentsTab({ c, k }: { c: Character; k?: ClassData }) {
  const { t, lang } = useI18n();
  const icons = useIcons();
  const idx = useIndex();
  const nav = useNavigate();
  const trees = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: PlacedTalent; el: HTMLElement } | null>(null);
  const M = useMemo(() => (k ? byId(k) : {}), [k]);
  if (!k) return <p className="text-sm text-muted">…</p>;
  if (c.missing?.includes("talents") || !c.talents) return <p className="text-sm text-muted">{t("ch_no_part")}</p>;

  const m = mapTalents(k, c.talents);
  const spent = Object.values(m.ranks).reduce((a, b) => a + b, 0);
  const split = k.tabs.map((tb) => tb.talents.reduce((a, x) => a + (m.ranks[x.id] || 0), 0));
  const level = c.summary?.[lang]?.level ?? null;
  const link = idx.data ? characterLink(k, c.talents, level, +idx.data.latest.split(".").pop()!) : null;
  const touch = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-display text-2xl text-gold">{split.join(" / ")}</span>
        <span className="text-sm text-muted">{t("ch_talents_spent", { n: spent })}</span>
        {m.matched < m.total && <span className="text-xs text-muted">{t("ch_talents_matched", { n: m.matched, m: m.total })}</span>}
        {link && (
          <button className="btn-primary ml-auto" onClick={() => nav(`/talents#${link.replace(/^#/, "")}`)}>{t("ch_open_calc")}</button>
        )}
      </div>
      <div ref={trees} className="grid gap-3 md:grid-cols-3">
        {k.tabs.map((_, i) => (
          <TalentTree
            key={i} c={k} ti={i} M={M} ranks={m.ranks} full={m.ranks} preview={false} total={spent} icons={icons.data}
            marks={NO_MARKS} touch={touch} readOnly
            onAdd={noop} onRemove={noop} onReset={noop} onTap={(x) => setTip({ x, el: document.body })}
            onHover={(x, el) => setTip(x && el ? { x, el } : null)}
          />
        ))}
      </div>
      {tip && createPortal(
        <TipBox el={tip.el} zone={trees.current}>
          <TalentTip x={tip.x} c={k} M={M} ranks={m.ranks} order={[]} start={10} planner={false} pending={[]} links={[]} hint={false} />
        </TipBox>,
        document.body,
      )}
    </div>
  );
}
