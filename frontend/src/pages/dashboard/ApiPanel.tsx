import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useMe } from "../../lib/auth";
import { useI18n } from "../../lib/i18n";
import { fullName, rulesetName, useApiStatus, useCharacters, wowApi } from "../../lib/wowApi";

/** Is the Blizzard API configured and answering, and (superadmin) which endpoints answer. */
export function ApiPanel() {
  const { t, lang } = useI18n();
  const st = useApiStatus(lang);
  const me = useMe();
  const [who, setWho] = useState("");
  const probe = useMutation({ mutationFn: () => wowApi.probe(who.trim() || undefined) });
  const s = st.data;
  if (!s) return <p className="text-sm text-muted">…</p>;
  return (
    <div className="space-y-2 text-sm">
      {!s.configured ? <p className="text-muted">{t("api_off")}</p> : (
        <>
          <p className="flex items-center gap-2">
            <span className={`dot ${s.ok ? "good" : "bad"}`} />
            {s.ok ? t("api_ok", { ms: s.ms ?? 0 }) : t("api_err")}
            <span className="chip ml-auto uppercase">{s.region}</span>
          </p>
          {s.error && <p className="break-words text-xs text-bad">{s.error}</p>}
          {!!s.rulesets?.length && (
            <p className="flex flex-wrap items-center gap-1.5">
              <span className="eyebrow">{t("api_rulesets")}</span>
              {s.rulesets.map((r) => <span key={r.id} className="chip">{rulesetName(r, t)}</span>)}
            </p>
          )}
        </>
      )}
      {me.data?.role === "superadmin" && s.configured && (
        <details className="pt-1">
          <summary className="cursor-pointer text-gold" title={t("api_probe_t")}>{t("api_probe")}</summary>
          <form className="mt-2 flex gap-2" onSubmit={(e) => (e.preventDefault(), probe.mutate())}>
            <input className="input min-w-0 flex-1 py-1" placeholder={t("api_probe_char")} value={who} onChange={(e) => setWho(e.target.value)} />
            <button className="btn px-2 py-1" disabled={probe.isPending}>{probe.isPending ? "…" : "▶"}</button>
          </form>
          {probe.data && (
            <ul className="mt-2 space-y-1 font-mono text-[11.5px]">
              {probe.data.map((p) => (
                <li key={p.name + p.namespace} title={`${p.path}\n${p.namespace}\n${p.sample}`}>
                  <span className={p.status === 200 ? "text-good" : "text-bad"}>{p.status || "ERR"}</span>{" "}
                  {p.name} <span className="text-muted">· {p.ms} ms</span>
                </li>
              ))}
            </ul>
          )}
          {probe.isError && <p className="mt-1 text-xs text-bad">{String(probe.error)}</p>}
        </details>
      )}
    </div>
  );
}

export function MyCharacters() {
  const { t, lang } = useI18n();
  const list = useCharacters();
  const xs = list.data || [];
  if (!xs.length) return <p className="text-sm text-muted">{t("ch_empty")} <Link to="/characters" className="text-gold">→</Link></p>;
  return (
    <ul className="space-y-1 text-sm">
      {xs.slice(0, 6).map((c) => {
        const s = c.summary?.[lang];
        return (
          <li key={c.id}>
            <Link to="/characters" className="flex justify-between gap-2 hover:text-gold">
              <span className="truncate">{fullName(c, lang)}</span>
              <span className="text-muted">{s ? `${s.level ?? "?"} · ${s.className}` : "…"}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
