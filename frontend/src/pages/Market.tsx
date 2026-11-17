import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ItemHover, ItemIcon, Money, parseMoney, Sparkline } from "../components/Wow";
import { useMe } from "../lib/auth";
import { fmtDate, useI18n } from "../lib/i18n";
import { qColor, rulesetName, wowApi, type Region } from "../lib/wowApi";

/**
 * Forever has no realms: its auction houses come as five worlds of three (Alliance, Horde, Blackwater, the
 * neutral one), the same list whatever ruleset is asked for. World 1 is PvP (matched in game: Horde #113);
 * world 2 is most likely Normal (the other big one); world 3 is empty; worlds 4 and 5 are the two
 * roleplay rulesets, which is which not known yet.
 */
const WORLDS: { key: "mk_w_pvp" | "mk_w_normal" | "mk_w_empty" | "mk_w_rp"; houses: number[] }[] = [
  { key: "mk_w_pvp", houses: [110, 113, 116] },
  { key: "mk_w_normal", houses: [111, 114, 117] },
  { key: "mk_w_rp", houses: [119, 120, 121] },
  { key: "mk_w_rp", houses: [123, 124, 125] },
  { key: "mk_w_empty", houses: [112, 115, 118] },
];
const SIDES = ["mk_s_alliance", "mk_s_horde", "mk_s_neutral"] as const;
const KNOWN = new Set(WORLDS.flatMap((w) => w.houses));

export function Market() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const me = useMe();
  const admin = me.data?.role === "superadmin";
  const cfg = useQuery({ queryKey: ["market", lang], queryFn: () => wowApi.market(lang) });
  const watch = useQuery({ queryKey: ["watch", lang], queryFn: () => wowApi.watch(lang), refetchInterval: 5 * 60e3 });
  const [region, setRegion] = useState<Region>("eu");
  const [ruleset, setRuleset] = useState<number | null>(null);
  const [house, setHouse] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [below, setBelow] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const s = cfg.data?.selected;
    if (s) (setRegion(s.region), setRuleset(s.ruleset), setHouse(s.house));
    else if (cfg.data?.rulesets[0] && ruleset == null) setRuleset(cfg.data.rulesets[0].id);
  }, [cfg.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const houses = useQuery({
    queryKey: ["houses", ruleset, region, lang],
    queryFn: () => wowApi.houses(ruleset!, region, lang),
    enabled: ruleset != null && !!cfg.data?.configured,
  });
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
        <div className="panel flex flex-wrap items-end gap-3 p-3 text-sm">
          <label className="grid gap-1"><span className="eyebrow">{t("mk_region")}</span>
            <select className="input py-1.5" value={region} onChange={(e) => (setRegion(e.target.value as Region), setHouse(null))}>
              <option value="eu">EU</option><option value="us">US</option>
            </select>
          </label>
          <label className="grid gap-1"><span className="eyebrow">{t("mk_ruleset")}</span>
            <select className="input py-1.5" value={ruleset ?? ""} onChange={(e) => (setRuleset(+e.target.value), setHouse(null))}>
              {cfg.data.rulesets.map((r) => <option key={r.id} value={r.id}>{rulesetName(r, t)}</option>)}
            </select>
          </label>
          <label className="grid gap-1"><span className="eyebrow">{t("mk_house")}</span>
            <select className="input py-1.5" value={house ?? ""} onChange={(e) => setHouse(+e.target.value)}>
              <option value="" disabled>—</option>
              {WORLDS.map((w) => {
                const hs = w.houses.filter((id) => (houses.data || []).some((h) => h.id === id));
                return hs.length ? (
                  <optgroup key={w.key} label={t(w.key)}>
                    {hs.map((id, i) => <option key={id} value={id}>{t(SIDES[i])} · #{id}</option>)}
                  </optgroup>
                ) : null;
              })}
              {(houses.data || []).filter((h) => !KNOWN.has(h.id)).map((h) => <option key={h.id} value={h.id}>{h.name} · #{h.id}</option>)}
            </select>
          </label>
          <button
            className="btn-primary" disabled={ruleset == null || house == null || save.isPending
              || (sel?.region === region && sel?.ruleset === ruleset && sel?.house === house)}
            onClick={() => save.mutate({ region, ruleset: ruleset!, house: house! })}
          >
            {t("mk_save")}
          </button>
          {sel && <button className="btn" disabled={poll.isPending} onClick={() => poll.mutate()}>{t("mk_refresh")}</button>}
          {ruleset != null && (
            <a className="text-xs text-gold underline-offset-2 hover:underline" target="_blank" rel="noopener noreferrer" title={t("mk_raw_t")}
              href={`/api/bnet/raw?kind=dynamic&region=${region}&path=${encodeURIComponent(`/data/wow/ruleset/${ruleset}/auctions/`)}`}>
              {t("mk_raw")}
            </a>
          )}
          {!sel && <span className="text-muted">{t("mk_pick")}</span>}
          {cfg.data.error && <span className="text-bad">{cfg.data.error}</span>}
          {ruleset != null && <Compare ruleset={ruleset} region={region} current={house} onPick={setHouse} />}
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

/** All houses of a ruleset side by side, to recognise yours by a price you see in game. */
function Compare({ ruleset, region, current, onPick }: { ruleset: number; region: Region; current: number | null; onPick: (h: number) => void }) {
  const { t, lang } = useI18n();
  const [item, setItem] = useState("2589");
  const [go, setGo] = useState(false);
  const id = parseInt(item, 10);
  const q = useQuery({
    queryKey: ["compare", ruleset, region, id, lang],
    queryFn: () => wowApi.compare(ruleset, region, id, lang),
    enabled: go && id > 0,
    staleTime: 10 * 60e3,
    retry: false,
  });
  const info = useQuery({ queryKey: ["item", id, lang], queryFn: () => wowApi.item(id, lang), enabled: id > 0, retry: false, staleTime: Infinity });
  return (
    <details className="w-full" onToggle={(e) => (e.target as HTMLDetailsElement).open && setGo(true)}>
      <summary className="cursor-pointer text-gold">{t("mk_cmp")}</summary>
      <p className="mt-1 text-xs text-muted">{t("mk_cmp_t")}</p>
      <label className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-muted">{t("mk_cmp_item")}</span>
        <input className="input w-24 py-1" inputMode="numeric" value={item} onChange={(e) => setItem(e.target.value.replace(/\D/g, ""))} />
        {info.data && <span style={{ color: qColor(info.data.quality) }}>{info.data.name}</span>}
      </label>
      {q.isFetching && <p className="mt-2 text-muted">{t("mk_cmp_loading")}</p>}
      {q.isError && <p className="mt-2 text-bad">{String(q.error)}</p>}
      {q.data && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[520px]">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="p-1.5 font-normal" />
                <th className="p-1.5 text-right font-normal">{t("mk_cmp_lots")}</th>
                <th className="p-1.5 text-right font-normal">{t("mk_cmp_items")}</th>
                <th className="p-1.5 text-right font-normal">{t("mk_cmp_price")}</th>
                <th className="p-1.5 text-right font-normal">{t("mk_qty")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {[...q.data].sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id).map((h) => (
                <tr key={h.id} className={`border-t border-edge/40 ${current === h.id ? "bg-accent/15" : ""}`}>
                  <td className="p-1.5">{h.name} <span className="text-muted">· #{h.id}</span></td>
                  <td className="p-1.5 text-right font-mono">{h.error ? "—" : h.lots}</td>
                  <td className="p-1.5 text-right font-mono">{h.error ? "—" : h.items}</td>
                  <td className="p-1.5 text-right">{h.itemMin != null ? <Money c={h.itemMin} /> : "—"}</td>
                  <td className="p-1.5 text-right font-mono">{h.itemQty ?? "—"}</td>
                  <td className="p-1.5 text-right">
                    <button className="btn px-2 py-0.5 text-xs" disabled={current === h.id} onClick={() => onPick(h.id)}>{t("mk_cmp_pick")}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}
