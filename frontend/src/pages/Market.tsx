import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { setActiveChar, useActiveCharId } from "../lib/activeChar";
import { useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { SourcePanel } from "../components/SourcePanel";
import { ItemHover, ItemIcon, Money, parseMoney, Sparkline } from "../components/Wow";
import { useMe } from "../lib/auth";
import { iconStyle, useIcons } from "../lib/gameData";
import { fmtDate, useI18n, type Key } from "../lib/i18n";
import { store } from "../lib/store";
import { qColor, useCharacter, useCharacters, wowApi, type AhList, type BisSale, type Region } from "../lib/wowApi";
import { Compare, qCol, useTrees } from "./throne/Bis";

/**
 * Forever has no realms: its auction houses come as five worlds of three (Alliance, Horde, Blackwater), the
 * same list for every ruleset. World 1 is PvP (matched in game on Horde #113). All the owner's characters are
 * Horde on PvP in Europe, so the hub reads only that world's Horde house or its neutral one.
 */
const REGION: Region = "eu";
const RULESET = 1;
const MINE = [
  { id: 113, key: "mk_s_horde" },
  { id: 116, key: "mk_s_neutral" },
] as const;

export function Market() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const me = useMe();
  const admin = me.data?.role === "superadmin";
  const cfg = useQuery({ queryKey: ["market", lang], queryFn: () => wowApi.market(lang) });
  const lists = useQuery({ queryKey: ["ah-lists", lang], queryFn: () => wowApi.lists(lang), refetchInterval: 5 * 60e3 });
  const pinned = (lists.data || []).filter((x) => x.pinned);
  const rest = (lists.data || []).filter((x) => !x.pinned);
  const [cur, setCur] = useState<number | null>(() => store.get<number | null>("ahList", null));
  const list: AhList | undefined = rest.find((x) => x.id === cur) ?? rest[0];
  const pickList = (id: number) => (setCur(id), store.set("ahList", id));
  const target = pinned[0] ?? list;  // where a BiS item's ☆ puts it

  const inv = () => (qc.invalidateQueries({ queryKey: ["market"] }), qc.invalidateQueries({ queryKey: ["ah-lists"] }),
    qc.invalidateQueries({ queryKey: ["bis-sale"] }));
  const save = useMutation({ mutationFn: wowApi.setMarket, onSuccess: () => wowApi.refreshMarket().then(inv) });
  const poll = useMutation({ mutationFn: wowApi.refreshMarket, onSuccess: inv });
  const newList = useMutation({ mutationFn: wowApi.addList, onSuccess: (x) => (pickList(x.id), inv()) });

  const st = cfg.data?.state;
  const sel = cfg.data?.selected;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-3xl text-gold">{t("mk_title")}</h1>
        <p className="text-sm text-muted">
          {!st?.at ? t("mk_never") : st.ok
            ? t("mk_last", { d: fmtDate(lang, st.at), n: st.items ?? 0, a: st.auctions ?? 0 })
            : t("mk_poll_err", { e: st.error ?? "?" })}
        </p>
      </div>

      {cfg.data && !cfg.data.configured && <p className="panel p-3 text-sm text-muted">{t("api_off")}</p>}

      {cfg.data?.configured && admin && (
        <div className="panel flex flex-wrap items-center gap-3 p-3 text-sm">
          <span className="eyebrow">{t("mk_mine")}</span>
          {MINE.map((h) => {
            const on = sel?.house === h.id && sel?.ruleset === RULESET && sel?.region === REGION;
            return (
              <button key={h.id} className={on ? "btn-primary" : "btn"} disabled={save.isPending || on}
                onClick={() => save.mutate({ region: REGION, ruleset: RULESET, house: h.id })}>
                {t(h.key)}
              </button>
            );
          })}
          {sel && <button className="btn ml-auto" disabled={poll.isPending} onClick={() => poll.mutate()}>{t("mk_refresh")}</button>}
          {!sel && <span className="text-muted">{t("mk_pick")}</span>}
          {cfg.data.error && <span className="text-bad">{cfg.data.error}</span>}
        </div>
      )}

      {/* pinned lists stand above everything */}
      {pinned.map((l) => (
        <Fold key={l.id} id={`list:${l.id}`} title={<>📌 {l.name} <span className="text-sm text-muted">{l.items.length}</span></>}>
          <ListBlock list={l} canDelete={(lists.data?.length ?? 0) > 1} onChanged={inv} />
        </Fold>
      ))}

      <BisOnSale onAdd={(id) => target && wowApi.addToList(target.id, { item_id: id, below: null }, lang).then(inv)} listName={target?.name} />

      <Fold id="lists" title={t("mk_lists")}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {rest.map((x) => (
            <button key={x.id} className={x.id === list?.id ? "btn-primary" : "btn"} onClick={() => pickList(x.id)}>
              {x.name} <span className="text-xs opacity-70">{x.items.length}</span>
            </button>
          ))}
          <button className="btn" onClick={() => { const n = ask(t("mk_list_new_q")); if (n) newList.mutate(n); }} title={t("mk_list_new")}>＋ {t("mk_list_new")}</button>
        </div>
        {list ? <ListBlock list={list} canDelete={(lists.data?.length ?? 0) > 1} onChanged={inv} />
          : <p className="text-sm text-muted">{lists.isLoading ? "…" : t("mk_lists_all_pinned")}</p>}
      </Fold>
    </div>
  );
}

const ask = (q: string, v = "") => prompt(q, v)?.trim().slice(0, 60) || null;

/** A block that folds; open or closed is remembered. `extra` sits in the header beside the title. */
function Fold({ id, title, extra, children }: { id: string; title: React.ReactNode; extra?: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(() => store.get(`mkOpen:${id}`, true));
  const toggle = () => { store.set(`mkOpen:${id}`, !open); setOpen(!open); };
  return (
    <section className="panel space-y-3 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="flex items-center gap-2" aria-expanded={open} onClick={toggle}>
          <span className={`text-gold transition-transform ${open ? "" : "-rotate-90"}`} aria-hidden>▾</span>
          <h2 className="font-display text-xl text-gold">{title}</h2>
        </button>
        {extra}
      </div>
      {open && children}
    </section>
  );
}

type Dir = 1 | -1;
/** Sorting by any column: a click picks the column, a second click turns the order around. */
function useSort<K extends string>(key: string, first: K) {
  const [s, setS] = useState<{ k: K; d: Dir }>(() => store.get(`mkSort:${key}`, { k: first, d: 1 as Dir }));
  const by = (k: K) => {
    const n = { k, d: (s.k === k ? -s.d : k === "gain" ? -1 : 1) as Dir };  // the biggest upgrade first
    setS(n);
    store.set(`mkSort:${key}`, n);
  };
  return { s, by };
}

function Th({ k, s, by, children, right }: { k: string; s: { k: string; d: Dir }; by: (k: never) => void; children: React.ReactNode; right?: boolean }) {
  return (
    <th className={`p-2 font-normal ${right ? "text-right" : ""}`}>
      <button className={`hover:text-gold ${s.k === k ? "text-gold" : ""}`} onClick={() => by(k as never)}>
        {children}{s.k === k ? (s.d === 1 ? " ▲" : " ▼") : ""}
      </button>
    </th>
  );
}

const cmp = (a: number | string | null | undefined, b: number | string | null | undefined) =>
  a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : typeof a === "string" ? a.localeCompare(String(b)) : (a as number) - (b as number);

/** One list: adding items (any: gear, potions, herbs), renaming, pinning, and its items sortable by any column. */
function ListBlock({ list, canDelete, onChanged }: { list: AhList; canDelete: boolean; onChanged: () => void }) {
  const { t, lang } = useI18n();
  const [q, setQ] = useState("");
  const [below, setBelow] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const { s, by } = useSort<"name" | "min" | "median" | "qty">("list", "name");
  const search = useQuery({
    queryKey: ["item-search", q, lang], queryFn: () => wowApi.searchItems(q.trim(), lang),
    enabled: q.trim().length >= 2, staleTime: 60e3, retry: false,
  });
  const add = useMutation({
    mutationFn: (id: number) => wowApi.addToList(list.id, { item_id: id, below: parseMoney(below) }, lang),
    onSuccess: () => (setQ(""), setBelow(""), onChanged()),
    onError: (e) => setMsg(String(e)),
  });
  const del = useMutation({ mutationFn: (iid: number) => wowApi.removeFromList(list.id, iid), onSuccess: onChanged });
  const rename = useMutation({ mutationFn: (name: string) => wowApi.renameList(list.id, name), onSuccess: onChanged });
  const pin = useMutation({ mutationFn: () => wowApi.pinList(list.id, !list.pinned), onSuccess: onChanged });
  const drop = useMutation({ mutationFn: () => wowApi.deleteList(list.id), onSuccess: onChanged });
  const val = (w: AhList["items"][number]) => ({
    name: w.item?.name ?? `#${w.itemId}`, min: w.latest?.min, median: w.latest?.median, qty: w.latest?.quantity,
  })[s.k];
  const items = [...list.items].sort((a, b) => cmp(val(a), val(b)) * s.d);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <input className="input w-64" placeholder={t("mk_search")} value={q} onChange={(e) => setQ(e.target.value)} />
        <input className="input w-52" placeholder={t("mk_below") + ": 1g 20s"} value={below} onChange={(e) => setBelow(e.target.value)} />
        {msg && <span className="text-bad" onClick={() => setMsg(null)}>{msg}</span>}
        <span className="ml-auto flex gap-1.5">
          <button className={list.pinned ? "btn-primary px-2" : "btn px-2"} onClick={() => pin.mutate()}
            title={t(list.pinned ? "mk_unpin" : "mk_pin")} aria-label={t(list.pinned ? "mk_unpin" : "mk_pin")}>📌</button>
          <button className="btn px-2" onClick={() => { const n = ask(t("mk_list_rename_q"), list.name); if (n) rename.mutate(n); }}
            title={t("mk_list_rename")} aria-label={t("mk_list_rename")}>✎</button>
          {canDelete && (
            <button className="btn px-2" title={t("mk_list_delete")} aria-label={t("mk_list_delete")}
              onClick={() => confirm(t("mk_list_delete_q", { n: list.name })) && drop.mutate()}>🗑</button>
          )}
        </span>
      </div>
      {q.trim().length >= 2 && (
        <ul className="flex flex-wrap gap-1.5">
          {(search.data || []).map((r) => (
            <li key={r.id}>
              <ItemHover id={r.id}>
                <button className="btn px-2 py-1 text-xs" onClick={() => add.mutate(r.id)}>
                  <span style={{ color: qColor(r.quality) }}>{r.name || `#${r.id}`}</span> · {t("mk_add")}
                </button>
              </ItemHover>
            </li>
          ))}
          {search.isError && <li className="text-sm text-bad">{String(search.error)}</li>}
        </ul>
      )}
      {!items.length ? <p className="text-sm text-muted">{t("mk_empty")}</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <Th k="name" s={s} by={by}>{t("mk_item")}</Th>
                <Th k="min" s={s} by={by} right>{t("mk_min")}</Th>
                <Th k="median" s={s} by={by} right>{t("mk_median")}</Th>
                <Th k="qty" s={s} by={by} right>{t("mk_qty")}</Th>
                <th className="p-2 font-normal">{t("mk_trend")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((w) => {
                const week = w.history.filter((p) => Date.now() - Date.parse(p.t) < 7 * 864e5).map((p) => p.min);
                return (
                  <tr key={w.id} className={`border-t border-edge/40 ${w.alert ? "bg-good/10" : ""}`}>
                    <td className="p-2">
                      <ItemHover id={w.itemId}>
                        <span tabIndex={0} className="flex items-center gap-2">
                          <ItemIcon src={w.item?.icon} quality={w.item?.quality} size={28} />
                          <span className="grid leading-tight">
                            <b className="font-medium" style={{ color: qColor(w.item?.quality) }}>{w.item?.name || `#${w.itemId}`}</b>
                            {w.below != null && (
                              <span className={`text-[11px] ${w.alert ? "text-good" : "text-muted"}`}>
                                {w.alert ? "● " : ""}{t("mk_alert", { p: "" })}<Money c={w.below} />
                              </span>
                            )}
                          </span>
                        </span>
                      </ItemHover>
                    </td>
                    {w.latest ? (
                      <>
                        <td className="p-2 text-right"><Money c={w.latest.min} /></td>
                        <td className="p-2 text-right"><Money c={w.latest.median} /></td>
                        <td className="p-2 text-right font-mono">{w.latest.quantity}</td>
                      </>
                    ) : <td colSpan={3} className="p-2 text-right text-muted">{t("mk_none")}</td>}
                    <td className="p-2"><Sparkline points={week} below={w.below} /></td>
                    <td className="p-2 text-right">
                      <button className="btn px-2 py-1 text-xs" title={t("mk_remove")} aria-label={t("mk_remove")} onClick={() => del.mutate(w.id)}>×</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const SLOT_ORDER = ["HEAD", "NECK", "SHOULDER", "BACK", "CHEST", "WRIST", "HANDS", "WAIST", "LEGS", "FEET", "FINGER_1",
  "FINGER_2", "TRINKET_1", "TRINKET_2", "MAIN_HAND", "OFF_HAND", "RANGED"];

/**
 * The chosen character's BiS for its level and a specialization, reduced to what the house sells now. Each item
 * keeps its place in its slot's list (1, 2, 3, as on the throne room). "Refresh" reads the character again (a new
 * level brings a new list) and the latest prices.
 */
function BisOnSale({ onAdd, listName }: { onAdd: (id: number) => void; listName?: string }) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const icons = useIcons();
  const chars = useCharacters();
  const all = (chars.data || []).filter((x) => !x.error && x.summary);
  const sel = useActiveCharId();
  const cid = (all.find((x) => x.id === sel) ?? all[0])?.id ?? null;
  const c = useCharacter(cid).data;
  const trees = useTrees(c);
  const [spec, setSpec] = useState<string | null>(null);
  const [open, setOpen] = useState<{ id: number; name: string } | null>(null);
  const q = useQuery({ queryKey: ["bis-sale", cid, spec, lang], enabled: !!cid, queryFn: () => wowApi.bisSale(cid!, spec, lang) });
  const refresh = useMutation({
    mutationFn: async () => { if (cid) await wowApi.refreshCharacter(cid); },
    onSettled: () => (qc.invalidateQueries({ queryKey: ["bis-sale"] }), qc.invalidateQueries({ queryKey: ["character", cid] })),
  });
  const d = q.data;
  const label = (k: string, i: number) => trees.tabs[i]?.name ?? t(`bis_spec_${k}` as Key);
  const { s, by } = useSort<"slot" | "rank" | "name" | "gain" | "min" | "qty">("bis", "slot");
  const bySlot = (a: Row, b: Row) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot) || a.rank - b.rank;
  const val = (r: Row) => ({ slot: SLOT_ORDER.indexOf(r.slot), rank: r.rank, name: r.name, gain: gainOf(r), min: r.latest.min, qty: r.latest.quantity })[s.k];
  const rows = [...(d?.rows || [])].sort((a, b) => cmp(val(a), val(b)) * s.d || bySlot(a, b));
  if (!all.length) return null;
  return (
    <Fold id="bis" title={t("mk_bis")} extra={<>
        <select className="input w-auto" value={cid ?? ""} onChange={(e) => (setActiveChar(+e.target.value), setSpec(null))}>
          {all.map((x) => <option key={x.id} value={x.id}>{x.summary?.[lang]?.name ?? x.name} · {x.summary?.[lang]?.level ?? "?"}</option>)}
        </select>
        {d?.level != null && <span className="text-sm text-muted">{t("mk_bis_level", { n: d.level })}</span>}
        <button className="btn ml-auto" disabled={refresh.isPending} onClick={() => refresh.mutate()} title={t("mk_bis_refresh_h")}>
          {refresh.isPending ? "…" : t("mk_bis_refresh")}
        </button>
      </>}>
      {d?.specs && (
        <div className="flex flex-wrap gap-1.5">
          {d.specs.map((k, i) => (
            <button key={k} className={`bis-spec ${k === d.spec ? "on" : ""}`} onClick={() => setSpec(k)} title={label(k, i)}>
              {trees.tabs[i] && <span className="bis-spec-ico" style={iconStyle(icons.data, trees.tabs[i].icon)} />}
              <span>{label(k, i)}</span>
            </button>
          ))}
          {d.customSet && (
            <button className={`bis-spec ${d.spec === "custom" ? "on" : ""}`} onClick={() => setSpec("custom")}>{t("bis_custom")}</button>
          )}
        </div>
      )}
      {q.isLoading && <p className="text-sm text-muted">…</p>}
      {q.isError && <p className="text-sm text-bad">{String(q.error)}</p>}
      {d?.status === "ready" && (!rows.length
        ? <p className="text-sm text-muted">{t(d.configured ? "mk_bis_none" : "mk_bis_nohouse")}</p>
        : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <Th k="slot" s={s} by={by}>{t("mk_bis_slot")}</Th>
                  <th className="p-2 font-normal">
                    <span className="flex gap-3">
                      <button className={`hover:text-gold ${s.k === "rank" ? "text-gold" : ""}`} onClick={() => by("rank")}>№{s.k === "rank" ? (s.d === 1 ? " ▲" : " ▼") : ""}</button>
                      <button className={`hover:text-gold ${s.k === "name" ? "text-gold" : ""}`} onClick={() => by("name")}>{t("mk_item")}{s.k === "name" ? (s.d === 1 ? " ▲" : " ▼") : ""}</button>
                    </span>
                  </th>
                  <Th k="gain" s={s} by={by} right>{t("mk_bis_gain")}</Th>
                  <Th k="min" s={s} by={by} right>{t("mk_min")}</Th>
                  <Th k="qty" s={s} by={by} right>{t("mk_qty")}</Th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.slot}-${r.id}`} className="border-t border-edge/40">
                    <td className="p-2 text-muted">{t(`slot_${r.slot}` as Key)}</td>
                    <td className="p-2">
                      <BisRowItem r={r} onOpen={() => setOpen({ id: r.id, name: r.name })} />
                    </td>
                    <td className="p-2 text-right font-mono"><Gain r={r} /></td>
                    <td className="p-2 text-right"><Money c={r.latest.min} /></td>
                    <td className="p-2 text-right font-mono">{r.latest.quantity}</td>
                    <td className="p-2 text-right">
                      {listName && (
                        <button className="btn px-2 py-1 text-xs" title={t("mk_to_list", { n: listName })} aria-label={t("mk_to_list", { n: listName })}
                          onClick={() => onAdd(r.id)}>☆</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      {d?.status === "ready" && <p className="text-xs text-muted">{t("mk_bis_note", { n: d.checked ?? 0 })}</p>}
      {d?.status === "ready" && d.talentsFrom !== "custom" && (
        <p className="text-xs text-muted">
          {t("bis_w_src")} <a className="underline" href="https://github.com/VgerMods/Pawn" target="_blank" rel="noopener noreferrer">Pawn</a> (HawsJon)
          {d.talentsMoved?.length ? <> · {t(d.talentsFrom === "real" ? "bis_w_real" : "bis_w_tree")}: {d.talentsMoved.join(", ")}</> : null}
        </p>
      )}
      <SourcePanel item={open} onClose={() => setOpen(null)} />
    </Fold>
  );
}

type Row = NonNullable<BisSale["rows"]>[number];

/** How much better the item is than what is worn in its slot, by the spec's weights: % of the worn item's score;
 *  an empty slot gains everything (Infinity), the worn item itself nothing. */
const gainOf = (r: Row): number | null => {
  if (r.worn) return 0;
  const w = r.wornItem?.score ?? 0;
  if (!r.wornItem || w <= 0) return r.full.score > 0 ? Infinity : null;
  return ((r.full.score - w) / w) * 100;
};

function Gain({ r }: { r: Row }) {
  const { t } = useI18n();
  const g = gainOf(r);
  if (g == null) return <span className="text-muted">—</span>;
  if (g === Infinity) return <span className="text-good" title={t("mk_bis_empty_slot")}>{t("mk_bis_new")}</span>;
  const v = Math.round(g);
  return <span className={v > 0 ? "text-good" : v < 0 ? "text-bad" : "text-muted"}>{v > 0 ? "+" : ""}{v}%</span>;
}

/** A BiS item of the block: hovering shows the throne room's comparison with what is worn in that slot. */
function BisRowItem({ r, onOpen }: { r: NonNullable<BisSale["rows"]>[number]; onOpen: () => void }) {
  const { t } = useI18n();
  const [hover, setHover] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <button ref={anchor} className="inline-flex items-center gap-2 text-left" onClick={onOpen}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onFocus={() => setHover(true)} onBlur={() => setHover(false)}>
      <span className="bis-rank" title={t("bis_rank", { n: r.rank })}>{r.rank}</span>
      <ItemIcon itemId={r.id} quality={["POOR", "COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY"][r.q]} size={28} />
      <span className="grid leading-tight">
        <b className="font-medium" style={{ color: qCol(r.q) }}>{r.name}</b>
        <span className="text-[11px] text-muted">
          {t("bis_ilvl", { i: r.ilvl })}{r.req ? ` · ${t("mk_bis_req", { n: r.req })}` : ""}
          {r.worn ? <span className="ml-1 text-good">· {t("bis_worn_tag")}</span> : !r.better ? <span className="ml-1">· {t("mk_bis_worse")}</span> : null}
        </span>
      </span>
      <AnimatePresence>
        {hover && anchor.current && <Compare a={r.full} b={r.wornItem} side="right" anchor={anchor.current} />}
      </AnimatePresence>
    </button>
  );
}
