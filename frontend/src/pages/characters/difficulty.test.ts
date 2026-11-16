import { describe, expect, it } from "vitest";
import type { Recipe } from "../../lib/wowApi";
import { difficulty } from "./ProfessionsTab";

const r = { skill: 30, yellow: 55, gray: 75 } as Recipe;

describe("recipe difficulty at a skill", () => {
  it("follows the game's colours", () => {
    expect(difficulty(r, 10).key).toBe("pf_d_red");
    expect(difficulty(r, 30).key).toBe("pf_d_orange");
    expect(difficulty(r, 55).key).toBe("pf_d_yellow");
    expect(difficulty(r, 65).key).toBe("pf_d_green");
    expect(difficulty(r, 75).key).toBe("pf_d_gray");
  });
});
