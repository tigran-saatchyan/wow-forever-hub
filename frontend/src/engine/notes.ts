/**
 * Blizzard's class notes (data/notes.json) and the preview of the trees by those notes.
 * Port of the prototype's notesItems / pendingNotes / npAvailable / npDataset.
 */
import type { TalentDataset, Talent } from "./types";

export type NoteStatus = "pending" | "done" | "unknown";

export interface NoteOp {
  k: "add" | "remove" | "move" | "ranks" | "rename";
  id?: number;
  row?: number;
  name?: string;
  max?: number;
  desc?: string;
  passive?: boolean;
  slot?: number;
}

export interface NoteItem {
  t: string;
  s: NoteStatus;
  id?: number;
  ops?: NoteOp[];
}

export interface ClassNotes {
  general: NoteItem[];
  tabs: NoteItem[][];
  other: { name: string; items: NoteItem[] }[];
}

export interface NotesData {
  generated: string;
  build: string;
  source: { title: string; url: string; posted: string; updated?: string; author?: string };
  summary?: Record<NoteStatus, number>;
  classes: Record<string, ClassNotes>;
}

export function notesItems(cn: ClassNotes): NoteItem[] {
  return [...cn.general, ...cn.tabs.flat(), ...cn.other.flatMap((o) => o.items)];
}

/** Announced changes to this talent that are not in the client files yet. */
export function pendingNotes(N: NotesData | undefined, cls: string, id: number): NoteItem[] {
  const cn = N?.classes?.[cls];
  return cn ? notesItems(cn).filter((x) => x.id === id && x.s === "pending") : [];
}

export function npAvailable(N: NotesData | undefined, cls: string): boolean {
  const cn = N?.classes?.[cls];
  return !!cn && notesItems(cn).some((x) => x.ops?.length);
}

/**
 * A copy of the client trees with the pending notes applied: new talents in the stated row,
 * removed ones gone, moves, rank counts and names. What the notes do not say (column, icon,
 * arrows of new talents) is guessed, so builds are not saved in this mode.
 */
export function npDataset(base: TalentDataset, N: NotesData): TalentDataset {
  const D: TalentDataset = JSON.parse(JSON.stringify(base));
  let nid = -1;
  for (const c of D.classes) {
    const cn = N.classes[c.token];
    if (!cn) continue;
    type It = NoteItem & { _tab: number | null };
    const items: It[] = [
      ...cn.general.map((it) => ({ ...it, _tab: null })),
      ...cn.tabs.flatMap((tb, ti) => tb.map((it) => ({ ...it, _tab: ti }))),
      ...cn.other.flatMap((o) => o.items.map((it) => ({ ...it, _tab: null }))),
    ];
    const where = (id: number) => {
      for (const [ti, tb] of c.tabs.entries()) {
        const i = tb.talents.findIndex((x) => x.id === id);
        if (i >= 0) return { tb, ti, i, x: tb.talents[i] };
      }
      return null;
    };
    const rowPts = c.tabs.map((tb) => {
      const m: Record<number, number> = {};
      for (const x of tb.talents) if (x.gate) m[x.row] = Math.max(m[x.row] || 0, x.gate.points);
      return m;
    });
    const placed = new Set<number>();
    const removed = new Set<number>();
    for (const it of items)
      for (const op of it.ops || []) {
        if (op.k === "add") {
          if (it._tab == null) continue;
          const slot = op.slot ? where(op.slot) : null;
          const max = op.max || 1;
          const x: Talent = {
            id: nid--, spell: 0, row: (op.row || 1) - 1, col: slot ? slot.x.col : -1, name: op.name || "?",
            icon: "inv_misc_questionmark", max, ranks: Array(max).fill(op.desc || ""), meta: { passive: op.passive },
            gate: null, requires: [], np: "add", npNotes: [it.t],
          };
          if (slot) {
            slot.tb.talents.splice(slot.i, 1);
            removed.add(slot.x.id);
          }
          c.tabs[it._tab].talents.push(x);
          placed.add(x.id);
          continue;
        }
        const f = op.id != null ? where(op.id) : null;
        if (!f) continue;
        const x = f.x;
        if (op.k === "remove") {
          f.tb.talents.splice(f.i, 1);
          removed.add(x.id);
          continue;
        }
        x.np = x.np || "chg";
        x.npNotes ||= [];
        if (!x.npNotes.includes(it.t)) x.npNotes.push(it.t);
        if (op.k === "move") {
          x.row = (op.row || 1) - 1;
          x.npPref = x.col;
          x.col = -1;
          placed.add(x.id);
        } else if (op.k === "ranks") {
          const mx = op.max || x.max;
          x.ranks = Array.from({ length: mx }, (_, i) => x.ranks[i] || it.t);
          x.max = mx;
        } else if (op.k === "rename") x.name = op.name || x.name;
      }
    c.tabs.forEach((tb, ti) => {
      // untouched talents keep their cells; moved / new ones take their old column if free, else the nearest free one
      const used: Record<number, Set<number>> = {};
      const mark = (x: Talent) => (used[x.row] ||= new Set()).add(x.col);
      for (const x of tb.talents) if (!placed.has(x.id) && x.col >= 0) mark(x);
      for (const x of tb.talents)
        if (placed.has(x.id) && x.col >= 0 && !used[x.row]?.has(x.col)) mark(x);
        else if (placed.has(x.id)) x.col = -1;
      for (const x of tb.talents)
        if (x.col < 0) {
          const pref = x.npPref ?? 1;
          const cols = [0, 1, 2, 3].sort((a, b) => Math.abs(a - pref) - Math.abs(b - pref));
          x.col = cols.find((k) => !used[x.row]?.has(k)) ?? pref;
          mark(x);
        }
      // arrows only to parents that still exist above (or beside) the talent
      const byI = Object.fromEntries(tb.talents.map((x) => [x.id, x]));
      for (const x of tb.talents)
        x.requires = (x.requires || []).filter((id) => !removed.has(id) && byI[id] && byI[id].row <= x.row && id !== x.id);
      // row gates: N points in the rows above, as the tree already uses for that row (5 per row otherwise)
      for (const x of tb.talents) {
        if (x.row <= 0) {
          x.gate = null;
          continue;
        }
        x.gate = { points: rowPts[ti][x.row] ?? x.row * 5, from: tb.talents.filter((y) => y.row < x.row).map((y) => y.id) };
      }
    });
  }
  return D;
}
