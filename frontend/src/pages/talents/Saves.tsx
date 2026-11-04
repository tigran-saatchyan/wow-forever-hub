import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  analyzeSave, byId, makeLink, normOrder, snapshot, startLevel, type ClassData, type Ranks, type SaveAnalysis, type SaveFlag,
  type SavedBuild, type TalentDataset,
} from "../../engine";
import { api } from "../../lib/api";
import { iconStyle, useAllBuilds, useDiffs, type DiffChange, type Icons } from "../../lib/gameData";
import { fmtDate, useI18n, type Key } from "../../lib/i18n";
import { Desc } from "./Tooltip";

/** Build types picked when saving; several can be set at once. */
export const TAGS = ["leveling", "pvp", "pve", "farm"] as const;
type Tag = (typeof TAGS)[number];
const TAG_COLOR: Record<Tag, string> = { leveling: "#1eff00", pvp: "#ff4d4d", pve: "#5fd4ff", farm: "#ffd100" };

interface Props {
  D: TalentDataset;
  c: ClassData;
  level: number;
  legacy: number;
  ranks: Ranks;
  order: number[];
  split: number[];
  icons?: Icons;
  np: boolean;
  activeSave: string | null;
  setActiveSave: (id: string | null) => void;
  clearFlags: () => void;
  onOpen: (sv: SavedBuild) => void;
  toast: (s: string) => void;
}

export function Saves({ D, c, level, legacy, ranks, order, split, icons, np, activeSave, setActiveSave, clearFlags, onOpen, toast }: Props) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [filter, setFilter] = useState<string | null>(null);
  const [arm, setArm] = useState<string | null>(null);
  const [cmp, setCmp] = useState<string[]>([]);
  const list = useQuery({ queryKey: ["builds"], queryFn: api.builds });
  const saves = list.data || [];

  // fill the form from the build that was opened
  useEffect(() => {
    const sv = saves.find((x) => x.id === activeSave);
    if (sv) (setName(sv.name), setTags(sv.tags || []));
  }, [activeSave]); // eslint-disable-line react-hooks/exhaustive-deps

  // diffs of every build newer than the oldest save: what changed in a broken build, and in which build
  const builds = useAllBuilds();
  const oldest = Math.min(...saves.map((sv) => +String(sv.version).split(".").pop()!));
  const later = builds.filter((b) => b.changes && b.build > oldest).map((b) => b.version);
  const diffs = useDiffs(later, lang);
  const laterChanges = (sv: SavedBuild, id: number) => {
    const out: (DiffChange & { build: string })[] = [];
    for (const v of later) {
      if (+v.split(".").pop()! <= +sv.version.split(".").pop()!) continue;
      for (const ch of diffs[v]?.changes || []) if (ch.class === sv.cls && ch.node === id) out.push({ ...ch, build: v });
    }
    return out;
  };

  const invalidate = () => qc.invalidateQueries({ queryKey: ["builds"] });
  const put = useMutation({ mutationFn: api.saveBuild, onSuccess: invalidate, onError: () => toast(t("sv_cloud_err")) });
  const del = useMutation({ mutationFn: api.deleteBuild, onSuccess: invalidate });

  const saveCurrent = async () => {
    if (np) return toast(t("np_nosave"));
    const nm = name.trim() || `${c.name} ${split.join("/")}`;
    const existed = saves.some((s) => s.id === activeSave || (s.cls === c.token && s.name.toLowerCase() === nm.toLowerCase()));
    const keep = saves.find((s) => s.id === activeSave && s.cls === c.token);
    const sv = await put.mutateAsync({
      id: keep?.id, name: nm, cls: c.token, level, legacy, version: D.build, order: normOrder(c, ranks, order),
      talents: snapshot(c, ranks), tags,
    });
    setName(sv.name);
    setActiveSave(sv.id);
    clearFlags();
    toast(t(existed ? "sv_updated" : "sv_saved", { n: sv.name }));
  };

  const fixSave = async (sv: SavedBuild, a: SaveAnalysis, k: ClassData) => {
    await put.mutateAsync({
      id: sv.id, name: sv.name, cls: sv.cls, level: sv.level, legacy: sv.legacy || 0, version: D.build,
      order: normOrder(k, a.ranks, sv.order || []), talents: snapshot(k, a.ranks), tags: sv.tags || [],
    });
    if (activeSave === sv.id) clearFlags();
    toast(t("sv_updated", { n: sv.name }));
  };

  const remove = (id: string) => {
    if (arm !== id) {
      setArm(id);
      setTimeout(() => setArm((a) => (a === id ? null : a)), 3500);
      return;
    }
    setArm(null);
    if (activeSave === id) setActiveSave(null);
    del.mutate(id);
  };

  const copyLink = (sv: SavedBuild, a: SaveAnalysis, k: ClassData) => {
    const h = makeLink(k, { level: sv.level, legacy: sv.legacy || 0, ranks: a.ranks, order: normOrder(k, a.ranks, sv.order || []), build: +D.build.split(".").pop()! });
    const url = location.href.split("#")[0] + "#" + h;
    navigator.clipboard?.writeText(url).then(() => toast(t("copied")), () => toast(t("tc_copy_fail")));
  };

  const rows = useMemo(() => saves.map((sv) => {
    const k = D.classes.find((x) => x.token === sv.cls);
    return { sv, k, a: k ? analyzeSave(k, sv) : null };
  }).filter((r) => r.k && r.a)
    .sort((p, q) => Number(!!q.a!.broken) - Number(!!p.a!.broken) || Number(q.sv.cls === c.token) - Number(p.sv.cls === c.token)
      || String(q.sv.updated).localeCompare(String(p.sv.updated))), [saves, D, c.token]);
  const shown = rows.filter((r) => !filter || (r.sv.tags || []).includes(filter));
  const nBroken = rows.filter((r) => r.a!.broken).length;

  const tagName = (g: string) => t(("tag_" + g) as Key);
  const tagChip = (g: string, on: boolean, onClick?: () => void) => (
    <button
      key={g} type="button" onClick={onClick} aria-pressed={on}
      className="tag transition"
      style={{ color: on ? TAG_COLOR[g as Tag] : undefined, borderColor: on ? TAG_COLOR[g as Tag] + "aa" : undefined, background: on ? TAG_COLOR[g as Tag] + "18" : undefined }}
    >
      {tagName(g)}
    </button>
  );

  const changeDetail = (f: SaveFlag, sv: SavedBuild) => {
    if (f.kind === "gone") return <span className="text-[12.5px] text-muted">{t("sv_gone")}</span>;
    const chs = laterChanges(sv, f.id);
    const bs = [...new Set(chs.map((x) => x.build.split(".").pop()))];
    const kinds = [...new Set(chs.map((x) => (x.kind === "text" && !x.numbers ? "wording" : x.kind)))].filter((k) => k !== "wording" && k !== "renamed");
    const lines = chs.filter((x) => x.kind === "ranks" || x.kind === "gate")
      .map((x) => t(x.kind === "ranks" ? "ranks_v" : "gate_v", { a: String(x.before), b: String(x.after) }));
    const nowDesc = f.kind === "changed" ? f.x.ranks[Math.min(f.r, f.x.max) - 1] : "";
    return (
      <>
        <span className="text-[12.5px] text-muted">{bs.length ? t("sv_changed_in", { b: bs.join(", ") }) : t("sv_changed")}</span>{" "}
        {kinds.map((k) => <span key={k} className="tag mr-1 border-bad/50 text-bad">{t(("k_" + k) as Key)}</span>)}
        {lines.length > 0 && <div className="text-[12.5px] text-muted">{lines.join(" · ")}</div>}
        {f.kind === "changed" && (
          <details className="mt-1 text-[12.5px]">
            <summary className="cursor-pointer text-gold">{t("sv_before_after")}</summary>
            <div className="mt-1 grid gap-2 sm:grid-cols-2">
              <div className="rounded border border-edge p-2"><b className="block text-muted">{t("sv_was", { r: f.r })}</b><Desc s={f.s.d || ""} /></div>
              <div className="rounded border border-edge p-2"><b className="block text-muted">{t("sv_now")}</b><Desc s={nowDesc} /></div>
            </div>
          </details>
        )}
      </>
    );
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-2xl text-gold">{t("sv_title")}</h2>
        {nBroken > 0 && <span className="chip flex items-center gap-1.5 border-bad/60 text-bad"><span className="dot bad" />{t("sv_attention", { n: nBroken })}</span>}
        {rows.length > 0 && (
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <span className="eyebrow">{t("sv_filter")}</span>
            {tagChip("all", !filter, () => setFilter(null))}
            {TAGS.map((g) => tagChip(g, filter === g, () => setFilter(filter === g ? null : g)))}
          </div>
        )}
      </div>

      {np ? <p className="text-sm text-muted">{t("np_saves")}</p> : (
        <>
          <form className="panel flex flex-wrap items-center gap-3 p-3" onSubmit={(e) => (e.preventDefault(), saveCurrent())} autoComplete="off">
            <label className="text-sm text-muted" htmlFor="saveName">{t("sv_name")}</label>
            <input id="saveName" className="input w-56" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder={`${c.name} ${split.join("/")}`} />
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="eyebrow">{t("sv_type")}</span>
              {TAGS.map((g) => tagChip(g, tags.includes(g), () => setTags(tags.includes(g) ? tags.filter((x) => x !== g) : [...tags, g])))}
            </span>
            <button className="btn-primary" type="submit" disabled={put.isPending}>{t("sv_save")}</button>
            <span className="text-xs text-muted">{t("sv_cloud")}</span>
          </form>

          {cmp.length > 0 && (
            <Compare
              A={rows.find((r) => r.sv.id === cmp[0])} B={cmp[1] ? rows.find((r) => r.sv.id === cmp[1]) : undefined}
              cur={{ c, level, legacy, ranks, order }} D={D} icons={icons} onClose={() => setCmp([])}
            />
          )}

          {!shown.length && <p className="text-sm text-muted">{rows.length ? t("sv_none_tag") : t("sv_empty")}</p>}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {shown.map(({ sv, k, a }) => {
              const A = a!;
              const K = k!;
              const ver = String(sv.version).split(".").pop();
              return (
                <article key={sv.id} className={`panel flex flex-col gap-2.5 p-4 ${A.broken ? "!border-bad/70" : ""} ${activeSave === sv.id ? "!border-gold/70" : ""}`}>
                  <header className="flex gap-2.5">
                    <span className="h-8 w-8 flex-none rounded border border-black" style={iconStyle(icons, K.icon)} />
                    <div className="min-w-0">
                      <h3 className="truncate font-semibold" style={{ color: A.broken ? "#f3a39e" : K.color }}>{sv.name}</h3>
                      <div className="font-mono text-[12px] leading-snug text-muted">
                        {K.name} · {A.broken ? "" : A.split.join(" / ") + " · "}
                        {t("sv_meta", { l: sv.level, b: ver ?? "", d: fmtDate(lang, sv.updated || sv.created || Date.now(), { day: "numeric", month: "short" }) })}
                        {sv.legacy ? " · " + t("sv_legacy", { k: sv.legacy }) : ""}
                        {sv.order?.length ? " · " + t("sv_plan") : ""}
                      </div>
                    </div>
                  </header>
                  {(sv.tags?.length ?? 0) > 0 && <div className="flex flex-wrap gap-1">{sv.tags!.map((g) => tagChip(g, true))}</div>}
                  {A.broken ? (
                    <div className="rounded-md border border-bad/50 bg-bad/10 p-2.5 text-sm">
                      <b className="text-[#f3a39e]">{t("sv_broken", { n: A.changed.length })}</b>
                      <ul className="mt-2 space-y-2">
                        {A.changed.map((f) => (
                          <li key={f.id} className="flex gap-2">
                            <span className="h-6 w-6 flex-none rounded-sm" style={iconStyle(icons, f.kind === "gone" ? "inv_misc_questionmark" : f.icon)} />
                            <div className="min-w-0"><b>{f.name}</b> <span className="font-mono text-xs text-muted">{f.r}</span><br />{changeDetail(f, sv)}</div>
                          </li>
                        ))}
                      </ul>
                      {A.chain.length > 0 && <p className="mt-2 text-[12.5px] text-[#ff9a3c]">{t("sv_chain", { list: A.chain.map((f) => f.name).join(", ") })}</p>}
                      <p className="mt-1 text-[12.5px]">{t("sv_points")}: <s>{A.before}</s> → {A.after} <span className="text-muted">({A.split.join(" / ")})</span></p>
                    </div>
                  ) : (
                    <p className="font-mono text-[12px] text-muted">{sv.version === D.build ? t("sv_ok_same") : t("sv_ok_older", { b: ver ?? "" })}</p>
                  )}
                  <div className="mt-auto flex flex-wrap gap-1.5">
                    <button className="btn-primary px-2.5 py-1 text-xs" onClick={() => onOpen(sv)}>{t("sv_open")}</button>
                    {A.broken && <button className="btn border-bad/70 px-2.5 py-1 text-xs text-[#f3a39e]" onClick={() => fixSave(sv, A, K)}>{t("sv_fix")}</button>}
                    <button className="btn px-2.5 py-1 text-xs" onClick={() => copyLink(sv, A, K)}>{t("sv_link")}</button>
                    <button
                      className="btn px-2.5 py-1 text-xs" aria-pressed={cmp.includes(sv.id)}
                      onClick={() => setCmp(cmp.includes(sv.id) ? cmp.filter((x) => x !== sv.id) : [...cmp, sv.id].slice(-2))}
                    >
                      {t("cmp_btn")}
                    </button>
                    <button className="btn px-2.5 py-1 text-xs text-bad" onClick={() => remove(sv.id)}>{arm === sv.id ? t("sv_del_sure") : t("sv_del")}</button>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

interface Side {
  name: string;
  c: ClassData;
  level: number;
  legacy: number;
  ranks: Ranks;
  order: number[];
}

/** Two builds side by side: only the differences in ranks and in the level a talent is taken at. */
function Compare({ A: ra, B: rb, cur, D, icons, onClose }: {
  A?: { sv: SavedBuild; k?: ClassData; a: SaveAnalysis | null };
  B?: { sv: SavedBuild; k?: ClassData; a: SaveAnalysis | null };
  cur: Omit<Side, "name">;
  D: TalentDataset;
  icons?: Icons;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const side = (r?: { sv: SavedBuild; k?: ClassData; a: SaveAnalysis | null }): Side | null =>
    r ? (r.k && r.a ? { name: r.sv.name, c: r.k, level: r.sv.level, legacy: r.sv.legacy || 0, ranks: r.a.ranks, order: normOrder(r.k, r.a.ranks, r.sv.order || []) } : null)
      : { name: t("cmp_current"), ...cur };
  const A = side(ra);
  const B = side(rb);
  if (!A || !B) return null;
  const tal = D.legacy?.talented;
  const split = (X: Side) => X.c.tabs.map((tb) => tb.talents.reduce((s2, x) => s2 + (X.ranks[x.id] || 0), 0));
  const firstLv = (X: Side, id: number) => {
    const i = X.order.indexOf(id);
    return i < 0 ? null : startLevel(tal, X.legacy) + i;
  };
  const head = (X: Side, k: string) => (
    <div className={`flex items-center gap-2 rounded-md border p-2 ${k === "a" ? "border-[#5fd4ff66]" : "border-[#ff9a3c66]"}`}>
      <span className="h-7 w-7 rounded" style={iconStyle(icons, X.c.icon)} />
      <div className="min-w-0">
        <b style={{ color: X.c.color }}>{X.name}</b>
        <div className="font-mono text-xs text-muted">{X.c.name} · {split(X).join(" / ")} · {t("cmp_lvl", { l: X.level })}{X.legacy ? " · " + t("sv_legacy", { k: X.legacy }) : ""}</div>
      </div>
    </div>
  );
  let same = 0;
  const M = byId(A.c);
  return (
    <section className="panel space-y-3 p-4">
      <header className="flex items-center gap-3">
        <h3 className="font-display text-xl text-gold">{t("cmp_title")}</h3>
        <button className="btn ml-auto" onClick={onClose}>{t("cmp_close")}</button>
      </header>
      <div className="grid items-center gap-2 md:grid-cols-[1fr_auto_1fr]">{head(A, "a")}<span className="hidden text-muted md:block">vs</span>{head(B, "b")}</div>
      {A.c.token !== B.c.token ? <p className="text-sm text-muted">{t("cmp_other_class")}</p> : (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            {A.c.tabs.map((tb, ti) => {
              const items = tb.talents.filter((x) => (A.ranks[x.id] || 0) || (B.ranks[x.id] || 0)).map((x0) => {
                const x = M[x0.id];
                const a = A.ranks[x.id] || 0;
                const b = B.ranks[x.id] || 0;
                const la = firstLv(A, x.id);
                const lb = firstLv(B, x.id);
                if (a === b && la === lb) return (same++, null);
                const col = a === b ? "" : a > b ? "text-[#5fd4ff]" : "text-[#ff9a3c]";
                return (
                  <li key={x.id} className={`flex items-center gap-2 text-sm ${col}`}>
                    <span className="h-5 w-5 rounded-sm" style={iconStyle(icons, x.icon)} />
                    <span className="min-w-0 flex-1 truncate">{x.name}</span>
                    <span className="font-mono text-xs text-[#5fd4ff]">{a}/{x.max}{la && a ? <i className="ml-1 text-muted">{la}</i> : null}</span>
                    <span className="font-mono text-xs text-[#ff9a3c]">{b}/{x.max}{lb && b ? <i className="ml-1 text-muted">{lb}</i> : null}</span>
                  </li>
                );
              }).filter(Boolean);
              return (
                <div key={tb.id}>
                  <h4 className="mb-1.5 flex items-center gap-2 font-display text-gold">
                    <span className="h-5 w-5 rounded-sm" style={iconStyle(icons, tb.icon)} />{tb.name}
                    <span className="font-mono text-xs text-muted">{split(A)[ti]} · {split(B)[ti]}</span>
                  </h4>
                  {items.length ? <ul className="space-y-1">{items}</ul> : <p className="text-[12.5px] text-muted">{t("cmp_no_diff")}</p>}
                </div>
              );
            })}
          </div>
          <p className="text-[12.5px] text-muted">{t("cmp_legend", { n: same })}</p>
        </>
      )}
      {!rb && <p className="text-[12.5px] text-muted">{t("cmp_pick")}</p>}
    </section>
  );
}
