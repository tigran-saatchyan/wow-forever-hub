import { describe, expect, it } from "vitest";
import { readJSON } from "./testkit";

interface Ab {
  classes: Record<string, { n: string; s: number; a?: number[] }[]>;
  talentLinks: Record<string, Record<string, number[]>>;
}
const HOLY_PRECISION = 110852;
const VAMPIRIC_EMBRACE = 105820;
const SHADOWFORM = 105817;

describe("talent -> spell links", () => {
  for (const lang of ["en", "ru"]) {
    it(`do not tie Holy Precision to Shadow spells (${lang})`, () => {
      const ab = readJSON<Ab>(`data/abilities/1.60.1.70755/${lang}.json`);
      const links = ab.talentLinks.PRIEST;
      expect(links[VAMPIRIC_EMBRACE] || []).not.toContain(HOLY_PRECISION);
      expect(links[SHADOWFORM] || []).not.toContain(HOLY_PRECISION);
      // Shadow Word: Pain (spell 589) is modified by Shadow talents, not by Holy Precision
      const swp = ab.classes.PRIEST.find((r) => r.s === 589)!;
      expect(swp.a).not.toContain(HOLY_PRECISION);
      expect(swp.a!.length).toBeGreaterThan(0);
    });
  }
});

describe("trainer list", () => {
  for (const lang of ["en", "ru"]) {
    it(`has each spell once per level, with ranks rising by level (${lang})`, () => {
      const ab = readJSON<{ classes: Record<string, { n: string; s: number; l: number; r: number; d?: string }[]> }>(
        `data/abilities/1.60.1.70755/${lang}.json`,
      );
      for (const rows of Object.values(ab.classes)) {
        const seen = new Set<string>();
        const last: Record<string, number> = {};
        for (const r of [...rows].sort((a, b) => a.l - b.l || a.r - b.r)) {
          const k = `${r.l}|${r.n}|${r.r}`;
          expect(seen.has(k), k).toBe(false);
          seen.add(k);
          expect(r.r, `${r.n} at ${r.l}`).toBeGreaterThan(last[r.n] ?? 0);
          last[r.n] = r.r;
        }
      }
      const priest = ab.classes.PRIEST;
      // Smite: rank 1 comes at level 1, so level 6 is rank 2
      expect(priest.find((r) => r.s === 591)?.r).toBe(2);
      // Shadowguard is listed once on level 20 (its bolt is a helper spell)
      expect(priest.filter((r) => r.l === 20 && r.s === 28377)).toHaveLength(0);
    });
  }
});
