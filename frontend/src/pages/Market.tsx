import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ItemHover, ItemIcon, Money, parseMoney, Sparkline } from "../components/Wow";
import { useMe } from "../lib/auth";
import { fmtDate, useI18n } from "../lib/i18n";
import { qColor, wowApi, type Region } from "../lib/wowApi";

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
  const watch = useQuery({ queryKey: ["watch", lang], queryFn: () => wowApi.watch(lang), refetchInterval: 5 * 60e3 });
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

  const inv = () => (qc.invalidateQueries({ queryKey: ["market"] }), qc.invalidateQueries({ queryKey: ["watch"] }));
  const save = useMutation({ mutationFn: wowApi.setMarket, onSuccess: () => wowApi.refreshMarket().then(inv) });
  const poll = useMutation({ mutationFn: wowApi.refreshMarket, onSuccess: inv });
  const add = useMutation({
    mutationFn: (id: number) => wowApi.addWatch({ item_id: id, below: parseMoney(below) }, lang),
    onSuccess: () => (setQ(""), setBelow(""), inv()),
    onError: (e) => setMsg(String(e)),
  });
  const del = useMutation({ mutationFn: wowApi.deleteWatch, onSuccess: inv });

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

      {!watch.data?.length ? <p className="text-muted">{watch.isLoading ? "…" : t("mk_empty")}</p> : (
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
              {watch.data.map((w) => {
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
