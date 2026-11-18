/** Blizzard-backed features: API status, characters, items, auction house. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "./api";
import type { Key, Lang } from "./i18n";

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
  name: string; surname?: string | null; level: number | null; classId: number | null; className: string; race: string; raceId?: number | null; gender?: string;
  faction?: string; guild: { name: string; href?: string } | null; ruleset: string | null; ilvl?: number;
  lastLogin?: number; xp?: number | null;
}
export interface QuestInfo {
  id: number; title: string; area: string | null; description: string | null; level: number | null; xp: number | null;
  money: number | null; reputations: { name: string; value: number | null }[]; items: { id: number; name: string; choice: boolean }[];
}
export interface StatGroup { group: string; rows: { id: number | null; name: string; value: number | null }[] }
export interface ItemSet {
  name: string; worn: number; items: { name: string; equipped: boolean }[]; effects: { text: string; count: number | null }[];
}
export interface EquipItem {
  slot: string; slotName: string; id: number; name: string; quality?: string; ilvl?: number;
  stats: string[]; enchants: string[]; set?: string | null; icon?: string | null; setInfo?: ItemSet | null;
}
export interface CharTalent { node: number | null; talent: number | null; spell: number | null; name: string; rank: number }
export interface Character {
  id: number; region: Region; slug: string; name: string; source: "manual" | "bnet";
  summary: Record<Lang, CharSummary> | null; error: string | null; fetched: string | null;
  equipment?: Record<Lang, EquipItem[]> | null; talents?: CharTalent[] | null; avatar?: string | null;
  missing?: string[];
  account?: Record<string, unknown> | null; tried?: string[] | null;
  model?: string | null;
  favorite?: boolean;
  stats?: Record<Lang, Record<string, number | string>> | null;
  professions?: Record<Lang, CharProfession[]> | null;
  xpLog?: { t: number; l: number; x: number | null }[];
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
export interface AhList { id: number; name: string; items: WatchCard[] }
export interface BisSale {
  status: string; level?: number; spec?: string; specs?: string[]; customSet?: boolean; checked?: number; configured?: boolean;
  rows?: { slot: string; rank: number; id: number; name: string; q: number; ilvl: number; req: number; worn: boolean; better: boolean;
    latest: { min: number; median: number; quantity: number; ts: string } }[];
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
  collection: <T,>(kind: string, lang: Lang) => req<T[]>(`/api/collections/${kind}?lang=${lang}`),
  profCategories: (line: number, lang: Lang) => req<{ order: string[]; of: Record<string, number> }>(`/api/professions/${line}/categories?lang=${lang}`),
  craft: <T,>(lang: Lang) => req<T>(`/api/craft?lang=${lang}`),
  signals: <T,>(lang: Lang) => req<T>(`/api/craft/signals?lang=${lang}`),
  setSignalCfg: (b: { minCraft: number; minFlip: number }) => req<{ minCraft: number; minFlip: number }>("/api/craft/signals/settings", { method: "PUT", body: JSON.stringify(b) }),
  craftPlan: <T,>(cid: number, prof: number, target: number, resale: boolean, lang: Lang) =>
    req<T>(`/api/craft/plan?cid=${cid}&prof=${prof}&target=${target}&resale=${resale}&lang=${lang}`),
  quest: (id: number, lang: Lang) => req<QuestInfo>(`/api/quests/${id}?lang=${lang}`),
  bis: <T,>(cid: number, spec: string | null, lang: Lang) => req<T>(`/api/bis/${cid}?lang=${lang}${spec ? `&spec=${spec}` : ""}`),
  bisPick: (cid: number, b: { spec: string; slot: string; pick: number }) => req<{ ok: boolean }>(`/api/bis/${cid}/pick`, { method: "PUT", body: JSON.stringify(b) }),
  bisCustom: (cid: number, b: { base: string; weights: Record<string, number> }) => req<{ ok: boolean }>(`/api/bis/${cid}/custom`, { method: "PUT", body: JSON.stringify(b) }),
  bisSpec: (cid: number, spec: string) => req<{ ok: boolean }>(`/api/bis/${cid}/spec`, { method: "PUT", body: JSON.stringify({ spec }) }),
  character: (id: number) => req<Character>(`/api/characters/${id}`),
  addCharacter: (b: { name: string; region: Region }) => req<Character>("/api/characters", { method: "POST", body: JSON.stringify(b) }),
  refreshCharacter: (id: number) => req<Character>(`/api/characters/${id}/refresh`, { method: "POST" }),
  deleteCharacter: (id: number) => req<void>(`/api/characters/${id}`, { method: "DELETE" }),
  guild: (id: number, lang: Lang) =>
    req<{ name: string; members: { name: string; surname?: string | null; level: number | null; classId: number | null; rank: number | null }[] }>(
      `/api/characters/${id}/guild?lang=${lang}`),
  tab: <T,>(cid: number, name: string, lang: Lang) =>
    req<{ available: boolean; status?: number; data: T | null; at?: string | null }>(`/api/characters/${cid}/tab/${name}?lang=${lang}`),
  professions: () => req<ProfIndex>("/api/professions"),
  known: (cid: number) => req<Record<string, number[]>>(`/api/characters/${cid}/known`),
  markKnown: (cid: number, b: { line: number; ids: number[]; known: boolean }) =>
    req<Record<string, number[]>>(`/api/characters/${cid}/known`, { method: "PUT", body: JSON.stringify(b) }),
  sources: (id: number, lang: Lang) => req<ItemSources>(`/api/sources/item/${id}?lang=${lang}`),
  profession: (line: number, lang: Lang) => req<ProfDetail>(`/api/professions/${line}?lang=${lang}`),
  rebuildRecipes: () => req<ProfIndex>("/api/professions/rebuild", { method: "POST" }),
  item: (id: number, lang: Lang) => req<ItemInfo>(`/api/items/${id}?lang=${lang}`),
  searchItems: (q: string, lang: Lang) =>
    req<{ id: number; name: string; quality?: string }[]>(`/api/items/search?q=${encodeURIComponent(q)}&lang=${lang}`),
  market: (lang: Lang) => req<MarketConfig>(`/api/market/config?lang=${lang}`),
  houses: (ruleset: number, region: Region, lang: Lang) =>
    req<{ id: number; name: string }[]>(`/api/market/houses?ruleset=${ruleset}&region=${region}&lang=${lang}`),
  setMarket: (b: { region: Region; ruleset: number; house: number }) =>
    req<unknown>("/api/market/config", { method: "PUT", body: JSON.stringify(b) }),
  compare: (ruleset: number, region: Region, item: number, lang: Lang) =>
    req<{ id: number; name: string; lots: number; items: number; error?: string | null; itemMin?: number | null; itemQty?: number | null }[]>(
      `/api/market/compare?ruleset=${ruleset}&region=${region}&item=${item}&lang=${lang}`),
  refreshMarket: () => req<MarketConfig["state"]>("/api/market/refresh", { method: "POST" }),
  lists: (lang: Lang) => req<AhList[]>(`/api/market/lists?lang=${lang}`),
  addList: (name: string) => req<AhList>("/api/market/lists", { method: "POST", body: JSON.stringify({ name }) }),
  renameList: (id: number, name: string) => req<AhList>(`/api/market/lists/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  deleteList: (id: number) => req<void>(`/api/market/lists/${id}`, { method: "DELETE" }),
  addToList: (id: number, b: { item_id: number; below: number | null }, lang: Lang) =>
    req<WatchCard>(`/api/market/lists/${id}/items?lang=${lang}`, { method: "POST", body: JSON.stringify(b) }),
  removeFromList: (id: number, iid: number) => req<void>(`/api/market/lists/${id}/items/${iid}`, { method: "DELETE" }),
  bisSale: (cid: number, spec: string | null, lang: Lang) =>
    req<BisSale>(`/api/market/bis/${cid}?lang=${lang}${spec ? `&spec=${spec}` : ""}`),
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

/** Forever's ruleset index has bare ids; known ones: 1 PvP, 2 Normal, 3 RP, 15 RP-PvP (community probes). */
export function rulesetName(r: Ruleset, t: (k: Key, v?: Record<string, string | number>) => string): string {
  if (r.name && r.name !== String(r.id)) return r.name;
  return [1, 2, 3, 15].includes(r.id) ? t(`rs_${r.id}` as Key) : t("rs_n", { n: r.id });
}

/** Blizzard images through the hub (ad blockers drop some render.worldofwarcraft.com icons). */
export const media = (url?: string | null) => (url ? `/api/media?u=${encodeURIComponent(url)}` : undefined);

export interface CharProfession {
  name: string; id?: number; kind: "primary" | "secondary"; skill: number | null; max: number | null;
  known?: number[]; knownNames?: string[]; hasKnown?: boolean;
}
export interface ProfIndex {
  status: "ready" | "building" | "error"; build: string; error?: string;
  professions?: { id: number; name: { en: string; ru: string }; recipes: number }[];
}
export interface RefItem { id: number; name: string; q?: number | null }
export interface Recipe {
  id: number; spell: number; name: string; nameEn: string; skill: number | null; yellow: number | null;
  green: number | null; gray: number | null;
  source: "trainer" | "auto" | "item"; count: number | null; item: RefItem | null; recipeItem: RefItem | null;
  reagents: (RefItem & { count: number })[];
}
export interface ProfDetail { status: "ready" | "building"; build: string; id?: number; name?: string; recipes?: Recipe[] }

/** Item quality index (client files) -> the API's quality names used for colors. */
export const Q_BY_INDEX = ["POOR", "COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY", "ARTIFACT", "HEIRLOOM"];

export interface ItemSources {
  item: ItemInfo | null;
  sold: { npc: number; name: string | null; installs: number | null; lastSeen?: string; copper: number | null; limited: number | null; unlimited: boolean | null }[];
  drops: { npc: number; name: string | null; rate: number | null; kills: number | null; reporters: number | null }[];
  quests: { quest: number; title: string | null; installs: number | null }[];
  wiki: { text: string; url: string | null; asOf: string | null }[];
  everloot: string; dataAsOf?: string; errors: string[]; at: string;
  /** ForeverDB: who sells it (where, the price, seen in Forever or the original game's data) and which recipe makes it */
  fdb?: { sold: { npc: number; name: string | null; title: string | null; side: string | null; zone: string | null; x: number | null; y: number | null;
    price: number | null; stack: number | null; limited: boolean | null; seen: boolean; rep: string | null }[];
    made: { profession: string; recipe: string; skill: number | null; ways: string[] }[] };
  /** the hub's own references: quests that reward it (Blizzard's data) and creatures that drop it (the original game's data) */
  own?: { quests: { id: number; name: string; area: string | null; chain: boolean; side?: "A" | "H" | null }[];
    drops: { top: { id: number; name: string; rank: string | null; level: number[] | null; instance: string | null; zone: string | null; x: number | null; y: number | null; chance: number }[]; count: number; world: boolean } | null };
  /** what the hub knows itself, when Everloot did not answer (in full or in part) */
  local?: { crafted: { profession: string; recipe: string; skill: number | null }[]; bind: "pickup" | "equip" | "use" | "quest" | null;
    auction: { min: number; qty: number; at?: string } | null };
}

/**
 * "Name Surname", Forever's way. The surname comes from the profile; for cards fetched before it was read,
 * from the lookup slug (name-surname), capitalised.
 */
export function fullName(c: { name: string; slug?: string; summary?: Record<Lang, CharSummary> | null }, lang: Lang): string {
  const s = c.summary?.[lang];
  const first = s?.name || c.name;
  let sur = s?.surname;
  if (!sur && c.slug && c.slug.toLowerCase().startsWith(first.toLowerCase() + "-")) {
    sur = c.slug.slice(first.length + 1).split("-").filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
  }
  return sur && !first.toLowerCase().endsWith(" " + sur.toLowerCase()) ? `${first} ${sur}` : first;
}
