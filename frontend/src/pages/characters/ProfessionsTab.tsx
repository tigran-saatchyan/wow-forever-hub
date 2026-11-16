/**
 * Professions: the character's skill, every recipe of the profession from the client files, which ones
 * the character still lacks at its skill and above, and how to get them (trainer, on its own, recipe item).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ItemHover } from "../../components/Wow";
import { useMe } from "../../lib/auth";
import { useI18n, type Key } from "../../lib/i18n";
import { store } from "../../lib/store";
import { Q_BY_INDEX, qColor, wowApi, type CharProfession, type Character, type Recipe, type RefItem } from "../../lib/wowApi";

type Filter = "missing" | "above" | "known" | "all";

/** The game's difficulty colours at a given skill: red = cannot yet, then orange, yellow, green, grey. */
export function difficulty(r: Recipe, skill: number | null): { color: string; key: Key } {
  if (skill == null) return { color: "#ff8040", key: "pf_d_orange" };
  if (skill < r.skill) return { color: "#ff3b3b", key: "pf_d_red" };
  const y = r.yellow ?? r.skill, g = r.gray ?? y;
  const green = Math.round((y + g) / 2);
  if (skill < y) return { color: "#ff8040", key: "pf_d_orange" };
  if (skill < green) return { color: "#ffff00", key: "pf_d_yellow" };
  if (skill < g) return { color: "#40c040", key: "pf_d_green" };
  return { color: "#808080", key: "pf_d_gray" };
}

const wowhead = (lang: string, id: number) => `https://www.wowhead.com/classic/${lang === "ru" ? "ru/" : ""}item=${id}`;

function Item({ x, count }: { x: RefItem; count?: number | null }) {
  return (
    <ItemHover id={x.id}>
      <span tabIndex={0} style={{ color: qColor(Q_BY_INDEX[x.q ?? 1]) }}>{x.name}{count && count > 1 ? ` ×${count}` : ""}</span>
    </ItemHover>
  );
}

export function ProfessionsTab({ c }: { c: Character }) {
  const { t, lang } = useI18n();
  const mine = c.professions?.[lang] || [];
  const idx = useQuery({
    queryKey: ["professions"], queryFn: wowApi.professions,
    refetchInterval: (q) => (q.state.data?.status === "building" ? 4000 : false),
  });
  const [sel, setSel] = useState<number | null>(() => mine.find((p) => p.id)?.id ?? null);
  const all = idx.data?.professions || [];
  const pick = sel ?? all[0]?.id ?? null;
  const own = mine.find((p) => p.id === pick);

  return (
    <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
      <div className="space-y-2">
        {mine.length ? mine.map((p) => (
          <button key={p.name} className={`char-stats w-full text-left ${pick === p.id ? "!border-gold/70" : ""}`} onClick={() => p.id && setSel(p.id)}>
            <div className="flex justify-between text-sm"><b className="font-medium">{p.name}</b><span className="font-mono text-xs">{p.skill ?? "?"}{p.max ? ` / ${p.max}` : ""}</span></div>
            {p.skill != null && p.max ? <div className="prof-bar"><span style={{ width: `${Math.min(100, (p.skill / p.max) * 100)}%` }} /></div> : null}
          </button>
        )) : <p className="text-sm text-muted">{c.missing?.includes("professions") ? t("ch_no_prof") : t("ch_prof_none")}</p>}
        {all.length > 0 && (
          <label className="grid gap-1 pt-2 text-sm">
            <span className="eyebrow">{t("pf_browse")}</span>
            <select className="input py-1.5" value={pick ?? ""} onChange={(e) => setSel(+e.target.value)}>
              {all.map((p) => <option key={p.id} value={p.id}>{p.name[lang] || p.name.en} ({p.recipes})</option>)}
            </select>
          </label>
        )}
      </div>
      <div>
        {idx.data?.status === "building" && <p className="text-sm text-muted">{t("pf_building")}</p>}
        {idx.data?.status === "error" && <BuildError error={idx.data.error} />}
        {idx.data?.status === "ready" && pick != null && <Recipes line={pick} own={own} />}
      </div>
    </div>
  );
}

function BuildError({ error }: { error?: string }) {
  const { t } = useI18n();
  const me = useMe();
  const qc = useQueryClient();
  const again = useMutation({ mutationFn: wowApi.rebuildRecipes, onSuccess: () => qc.invalidateQueries({ queryKey: ["professions"] }) });
  return (
    <div className="space-y-2 rounded-md border border-bad/50 bg-bad/10 p-2.5 text-sm">
      <p>{t("pf_build_err")}</p>
      <p className="break-words font-mono text-xs text-muted">{error}</p>
      {me.data?.role === "superadmin" && <button className="btn" onClick={() => again.mutate()}>{t("pf_retry")}</button>}
    </div>
  );
}

function Recipes({ line, own }: { line: number; own?: CharProfession }) {
  const { t, lang } = useI18n();
  const q = useQuery({ queryKey: ["profession", line, lang], queryFn: () => wowApi.profession(line, lang), staleTime: Infinity });
  const [filter, setFilter] = useState<Filter>(() => store.get<Filter>("pfFilter", "missing"));
  const [search, setSearch] = useState("");
  const skill = own?.skill ?? null;
  const tracks = !!own?.hasKnown;
  const knownIds = useMemo(() => new Set(own?.known || []), [own]);
  const knownNames = useMemo(() => new Set((own?.knownNames || []).map((n) => n.toLowerCase())), [own]);
  const isKnown = (r: Recipe) => knownIds.has(r.id) || knownIds.has(r.spell) || knownNames.has(r.nameEn.toLowerCase());

  if (!q.data?.recipes) return <p className="text-sm text-muted">{q.data?.status === "building" ? t("pf_building") : "…"}</p>;
  const rows = q.data.recipes.filter((r) => {
    if (search && !r.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (!own || filter === "all") return true;
    if (filter === "known") return tracks && isKnown(r);
    if (filter === "above") return skill != null && r.skill > skill && !(tracks && isKnown(r));
    return (skill == null || r.skill <= skill) && !(tracks && isKnown(r));
  });
  const set = (f: Filter) => (store.set("pfFilter", f), setFilter(f));
  const chip = (f: Filter, label: string) => (
    <button key={f} className="btn px-2 py-1 text-xs" aria-pressed={filter === f} onClick={() => set(f)}>{label}</button>
  );
  const source = (r: Recipe) =>
    r.source === "item" && r.recipeItem ? (
      <span className="grid">
        <Item x={r.recipeItem} />
        <a className="text-[11px] text-gold hover:underline" href={wowhead(lang, r.recipeItem.id)} target="_blank" rel="noopener noreferrer">{t("pf_where")}</a>
      </span>
    ) : r.source === "auto" ? <span className="text-muted">{t("pf_src_auto", { s: r.skill })}</span>
      : <span className="text-muted">{t("pf_src_trainer")}</span>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-display text-xl text-gold">{q.data.name}</h3>
        {skill != null && <span className="chip">{t("pf_skill", { s: skill })}</span>}
        <span className="text-xs text-muted">{t("pf_total", { n: q.data.recipes.length })}</span>
      </div>
      {own && (
        <div className="flex flex-wrap items-center gap-1.5">
          {chip("missing", t(tracks ? "pf_f_missing" : "pf_f_available"))}
          {chip("above", t("pf_f_above"))}
          {tracks && chip("known", t("pf_f_known"))}
          {chip("all", t("pf_f_all"))}
          <input className="input ml-auto w-48 py-1" placeholder={t("ar_filter")} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      )}
      {own && !tracks && <p className="text-xs text-muted">{t("pf_no_known")}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="text-left text-xs text-muted">
            <tr>
              <th className="p-1.5 font-normal">{t("pf_c_skill")}</th>
              <th className="p-1.5 font-normal">{t("pf_c_recipe")}</th>
              <th className="p-1.5 font-normal">{t("pf_c_reagents")}</th>
              <th className="p-1.5 font-normal">{t("pf_c_source")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const d = difficulty(r, skill);
              const known = tracks && isKnown(r);
              return (
                <tr key={r.id} className={`border-t border-edge/40 align-top ${known ? "opacity-60" : ""}`}>
                  <td className="p-1.5 font-mono" title={t(d.key)}>
                    <span style={{ color: d.color }}>{r.skill}</span>
                    <div className="text-[10px] text-muted">{r.yellow ?? "—"} · {r.gray ?? "—"}</div>
                  </td>
                  <td className="p-1.5">
                    {known && <span className="mr-1 text-good" title={t("pf_known")}>✓</span>}
                    {r.item ? <Item x={r.item} count={r.count} /> : <span>{r.name}</span>}
                    {r.item && r.item.name !== r.name && <div className="text-[11px] text-muted">{r.name}</div>}
                  </td>
                  <td className="p-1.5 text-xs">
                    {r.reagents.map((x, i) => <span key={x.id}>{i ? ", " : ""}<Item x={x} />{x.count > 1 ? ` ×${x.count}` : ""}</span>)}
                  </td>
                  <td className="p-1.5 text-xs">{source(r)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length && <p className="p-2 text-sm text-muted">{t("ar_empty")}</p>}
      </div>
    </div>
  );
}
