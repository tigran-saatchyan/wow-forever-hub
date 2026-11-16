import { describe, expect, it } from "vitest";
import { pace, totalXp, xpToCap, xpToNext } from "./xp";

describe("xp", () => {
  it("gives the classic numbers and nothing at the cap", () => {
    expect(xpToNext(1)).toBe(400);
    expect(xpToNext(32)).toBe(54500);
    expect(xpToNext(59)).toBe(209800);
    expect(xpToNext(60)).toBeNull();
    expect(xpToNext(null)).toBeNull();
  });
  it("counts the way to 60", () => {
    expect(xpToCap(59, 9800)).toBe(200000);
    expect(xpToCap(1, 0)).toBe(4084700);
  });
});

describe("pace", () => {
  it("needs two points a few hours apart", () => {
    expect(pace([{ t: 0, l: 10, x: 0 }])).toBeNull();
    expect(pace([{ t: 0, l: 10, x: 0 }, { t: 3600, l: 10, x: 100 }], 3600)).toBeNull();
  });
  it("counts experience a day and the days to 60", () => {
    const day = 86400;
    const p = pace([{ t: 0, l: 59, x: 0 }, { t: day, l: 59, x: 104900 }], day)!;
    expect(p.perDay).toBe(104900);
    expect(p.levels).toBe(0);
    expect(p.eta).toBeCloseTo(1, 5); // 209 800 a level: one more day
    expect(totalXp(2, 0)).toBe(400);
  });
});
