import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ApiError } from "../lib/api";
import { characterLink, mapTalents } from "../lib/charTalents";
import { iconStyle, useIcons, useIndex, useTalents } from "../lib/gameData";
import { fmtDate, useI18n, type Key } from "../lib/i18n";
import { store } from "../lib/store";
import { CharacterList } from "./characters/CharacterList";
import { CharacterSheet } from "./characters/CharacterSheet";
import {
  media, useCharacter, useCharacterActions, useCharacters, wowApi, type Character, type Region,
} from "../lib/wowApi";

export function Characters() {
  const { t, lang } = useI18n();
  const list = useCharacters();
  const acts = useCharacterActions();
  const [params, setParams] = useSearchParams();
  const [name, setName] = useState("");
  const [region, setRegion] = useState<Region>(() => store.get<Region>("chRegion", "eu"));
  const [sel, setSel] = useState<number | null>(() => store.get<number | null>("chSel", null));
  const [msg, setMsg] = useState<string | null>(null);
  const account = useQuery({ queryKey: ["bnet-account"], queryFn: wowApi.account });
  const chars = list.data || [];
  const cur = chars.find((c) => c.id === sel) ?? chars[0];

  useEffect(() => {
    const b = params.get("bnet");
    if (!b) return;
    setMsg(b === "ok" ? t("ch_bnet_ok") : t("ch_bnet_fail", { e: b }));
    setParams({}, { replace: true });
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2) return;
    try {
      const c = await acts.add.mutateAsync({ name: name.trim(), region });
      setSel(c.id);
      store.set("chSel", c.id);
      setName("");
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : String(err));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-3xl text-gold">{t("ch_title")}</h1>
        <form className="flex flex-wrap items-center gap-2" onSubmit={add} autoComplete="off">
          <input className="input w-56" placeholder={t("ch_name")} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          <select className="input py-1.5" aria-label="region" value={region} onChange={(e) => (setRegion(e.target.value as Region), store.set("chRegion", e.target.value))}>
            <option value="eu">EU</option>
            <option value="us">US</option>
          </select>
          <button className="btn-primary" disabled={acts.add.isPending}>{t("ch_add")}</button>
        </form>
        <div className="ml-auto flex items-center gap-2 text-sm">
          {account.data?.battletag && <span className="chip">{t("ch_bnet_linked", { b: account.data.battletag })}</span>}
          <a className="btn" href={`/api/bnet/login?region=${region}`} title={t("ch_bnet_t")}>{t("ch_bnet")}</a>
        </div>
      </div>
      {msg && <p className="panel px-3 py-2 text-sm" role="status" onClick={() => setMsg(null)}>{msg}</p>}

      {!chars.length ? (
        <p className="text-muted">{list.isLoading ? "…" : t("ch_empty")}</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
          <CharacterList
            chars={chars} cur={cur?.id}
            onSelect={(id) => (setSel(id), store.set("chSel", id))}
            icon={(c) => <ClassIcon classId={c.summary?.[lang]?.classId ?? null} />}
          />
          {cur && <CharacterCard id={cur.id} />}
        </div>
      )}
    </div>
  );
}

function ClassIcon({ classId, size = 40 }: { classId: number | null; size?: number }) {
  const { lang } = useI18n();
  const D = useTalents(lang);
  const icons = useIcons();
  const k = D.data?.classes.find((c) => c.id === classId);
  return (
    <span
      className="flex-none rounded border border-black"
      style={{ width: size, height: size, ...(k ? iconStyle(icons.data, k.icon) : { background: "rgb(var(--edge))" }) }}
    />
  );
}

function CharacterCard({ id }: { id: number }) {
  const { t, lang } = useI18n();
  const q = useCharacter(id);
  const acts = useCharacterActions();
  const D = useTalents(lang);
  const idx = useIndex();
  const nav = useNavigate();
  const c: Character | undefined = q.data;
  if (!c) return <div className="panel p-4 text-muted">…</div>;
  const s = c.summary?.[lang];
  const k = D.data?.classes.find((x) => x.id === s?.classId);
  const m = k && c.talents ? mapTalents(k, c.talents) : null;
  const link = k && c.talents && idx.data ? characterLink(k, c.talents, s?.level ?? null, +idx.data.latest.split(".").pop()!) : null;
  const known = ["not_found", "not_configured", "low_level"];
  const err = c.error ? t(known.includes(c.error) ? (`ch_err_${c.error}` as Key) : "ch_err", { e: c.error }) : null;

  return (
    <section className="panel space-y-4 p-4">
      <header className="flex flex-wrap items-start gap-4">
        {c.avatar ? <img src={media(c.avatar)} alt="" className="h-16 w-16 rounded-md border border-edge object-cover" /> : <ClassIcon classId={s?.classId ?? null} size={64} />}
        <div className="min-w-[200px] flex-1">
          <h2 className="font-display text-2xl" style={{ color: k?.color }}>{s?.name || c.name}</h2>
          {s && (
            <p className="text-sm text-muted">
              {t("ch_level", { l: s.level ?? "?" })} · {s.race} {s.className}
              {s.guild?.name ? <> · <span className="text-ink">&lt;{s.guild.name}&gt;</span></> : null}
              {s.ruleset ? ` · ${s.ruleset}` : ""}
              {s.ilvl ? ` · ${t("ch_ilvl", { i: s.ilvl })}` : ""}
            </p>
          )}
          <p className="text-xs text-muted">{c.region.toUpperCase()} · {c.slug}{c.fetched ? ` · ${t("ch_updated", { d: fmtDate(lang, c.fetched) })}` : ""}</p>
        </div>
        <div className="flex gap-2">
          <button className="btn" disabled={acts.refresh.isPending} onClick={() => acts.refresh.mutate(c.id)}>{t("ch_refresh")}</button>
          <button className="btn text-bad" onClick={() => acts.remove.mutate(c.id)}>{t("ch_delete")}</button>
        </div>
      </header>
      {err && <p className="rounded-md border border-bad/50 bg-bad/10 p-2.5 text-sm">{err}</p>}
      {c.error && c.error !== "low_level" && (c.account || c.tried) && (
        <details className="text-xs">
          <summary className="cursor-pointer text-gold">{t("ch_raw")}</summary>
          {c.tried && <p className="mt-1 text-muted">{t("ch_tried")}: <span className="font-mono">{c.tried.join(", ")}</span></p>}
          {c.account && <pre className="mt-1 max-h-80 overflow-auto rounded-md border border-edge/50 bg-bg/60 p-2 font-mono">{JSON.stringify(c.account, null, 2)}</pre>}
        </details>
      )}

      {s?.guild?.href && <GuildRoster cid={c.id} name={s.guild.name} />}

      {c.summary && !c.error && <CharacterSheet c={c} k={k} />}

      {c.summary && !c.error && (
        <div>
            <h3 className="panel-title mb-2">{t("ch_talents")}</h3>
            {c.missing?.includes("talents") || !c.talents ? <p className="text-sm text-muted">{t("ch_no_part")}</p> : (
              <>
                {m && <p className="mb-2 text-sm text-muted">{t("ch_talents_matched", { n: m.matched, m: m.total })}</p>}
                {link && <button className="btn-primary mb-3" onClick={() => nav(`/talents#${link.replace(/^#/, "")}`)}>{t("ch_open_calc")}</button>}
                <ul className="flex flex-wrap gap-1.5 text-xs">
                  {c.talents.map((x, i) => <li key={i} className="chip">{x.name || x.node || x.spell} {x.rank}</li>)}
                </ul>
              </>
            )}
        </div>
      )}
    </section>
  );
}

function GuildRoster({ cid, name }: { cid: number; name: string }) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const D = useTalents(lang);
  const icons = useIcons();
  const q = useQuery({ queryKey: ["guild", cid, lang], queryFn: () => wowApi.guild(cid, lang), enabled: open, retry: false });
  const cls = (id: number | null) => D.data?.classes.find((k) => k.id === id);
  return (
    <details className="rounded-md border border-edge/50 bg-bg/40 p-2.5" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer text-sm">
        <span className="text-gold">{t("gd_show")}</span> <span className="text-ink">&lt;{name}&gt;</span>
        {q.data && <span className="ml-2 text-muted">{t("gd_members", { n: q.data.members.length })}</span>}
      </summary>
      {q.isError && <p className="mt-2 text-sm text-muted">{t("gd_fail")}</p>}
      {q.data && (
        <table className="mt-2 w-full text-sm">
          <tbody>
            {q.data.members.map((m) => {
              const k = cls(m.classId);
              return (
                <tr key={m.name} className="border-t border-edge/30">
                  <td className="py-1 pr-2">
                    <span className="flex items-center gap-2">
                      <span className="h-5 w-5 flex-none rounded-sm" style={k ? iconStyle(icons.data, k.icon) : undefined} />
                      <span style={{ color: k?.color }}>{m.name}</span>
                    </span>
                  </td>
                  <td className="py-1 pr-2 text-right font-mono">{m.level ?? "?"}</td>
                  <td className="py-1 text-right text-xs text-muted">{m.rank === 0 ? t("gd_gm") : `${t("gd_rank")} ${m.rank ?? "?"}`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </details>
  );
}
