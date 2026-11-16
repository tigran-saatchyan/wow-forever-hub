import { describe, expect, it } from "vitest";
import { xpToCap, xpToNext } from "./xp";

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
