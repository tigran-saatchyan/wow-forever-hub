import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { SourcePanel } from "../components/SourcePanel";
import { ItemHover, ItemIcon, Money, parseMoney, Sparkline } from "../components/Wow";
import { useMe } from "../lib/auth";
import { iconStyle, useIcons } from "../lib/gameData";
import { fmtDate, useI18n, type Key } from "../lib/i18n";
import { store } from "../lib/store";
import { qColor, useCharacter, useCharacters, wowApi, type AhList, type Region } from "../lib/wowApi";
import { qCol, useTrees } from "./throne/Bis";

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
  const [cur, setCur] = useState<number | null>(() => store.get<number | null>("ahList", null));
  const list: AhList | undefined = lists.data?.find((x) => x.id === cur) ?? lists.data?.[0];
  const pickList = (id: number) => (setCur(id), store.set("ahList", id));
  const [q, setQ] = useState("");
  const [below, setBelow] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const search = useQuery({
    queryKey: ["item-search", q, lang],
    queryFn: () => wowApi.searchItems(q.trim(), lang),
    enabled: q.trim().length >= 2,
    staleTime: 60e3,
    retry: false,
  });

  const inv = () => (qc.invalidateQueries({ queryKey: ["market"] }), qc.invalidateQueries({ queryKey: ["ah-lists"] }),
    qc.invalidateQueries({ queryKey: ["bis-sale"] }));
  const save = useMutation({ mutationFn: wowApi.setMarket, onSuccess: () => wowApi.refreshMarket().then(inv) });
  const poll = useMutation({ mutationFn: wowApi.refreshMarket, onSuccess: inv });
  const add = useMutation({
    mutationFn: (id: number) => wowApi.addToList(list!.id, { item_id: id, below: parseMoney(below) }, lang),
    onSuccess: () => (setQ(""), setBelow(""), inv()),
    onError: (e) => setMsg(String(e)),
  });
  const del = useMutation({ mutationFn: (iid: number) => wowApi.removeFromList(list!.id, iid), onSuccess: inv });
  const newList = useMutation({ mutationFn: wowApi.addList, onSuccess: (x) => (pickList(x.id), inv()) });
  const rename = useMutation({ mutationFn: (name: string) => wowApi.renameList(list!.id, name), onSuccess: inv });
  const ask = (q: string, v = "") => prompt(q, v)?.trim().slice(0, 60) || null;
  const drop = useMutation({ mutationFn: () => wowApi.deleteList(list!.id), onSuccess: inv });

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

      <BisOnSale onAdd={(id) => list && wowApi.addToList(list.id, { item_id: id, below: null }, lang).then(inv)} listName={list?.name} />

      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-xl text-gold">{t("mk_lists")}</h2>
        {(lists.data || []).map((x) => (
          <button key={x.id} className={x.id === list?.id ? "btn-primary" : "btn"} onClick={() => pickList(x.id)}>
            {x.name} <span className="text-xs opacity-70">{x.items.length}</span>
          </button>
        ))}
        <button className="btn" onClick={() => { const n = ask(t("mk_list_new_q")); if (n) newList.mutate(n); }} title={t("mk_list_new")}>＋ {t("mk_list_new")}</button>
        {list && <button className="btn px-2" onClick={() => { const n = ask(t("mk_list_rename_q"), list.name); if (n) rename.mutate(n); }} title={t("mk_list_rename")} aria-label={t("mk_list_rename")}>✎</button>}
        {list && (lists.data?.length ?? 0) > 1 && (
          <button className="btn px-2" title={t("mk_list_delete")} aria-label={t("mk_list_delete")}
            onClick={() => confirm(t("mk_list_delete_q", { n: list.name })) && drop.mutate()}>🗑</button>
        )}
      </div>
      <div className="panel space-y-2 p-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <input className="input w-64" placeholder={t("mk_search")} value={q} onChange={(e) => setQ(e.target.value)} />
          <input className="input w-52" placeholder={t("mk_below") + ": 1g 20s"} value={below} onChange={(e) => setBelow(e.target.value)} />
          {msg && <span className="text-bad" onClick={() => setMsg(null)}>{msg}</span>}
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
      </div>

      {!list?.items.length ? <p className="text-muted">{lists.isLoading ? "…" : t("mk_empty")}</p> : (
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="p-2 font-normal" />
                <th className="p-2 text-right font-normal">{t("mk_min")}</th>
                <th className="p-2 text-right font-normal">{t("mk_median")}</th>
                <th className="p-2 text-right font-normal">{t("mk_qty")}</th>
                <th className="p-2 font-normal">{t("mk_trend")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.items.map((w) => {
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
  const [sel, setSel] = useState<number | null>(() => store.get<number | null>("ahBisChar", null));
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
  const rows = [...(d?.rows || [])].sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot) || a.rank - b.rank);
  if (!all.length) return null;
  return (
    <section className="panel space-y-3 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-xl text-gold">{t("mk_bis")}</h2>
        <select className="input w-auto" value={cid ?? ""} onChange={(e) => (setSel(+e.target.value), store.set("ahBisChar", +e.target.value), setSpec(null))}>
          {all.map((x) => <option key={x.id} value={x.id}>{x.summary?.[lang]?.name ?? x.name} · {x.summary?.[lang]?.level ?? "?"}</option>)}
        </select>
        {d?.level != null && <span className="text-sm text-muted">{t("mk_bis_level", { n: d.level })}</span>}
        <button className="btn ml-auto" disabled={refresh.isPending} onClick={() => refresh.mutate()} title={t("mk_bis_refresh_h")}>
          {refresh.isPending ? "…" : t("mk_bis_refresh")}
        </button>
      </div>
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
                  <th className="p-2 font-normal">{t("mk_bis_slot")}</th>
                  <th className="p-2 font-normal" />
                  <th className="p-2 text-right font-normal">{t("mk_min")}</th>
                  <th className="p-2 text-right font-normal">{t("mk_qty")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.slot}-${r.id}`} className="border-t border-edge/40">
                    <td className="p-2 text-muted">{t(`slot_${r.slot}` as Key)}</td>
                    <td className="p-2">
                      <ItemHover id={r.id}>
                        <button className="flex items-center gap-2 text-left" onClick={() => setOpen({ id: r.id, name: r.name })}>
                          <span className="bis-rank" title={t("bis_rank", { n: r.rank })}>{r.rank}</span>
                          <ItemIcon itemId={r.id} quality={["POOR", "COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY"][r.q]} size={28} />
                          <span className="grid leading-tight">
                            <b className="font-medium" style={{ color: qCol(r.q) }}>{r.name}</b>
                            <span className="text-[11px] text-muted">
                              {t("bis_ilvl", { i: r.ilvl })}{r.req ? ` · ${t("mk_bis_req", { n: r.req })}` : ""}
                              {r.worn ? <span className="ml-1 text-good">· {t("bis_worn_tag")}</span> : !r.better ? <span className="ml-1">· {t("mk_bis_worse")}</span> : null}
                            </span>
                          </span>
                        </button>
                      </ItemHover>
                    </td>
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
      <SourcePanel item={open} onClose={() => setOpen(null)} />
    </section>
  );
}
