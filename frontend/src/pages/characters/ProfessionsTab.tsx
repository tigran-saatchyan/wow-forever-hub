/**
 * Professions: the character's own professions, every recipe from the client files with the skill it needs
 * and its colours, what it makes and from what, how to get it, and which ones are learned.
 *
 * Blizzard does not say which recipes a Forever character knows, so recipes are marked learned by hand
 * (stored on the server per character); when the API ever lists them, those count too.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ItemHover } from "../../components/Wow";
import { useMe } from "../../lib/auth";
import { useI18n, type Key } from "../../lib/i18n";
import { store } from "../../lib/store";
import {
  Q_BY_INDEX, qColor, useItem, wowApi, type CharProfession, type Character, type Recipe, type RefItem,
} from "../../lib/wowApi";

/** The skill a recipe needs; for trainer recipes the client does not say, so it is estimated from the colours. */
export function need(r: Recipe): { v: number; exact: boolean } {
  if (r.skill) return { v: r.skill, exact: true };
  return { v: Math.max(1, (r.yellow ?? 1) - 30), exact: false };
}

/** The game's difficulty colour at a skill: red = cannot yet, then orange, yellow, green, grey. */
export function difficulty(r: Recipe, skill: number | null): { color: string; key: Key } {
  if (skill == null) return { color: "#ff8040", key: "pf_d_orange" };
  const n = need(r);
  if (n.exact && skill < n.v) return { color: "#ff3b3b", key: "pf_d_red" };
  const y = r.yellow ?? n.v, g = r.gray ?? y, gr = r.green ?? Math.round((y + g) / 2);
  if (skill < y) return { color: "#ff8040", key: "pf_d_orange" };
  if (skill < gr) return { color: "#ffff00", key: "pf_d_yellow" };
  if (skill < g) return { color: "#40c040", key: "pf_d_green" };
  return { color: "#808080", key: "pf_d_gray" };
}

const wowhead = (lang: string, id: number) => `https://www.wowhead.com/classic/${lang === "ru" ? "ru/" : ""}item=${id}`;

/** An item by name; names the client tables lack ("#13480") are asked from Blizzard when shown. */
function Item({ x, count }: { x: RefItem; count?: number | null }) {
  const { lang } = useI18n();
  const missing = x.name.startsWith("#");
  const q = useItem(missing ? x.id : null, lang);
  const name = missing ? q.data?.name || x.name : x.name;
  const color = qColor(missing ? q.data?.quality : Q_BY_INDEX[x.q ?? 1]);
  return (
    <ItemHover id={x.id}>
      <span tabIndex={0} style={{ color }}>{name}{count && count > 1 ? ` ×${count}` : ""}</span>
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
  const names = new Map((idx.data?.professions || []).map((p) => [p.id, p.name[lang] || p.name.en]));
  const [sel, setSel] = useState<number | null>(null);
  const own = mine.find((p) => p.id === sel) ?? mine.find((p) => p.id);

  if (!mine.length)
    return <p className="text-sm text-muted">{c.missing?.includes("professions") ? t("ch_no_prof") : t("ch_prof_none")}</p>;
  return (
    <div className="grid gap-4 lg:grid-cols-[230px_minmax(0,1fr)]">
      <div className="space-y-2">
        {mine.map((p) => (
          <button key={p.name} className={`char-stats w-full text-left ${own?.id === p.id ? "!border-gold/70" : ""}`} onClick={() => p.id && setSel(p.id)}>
            <div className="flex justify-between text-sm">
              <b className="font-medium">{(p.id && names.get(p.id)) || p.name}</b>
              <span className="font-mono text-xs">{p.skill ?? "?"}{p.max ? ` / ${p.max}` : ""}</span>
            </div>
            {p.skill != null && p.max ? <div className="prof-bar"><span style={{ width: `${Math.min(100, (p.skill / p.max) * 100)}%` }} /></div> : null}
          </button>
        ))}
      </div>
      <div>
        {idx.data?.status === "building" && <p className="text-sm text-muted">{t("pf_building")}</p>}
        {idx.data?.status === "error" && <BuildError error={idx.data.error} />}
        {idx.data?.status === "ready" && own?.id != null && <Recipes cid={c.id} line={own.id} own={own} />}
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

type Range = "mine" | "all";

function Recipes({ cid, line, own }: { cid: number; line: number; own: CharProfession }) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["profession", line, lang], queryFn: () => wowApi.profession(line, lang), staleTime: Infinity });
  const marks = useQuery({ queryKey: ["known", cid], queryFn: () => wowApi.known(cid) });
  const mark = useMutation({
    mutationFn: (b: { ids: number[]; known: boolean }) => wowApi.markKnown(cid, { line, ...b }),
    onSuccess: (v) => qc.setQueryData(["known", cid], v),
  });
  const [showKnown, setShowKnown] = useState(() => store.get<boolean>("pfKnown", true));
  const [showNew, setShowNew] = useState(() => store.get<boolean>("pfNew", true));
  const [range, setRange] = useState<Range>(() => store.get<Range>("pfRange", "mine"));
  const [search, setSearch] = useState("");
  const skill = own.skill ?? null;
  const apiIds = useMemo(() => new Set(own.known || []), [own]);
  const apiNames = useMemo(() => new Set((own.knownNames || []).map((n) => n.toLowerCase())), [own]);
  const manual = useMemo(() => new Set(marks.data?.[String(line)] || []), [marks.data, line]);
  const byApi = (r: Recipe) => apiIds.has(r.id) || apiIds.has(r.spell) || apiNames.has(r.nameEn.toLowerCase());
  const isKnown = (r: Recipe) => byApi(r) || manual.has(r.id);

  if (!q.data?.recipes) return <p className="text-sm text-muted">{q.data?.status === "building" ? t("pf_building") : "…"}</p>;
  const all = q.data.recipes;
  const inRange = (r: Recipe) => range === "all" || skill == null || need(r).v <= skill;
  const rows = all.filter((r) => {
    if (search && !(r.name + " " + (r.item?.name || "")).toLowerCase().includes(search.toLowerCase())) return false;
    if (!inRange(r)) return false;
    return isKnown(r) ? showKnown : showNew;
  });
  const learnable = all.filter((r) => inRange(r) && !isKnown(r));
  const toggle = (k: "pfKnown" | "pfNew", v: boolean, set: (v: boolean) => void) => (store.set(k, v), set(v));
  const nKnown = all.filter(isKnown).length;

  const source = (r: Recipe) =>
    r.source === "item" && r.recipeItem ? (
      <span className="grid">
        <Item x={r.recipeItem} />
        <a className="text-[11px] text-gold hover:underline" href={wowhead(lang, r.recipeItem.id)} target="_blank" rel="noopener noreferrer">{t("pf_where")}</a>
      </span>
    ) : r.source === "auto" ? <span className="text-muted">{t("pf_src_auto")}</span>
      : <span className="text-muted">{t("pf_src_trainer")}</span>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-display text-xl text-gold">{q.data.name}</h3>
        {skill != null && <span className="chip">{t("pf_skill", { s: skill })}{own.max ? ` / ${own.max}` : ""}</span>}
        <span className="text-xs text-muted">{t("pf_known_n", { n: nKnown, m: all.length })}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="flex overflow-hidden rounded-md border border-edge">
          {(["mine", "all"] as const).map((x) => (
            <button key={x} className={`px-2.5 py-1 text-xs ${range === x ? "bg-accent/25 text-gold" : "text-muted"}`}
              onClick={() => (store.set("pfRange", x), setRange(x))}>
              {t(x === "mine" ? "pf_r_mine" : "pf_r_all")}
            </button>
          ))}
        </span>
        <button className="btn px-2 py-1 text-xs" aria-pressed={showNew} onClick={() => toggle("pfNew", !showNew, setShowNew)}>{t("pf_show_new")}</button>
        <button className="btn px-2 py-1 text-xs" aria-pressed={showKnown} onClick={() => toggle("pfKnown", !showKnown, setShowKnown)}>{t("pf_show_known")}</button>
        {learnable.length > 0 && range === "mine" && (
          <button className="btn px-2 py-1 text-xs" title={t("pf_mark_all_t")} onClick={() => mark.mutate({ ids: learnable.map((r) => r.id), known: true })}>
            {t("pf_mark_all")}
          </button>
        )}
        <input className="input ml-auto w-48 py-1" placeholder={t("ar_filter")} value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <p className="text-xs text-muted">{t("pf_mark_hint")}</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-sm">
          <thead className="text-left text-xs text-muted">
            <tr>
              <th className="w-8 p-1.5 font-normal" title={t("pf_known")}>✓</th>
              <th className="p-1.5 font-normal" title={t("pf_c_skill_t")}>{t("pf_c_skill")}</th>
              <th className="p-1.5 font-normal">{t("pf_c_recipe")}</th>
              <th className="p-1.5 font-normal">{t("pf_c_reagents")}</th>
              <th className="p-1.5 font-normal">{t("pf_c_source")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const d = difficulty(r, skill);
              const known = isKnown(r);
              const n = need(r);
              return (
                <tr key={r.id} className={`border-t border-edge/40 align-top ${known ? "opacity-60" : ""}`}>
                  <td className="p-1.5">
                    <input type="checkbox" className="accent-[#ffd100]" checked={known} disabled={byApi(r)}
                      aria-label={t("pf_known")} onChange={(e) => mark.mutate({ ids: [r.id], known: e.target.checked })} />
                  </td>
                  <td className="whitespace-nowrap p-1.5 font-mono text-xs" title={t(d.key)}>
                    <span style={{ color: "#ff8040" }} title={n.exact ? t("pf_need") : t("pf_need_est")}>{n.exact ? n.v : `≈${n.v}`}</span>{" "}
                    <span style={{ color: "#ffff00" }}>{r.yellow ?? "—"}</span>{" "}
                    <span style={{ color: "#40c040" }}>{r.green ?? "—"}</span>{" "}
                    <span style={{ color: "#909090" }}>{r.gray ?? "—"}</span>
                  </td>
                  <td className="p-1.5">
                    <span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: d.color }} title={t(d.key)} />
                    {r.item ? <Item x={r.item} count={r.count} /> : <span>{r.name}</span>}
                    {r.item && r.name && <div className="text-[11px] text-muted">{r.name}</div>}
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
