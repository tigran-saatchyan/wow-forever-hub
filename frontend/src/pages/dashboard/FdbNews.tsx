/**
 * ForeverDB on the news page: Blizzard's posts about Forever, ForeverDB's articles, and the buffs and nerfs of my
 * characters' classes, build by build (app/routers/fdb.py). ForeverDB is credited with a link, as its terms ask.
 */
import { useActiveChar } from "../../lib/activeChar";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { req } from "../../lib/api";
import { fmtDate, useI18n, type Key } from "../../lib/i18n";
import { useCharacters } from "../../lib/wowApi";

interface News {
  posts: { title: string; author: string; role: string | null; date: string; source: string; url: string; page: string }[];
  articles: { title: string; summary: string; date: string; type: string; url: string }[];
}
interface Change { build: string; date: string; name: string; about: string | null; icon: string | null; direction: string; text: string | null; url: string; type: string }

const DIR: Record<string, string> = { buff: "text-good", nerf: "text-bad", new: "text-[#9fd0ff]", removed: "text-muted line-through", changed: "text-[#ffd76a]" };

export function FdbNews() {
  const { t, lang } = useI18n();
  const [tab, setTab] = useState<"posts" | "articles" | "changes">("posts");
  const chars = (useCharacters().data || []).filter((c) => !c.error);
  const classes = [...new Map(chars.map((c) => [c.summary?.[lang]?.classId, c.summary?.[lang]?.className])).entries()].filter(([id]) => id) as [number, string][];
  const [cls, setCls] = useState<number | null>(null);
  const mine = useActiveChar().char?.summary?.[lang]?.classId ?? null;
  const cur = cls ?? mine ?? classes[0]?.[0] ?? null;
  const news = useQuery({ queryKey: ["fdb-news"], queryFn: () => req<News>("/api/fdb/news"), staleTime: 30 * 60e3 });
  const changes = useQuery({ queryKey: ["fdb-changes", cur], enabled: tab === "changes" && !!cur, staleTime: 60 * 60e3,
    queryFn: () => req<Change[]>(`/api/fdb/changes/${cur}`) });
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-1">
        {(["posts", "articles", "changes"] as const).map((k) => (
          <button key={k} className={`chip ${tab === k ? "border-gold/60 text-gold" : ""}`} onClick={() => setTab(k)}>{t(`fn_${k}` as Key)}</button>
        ))}
        {tab === "changes" && classes.length > 1 && classes.map(([id, name]) => (
          <button key={id} className={`chip ${cur === id ? "border-gold/60 text-gold" : ""}`} onClick={() => setCls(id)}>{name}</button>
        ))}
        <a className="ml-auto text-[11px] text-gold hover:underline" href="https://foreverdb.net" target="_blank" rel="noopener noreferrer">{t("fdb_credit")}</a>
      </div>
      {news.isError && <p className="text-sm text-muted">{t("fn_off")}</p>}
      {(news.isLoading || changes.isFetching) && <p className="text-sm text-muted">…</p>}
      {tab === "posts" && (
        <ul className="divide-y divide-edge/40">
          {(news.data?.posts || []).slice(0, 8).map((p) => (
            <li key={p.url} className="py-2">
              <a href={p.url} target="_blank" rel="noopener noreferrer" className="group block">
                <span className="text-sm font-semibold group-hover:text-gold">{p.title}</span>
                <p className="mt-0.5 text-[11px] text-muted">{p.author}{p.role ? `, ${p.role}` : ""} · {fmtDate(lang, p.date)} · {p.source}</p>
              </a>
            </li>
          ))}
        </ul>
      )}
      {tab === "articles" && (
        <ul className="divide-y divide-edge/40">
          {(news.data?.articles || []).slice(0, 6).map((a) => (
            <li key={a.url} className="py-2">
              <a href={a.url} target="_blank" rel="noopener noreferrer" className="group block">
                <span className="text-sm font-semibold group-hover:text-gold">{a.title}</span>
                <p className="mt-1 line-clamp-2 text-xs text-muted">{a.summary}</p>
                <p className="mt-0.5 text-[11px] text-muted/80">{fmtDate(lang, a.date)}</p>
              </a>
            </li>
          ))}
        </ul>
      )}
      {tab === "changes" && (
        <ul className="divide-y divide-edge/40">
          {(changes.data || []).slice(0, 15).map((c, i) => (
            <li key={`${c.url}-${c.build}-${i}`} className="flex gap-2 py-2">
              {c.icon && <img src={c.icon} alt="" className="h-7 w-7 flex-none rounded border border-black" />}
              <div className="min-w-0">
                <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold hover:text-gold">{c.name}</a>
                <span className={`ml-2 text-xs ${DIR[c.direction] ?? ""}`}>{t(`fn_dir_${c.direction}` as Key)}</span>
                <p className="text-[11px] text-muted">{c.about ? `${c.about} · ` : ""}{c.build} · {fmtDate(lang, c.date)}</p>
                {c.text && <p className="mt-0.5 line-clamp-2 text-xs">{c.text}</p>}
              </div>
            </li>
          ))}
          {changes.data && !changes.data.length && <li className="py-2 text-sm text-muted">{t("ar_empty")}</li>}
        </ul>
      )}
    </div>
  );
}
