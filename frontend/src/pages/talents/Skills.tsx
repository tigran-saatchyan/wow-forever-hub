import { useState } from "react";
import { levelsOf } from "../../engine";
import { iconStyle, type AbilityRow, type Icons } from "../../lib/gameData";
import { useI18n } from "../../lib/i18n";
import { store } from "../../lib/store";
import type { Calc } from "./useCalculator";

/** A spell in the skills list: from the trainer, or learned through a talent (fromTalent = node id). */
export interface SkillRow extends AbilityRow {
  fromTalent?: number;
}

interface Props {
  calc: Calc;
  icons?: Icons;
  abilities: AbilityRow[];
  links: Record<string, number[]>;
  touch: boolean;
  onClose: () => void;
  onSkill: (a: SkillRow | null, el?: HTMLElement) => void;
}

/**
 * Trainer spells by level, plus active talents of the build at the level the plan takes them.
 * Hovering a spell lights up the talents that modify it.
 */
export function Skills({ calc, icons, abilities, links, touch, onClose, onSkill }: Props) {
  const { t } = useI18n();
  const { s, c, M, start, preview } = calc;
  const [onlyTal, setOnlyTal] = useState(() => store.get("skOnlyTal", false));
  if (!s || !c) return null;

  // talent-only trainer ranks (Mutilate 2, Hemorrhage 2...) show up only if the build has the talent
  const rows: SkillRow[] = abilities.filter((x) => !x.t || (s.ranks[x.t] || 0) > 0);
  for (const id of new Set(s.order)) {
    const x = M[id];
    if (!x || x.meta?.passive) continue;
    const lv = levelsOf(s.order, id, start)[0];
    rows.push({ l: lv, s: x.spell, n: x.name, r: 1, i: x.icon, d: x.ranks[0], a: links[id] || [], fromTalent: id });
  }
  const shown = onlyTal ? rows.filter((x) => x.fromTalent || x.t) : rows;
  const by = new Map<number, SkillRow[]>();
  for (const x of shown.sort((a, b) => a.l - b.l || Number(!!b.fromTalent) - Number(!!a.fromTalent)))
    (by.get(x.l) ?? by.set(x.l, []).get(x.l)!).push(x);
  const curLv = preview != null ? start + preview : null;

  return (
    <div className="planner">
      <header>
        <h2 className="font-display text-lg text-gold">{t("sk_title")}</h2>
        <div className="ml-auto flex gap-1">
          <button className="btn px-2 py-1 text-xs" aria-pressed={onlyTal} title={t("sk_only_tal_t")}
            onClick={() => (store.set("skOnlyTal", !onlyTal), setOnlyTal(!onlyTal))}>
            {t("sk_only_tal")}
          </button>
          <button className="btn px-2 py-1 text-xs" title={t("pl_hide")} aria-label={t("pl_hide")} onClick={onClose}>»</button>
        </div>
      </header>
      {!by.size ? <p className="text-sm text-muted">{t("sk_empty")}</p> : (
        <ol className="text-sm">
          {[...by.entries()].map(([l, xs]) => (
            <li key={l} className={`grid grid-cols-[34px_minmax(0,1fr)] items-start gap-1.5 rounded px-1.5 py-[3px] ${curLv != null && l > curLv ? "opacity-40" : ""}`}>
              <span className={`font-mono text-[11.5px] leading-[22px] ${xs.some((x) => x.fromTalent) ? "text-[#ffd100]" : "text-muted"}`}>{l}</span>
              <span className="flex flex-wrap gap-1">
                {xs.map((x) => (
                  <span
                    key={(x.fromTalent ? "t" : "a") + x.s + "-" + x.r}
                    className={`ab ${x.fromTalent ? "ab-tal" : ""}`}
                    tabIndex={0}
                    onMouseEnter={(e) => !touch && onSkill(x, e.currentTarget)}
                    onMouseLeave={() => !touch && onSkill(null)}
                    onFocus={(e) => onSkill(x, e.currentTarget)}
                    onBlur={() => onSkill(null)}
                    onClick={(e) => touch && (e.stopPropagation(), onSkill(x, e.currentTarget))}
                  >
                    <span className="h-[18px] w-[18px] flex-none rounded-[3px]" style={iconStyle(icons, x.i)} />
                    <span className="truncate">{x.n}</span>
                    {!x.fromTalent && <span className="ab-rank" title={t("ab_rank", { r: x.r, l: x.l })}>{t("sk_rank", { r: x.r })}</span>}
                    {(x.fromTalent || x.t) && <span className="ab-badge" title={t(x.fromTalent ? "sk_from_tal" : "ab_talent")}>{t("sk_badge")}</span>}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
