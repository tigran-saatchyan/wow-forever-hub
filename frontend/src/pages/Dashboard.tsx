import { motion } from "framer-motion";
import { useEffect, useState, type ReactNode } from "react";
import { useIndex, useLive } from "../lib/gameData";
import { fmtDate, useI18n, type Key } from "../lib/i18n";
import { computeState, launchMs, nextReset, type ServerState } from "../lib/status";

function useNow(ms = 30e3) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

function Panel({ title, children, className = "", delay = 0 }: { title: string; children: ReactNode; className?: string; delay?: number }) {
  return (
    <motion.section
      className={`panel p-4 ${className}`}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.35 }}
    >
      <h2 className="panel-title mb-3">{title}</h2>
      {children}
    </motion.section>
  );
}

const DOT: Record<ServerState["k"], string> = {
  online: "good", now: "warn", soon: "warn", reports: "bad", stale: "", prelaunch: "",
};

export function Dashboard() {
  const { t, lang } = useI18n();
  const { status: st, news, connected } = useLive();
  const idx = useIndex();
  const now = useNow();

  const span = (ms: number) => {
    ms = Math.max(0, ms);
    const d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5) % 24, m = Math.floor(ms / 6e4) % 60;
    return `${d}${t("days")} ${String(h).padStart(2, "0")}${t("hours")} ${String(m).padStart(2, "0")}${t("minutes")}`;
  };

  if (!st) return <p className="text-muted">…</p>;
  const s = computeState(st, now);
  const f = (iso: string) => fmtDate(lang, iso);
  const text = t(`st_${s.k}_t` as Key, {
    l: f(st.dates.launch),
    t: "m" in s ? f(s.m.start || s.m.announced || st.generated) : "",
    a: "age" in s ? span(s.age) : "",
    n: "reports" in s ? s.reports.length : 0,
  });
  const launched = now >= launchMs(st);
  const cur = Object.values(st.regions)[0] ?? st.latestBuild;
  const week = (news?.topics || []).filter((x) => now - Date.parse(x.last) < 7 * 864e5);

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Panel title={t("st_" + s.k as Key)} className="lg:col-span-2">
        <div className="flex items-start gap-3">
          <span className={`dot mt-1.5 ${DOT[s.k]}`} />
          <div className="flex-1">
            <p className="text-ink">{text}</p>
            <p className="mt-1 text-xs text-muted">
              {fmtDate(lang, st.generated)} · <span className={connected ? "text-good" : ""}>{connected ? t("st_live") : t("st_offline")}</span>
            </p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            [t("f_build"), cur?.version ?? "—"],
            launched ? [t("f_since"), span(now - launchMs(st))] : [t("f_launch"), span(launchMs(st) - now)],
            [t("f_cap"), String(st.levelCap || 60)],
            [t("f_news"), String(week.length)],
          ].map(([k, v]) => (
            <div key={k} className="rounded-md border border-edge/60 bg-bg/50 p-3">
              <div className="eyebrow">{k}</div>
              <div className="mt-1 font-display text-lg text-gold">{v}</div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title={t("reset_title")} delay={0.05}>
        {(["eu", "us"] as const).map((r) => (
          <div key={r} className="flex items-baseline justify-between border-b border-edge/40 py-2 last:border-0">
            <span className="chip uppercase">{r}</span>
            <span className="font-display text-xl text-gold">{span(nextReset(r, now) - now)}</span>
          </div>
        ))}
        <p className="mt-2 text-xs text-muted">{t("reset_note")}</p>
      </Panel>

      <Panel title={t("news_title")} className="lg:col-span-2" delay={0.1}>
        <ul className="divide-y divide-edge/40">
          {(news?.topics || []).slice(0, 8).map((n) => (
            <li key={n.topic + n.region} className="py-2">
              <a href={n.url} target="_blank" rel="noopener noreferrer" className="group block">
                <div className="flex items-center gap-2">
                  <span className="chip">{n.kind}</span>
                  <span className="text-sm font-semibold group-hover:text-gold">{n.title}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-muted">{n.excerpt}</p>
                <p className="mt-0.5 text-[11px] text-muted/80">
                  {(n.regions || [n.region]).join(" + ").toUpperCase()} · {fmtDate(lang, n.last)} · {n.authors.join(", ")}
                </p>
              </a>
            </li>
          ))}
        </ul>
      </Panel>

      <div className="space-y-4">
        <Panel title={t("maint_title")} delay={0.15}>
          {st.maintenance.length ? (
            st.maintenance.map((m) => (
              <a key={m.url} href={m.url} target="_blank" rel="noopener noreferrer" className="block py-1 text-sm hover:text-gold">
                <b>{fmtDate(lang, m.start || m.announced || "")}</b> {m.title}
              </a>
            ))
          ) : (
            <p className="text-sm text-muted">{t("maint_empty")}</p>
          )}
        </Panel>
        <Panel title={t("builds_title")} delay={0.2}>
          <ul className="space-y-1 text-sm">
            {(idx.data?.builds || []).slice(-6).reverse().map((b) => (
              <li key={b.version} className="flex justify-between">
                <span className="font-mono text-gold">{b.build}</span>
                <span className="text-muted">{fmtDate(lang, b.seen.replace(" ", "T") + "Z")}</span>
                <span className="text-xs">{b.changesByLang?.[lang] ?? b.changes ?? 0} Δ</span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title={t("chars_title")} delay={0.25}>
          <p className="text-sm text-muted">{t("chars_soon")}</p>
        </Panel>
      </div>
    </div>
  );
}
