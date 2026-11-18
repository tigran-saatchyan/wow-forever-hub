/** Slide-over from the right (half the screen, full on a phone): where an item drops, who sells it, which quest gives it. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { fmtDate, useI18n, type Key } from "../lib/i18n";
import { qColor, wowApi } from "../lib/wowApi";
import { ItemIcon, ItemTip, Money } from "./Wow";

const wh = (lang: string, kind: "item" | "npc" | "quest", id: number) =>
  `https://www.wowhead.com/classic/${lang === "ru" ? "ru/" : ""}${kind}=${id}`;

export function SourcePanel({ item, onClose }: { item: { id: number; name?: string } | null; onClose: () => void }) {
  useEffect(() => {
    if (!item) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [item, onClose]);
  return createPortal(
    <AnimatePresence>
      {item && (
        <>
          <motion.div key="shade" className="fixed inset-0 z-[80] bg-black/50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside
            key="panel" role="dialog" aria-modal="true"
            className="source-panel fixed inset-y-0 right-0 z-[81] flex w-full flex-col md:w-1/2"
            initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "tween", duration: 0.22 }}
          >
            <Body id={item.id} fallbackName={item.name} onClose={onClose} />
          </motion.aside>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function Body({ id, fallbackName, onClose }: { id: number; fallbackName?: string; onClose: () => void }) {
  const { t, lang } = useI18n();
  const q = useQuery({ queryKey: ["sources", id, lang], queryFn: () => wowApi.sources(id, lang), staleTime: 30 * 60e3, retry: false });
  const d = q.data;
  const it = d?.item;
  const npc = (n: { npc: number; name: string | null }) => (
    <a className="hover:text-gold hover:underline" href={wh(lang, "npc", n.npc)} target="_blank" rel="noopener noreferrer">{n.name || `NPC #${n.npc}`}</a>
  );
  const empty = d && !d.sold.length && !d.drops.length && !d.quests.length && !d.fdb?.sold.length && !d.fdb?.made.length && !d.own?.quests.length && !d.own?.drops;
  return (
    <>
      <header className="flex items-center gap-3 border-b border-edge/60 p-4">
        <ItemIcon src={it?.icon} quality={it?.quality} size={40} />
        <div className="min-w-0 flex-1">
          <div className="eyebrow">{t("so_title")}</div>
          <h2 className="truncate font-display text-xl" style={{ color: qColor(it?.quality) }}>{it?.name || fallbackName || `#${id}`}</h2>
        </div>
        <AddToList id={id} />
        <button className="btn px-2.5" onClick={onClose} aria-label={t("so_close")} title={t("so_close")}>×</button>
      </header>
      <div className="flex-1 space-y-5 overflow-y-auto p-4 text-sm">
        {q.isLoading && <p className="text-muted">{t("so_loading")}</p>}
        {q.isError && <p className="text-bad">{String(q.error)}</p>}
        {d && (
          <>
            {d.own && d.own.quests.length > 0 && (
              <section>
                <h3 className="panel-title mb-2">{t("so_quests")}</h3>
                <ul className="space-y-1">
                  {d.own.quests.map((q) => (
                    <li key={q.id}>
                      <a className="hover:text-gold hover:underline" href={wh(lang, "quest", q.id)} target="_blank" rel="noopener noreferrer">{q.name}</a>
                      {q.chain && <span className="ml-2 text-xs text-[#ffd100]">{t("so_chain")}</span>}
                      {q.side && <span className={`ml-2 text-xs ${q.side === "H" ? "text-red-400" : "text-sky-400"}`}>{t(q.side === "H" ? "so_side_H" : "so_side_A")}</span>}
                      {q.area && <span className="ml-2 text-xs text-muted">{q.area}</span>}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {d.own?.drops && d.own.drops.top.length > 0 && (
              <section>
                <h3 className="panel-title mb-1">{d.own.drops.world ? t("so_world") : t("so_drops")}</h3>
                <p className="mb-2 text-xs text-muted">{t("so_classic_note")}{d.own.drops.count > d.own.drops.top.length ? ` · ${t("so_kinds", { n: d.own.drops.count })}` : ""}</p>
                <table className="w-full">
                  <tbody>
                    {d.own.drops.top.map((x) => (
                      <tr key={x.id} className="border-t border-edge/40">
                        <td className="py-1.5 pr-2">
                          {npc({ npc: x.id, name: x.name })}
                          {x.rank && <span className="ml-1.5 text-[10px] uppercase text-[#ff9a3c]">{t(`so_rank_${x.rank}` as Key)}</span>}
                          <div className="text-[11px] text-muted">{x.instance ?? x.zone ?? ""}{x.x != null && !x.instance ? ` ${x.x.toFixed(0)}, ${x.y?.toFixed(0)}` : ""}{x.level ? ` · ${x.level[0] === x.level[1] ? x.level[0] : `${x.level[0]}–${x.level[1]}`} ${t("so_lvl")}` : ""}</div>
                        </td>
                        <td className="py-1.5 text-right font-mono">{x.chance >= 10 ? x.chance.toFixed(0) : x.chance.toFixed(x.chance < 1 ? 2 : 1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}
            {d.fdb && d.fdb.sold.length > 0 && (
              <section>
                <h3 className="panel-title mb-2">{t("so_sold")} <span className="text-[10px] font-normal normal-case tracking-normal text-muted">ForeverDB</span></h3>
                <ul className="space-y-1.5">
                  {d.fdb.sold.map((v) => (
                    <li key={v.npc} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-edge/50 bg-bg/40 p-2">
                      <span className="grid">
                        <span>{npc(v)}{v.title ? <span className="text-xs text-muted"> &lt;{v.title}&gt;</span> : null}</span>
                        <span className="text-[11px] text-muted">
                          {v.zone ?? ""}{v.x != null ? ` · ${v.x.toFixed(0)}, ${v.y?.toFixed(0)}` : ""}{v.side ? ` · ${v.side}` : ""}
                          {" · "}{v.seen ? <span className="text-good">{t("so_seen_forever")}</span> : t("so_classic_data")}
                          {v.rep ? ` · ${t("so_rep_discount", { r: v.rep })}` : ""}
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        {v.limited ? <span className="text-xs text-[#ff9a3c]">{t("so_limited")}</span> : null}
                        {v.price != null && <Money c={v.price} />}{v.stack && v.stack > 1 ? <span className="text-xs text-muted">×{v.stack}</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {d.fdb && d.fdb.made.length > 0 && (
              <section>
                <h3 className="panel-title mb-2">{t("so_made")}</h3>
                <ul className="space-y-1">
                  {d.fdb.made.map((m) => <li key={m.recipe}>{t("so_crafted", { p: m.profession, r: m.recipe })}{m.skill ? ` · ${m.skill}` : ""}</li>)}
                </ul>
              </section>
            )}
            {d.sold.length > 0 && !(d.fdb && d.fdb.sold.length) && (
              <section>
                <h3 className="panel-title mb-2">{t("so_sold")}</h3>
                <ul className="space-y-1.5">
                  {d.sold.map((s) => (
                    <li key={s.npc} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-edge/50 bg-bg/40 p-2">
                      <span>{npc(s)}{s.limited ? <span className="ml-2 text-xs text-[#ff9a3c]">{t("so_limited")}</span> : null}</span>
                      <span className="flex items-center gap-3">
                        {s.copper != null && <Money c={s.copper} />}
                        {s.installs ? <span className="text-xs text-muted">{t("so_seen", { n: s.installs })}</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {d.drops.length > 0 && !d.own?.drops && (
              <section>
                <h3 className="panel-title mb-2">{t("so_drops")}</h3>
                <table className="w-full">
                  <tbody>
                    {d.drops.map((x) => (
                      <tr key={x.npc} className="border-t border-edge/40">
                        <td className="py-1.5 pr-2">{npc(x)}</td>
                        <td className="py-1.5 pr-2 text-right font-mono">{x.rate != null ? `${(x.rate * 100).toFixed(x.rate < 0.1 ? 1 : 0)}%` : "—"}</td>
                        <td className="py-1.5 text-right text-xs text-muted">{x.kills != null ? t("so_kills", { k: x.kills }) : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}
            {d.quests.length > 0 && !d.own?.quests.length && (
              <section>
                <h3 className="panel-title mb-2">{t("so_quests")}</h3>
                <ul className="space-y-1">
                  {d.quests.map((x) => (
                    <li key={x.quest}>
                      <a className="hover:text-gold hover:underline" href={wh(lang, "quest", x.quest)} target="_blank" rel="noopener noreferrer">{x.title || `#${x.quest}`}</a>
                      {x.installs ? <span className="ml-2 text-xs text-muted">{t("so_seen", { n: x.installs })}</span> : null}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {d.errors.length > 0 && empty && <p className="rounded-md border border-[#ff9a3c]/40 bg-[#ff9a3c]/10 p-2.5 text-[#ffb070]">{t("so_down")}</p>}
            {d.local && (d.local.crafted.length > 0 || d.local.auction || d.local.bind) && (
              <section>
                <h3 className="panel-title mb-2">{t("so_local")}</h3>
                <ul className="space-y-1.5">
                  {d.local.crafted.map((c) => (
                    <li key={c.recipe} className="rounded-md border border-edge/50 bg-bg/40 p-2">{t("so_crafted", { p: c.profession, r: c.recipe })}{c.skill ? ` · ${c.skill}` : ""}</li>
                  ))}
                  {d.local.auction && (
                    <li className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-edge/50 bg-bg/40 p-2">
                      <span>{t("so_on_ah", { n: d.local.auction.qty })}</span><Money c={d.local.auction.min} />
                    </li>
                  )}
                  {d.local.bind && <li className="text-xs text-muted">{t(`so_bind_${d.local.bind}` as Key)}</li>}
                </ul>
              </section>
            )}
            {empty && !d.local?.crafted.length && !d.local?.auction && <p className="rounded-md border border-edge/60 bg-bg/50 p-2.5 text-muted">{t("so_none")}</p>}
            {d.wiki.length > 0 && (
              <section>
                <h3 className="panel-title mb-1">{t("so_wiki")}</h3>
                <p className="mb-2 text-xs text-muted">{t("so_wiki_note")}</p>
                {d.wiki.map((w) => (
                  <blockquote key={w.text} className="rounded-md border-l-2 border-gold/50 bg-bg/40 px-3 py-2">
                    {w.text.replace(/^[^:]+:\s*/, "")}
                    {w.url && <a className="ml-1 text-xs text-gold hover:underline" href={w.url} target="_blank" rel="noopener noreferrer">→</a>}
                  </blockquote>
                ))}
              </section>
            )}
            {it && <section className="wow-tip !w-auto"><ItemTip it={it} /></section>}
          </>
        )}
      </div>
      <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-edge/60 p-3 text-xs text-muted">
        <a className="text-gold hover:underline" href={d?.everloot || `https://everloot.app/database/items/${id}`} target="_blank" rel="noopener noreferrer">Everloot →</a>
        <a className="text-gold hover:underline" href={wh(lang, "item", id)} target="_blank" rel="noopener noreferrer">Wowhead →</a>
        {d?.fdb && (d.fdb.sold.length > 0 || d.fdb.made.length > 0) && (
          <a className="text-gold hover:underline" href="https://foreverdb.net" target="_blank" rel="noopener noreferrer">{t("fdb_credit")}</a>
        )}
        <span className="ml-auto">{t("so_credit")}{d?.dataAsOf ? ` · ${fmtDate(lang, d.dataAsOf)}` : ""}</span>
      </footer>
    </>
  );
}

/** Puts the item into one of the user's auction lists (any item: gear, potions, herbs); a mark on the lists that hold it. */
function AddToList({ id }: { id: number }) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const lists = useQuery({ queryKey: ["ah-lists", lang], queryFn: () => wowApi.lists(lang), staleTime: 60e3 });
  const add = useMutation({
    mutationFn: (lid: number) => wowApi.addToList(lid, { item_id: id, below: null }, lang),
    onSuccess: () => (qc.invalidateQueries({ queryKey: ["ah-lists"] }), setOpen(false)),
  });
  if (!lists.data?.length) return null;
  return (
    <div className="relative">
      <button className="btn px-2.5 text-sm" onClick={() => setOpen(!open)} aria-expanded={open}>☆ {t("mk_add_to")} ▾</button>
      {open && (
        <ul className="panel absolute right-0 top-full z-10 mt-1 min-w-48 p-1 text-sm">
          {lists.data.map((l) => {
            const has = l.items.some((x) => x.itemId === id);
            return (
              <li key={l.id}>
                <button className="w-full rounded px-2 py-1.5 text-left hover:bg-white/5 disabled:opacity-60" disabled={has || add.isPending}
                  onClick={() => add.mutate(l.id)}>
                  {has ? "✓ " : ""}{l.name}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
