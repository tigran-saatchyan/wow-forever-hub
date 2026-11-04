import { describe, expect, it } from "vitest";
import {
  allTalents, analyzeSave, byId, canAdd, canRemove, decodeOrder, decodeRanks, encodeOrder, encodeRanks,
  gateOk, makeLink, normOrder, orderProblem, parseLink, pointsAt, pruneRanks, rowOrder, runsOf, snapshot,
  spent, startLevel, tabSpent, type ClassData, type Ranks, type SavedBuild,
} from "./index";
import { loadDataset, loadLegacy, readJSON } from "./testkit";

const D = loadDataset();
const cls = (token: string) => D.classes.find((c) => c.token === token)! as ClassData;
const talented = D.legacy!.talented!;

/** Deterministic PRNG so failures are reproducible. */
function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Click random talents like a user would until the points run out. */
function randomBuild(c: ClassData, seed: number, total = 51): { ranks: Ranks; order: number[] } {
  const r = rng(seed);
  const M = byId(c);
  const xs = allTalents(c);
  const ranks: Ranks = {};
  const order: number[] = [];
  for (let guard = 0; guard < 4000 && spent(c, ranks) < total; guard++) {
    const x = xs[Math.floor(r() * xs.length)];
    if (canAdd(x, c, M, ranks, total)) {
      ranks[x.id] = (ranks[x.id] || 0) + 1;
      order.push(x.id);
    }
  }
  return { ranks, order };
}

describe("dataset", () => {
  it("has 9 classes, 3 tabs each, 465 talents", () => {
    expect(D.classes).toHaveLength(9);
    expect(D.classes.every((c) => c.tabs.length === 3)).toBe(true);
    expect(D.classes.reduce((a, c) => a + allTalents(c).length, 0)).toBe(465);
  });
  it("gates only count rows above (fixGates)", () => {
    for (const c of D.classes) {
      const M = byId(c);
      for (const x of allTalents(c)) for (const id of x.gate?.from || []) expect(M[id].row).toBeLessThan(x.row);
    }
  });
});

describe("points", () => {
  it("first point at 10, one per level, cap 51", () => {
    expect(pointsAt(9, 10)).toBe(0);
    expect(pointsAt(10, 10)).toBe(1);
    expect(pointsAt(60, 10)).toBe(51);
  });
  it("Legacy Talented tiers move the first point to 9..5, cap stays 51", () => {
    expect(startLevel(talented, 0)).toBe(10);
    expect([1, 2, 3, 4, 5].map((k) => startLevel(talented, k))).toEqual([9, 8, 7, 6, 5]);
    expect(pointsAt(7, startLevel(talented, 3))).toBe(1);
    expect(pointsAt(60, startLevel(talented, 5))).toBe(51);
  });
});

describe("tree rules", () => {
  const c = cls("WARRIOR");
  const M = byId(c);
  const row1 = allTalents(c).find((x) => x.tab === 0 && x.row === 1)!;
  const row0 = allTalents(c).filter((x) => x.tab === 0 && x.row === 0);

  it("row 2 opens after 5 points in the rows above", () => {
    expect(gateOk(row1, {})).toBe(false);
    const ranks: Ranks = {};
    let left = 5;
    for (const x of row0) {
      const n = Math.min(x.max, left);
      if (n) ranks[x.id] = n;
      left -= n;
    }
    expect(gateOk(row1, ranks)).toBe(true);
    expect(canAdd(row1, c, M, ranks, 51)).toBe(true);
  });

  it("arrows need the parent fully ranked; parent cannot drop below max while child is taken", () => {
    const child = allTalents(c).find((x) => x.requires?.length)!;
    const parent = M[child.requires![0]];
    const { ranks } = randomBuild(c, 1);
    for (const k of Object.keys(ranks)) delete ranks[+k];
    // build up legally: everything needed for the child
    const want = normOrder(c, { ...fillTo(c, child) }, []);
    for (const id of want) ranks[id] = (ranks[id] || 0) + 1;
    expect(ranks[parent.id]).toBe(parent.max);
    expect(canRemove(parent, c, M, ranks)).toBe(false);
    expect(canRemove(child, c, M, ranks)).toBe(true);
  });

  it("pruneRanks removes the whole broken chain", () => {
    const { ranks } = randomBuild(c, 7);
    const r = { ...ranks };
    const firstRow = allTalents(c).filter((x) => x.row === 0 && r[x.id]);
    for (const x of firstRow) delete r[x.id];
    pruneRanks(c, r);
    const M2 = byId(c);
    for (const [id] of Object.entries(r)) {
      const x = M2[+id];
      expect(gateOk(x, r)).toBe(true);
    }
  });
});

/** Minimal legal ranks that make `target` learnable, then take it once. */
function fillTo(c: ClassData, target: ReturnType<typeof allTalents>[number]): Ranks {
  const M = byId(c);
  const ranks: Ranks = {};
  const need = (x: typeof target) => {
    for (const id of x.requires || []) {
      need(M[id]);
      ranks[id] = M[id].max;
    }
  };
  need(target);
  // fill rows above in the same tab until the gate is met
  const above = allTalents(c).filter((x) => x.tab === target.tab && x.row < target.row).sort((a, b) => a.row - b.row);
  for (const x of above) {
    if (target.gate && target.gate.from.reduce((a, id) => a + (ranks[id] || 0), 0) >= target.gate.points) break;
    if (!x.requires?.length) ranks[x.id] = Math.max(ranks[x.id] || 0, x.max);
  }
  pruneRanks(c, ranks);
  ranks[target.id] = 1;
  return ranks;
}

describe("order", () => {
  it("normOrder matches ranks and is always a valid learning order", () => {
    for (const c of D.classes)
      for (let s = 0; s < 20; s++) {
        const { ranks, order } = randomBuild(c, s * 31 + c.id);
        const shuffled = order.slice().reverse();
        const o = normOrder(c, ranks, shuffled);
        expect(o.length).toBe(spent(c, ranks));
        expect(orderProblem(c, o)).toBeNull();
      }
  });
  it("orderProblem explains a point taken too early", () => {
    const c = cls("PRIEST");
    const { ranks } = randomBuild(c, 3);
    const o = rowOrder(c, ranks).reverse();
    const p = orderProblem(c, o);
    expect(p).not.toBeNull();
    expect(["gate", "req"]).toContain(p!.kind);
  });
  it("runsOf glues neighbouring points of one talent", () => {
    expect(runsOf([1, 1, 2, 1])).toEqual([
      { id: 1, start: 0, len: 2 },
      { id: 2, start: 2, len: 1 },
      { id: 1, start: 3, len: 1 },
    ]);
  });
});

describe("links", () => {
  it("round-trips ranks and order, v1 and v2", () => {
    for (const c of D.classes) {
      const { ranks, order } = randomBuild(c, c.id * 17);
      expect(decodeRanks(c, encodeRanks(c, ranks))).toEqual(ranks);
      expect(decodeOrder(c, encodeOrder(c, order))).toEqual(order);
      for (const build of [undefined, 70755]) {
        const link = makeLink(c, { level: 60, legacy: 2, ranks, order: normOrder(c, ranks, order), build });
        const p = parseLink("#" + link)!;
        expect(p.cls).toBe(c.token.toLowerCase());
        expect(p.build).toBe(build);
        expect(p.legacy).toBe(2);
        expect(decodeRanks(c, p.ranksCode)).toEqual(ranks);
      }
    }
  });
  it("reads the prototype's link format", () => {
    const p = parseLink("#t-warrior-L60-T3-3531__")!;
    expect(p).toMatchObject({ cls: "warrior", level: 60, legacy: 3, ranksCode: "3531__" });
    expect(parseLink("#t-warrior-L99-5")!.level).toBe(60);
    expect(parseLink("#nonsense")).toBeNull();
  });
});

describe("saved builds", () => {
  it("example save from the beta build is checked against the current trees", () => {
    const ex = readJSON<SavedBuild>("data/example-save.json");
    const c = loadDataset("1.60.1.70755", "ru").classes.find((k) => k.token === ex.cls)!;
    const a = analyzeSave(c, ex);
    expect(a.before).toBeGreaterThan(0);
    expect(a.after).toBeLessThanOrEqual(a.before);
    expect(orderProblem(c, normOrder(c, a.ranks, ex.order))).toBeNull();
  });
  it("snapshot -> analyze is lossless on the same build", () => {
    const c = cls("ROGUE");
    const { ranks } = randomBuild(c, 99);
    const sv: SavedBuild = { id: "x", name: "x", cls: c.token, level: 60, version: D.build, talents: snapshot(c, ranks) };
    const a = analyzeSave(c, sv);
    expect(a.ranks).toEqual(ranks);
    expect(a.broken).toBe(false);
    expect(a.split).toEqual(tabSpent(c, ranks));
  });
});

describe("parity with the prototype (legacy/web/index.html)", () => {
  const L = loadLegacy(D);

  it("same canAdd / canRemove / normOrder / links on random builds of every class", () => {
    for (const c of D.classes) {
      const M = byId(c);
      for (let s = 0; s < 15; s++) {
        const level = 10 + ((s * 7) % 51);
        const tier = s % 6;
        const total = pointsAt(level, startLevel(talented, tier));
        const { ranks, order } = randomBuild(c, s * 101 + c.id, total);
        Object.assign(L.S, { ranks: { ...ranks }, order: order.slice(), level, legacy: tier, cls: c.token });
        const LM = L.byId(c);
        expect(L.totalPoints()).toBe(total);
        for (const x of allTalents(c)) {
          expect(canAdd(x, c, M, ranks, total)).toBe(L.canAdd(LM[x.id], c, LM));
          expect(canRemove(x, c, M, ranks)).toBe(L.canRemove(LM[x.id], c, LM));
        }
        const shuffled = order.slice().reverse();
        expect(normOrder(c, ranks, shuffled)).toEqual(L.normOrder(c, ranks, shuffled));
        expect(rowOrder(c, ranks)).toEqual(L.rowOrder(c, ranks));
        expect(encodeRanks(c, ranks)).toBe(L.encode(c));
        expect(encodeOrder(c, order)).toBe(L.encodeOrder(c, order));
        const bad = orderProblem(c, shuffled);
        const lbad = L.orderProblem(c, shuffled);
        expect(bad?.i ?? null).toBe(lbad?.i ?? null);
        const r1 = { ...ranks };
        const r2 = { ...ranks };
        const drop = allTalents(c).find((x) => x.row === 0 && r1[x.id]);
        if (drop) {
          delete r1[drop.id];
          delete r2[drop.id];
        }
        pruneRanks(c, r1);
        L.pruneRanks(c, r2);
        expect(r1).toEqual(r2);
      }
    }
  });
});
