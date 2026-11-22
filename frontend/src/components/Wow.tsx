/** Small WoW pieces shared by the character and auction pages: money, item icon, item tooltip. */
import { Component, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../lib/i18n";
import { media, qColor, useItem, type EquipItem, type ItemInfo, type ItemSet } from "../lib/wowApi";
import { TipBox } from "../pages/talents/Tooltip";

/** Copper as gold, silver and copper, colored like the game's money frame. */
export function Money({ c, className = "" }: { c: number | null | undefined; className?: string }) {
  if (c == null) return <span className={className}>—</span>;
  const g = Math.floor(c / 10000), s = Math.floor(c / 100) % 100, cu = c % 100;
  const part = (v: number, color: string, unit: string) => (
    <span className="whitespace-nowrap">{v}<span style={{ color }} className="ml-px text-[0.8em]">{unit}</span></span>
  );
  return (
    <span className={`inline-flex gap-1 font-mono tabular-nums ${className}`}>
      {g > 0 && part(g, "#ffd100", "g")}
      {(g > 0 || s > 0) && part(s, "#c7c7cf", "s")}
      {part(cu, "#e0915a", "c")}
    </span>
  );
}

/** Parse "1g 20s 5c", "1.2005" style input back to copper; plain numbers are gold. */
export function parseMoney(text: string): number | null {
  const t = text.trim().toLowerCase().replace(",", ".");
  if (!t) return null;
  const parts = [...t.matchAll(/(\d+(?:\.\d+)?)\s*([gsc]|з|с|м)?/g)];
  if (!parts.length) return null;
  let c = 0;
  for (const [, n, u] of parts) {
    const v = parseFloat(n);
    c += u === "s" || u === "с" ? v * 100 : u === "c" || u === "м" ? v : v * 10000;
  }
  return Math.round(c);
}

/** An item's icon; when the saved one is missing and the item is known, it is asked for once more. */
export function ItemIcon({ src, quality, size = 36, itemId }: { src?: string | null; quality?: string | null; size?: number; itemId?: number }) {
  const { lang } = useI18n();
  const q = useItem(!src && itemId ? itemId : null, lang);
  src = src || q.data?.icon;
  return (
    <span
      className="inline-block flex-none rounded-[4px] bg-black/60 bg-cover bg-center"
      style={{
        width: size, height: size,
        backgroundImage: src ? `url(${media(src)})` : undefined,
        boxShadow: `0 0 0 1px #000, 0 0 0 2px ${qColor(quality) ?? "#555"}88`,
      }}
    />
  );
}

/** A set in an item's tooltip, as the game shows it: name (worn/total), the pieces, then the bonuses. */
export function SetBonus({ set }: { set: ItemSet }) {
  return (
    <div className="mt-2 space-y-0.5 text-[13px]">
      <div className="text-[#ffd100]">{set.name} ({set.worn}/{set.items.length})</div>
      {set.items.map((x) => (
        <div key={x.name} className={`pl-3 ${x.equipped ? "text-[#ffff98]" : "text-[#808080]"}`}>{x.name}</div>
      ))}
      <div className="pt-1" />
      {set.effects.map((e) => (
        <div key={e.text} className={(e.count ?? 99) <= set.worn ? "text-[#1eff00]" : "text-[#808080]"}>{e.text}</div>
      ))}
    </div>
  );
}

/** Extra lines under an equipped item's tooltip: its enchants (green) and its set. */
export function EquipExtra({ x }: { x: EquipItem }) {
  const ench = (x.enchants || []).filter((e) => typeof e === "string");
  if (!ench.length && !x.setInfo) return null;
  return (
    <>
      {ench.map((e) => <div key={e} className="text-[#1eff00]">{e}</div>)}
      {x.setInfo && <SetBonus set={x.setInfo} />}
    </>
  );
}

/** A tooltip that fails renders nothing instead of taking the whole page down with it. */
class TipBoundary extends Component<{ children: ReactNode }, { bad: boolean }> {
  state = { bad: false };
  static getDerivedStateFromError() {
    return { bad: true };
  }
  render() {
    return this.state.bad ? null : this.props.children;
  }
}

/** Only strings and numbers reach the page: Blizzard sometimes sends a text as {en_US, ru_RU}. */
const str = (v: unknown): string | null => (typeof v === "string" || typeof v === "number" ? String(v) : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter((x): x is string => !!x) : []);

export function ItemTip({ it, extra }: { it: ItemInfo; extra?: ReactNode }) {
  const { t } = useI18n();
  it = {
    ...it, name: str(it.name) ?? "", binding: str(it.binding), slot: str(it.slot) ?? undefined,
    subclass: str(it.subclass) ?? undefined, damage: str(it.damage) ?? undefined, speed: str(it.speed) ?? undefined,
    armor: str(it.armor) ?? undefined, description: str(it.description) ?? undefined,
    stats: strs(it.stats), spells: strs(it.spells),
    level: typeof it.level === "number" ? it.level : undefined, required: typeof it.required === "number" ? it.required : undefined,
    sell: typeof it.sell === "number" ? it.sell : undefined,
  };
  return (
    <>
      <h4 style={{ color: qColor(it.quality) }}>{it.name}</h4>
      {it.level ? <div className="text-[#ffd100]">{t("item_lvl", { l: it.level })}</div> : null}
      {it.binding && <div>{it.binding}</div>}
      {(it.slot || it.subclass) && (
        <div className="flex justify-between gap-4"><span>{it.slot}</span><span>{it.subclass}</span></div>
      )}
      {it.damage && <div className="flex justify-between gap-4"><span>{it.damage}</span><span>{it.speed}</span></div>}
      {it.armor && <div>{it.armor}</div>}
      {it.stats.map((s) => <div key={s}>{s}</div>)}
      {it.required ? <div>{t("item_req", { l: it.required })}</div> : null}
      {it.spells.map((s) => <div key={s} className="text-[#1eff00]">{s}</div>)}
      {it.description && <div className="text-[#ffd100]">“{it.description}”</div>}
      {extra}
      {it.sell ? <div className="mt-1 flex items-center gap-1.5 text-muted">{t("item_sell")} <Money c={it.sell} /></div> : null}
      {it.source === "foreverdb" && <div className="mt-1.5 text-[11px] text-muted">{t("item_from_fdb")}</div>}
    </>
  );
}

/**
 * Hover (or focus) target that shows an item tooltip, loading the item on first hover.
 * `fallback` (what we already know, e.g. from a character's equipment) is shown while the item
 * loads, when Blizzard refuses it, or when only its icon came back.
 */
export function ItemHover({ id, children, extra, fallback }: { id: number; children: ReactNode; extra?: ReactNode; fallback?: ItemInfo }) {
  const { lang } = useI18n();
  const [el, setEl] = useState<HTMLElement | null>(null);
  const q = useItem(el ? id : null, lang);
  const full = q.data && !(q.data as ItemInfo & { partial?: boolean }).partial ? q.data : undefined;
  const shown = full ?? fallback;
  return (
    <span
      className="contents"
      onMouseOver={(e) => setEl(e.currentTarget.firstElementChild as HTMLElement)}
      onMouseLeave={() => setEl(null)}
      onFocus={(e) => setEl(e.target as HTMLElement)}
      onBlur={() => setEl(null)}
    >
      {children}
      {el && shown && createPortal(<TipBoundary><TipBox el={el}><ItemTip it={shown} extra={extra} /></TipBox></TipBoundary>, document.body)}
    </span>
  );
}

/** A small line chart of prices; the dashed line is the alert threshold. */
export function Sparkline({ points, below, w = 120, h = 32 }: { points: number[]; below?: number | null; w?: number; h?: number }) {
  if (points.length < 2) return <span className="text-xs text-muted">—</span>;
  const lo = Math.min(...points, below ?? Infinity), hi = Math.max(...points, below ?? -Infinity);
  const y = (v: number) => (hi === lo ? h / 2 : h - 2 - ((v - lo) / (hi - lo)) * (h - 4));
  const x = (i: number) => (i / (points.length - 1)) * (w - 2) + 1;
  const d = points.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  return (
    <svg width={w} height={h} className="overflow-visible" aria-hidden>
      {below != null && <line x1={0} x2={w} y1={y(below)} y2={y(below)} stroke="rgb(var(--bad))" strokeDasharray="3 3" strokeWidth={1} />}
      <path d={d} fill="none" stroke="#ffd100" strokeWidth={1.5} />
      <circle cx={x(points.length - 1)} cy={y(points[points.length - 1])} r={2.2} fill="#ffd100" />
    </svg>
  );
}
