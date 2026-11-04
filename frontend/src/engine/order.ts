/**
 * Leveling plan. `order` lists node ids, one per spent point, in the order they are learned:
 * point i is learned at level startLevel + i. Ported 1:1 from the prototype.
 */
import { allTalents, byId, type TalentIndex } from "./rules";
import type { ClassData, PlacedTalent, Ranks } from "./types";

export function pointOk(x: PlacedTalent, M: TalentIndex, have: Ranks): boolean {
  if (x.gate && x.gate.from.reduce((a, id) => a + (have[id] || 0), 0) < x.gate.points) return false;
  return !(x.requires || []).some((id) => M[id] && (have[id] || 0) < M[id].max);
}

/** Default order: heaviest tree first, then row by row, every rank of a talent together. */
export function rowOrder(c: ClassData, ranks: Ranks): number[] {
  const per = c.tabs.map((tb) => tb.talents.reduce((a, x) => a + (ranks[x.id] || 0), 0));
  const tabRank = per
    .map((v, i) => [v, i])
    .sort((a, b) => b[0] - a[0])
    .map((p) => p[1]);
  const xs = allTalents(c)
    .filter((x) => ranks[x.id])
    .sort((a, b) => tabRank.indexOf(a.tab) - tabRank.indexOf(b.tab) || a.row - b.row || a.col - b.col);
  return xs.flatMap((x) => Array<number>(ranks[x.id]).fill(x.id));
}

/**
 * Make `order` agree with `ranks`: drop extra points, append missing ones row by row, and delay
 * any point the game would not allow yet (greedy, keeping the user's sequence otherwise).
 */
export function normOrder(c: ClassData, ranks: Ranks, order: number[] | null | undefined): number[] {
  const M = byId(c);
  const cnt: Ranks = {};
  const keep: number[] = [];
  for (const id of order || [])
    if (M[id] && (cnt[id] || 0) < (ranks[id] || 0)) {
      keep.push(+id);
      cnt[id] = (cnt[id] || 0) + 1;
    }
  for (const id of rowOrder(c, ranks))
    if ((cnt[id] || 0) < ranks[id]) {
      keep.push(+id);
      cnt[id] = (cnt[id] || 0) + 1;
    }
  const have: Ranks = {};
  const out: number[] = [];
  const rest = keep.slice();
  while (rest.length) {
    let i = rest.findIndex((id) => pointOk(M[id], M, have));
    if (i < 0) i = 0; // cannot happen for a valid build; never loop forever
    const id = rest.splice(i, 1)[0];
    out.push(id);
    have[id] = (have[id] || 0) + 1;
  }
  return out;
}

export type OrderProblem =
  | { i: number; x: PlacedTalent; kind: "gate"; points: number; tab: string }
  | { i: number; x: PlacedTalent; kind: "req"; parent: string; max: number };

/** First point of `order` the game would refuse, with the reason; null if the order is valid. */
export function orderProblem(c: ClassData, order: number[]): OrderProblem | null {
  const M = byId(c);
  const have: Ranks = {};
  for (let i = 0; i < order.length; i++) {
    const x = M[order[i]];
    if (!pointOk(x, M, have)) {
      if (x.gate && x.gate.from.reduce((a, id) => a + (have[id] || 0), 0) < x.gate.points)
        return { i, x, kind: "gate", points: x.gate.points, tab: c.tabs[x.tab].name };
      const p = M[(x.requires || []).find((id) => M[id] && (have[id] || 0) < M[id].max) ?? -1];
      return { i, x, kind: "req", parent: p?.name || "?", max: M[(x.requires || [])[0]]?.max || 1 };
    }
    have[x.id] = (have[x.id] || 0) + 1;
  }
  return null;
}

export interface Run {
  id: number;
  start: number;
  len: number;
}

/** Consecutive points of the same talent, shown as one row in the plan. */
export function runsOf(order: number[]): Run[] {
  const runs: Run[] = [];
  order.forEach((id, i) => {
    const r = runs.at(-1);
    if (r && r.id === id) r.len++;
    else runs.push({ id, start: i, len: 1 });
  });
  return runs;
}

/** Move run `from` before run index `before`. Returns the new order, or the problem if it is invalid. */
export function moveRun(
  c: ClassData,
  order: number[],
  from: number,
  before: number,
): { order: number[] } | { problem: OrderProblem } | null {
  const runs = runsOf(order);
  if (before === from || before === from + 1 || before < 0 || before > runs.length) return null;
  const moved = runs[from];
  const rest = runs.filter((_, k) => k !== from);
  rest.splice(before > from ? before - 1 : before, 0, moved);
  const next = rest.flatMap((r) => Array<number>(r.len).fill(r.id));
  const problem = orderProblem(c, next);
  return problem ? { problem } : { order: next };
}

/** Levels at which talent `id` gets its points. */
export function levelsOf(order: number[], id: number, start: number): number[] {
  const out: number[] = [];
  order.forEach((v, i) => {
    if (v === id) out.push(start + i);
  });
  return out;
}

/** Ranks after the first n+1 points of the plan (the "view at level" mode). */
export function ranksAtStep(order: number[], n: number): Ranks {
  const r: Ranks = {};
  for (const id of order.slice(0, n + 1)) r[id] = (r[id] || 0) + 1;
  return r;
}
