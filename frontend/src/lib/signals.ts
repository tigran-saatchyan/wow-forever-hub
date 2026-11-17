/**
 * Crafting signals: what pays right now (a craft with every reagent bought; an item a vendor pays more for than
 * its cheapest buyout). Read from the server after each auction poll; "new" means not seen on the Crafting page
 * yet in this browser.
 */
import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { useI18n } from "./i18n";
import { store } from "./store";
import { wowApi, type RefItem } from "./wowApi";

export interface CraftSignal extends Record<string, unknown> {
  cid: number; char: string; profName: string; recipe: number; name: string; item: RefItem | null; made: number;
  cost: number; value: number; profit: number; margin: number | null; sale: { where: "ah" | "vendor" | null; ah: number | null; vendor: number | null; qty: number };
  parts: (RefItem & { count: number; unit: number | null; src: "ah" | "vendor" | null })[];
}
export interface FlipSignal extends RefItem { buy: number; sell: number; profit: number; qty: number }
export interface Signals {
  status: string; market?: { configured: boolean; at?: string }; cfg?: { minCraft: number; minFlip: number };
  crafts?: CraftSignal[]; flips?: FlipSignal[];
}

export const signalKey = {
  craft: (s: CraftSignal) => `c:${s.cid}:${s.recipe}:${s.profit}`,
  flip: (s: FlipSignal) => `f:${s.id}:${s.buy}`,
};

const subs = new Set<() => void>();
let seen = new Set<string>(store.get<string[]>("crSeen", []));
export function markSeen(keys: string[]) {
  seen = new Set([...seen, ...keys].slice(-2000));
  store.set("crSeen", [...seen]);
  subs.forEach((f) => f());
}
export const useSeen = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => seen);

export function useSignals() {
  const { lang } = useI18n();
  return useQuery({
    queryKey: ["craft-signals", lang], queryFn: () => wowApi.signals<Signals>(lang),
    staleTime: 5 * 60e3, refetchInterval: 10 * 60e3, retry: false,
  });
}

/** How many signals the user has not looked at yet. */
export function useNewSignals(): number {
  const q = useSignals();
  const s = useSeen();
  const d = q.data;
  if (!d?.crafts && !d?.flips) return 0;
  return (d.crafts || []).filter((x) => !s.has(signalKey.craft(x))).length + (d.flips || []).filter((x) => !s.has(signalKey.flip(x))).length;
}
