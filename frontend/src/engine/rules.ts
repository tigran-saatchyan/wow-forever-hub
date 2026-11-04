/**
 * Talent tree rules, ported 1:1 from the prototype (legacy/web/index.html: pointsAt, gateOk, reqOk,
 * canAdd, canRemove, pruneRanks, fixGates). Everything here is pure: state goes in, state comes out.
 */
import type { ClassData, LegacyTalented, PlacedTalent, Ranks, TalentDataset } from "./types";

export const MAX_POINTS = 51;
export const BASE_START = 10;

/** Level of the first talent point; a Legacy "Talented" tier moves it from 10 down to 9..5. */
export function startLevel(talented: LegacyTalented | null | undefined, tier: number): number {
  const tr = tier && talented ? talented.tiers[tier - 1] : undefined;
  return tr ? tr.start : BASE_START;
}

export function pointsAt(level: number, start: number): number {
  return Math.max(0, Math.min(MAX_POINTS, level - start + 1));
}

export function allTalents(c: ClassData): PlacedTalent[] {
  return c.tabs.flatMap((tb, ti) => tb.talents.map((x) => ({ ...x, tab: ti })));
}

export type TalentIndex = Record<number, PlacedTalent>;

export function byId(c: ClassData): TalentIndex {
  const m: TalentIndex = {};
  for (const x of allTalents(c)) m[x.id] = x;
  return m;
}

const rk = (ranks: Ranks, id: number) => ranks[id] || 0;

export function spent(c: ClassData, ranks: Ranks): number {
  return allTalents(c).reduce((a, x) => a + rk(ranks, x.id), 0);
}

export function tabSpent(c: ClassData, ranks: Ranks): number[] {
  return c.tabs.map((tb) => tb.talents.reduce((a, x) => a + rk(ranks, x.id), 0));
}

export function gateOk(x: PlacedTalent, ranks: Ranks): boolean {
  return !x.gate || x.gate.from.reduce((a, id) => a + rk(ranks, id), 0) >= x.gate.points;
}

export function reqOk(x: PlacedTalent, M: TalentIndex, ranks: Ranks): boolean {
  return !(x.requires || []).some((id) => M[id] && rk(ranks, id) < M[id].max);
}

export function canAdd(x: PlacedTalent, c: ClassData, M: TalentIndex, ranks: Ranks, total: number): boolean {
  return rk(ranks, x.id) < x.max && spent(c, ranks) < total && gateOk(x, ranks) && reqOk(x, M, ranks);
}

export function validAll(c: ClassData, M: TalentIndex, ranks: Ranks): boolean {
  return allTalents(c).every((x) => !rk(ranks, x.id) || (gateOk(x, ranks) && reqOk(x, M, ranks)));
}

/** A rank can be removed only if the rest of the build stays valid. */
export function canRemove(x: PlacedTalent, c: ClassData, M: TalentIndex, ranks: Ranks): boolean {
  if (!rk(ranks, x.id)) return false;
  return validAll(c, M, { ...ranks, [x.id]: rk(ranks, x.id) - 1 });
}

/**
 * Remove every talent that breaks the rules (row gate or arrow), repeating until stable.
 * Mutates `ranks`; returns what was removed, in removal order.
 */
export function pruneRanks(c: ClassData, ranks: Ranks): { x: PlacedTalent; r: number }[] {
  const M = byId(c);
  const removed: { x: PlacedTalent; r: number }[] = [];
  for (;;) {
    const bad = allTalents(c).filter(
      (x) => rk(ranks, x.id) && (!gateOk(x, ranks) || !reqOk(x, M, ranks)),
    );
    if (!bad.length) return removed;
    for (const x of bad) {
      removed.push({ x, r: ranks[x.id] });
      delete ranks[x.id];
    }
  }
}

/**
 * The client data sometimes lists a talent (and its row neighbours) in its own row-gate group
 * (Shadowform, Mortal Strike). Only points in rows above can open a row. Mutates and returns `data`.
 */
export function fixGates(data: TalentDataset): TalentDataset {
  for (const c of data.classes)
    for (const tb of c.tabs) {
      const row: Record<number, number> = Object.fromEntries(tb.talents.map((x) => [x.id, x.row]));
      for (const x of tb.talents) if (x.gate) x.gate.from = x.gate.from.filter((id) => row[id] < x.row);
    }
  return data;
}

/** Key talents of rows 3, 5, 7: one rank, not passive. Drawn with a dashed frame. */
export function isMilestone(x: { max: number; row: number; meta: { passive?: boolean } }): boolean {
  return x.max === 1 && !x.meta.passive && (x.row === 2 || x.row === 4 || x.row === 6);
}
