import { motion } from "framer-motion";
import type { MouseEvent } from "react";
import { canAdd, gateOk, isMilestone, reqOk, type ClassData, type PlacedTalent, type Ranks, type TalentIndex } from "../../engine";
import { iconStyle, type Icons } from "../../lib/gameData";
import { useI18n } from "../../lib/i18n";

const ROWS = 7;
const COLS = 4;

interface Props {
  c: ClassData;
  ti: number;
  M: TalentIndex;
  ranks: Ranks;
  total: number;
  spentTab: number;
  icons?: Icons;
  onAdd: (id: number) => void;
  onRemove: (id: number) => void;
  onReset: () => void;
  onHover: (x: PlacedTalent | null, el?: HTMLElement) => void;
}

export function TalentTree({ c, ti, M, ranks, total, spentTab, icons, onAdd, onRemove, onReset, onHover }: Props) {
  const { t } = useI18n();
  const tb = c.tabs[ti];
  const xs = tb.talents.map((x) => M[x.id]);
  const cx = (col: number) => ((col + 0.5) / COLS) * 100;
  const cy = (row: number) => ((row + 0.5) / ROWS) * 100;

  const click = (x: PlacedTalent) => (e: MouseEvent) => {
    e.preventDefault();
    if (e.type === "contextmenu" || e.shiftKey) onRemove(x.id);
    else onAdd(x.id);
  };

  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center gap-2 border-b border-edge/60 bg-bg/60 px-3 py-2">
        <span className="h-6 w-6 rounded border border-gold/50" style={iconStyle(icons, tb.icon)} />
        <span className="font-display font-semibold tracking-wider text-gold">{tb.name}</span>
        <button className="ml-2 text-xs text-muted hover:text-bad" onClick={onReset}>{t("reset_tab")}</button>
        <span className="ml-auto font-display text-lg text-ink">{spentTab}</span>
      </div>
      <div
        className="relative mx-auto aspect-[4/7] w-full max-w-[300px] bg-cover bg-center p-1"
        style={{ backgroundImage: `linear-gradient(rgb(0 0 0 / .35), rgb(0 0 0 / .55)), url(/data/trees/${tb.id}.jpg)` }}
      >
        {/* prerequisite arrows */}
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          {xs.flatMap((x) =>
            (x.requires || []).filter((id) => M[id]?.tab === ti).map((id) => {
              const p = M[id];
              const on = (ranks[p.id] || 0) >= p.max;
              const d = p.row === x.row
                ? `M${cx(p.col)} ${cy(p.row)} H${cx(x.col)}`
                : `M${cx(p.col)} ${cy(p.row)} H${cx(x.col)} V${cy(x.row)}`;
              return (
                <path key={`${id}-${x.id}`} d={d} fill="none" vectorEffect="non-scaling-stroke"
                  stroke={on ? "rgb(var(--gold))" : "rgb(120 120 120 / .7)"} strokeWidth={on ? 4 : 3}
                  style={on ? { filter: "drop-shadow(0 0 4px rgb(var(--gold)))" } : undefined} />
              );
            }),
          )}
        </svg>
        <div className="relative grid h-full grid-cols-4 grid-rows-7">
          {xs.map((x) => {
            const r = ranks[x.id] || 0;
            const open = gateOk(x, ranks) && reqOk(x, M, ranks);
            const can = canAdd(x, c, M, ranks, total);
            const cls = r ? "has" : can ? "can" : open && r < x.max ? "" : "locked";
            return (
              <div key={x.id} className="flex items-center justify-center" style={{ gridColumn: x.col + 1, gridRow: x.row + 1 }}>
                <motion.button
                  whileHover={{ scale: 1.08 }}
                  whileTap={{ scale: 0.92 }}
                  className={`slot ${cls} ${isMilestone(x) ? "milestone" : ""}`}
                  style={iconStyle(icons, x.icon)}
                  onClick={click(x)}
                  onContextMenu={click(x)}
                  onKeyDown={(e) => (e.key === "-" || e.key === "Backspace") && (e.preventDefault(), onRemove(x.id))}
                  onMouseEnter={(e) => onHover(x, e.currentTarget)}
                  onMouseLeave={() => onHover(null)}
                  onFocus={(e) => onHover(x, e.currentTarget)}
                  onBlur={() => onHover(null)}
                  aria-label={`${x.name} ${r}/${x.max}`}
                >
                  <span className="rk">{r}/{x.max}</span>
                </motion.button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
