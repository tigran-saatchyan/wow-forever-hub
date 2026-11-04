import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { isMilestone, runsOf, type OrderProblem } from "../../engine";
import { iconStyle, type Icons } from "../../lib/gameData";
import { useI18n } from "../../lib/i18n";
import type { Calc } from "./useCalculator";

interface Props {
  calc: Calc;
  icons?: Icons;
  touch: boolean;
  onClose: () => void;
  onRowHover: (id: number | null) => void;
  onProblem: (p: OrderProblem) => void;
  onAuto: () => void;
}

export function Planner({ calc, icons, touch, onClose, onRowHover, onProblem, onAuto }: Props) {
  const { t } = useI18n();
  const { s, c, M, start, total, preview } = calc;
  const [info, setInfo] = useState(false);
  const [drag, setDrag] = useState<number | null>(null);
  const [drop, setDrop] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const prevLen = useRef(s?.order.length ?? 0);

  // one point just added: follow it down the list; the previewed row stays in view
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !s) return;
    const grew = s.order.length === prevLen.current + 1;
    prevLen.current = s.order.length;
    if (grew && preview == null) el.scrollTop = el.scrollHeight;
    const cur = el.querySelector<HTMLElement>('.prow[aria-current="true"]');
    if (cur) {
      const a = el.getBoundingClientRect();
      const r = cur.getBoundingClientRect();
      const h = el.querySelector("header")?.offsetHeight ?? 0;
      if (r.top < a.top + h) el.scrollTop -= a.top + h - r.top;
      else if (r.bottom > a.bottom) el.scrollTop += r.bottom - a.bottom;
    }
  }, [s, preview]);

  useEffect(() => {
    if (!info) return;
    const off = () => setInfo(false);
    document.addEventListener("click", off);
    return () => document.removeEventListener("click", off);
  }, [info]);

  if (!s || !c) return null;
  const runs = runsOf(s.order);
  const split = [0, 0, 0];
  const move = (from: number, before: number) => {
    const p = calc.move(from, before);
    if (p) onProblem(p);
  };
  const free = total - s.order.length;
  const lastLv = Math.min(60, start + 50);

  const items: ReactNode[] = [];
  runs.forEach((r, k) => {
    const x = M[r.id];
    const before = s.order.slice(0, r.start).filter((v) => v === r.id).length;
    split[x.tab] += r.len;
    const a = start + r.start;
    const b = a + r.len - 1;
    const cur = preview != null && preview >= r.start && preview < r.start + r.len;
    const rk = r.len > 1 ? `${before + 1}–${before + r.len}/${x.max}` : `${before + 1}/${x.max}`;
    items.push(
      <li
        key={"r" + r.start}
        className={`prow ${drag === k ? "dragging" : ""} ${drop === k ? "drop" : ""}`}
        aria-current={cur}
        draggable={!touch}
        onClick={() => {
          const end = r.start + r.len - 1;
          calc.setPreview(preview === end ? null : end);
        }}
        onMouseEnter={() => !touch && onRowHover(x.id)}
        onMouseLeave={() => !touch && onRowHover(null)}
        onDragStart={(e) => {
          setDrag(k);
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", String(k));
        }}
        onDragEnd={() => (setDrag(null), setDrop(null))}
        onDragOver={(e) => {
          if (drag == null) return;
          e.preventDefault();
          setDrop(k);
        }}
        onDragLeave={() => setDrop((d) => (d === k ? null : d))}
        onDrop={(e) => {
          e.preventDefault();
          const from = drag;
          setDrag(null);
          setDrop(null);
          const rect = e.currentTarget.getBoundingClientRect();
          if (from != null) move(from, e.clientY > rect.top + rect.height / 2 ? k + 1 : k);
        }}
      >
        <span className="font-mono text-[12.5px] font-semibold text-[#ffd100]">{a === b ? a : `${a}–${b}`}</span>
        <span className="h-[26px] w-[26px] rounded-[3px] shadow-[0_0_0_1px_#000]" style={iconStyle(icons, x.icon)} />
        <span className="grid min-w-0 leading-tight">
          <b className={`truncate font-medium ${isMilestone(x) ? "text-[#ffd100]" : ""}`}>{x.name}</b>
          <span className="truncate font-mono text-[11.5px] text-muted">{rk} · {c.tabs[x.tab].name} {split.join("/")}</span>
        </span>
        <span className="flex flex-col gap-0.5" onClick={(e) => e.stopPropagation()}>
          <button className="mvb !h-[18px] !w-6 text-[10px]" disabled={k === 0} title={t("pl_up")} aria-label={t("pl_up")} onClick={() => move(k, k - 1)}>↑</button>
          <button className="mvb !h-[18px] !w-6 text-[10px]" disabled={k === runs.length - 1} title={t("pl_down")} aria-label={t("pl_down")} onClick={() => move(k, k + 2)}>↓</button>
        </span>
      </li>,
    );
  });

  return (
    <div ref={box} className="planner">
      <header>
        <h2 className="font-display text-lg text-gold">{t("pl_title")}</h2>
        <button
          className={`pl-i ${info ? "open" : ""}`}
          type="button"
          aria-label={t("pl_about")}
          onClick={(e) => (e.stopPropagation(), setInfo(!info))}
        >
          i
        </button>
        <div className="pl-hint" role="tooltip">{t(touch ? "pl_hint_touch" : "pl_hint")}</div>
        <div className="ml-auto flex gap-1">
          <button className="btn px-2 py-1 text-xs" title={t("pl_auto")} disabled={!s.order.length} onClick={onAuto}>{t("pl_auto_s")}</button>
          <button className="btn px-2 py-1 text-xs" title={t("pl_hide")} aria-label={t("pl_hide")} aria-expanded="true" onClick={onClose}>»</button>
        </div>
      </header>
      {s.order.length ? (
        <ol className="text-sm">
          {items}
          {free > 0 && <li className="px-1.5 py-2 text-[12.5px] text-muted">{t("pl_free", { n: free, a: start + s.order.length, b: lastLv })}</li>}
        </ol>
      ) : (
        <p className="text-sm text-muted">{t("pl_empty")}</p>
      )}
    </div>
  );
}

/** The bar above the trees while viewing the build at one level of the plan. */
export function PlanBar({ calc }: { calc: Calc }) {
  const { t } = useI18n();
  const { s, start, preview } = calc;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (preview == null || (e.target as HTMLElement)?.closest?.("input,textarea")) return;
      if (e.key === "Escape") calc.setPreview(null);
      else if (e.key === "ArrowLeft") calc.setPreview(Math.max(0, preview - 1));
      else if (e.key === "ArrowRight") calc.setPreview(preview + 1);
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  });
  if (!s || preview == null) return null;
  const last = s.order.length - 1;
  const [pre, post] = t("pl_preview", { l: "\u0000", n: preview + 1, m: s.order.length }).split("\u0000");
  return (
    <div className="planbar">
      <span className="flex items-center gap-1.5">
        <button className="btn px-2 py-1" disabled={!preview} aria-label="−1" onClick={() => calc.setPreview(preview - 1)}>◀</button>
        <input
          type="range" className="w-36 accent-[#ffd100]" min={start} max={start + last} value={start + preview}
          aria-label={t("level")} onChange={(e) => calc.setPreview(+e.target.value - start)}
        />
        <button className="btn px-2 py-1" aria-label="+1" onClick={() => calc.setPreview(preview + 1)}>▶</button>
      </span>
      <span className="text-sm">{pre}<b className="text-[#ffd100]">{start + preview}</b>{post}</span>
      <button className="btn ml-auto" onClick={() => calc.setPreview(null)}>{t("pl_preview_exit")}</button>
    </div>
  );
}
