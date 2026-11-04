import { describe, expect, it } from "vitest";
import { notesItems, npAvailable, npDataset, pendingNotes, type NotesData } from "./notes";
import { legacyNpDataset, loadDataset, readJSON } from "./testkit";

const D = loadDataset();
const N = readJSON<NotesData>("data/notes.json");

describe("Blizzard notes", () => {
  it("counts items per status like the summary", () => {
    const all = Object.values(N.classes).flatMap(notesItems);
    for (const s of ["pending", "done", "unknown"] as const) expect(all.filter((x) => x.s === s).length).toBe(N.summary![s]);
  });

  it("finds pending notes for a talent", () => {
    for (const [cls, cn] of Object.entries(N.classes)) {
      const p = notesItems(cn).find((x) => x.id && x.s === "pending");
      if (p) expect(pendingNotes(N, cls, p.id!)).toContainEqual(p);
    }
  });

  it("builds the preview trees exactly as the prototype", () => {
    const mine = npDataset(D, N);
    const theirs = legacyNpDataset(D, N);
    expect(mine).toEqual(JSON.parse(JSON.stringify(theirs)));
    // something actually changes for the classes that have ops
    const changed = D.classes.filter((c) => npAvailable(N, c.token));
    expect(changed.length).toBeGreaterThan(0);
  });

  it("does not touch the input dataset", () => {
    const before = JSON.stringify(D);
    npDataset(D, N);
    expect(JSON.stringify(D)).toBe(before);
  });
});
