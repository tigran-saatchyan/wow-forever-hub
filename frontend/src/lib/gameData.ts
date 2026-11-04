import { useQueries, useQuery } from "@tanstack/react-query";
import { useEffect, useState, type CSSProperties } from "react";
import { fixGates, type NotesData, type TalentDataset } from "../engine";
import { data } from "./api";
import type { Lang } from "./i18n";
import type { StatusData } from "./status";

export interface IndexData {
  generated: string;
  latest: string;
  phase: string;
  builds: BuildInfo[];
  archive?: string;
  betaFinal?: string;
}

export interface BuildInfo {
  version: string;
  build: number;
  seen: string;
  from?: string;
  talents?: boolean;
  changes?: number | null;
  changesByLang?: Record<string, number>;
}

/** Trainer spells per class and level, and which talents modify each spell (data/abilities). */
export interface AbilityRow {
  l: number; // level
  s: number; // spell id
  n: string;
  r: number; // rank
  i: string; // icon
  d?: string;
  a?: number[]; // talents that modify it
  t?: number; // exists only with this talent
}
export interface AbilitiesData {
  build: string;
  classes: Record<string, AbilityRow[]>;
  talentLinks: Record<string, Record<string, number[]>>;
}

/** One entry of data/diffs/<build>.<lang>.json */
export interface DiffChange {
  kind: "added" | "removed" | "text" | "renamed" | "requires" | "meta" | "moved" | "ranks" | "gate";
  class: string;
  node: number;
  talent?: string;
  numbers?: boolean;
  before?: unknown;
  after?: unknown;
}
export interface DiffData {
  from: string;
  to: string;
  changes: DiffChange[];
}

export interface NewsTopic {
  topic: number;
  title: string;
  kind: string;
  first: string;
  last: string;
  authors: string[];
  excerpt: string;
  url: string;
  region: string;
  regions?: string[];
}

export interface Icons {
  size: number;
  width: number;
  height: number;
  icons: Record<string, [number, number]>;
}

const forever = { staleTime: Infinity } as const;

export const useIndex = () => useQuery({ queryKey: ["index"], queryFn: () => data<IndexData>("index.json"), ...forever });
export const useIcons = () => useQuery({ queryKey: ["icons"], queryFn: () => data<Icons>("icons.json"), ...forever });

export const useNotes = () => useQuery({ queryKey: ["notes"], queryFn: () => data<NotesData>("notes.json"), ...forever });
export const useNews = () => useQuery({ queryKey: ["news"], queryFn: () => data<{ topics: NewsTopic[] }>("news.json") });

export function useAbilities(lang: Lang) {
  const idx = useIndex();
  return useQuery({
    queryKey: ["abilities", idx.data?.latest, lang],
    enabled: !!idx.data,
    // older builds may not have abilities: the plan then simply shows no trainer rows
    queryFn: () => data<AbilitiesData>(`abilities/${idx.data!.latest}/${lang}.json`).catch(() => null),
    ...forever,
  });
}

/** Every client build with talent data: the beta archive plus the live index, oldest first. */
export function useAllBuilds(): BuildInfo[] {
  const idx = useIndex().data;
  const arch = useQuery({
    queryKey: ["archive", idx?.archive],
    enabled: !!idx?.archive,
    queryFn: () => data<{ builds: BuildInfo[] }>(idx!.archive!).catch(() => ({ builds: [] })),
    ...forever,
  }).data;
  const m = new Map<string, BuildInfo>();
  for (const b of arch?.builds || []) if (b.talents) m.set(b.version, b);
  for (const b of idx?.builds || []) m.set(b.version, b);
  return [...m.values()].sort((a, b) => a.build - b.build);
}

/** Talent diffs of the given builds (missing files resolve to null). */
export function useDiffs(versions: string[], lang: Lang): Record<string, DiffData | null> {
  const qs = useQueries({
    queries: versions.map((v) => ({
      queryKey: ["diff", v, lang],
      queryFn: () => data<DiffData>(`diffs/${v}.${lang}.json`).catch(() => null),
      ...forever,
    })),
  });
  const out: Record<string, DiffData | null> = {};
  versions.forEach((v, i) => (out[v] = qs[i].data ?? null));
  return out;
}

export function useTalents(lang: Lang) {
  const idx = useIndex();
  return useQuery({
    queryKey: ["talents", idx.data?.latest, lang],
    enabled: !!idx.data,
    queryFn: async () => fixGates(await data<TalentDataset>(`talents/${idx.data!.latest}/${lang}.json`)),
    ...forever,
  });
}

/**
 * Status and blue posts: loaded once, then kept fresh by the backend's SSE stream (/api/live),
 * which pushes the files again whenever the collector rewrites them.
 */
export function useLive() {
  const status = useQuery({ queryKey: ["status"], queryFn: () => data<StatusData>("status.json") });
  const news = useQuery({ queryKey: ["news"], queryFn: () => data<{ topics: NewsTopic[] }>("news.json") });
  const [live, setLive] = useState<StatusData | null>(null);
  const [liveNews, setLiveNews] = useState<{ topics: NewsTopic[] } | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const es = new EventSource("/api/live");
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.addEventListener("status", (e) => setLive(JSON.parse((e as MessageEvent).data)));
    es.addEventListener("news", (e) => setLiveNews(JSON.parse((e as MessageEvent).data)));
    return () => es.close();
  }, []);

  return { status: live ?? status.data, news: liveNews ?? news.data, connected };
}

export function iconStyle(I: Icons | undefined, name: string): CSSProperties {
  if (!I) return {};
  const p = I.icons[name] || I.icons["inv_misc_questionmark"] || [0, 0];
  const sz = I.size;
  return {
    backgroundImage: "url(/data/icons.jpg)",
    backgroundSize: `${(I.width / sz) * 100}% ${(I.height / sz) * 100}%`,
    backgroundPosition: `${(p[0] / (I.width - sz)) * 100}% ${(p[1] / (I.height - sz)) * 100}%`,
  };
}
