import type { MouseEvent } from "react";
import { canAdd, isMilestone, type ClassData, type PlacedTalent, type Ranks, type TalentIndex } from "../../engine";
import { iconStyle, type Icons } from "../../lib/gameData";
import { useI18n } from "../../lib/i18n";
import type { Flags } from "./useCalculator";

/** Gaps between cells in cell units: must match --cg / --rg of .tgrid in styles.css */
const CG = 0.62;
const RG = 0.42;
const W = 4 + 3 * CG;
const H = 7 + 6 * RG;
const cx = (col: number) => col * (1 + CG) + 0.5;
const top = (row: number) => row * (1 + RG);

export interface TreeMarks {
  /** first plan level per talent (only while the plan is open and not previewing) */
  levels: Map<number, number>;
  changed: Set<number>;
  pending: Set<number>;
  flags: Flags | null;
  hl: number | null;
  flash: number | null;
  aff: Set<number>;
}

interface Props {
  c: ClassData;
  ti: number;
  M: TalentIndex;
  /** ranks shown (the plan step in "view at level") */
  ranks: Ranks;
  /** ranks of the whole build */
  full: Ranks;
  preview: boolean;
  total: number;
  icons?: Icons;
  marks: TreeMarks;
  touch: boolean;
  onAdd: (id: number) => void;
  onRemove: (id: number) => void;
  onReset: () => void;
  onHover: (x: PlacedTalent | null, el?: HTMLElement) => void;
  onTap: (x: PlacedTalent) => void;
}

export function TalentTree({ c, ti, M, ranks, full, preview, total, icons, marks, touch, onAdd, onRemove, onReset, onHover, onTap }: Props) {
  const { t } = useI18n();
  const tb = c.tabs[ti];
  const xs = tb.talents.map((x) => M[x.id]);
  const spentTab = xs.reduce((a, x) => a + (ranks[x.id] || 0), 0);

  const click = (x: PlacedTalent) => (e: MouseEvent) => {
    e.preventDefault();
    if (touch) return onTap(x);
    if (e.type === "contextmenu" || e.shiftKey) onRemove(x.id);
    else onAdd(x.id);
  };

  return (
    <div className="wow-tree" data-tab={ti}>
      <div className="art" style={{ backgroundImage: `url(/data/trees/${tb.id}.jpg)` }} />
      <header>
        <span className="tico" style={iconStyle(icons, tb.icon)} />
        <h3>{tb.name}</h3>
        <button className="reset" onClick={onReset}>{t("reset_tab")}</button>
        <span className="sp">{spentTab}</span>
      </header>
      <div className="body">
        <div className={`tgrid ${marks.aff.size ? "affing" : ""}`}>
          <svg className="arrows" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
            <defs>
              {[0, 1].map((o) => (
                <marker key={o} id={`ah${o}-${ti}`} className={o ? "on" : ""} viewBox="0 0 10 10" refX="6" refY="5"
                  markerWidth="2.6" markerHeight="2.6" orient="auto-start-reverse">
                  <path d="M0 0L10 5L0 10z" />
                </marker>
              ))}
            </defs>
            {xs.flatMap((x) =>
              (x.requires || []).filter((id) => M[id]?.tab === ti).map((id) => {
                const p = M[id];
                const on = (ranks[p.id] || 0) >= p.max;
                let d: string;
                if (p.col === x.col) d = `M${cx(p.col)} ${top(p.row) + 1.04}V${top(x.row) - 0.1}`;
                else {
                  const dir = x.col > p.col ? 1 : -1;
                  d = p.row === x.row
                    ? `M${cx(p.col) + dir * 0.54} ${top(p.row) + 0.5}H${cx(x.col) - dir * 0.62}`
                    : `M${cx(p.col) + dir * 0.54} ${top(p.row) + 0.5}H${cx(x.col)}V${top(x.row) - 0.1}`;
                }
                return <path key={`${id}-${x.id}`} className={on ? "on" : ""} d={d} markerEnd={`url(#ah${on ? 1 : 0}-${ti})`} />;
              }),
            )}
          </svg>
          {xs.map((x) => {
            const r = ranks[x.id] || 0;
            const all = full[x.id] || 0;
            const ghost = preview && all > r;
            const st = r >= x.max ? "max" : r > 0 ? "some" : ghost ? "" : canAdd(x, c, M, ranks, total) ? "avail" : "";
            const fl = !r ? marks.flags?.items.get(x.id) : undefined;
            const lv = marks.levels.get(x.id);
            const cls = [
              "slot", st, ghost && "plan", x.np && "np-" + x.np, isMilestone(x) && "ms",
              fl && "flag-" + (fl.kind === "chain" ? "chain" : "changed"),
              marks.hl === x.id && "hl", marks.flash === x.id && "hl flash", marks.aff.has(x.id) && "aff",
            ].filter(Boolean).join(" ");
            return (
              <button
                key={x.id}
                data-id={x.id}
                className={cls}
                style={{ gridColumn: x.col + 1, gridRow: x.row + 1 }}
                onClick={click(x)}
                onContextMenu={click(x)}
                onKeyDown={(e) => (e.key === "-" || e.key === "Backspace") && (e.preventDefault(), onRemove(x.id))}
                onMouseEnter={(e) => !touch && onHover(x, e.currentTarget)}
                onMouseLeave={() => !touch && onHover(null)}
                onFocus={(e) => !touch && onHover(x, e.currentTarget)}
                onBlur={() => !touch && onHover(null)}
                aria-label={`${x.name} ${r}/${x.max}`}
              >
                <span className="ico" style={iconStyle(icons, x.icon)} />
                <span className="rk">{ghost ? all : r}/{x.max}</span>
                {lv != null && <span className="lvb">{lv}</span>}
                {fl ? <span className="flagx">{fl.kind === "chain" ? "!" : "×"}</span>
                  : marks.changed.has(x.id) && lv == null && <span className="chg" />}
                {marks.pending.has(x.id) && <span className="nb" />}
                {x.np === "add" && <span className="npnew">NEW</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
