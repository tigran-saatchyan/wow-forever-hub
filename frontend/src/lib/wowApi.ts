/** Blizzard-backed features: API status, characters, items, auction house. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "./api";
import type { Lang } from "./i18n";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, {
    credentials: "include",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  if (!r.ok) {
    let msg = r.statusText;
    try {
      msg = (await r.json()).detail ?? msg;
    } catch {
      /* not json */
    }
    throw new ApiError(r.status, msg);
  }
  return r.status === 204 ? (undefined as T) : r.json();
}

export type Region = "eu" | "us";
export interface Ruleset { id: number; name: string; type?: string }
export interface ApiStatus {
  configured: boolean; region: Region; version?: string; ok?: boolean; error?: string;
  rulesets?: Ruleset[]; ms?: number; checked?: string;
}
export interface ProbeRow { name: string; path: string; namespace: string; status: number; ms: number; sample: string }

export interface CharSummary {
  name: string; level: number | null; classId: number | null; className: string; race: string; gender?: string;
  faction?: string; guild: { name: string; href?: string } | null; ruleset: string | null; ilvl?: number;
  lastLogin?: number;
}
export interface EquipItem {
  slot: string; slotName: string; id: number; name: string; quality?: string; ilvl?: number;
  stats: string[]; enchants: string[]; set?: string | null; icon?: string | null;
}
export interface CharTalent { node: number | null; talent: number | null; spell: number | null; name: string; rank: number }
export interface Character {
  id: number; region: Region; slug: string; name: string; source: "manual" | "bnet";
  summary: Record<Lang, CharSummary> | null; error: string | null; fetched: string | null;
  equipment?: Record<Lang, EquipItem[]> | null; talents?: CharTalent[] | null; avatar?: string | null;
  missing?: string[];
}
export interface ItemInfo {
  id: number; name: string; quality?: string; level?: number; required?: number; class?: string; subclass?: string;
  slot?: string; binding?: string | null; stats: string[]; spells: string[]; armor?: string; damage?: string;
  speed?: string; sell?: number; description?: string; icon?: string | null;
}
export interface PricePoint { t: string; min: number; median: number; q: number }
export interface WatchCard {
  id: number; itemId: number; below: number | null; item: ItemInfo | null; alert: boolean;
  latest: { min: number; median: number; quantity: number; auctions: number; ts: string } | null;
  history: PricePoint[];
}
export interface MarketConfig {
  configured: boolean; selected: { region: Region; ruleset: number; house: number } | null;
  state: { at?: string; ok?: boolean; items?: number; auctions?: number; error?: string };
  rulesets: Ruleset[]; houses: { id: number; name: string }[]; error?: string;
}

export const wowApi = {
  status: (lang: Lang) => req<ApiStatus>(`/api/bnet/status?lang=${lang}`),
  probe: (character?: string) => req<ProbeRow[]>(`/api/bnet/probe${character ? `?character=${encodeURIComponent(character)}` : ""}`),
  account: () => req<{ battletag?: string; characters?: number; linked?: string; error?: string } | null>("/api/bnet/account"),
  characters: () => req<Character[]>("/api/characters"),
  character: (id: number) => req<Character>(`/api/characters/${id}`),
  addCharacter: (b: { name: string; region: Region }) => req<Character>("/api/characters", { method: "POST", body: JSON.stringify(b) }),
  refreshCharacter: (id: number) => req<Character>(`/api/characters/${id}/refresh`, { method: "POST" }),
  deleteCharacter: (id: number) => req<void>(`/api/characters/${id}`, { method: "DELETE" }),
  guild: (id: number, lang: Lang) =>
    req<{ name: string; members: { name: string; level: number | null; classId: number | null; rank: number | null }[] }>(
      `/api/characters/${id}/guild?lang=${lang}`),
  item: (id: number, lang: Lang) => req<ItemInfo>(`/api/items/${id}?lang=${lang}`),
  searchItems: (q: string, lang: Lang) =>
    req<{ id: number; name: string; quality?: string }[]>(`/api/items/search?q=${encodeURIComponent(q)}&lang=${lang}`),
  market: (lang: Lang) => req<MarketConfig>(`/api/market/config?lang=${lang}`),
  houses: (ruleset: number, region: Region, lang: Lang) =>
    req<{ id: number; name: string }[]>(`/api/market/houses?ruleset=${ruleset}&region=${region}&lang=${lang}`),
  setMarket: (b: { region: Region; ruleset: number; house: number }) =>
    req<unknown>("/api/market/config", { method: "PUT", body: JSON.stringify(b) }),
  refreshMarket: () => req<MarketConfig["state"]>("/api/market/refresh", { method: "POST" }),
  watch: (lang: Lang) => req<WatchCard[]>(`/api/market/watch?lang=${lang}`),
  addWatch: (b: { item_id: number; below: number | null }, lang: Lang) =>
    req<WatchCard>(`/api/market/watch?lang=${lang}`, { method: "POST", body: JSON.stringify(b) }),
  deleteWatch: (id: number) => req<void>(`/api/market/watch/${id}`, { method: "DELETE" }),
};

export const useApiStatus = (lang: Lang) =>
  useQuery({ queryKey: ["bnet-status", lang], queryFn: () => wowApi.status(lang), staleTime: 5 * 60e3, retry: false });
export const useCharacters = () => useQuery({ queryKey: ["characters"], queryFn: wowApi.characters });
export const useCharacter = (id: number | null) =>
  useQuery({ queryKey: ["character", id], queryFn: () => wowApi.character(id!), enabled: id != null });
export const useItem = (id: number | null, lang: Lang) =>
  useQuery({ queryKey: ["item", id, lang], queryFn: () => wowApi.item(id!, lang), enabled: id != null, staleTime: Infinity, retry: false });

export function useCharacterActions() {
  const qc = useQueryClient();
  const done = (c?: Character) => {
    void qc.invalidateQueries({ queryKey: ["characters"] });
    if (c) qc.setQueryData(["character", c.id], c);
  };
  return {
    add: useMutation({ mutationFn: wowApi.addCharacter, onSuccess: done }),
    refresh: useMutation({ mutationFn: wowApi.refreshCharacter, onSuccess: done }),
    remove: useMutation({ mutationFn: wowApi.deleteCharacter, onSuccess: () => done() }),
  };
}

/** Item quality colors as in the game. */
export const QUALITY: Record<string, string> = {
  POOR: "#9d9d9d", COMMON: "#ffffff", UNCOMMON: "#1eff00", RARE: "#0070dd", EPIC: "#a335ee",
  LEGENDARY: "#ff8000", ARTIFACT: "#e6cc80", HEIRLOOM: "#00ccff",
};
export const qColor = (q?: string | null) => (q && QUALITY[q]) || undefined;
