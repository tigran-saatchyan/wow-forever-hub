/** The characters list: favorites on top, the rest collapsible; reorder by dragging or with arrows. */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { ApiError } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { store } from "../../lib/store";
import { fullName, type Character } from "../../lib/wowApi";

type Row = Character & { favorite?: boolean };

async function saveLayout(b: { order: number[]; favorites: number[] }) {
  const r = await fetch("/api/characters/layout", {
    method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b),
  });
  if (!r.ok) throw new ApiError(r.status, r.statusText);
}

interface Props {
  chars: Row[];
  cur?: number;
  onSelect: (id: number) => void;
  icon: (c: Row) => ReactNode;
}

export function CharacterList({ chars, cur, onSelect, icon }: Props) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const [open, setOpen] = useState(() => store.get<boolean>("chOthersOpen", true));
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<{ id: number; after: boolean } | null>(null);
  const touch = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;
  const save = useMutation({ mutationFn: saveLayout, onError: () => qc.invalidateQueries({ queryKey: ["characters"] }) });

  const favs = chars.filter((c) => c.favorite);
  const rest = chars.filter((c) => !c.favorite);

  /** Apply a new list (order + favorite flags) at once, then store it on the server. */
  const commit = (rows: Row[]) => {
    const list = [...rows.filter((c) => c.favorite), ...rows.filter((c) => !c.favorite)];
    qc.setQueryData(["characters"], list);
    save.mutate({ order: list.map((c) => c.id), favorites: list.filter((c) => c.favorite).map((c) => c.id) });
  };
  const toggleFav = (id: number) => commit(chars.map((c) => (c.id === id ? { ...c, favorite: !c.favorite } : c)));
  const move = (id: number, dir: -1 | 1) => {
    const group = chars.find((c) => c.id === id)?.favorite ? favs : rest;
    const i = group.findIndex((c) => c.id === id), j = i + dir;
    if (j < 0 || j >= group.length) return;
    const g = group.slice();
    [g[i], g[j]] = [g[j], g[i]];
    commit(group === favs ? [...g, ...rest] : [...favs, ...g]);
  };
  /** Drop `from` before or after `to`; it joins the group of `to` (dragging into favorites stars it). */
  const drop = (from: number, to: number, after: boolean) => {
    if (from === to) return;
    const target = chars.find((c) => c.id === to)!;
    const moving = { ...chars.find((c) => c.id === from)!, favorite: target.favorite };
    const out = chars.filter((c) => c.id !== from);
    const k = out.findIndex((c) => c.id === to) + (after ? 1 : 0);
    out.splice(k, 0, moving);
    commit(out);
  };

  const item = (c: Row, group: Row[], i: number) => {
    const s = c.summary?.[lang];
    const line = over?.id === c.id && drag !== c.id ? (over.after ? "shadow-[0_2px_0_0_#ffd100]" : "shadow-[0_-2px_0_0_#ffd100]") : "";
    return (
      <li
        key={c.id}
        draggable={!touch}
        onDragStart={(e) => (setDrag(c.id), (e.dataTransfer.effectAllowed = "move"), e.dataTransfer.setData("text/plain", String(c.id)))}
        onDragEnd={() => (setDrag(null), setOver(null))}
        onDragOver={(e) => {
          if (drag == null) return;
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          setOver({ id: c.id, after: e.clientY > r.top + r.height / 2 });
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (drag != null && over) drop(drag, c.id, over.after);
          setDrag(null);
          setOver(null);
        }}
        className={`panel flex items-center gap-2 p-2 transition ${cur === c.id ? "!border-gold/70" : "hover:border-gold/40"} ${drag === c.id ? "opacity-40" : ""} ${line}`}
      >
        <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => onSelect(c.id)}>
          {icon(c)}
          <span className="grid min-w-0">
            <b className="truncate">{fullName(c, lang)}</b>
            <span className="truncate text-xs text-muted">
              {s ? `${t("ch_level", { l: s.level ?? "?" })} · ${s.className}` : c.error ? "!" : "…"} · {c.region.toUpperCase()}
            </span>
          </span>
        </button>
        <button
          className={`px-1 text-lg leading-none transition ${c.favorite ? "text-[#ffd100]" : "text-muted/50 hover:text-[#ffd100]"}`}
          title={t(c.favorite ? "ch_unfav" : "ch_fav")} aria-label={t(c.favorite ? "ch_unfav" : "ch_fav")} aria-pressed={!!c.favorite}
          onClick={() => toggleFav(c.id)}
        >
          {c.favorite ? "★" : "☆"}
        </button>
        <span className="flex flex-col gap-0.5">
          <button className="mvb !h-[18px] !w-6 text-[10px]" disabled={i === 0} title={t("pl_up")} aria-label={t("pl_up")} onClick={() => move(c.id, -1)}>↑</button>
          <button className="mvb !h-[18px] !w-6 text-[10px]" disabled={i === group.length - 1} title={t("pl_down")} aria-label={t("pl_down")} onClick={() => move(c.id, 1)}>↓</button>
        </span>
      </li>
    );
  };

  return (
    <div className="space-y-2">
      {favs.length > 0 && (
        <>
          <div className="eyebrow flex items-center gap-1.5 px-1"><span className="text-[#ffd100]">★</span>{t("ch_favs")}</div>
          <ul className="space-y-2">{favs.map((c, i) => item(c, favs, i))}</ul>
        </>
      )}
      {rest.length > 0 && (
        <>
          {favs.length > 0 && (
            <button
              className="eyebrow flex w-full items-center gap-1.5 px-1 pt-1 text-left hover:text-ink" aria-expanded={open}
              onClick={() => (store.set("chOthersOpen", !open), setOpen(!open))}
            >
              <span className="inline-block w-3">{open ? "▾" : "▸"}</span>{t("ch_others", { n: rest.length })}
            </button>
          )}
          {(open || !favs.length) && <ul className="space-y-2">{rest.map((c, i) => item(c, rest, i))}</ul>}
        </>
      )}
      {!touch && chars.length > 1 && <p className="px-1 text-[11px] text-muted">{t("ch_order_hint")}</p>}
    </div>
  );
}
