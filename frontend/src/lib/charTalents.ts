/** Map a character's talents from the Blizzard API onto the calculator's nodes. */
import { allTalents, makeLink, normOrder, type ClassData, type Ranks } from "../engine";
import type { CharTalent } from "./wowApi";

export interface Mapped { ranks: Ranks; matched: number; total: number }

/** By TraitNode id first (what the modern API calls `id`), then by spell, then by name. */
export function mapTalents(c: ClassData, rows: CharTalent[]): Mapped {
  const xs = allTalents(c);
  const byNode = new Map(xs.map((x) => [x.id, x]));
  const bySpell = new Map(xs.map((x) => [x.spell, x]));
  const byName = new Map(xs.map((x) => [x.name.trim().toLowerCase(), x]));
  const ranks: Ranks = {};
  let matched = 0;
  for (const r of rows) {
    const x = (r.node != null && byNode.get(r.node))
      || (r.spell != null && bySpell.get(r.spell))
      || (r.name ? byName.get(r.name.trim().toLowerCase()) : undefined);
    if (!x || !(r.rank > 0)) continue;
    ranks[x.id] = Math.min(x.max, Math.max(ranks[x.id] || 0, r.rank));
    matched++;
  }
  return { ranks, matched, total: rows.length };
}

/** Calculator hash for a character's build, or null when nothing was recognised. */
export function characterLink(c: ClassData, rows: CharTalent[], level: number | null, build: number): string | null {
  const m = mapTalents(c, rows);
  if (!m.matched) return null;
  return makeLink(c, { level: Math.min(60, Math.max(10, level || 60)), legacy: 0, ranks: m.ranks, order: normOrder(c, m.ranks, []), build });
}
