import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type CSSProperties } from "react";
import { fixGates, type TalentDataset } from "../engine";
import { data } from "./api";
import type { Lang } from "./i18n";
import type { StatusData } from "./status";

export interface IndexData {
  generated: string;
  latest: string;
  phase: string;
  builds: { version: string; build: number; seen: string; changes?: number; changesByLang?: Record<string, number> }[];
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
