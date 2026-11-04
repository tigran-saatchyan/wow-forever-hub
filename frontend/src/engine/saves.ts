/**
 * Saved builds are stored by node id with each talent's fingerprint, so they survive layout changes
 * and report when a talent changed. Ported from the prototype's snapshot / analyzeSave.
 */
import { byId, pruneRanks } from "./rules";
import type { ClassData, PlacedTalent, Ranks } from "./types";

export interface SavedTalent {
  r: number;
  fp?: string;
  n?: string;
  d?: string;
}

export interface SavedBuild {
  id: string;
  name: string;
  cls: string;
  level: number;
  legacy?: number;
  version: string;
  created?: string;
  updated?: string;
  order?: number[];
  talents: Record<string, SavedTalent>;
  tags?: string[];
  example?: boolean;
}

export function snapshot(c: ClassData, ranks: Ranks): Record<string, SavedTalent> {
  const M = byId(c);
  const out: Record<string, SavedTalent> = {};
  for (const [id, r] of Object.entries(ranks)) {
    const x = M[+id];
    if (x && r) out[id] = { r, fp: x.fp, n: x.name, d: x.ranks[r - 1] };
  }
  return out;
}

export type SaveFlag =
  | { id: number; kind: "gone"; name?: string; r: number; s: SavedTalent }
  | { id: number; kind: "changed"; name: string; icon: string; r: number; s: SavedTalent; x: PlacedTalent }
  | { id: number; kind: "chain"; name: string; icon: string; r: number };

export interface SaveAnalysis {
  ranks: Ranks;
  changed: SaveFlag[];
  chain: SaveFlag[];
  before: number;
  after: number;
  split: number[];
  broken: boolean;
}

/** Check a saved build against the current trees: gone/changed talents are dropped, then the chain pruned. */
export function analyzeSave(c: ClassData, sv: SavedBuild): SaveAnalysis {
  const M = byId(c);
  const ranks: Ranks = {};
  const changed: SaveFlag[] = [];
  for (const [sid, s] of Object.entries(sv.talents || {})) {
    const id = +sid;
    const x = M[id];
    if (!x) {
      changed.push({ id, kind: "gone", name: s.n, r: s.r, s });
      continue;
    }
    if (s.fp && x.fp && s.fp !== x.fp) {
      changed.push({ id, kind: "changed", name: x.name, icon: x.icon, r: s.r, s, x });
      continue;
    }
    ranks[id] = Math.min(s.r, x.max);
  }
  const chain: SaveFlag[] = pruneRanks(c, ranks).map(({ x, r }) => ({
    id: x.id,
    kind: "chain",
    name: x.name,
    icon: x.icon,
    r,
  }));
  const before = Object.values(sv.talents || {}).reduce((a, s) => a + s.r, 0);
  const after = Object.values(ranks).reduce((a, v) => a + v, 0);
  const split = c.tabs.map((tb) => tb.talents.reduce((a, x) => a + (ranks[x.id] || 0), 0));
  return { ranks, changed, chain, before, after, split, broken: changed.length > 0 };
}
