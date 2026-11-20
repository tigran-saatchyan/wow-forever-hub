/** The character the whole site is about: picked in the top menu (or in the throne room), the same on every page
 * except Crafting, which switches between professions on its own. Kept in this browser. */
import { useSyncExternalStore } from "react";
import { store } from "./store";
import { useCharacters, type Character } from "./wowApi";

const KEY = "activeChar";
const subs = new Set<() => void>();
// the throne room's pick was the main one before the menu had its own
let cur: number | null = store.get<number | null>(KEY, store.get<number | null>("throneSel", null));

export function setActiveChar(id: number) {
  if (cur === id) return;
  cur = id;
  store.set(KEY, id);
  subs.forEach((f) => f());
}

function subscribe(f: () => void) {
  subs.add(f);
  return () => { subs.delete(f); };
}

/** The picked id as stored (may name a deleted character). */
export function useActiveCharId(): number | null {
  return useSyncExternalStore(subscribe, () => cur);
}

/** The usable characters and the active one among them (the first, if the stored one is gone). */
export function useActiveChar(): { chars: Character[]; char: Character | null; id: number | null; set: (id: number) => void } {
  const q = useCharacters();
  const id = useActiveCharId();
  const chars = (q.data || []).filter((c) => !c.error);
  const char = chars.find((c) => c.id === id) ?? chars[0] ?? null;
  return { chars, char, id: char?.id ?? null, set: setActiveChar };
}
