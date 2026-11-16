import { describe, expect, it } from "vitest";
import { allTalents, parseLink, type TalentDataset } from "../engine";
import { readJSON } from "../engine/testkit";
import { characterLink, mapTalents } from "./charTalents";

const D = readJSON<TalentDataset>("data/talents/1.60.1.70755/en.json");
const warrior = D.classes.find((c) => c.token === "WARRIOR")!;
const [ihs, second] = allTalents(warrior);

describe("character talents -> calculator", () => {
  it("matches by node, spell and name, and caps ranks at the talent's max", () => {
    const m = mapTalents(warrior, [
      { node: ihs.id, talent: 1, spell: null, name: "", rank: 9 },
      { node: null, talent: 2, spell: second.spell, name: "", rank: 1 },
      { node: null, talent: 3, spell: null, name: "No Such Talent", rank: 1 },
    ]);
    expect(m.ranks).toEqual({ [ihs.id]: ihs.max, [second.id]: 1 });
    expect([m.matched, m.total]).toEqual([2, 3]);
  });

  it("matches a name without node or spell", () => {
    expect(mapTalents(warrior, [{ node: null, talent: null, spell: null, name: ihs.name.toUpperCase(), rank: 2 }]).ranks)
      .toEqual({ [ihs.id]: 2 });
  });

  it("builds a link the calculator can open", () => {
    const h = characterLink(warrior, [{ node: ihs.id, talent: null, spell: null, name: "", rank: 3 }], 42, 70755)!;
    const p = parseLink(h)!;
    expect(p.cls).toBe("warrior");
    expect(p.level).toBe(42);
    expect(characterLink(warrior, [], 42, 70755)).toBeNull();
  });
});
