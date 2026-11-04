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
