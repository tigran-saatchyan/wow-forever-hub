import { useCallback, useEffect, useMemo, useState } from "react";
import {
  analyzeSave, byId, canAdd, canRemove, decodeOrder, decodeRanks, makeLink, moveRun, normOrder, npAvailable, npDataset, parseLink,
  pointsAt, pruneRanks, ranksAtStep, rowOrder, spent, startLevel, tabSpent, type ClassData, type NotesData,
  type OrderProblem, type Ranks, type SaveFlag, type SavedBuild, type TalentDataset,
} from "../../engine";
import { store } from "../../lib/store";

interface Build {
  cls: string;
  level: number;
  legacy: number;
  ranks: Ranks;
  order: number[];
}

interface AutoSave {
  level: number;
  v: string;
  ranks: Ranks;
  order: number[];
}

/** A saved build opened without its changed talents: those are marked in the trees until hidden. */
export interface Flags {
  name: string;
  items: Map<number, SaveFlag>;
}

/** Restore a class from its per-class autosave (by node id, so it survives layout changes). */
function restore(c: ClassData, level: number): Pick<Build, "level" | "ranks" | "order"> {
  const saved = store.get<AutoSave | null>("build." + c.token, null);
  if (!saved?.ranks) return { level, ranks: {}, order: [] };
  const M = byId(c);
  const r: Ranks = {};
  for (const [id, v] of Object.entries(saved.ranks)) if (M[+id] && v > 0) r[+id] = Math.min(v, M[+id].max);
  pruneRanks(c, r);
  return { level: saved.level || level, ranks: r, order: normOrder(c, r, saved.order) };
}

function fromHash(D: TalentDataset): Build | null {
  const p = parseLink(location.hash);
  if (!p) return null;
  const c = D.classes.find((k) => k.token.toLowerCase() === p.cls);
  if (!c) return null;
  // v2 links name their game build; ranks are positional, so a different build may shift talents.
  const ranks = decodeRanks(c, p.ranksCode);
  pruneRanks(c, ranks);
  return { cls: c.token, level: p.level, legacy: p.legacy, ranks, order: normOrder(c, ranks, decodeOrder(c, p.orderCode)) };
}

export function useCalculator(base: TalentDataset | undefined, notes: NotesData | undefined) {
  const [s, setS] = useState<Build | null>(null);
  const [preview, setPreviewState] = useState<number | null>(null);
  const [flags, setFlags] = useState<Flags | null>(null);
  const [activeSave, setActiveSave] = useState<string | null>(null);
  // preview by Blizzard's notes: the real build is stashed and restored on the way back
  const [np, setNpState] = useState<{ stash: Build; flags: Flags | null; active: string | null } | null>(null);

  const npD = useMemo(() => (base && notes && np ? npDataset(base, notes) : undefined), [base, notes, np]);
  const D = np ? npD : base;

  // init once data is there: link > autosave of the last class > empty priest (the first planned main)
  useEffect(() => {
    if (!base || s) return;
    const h = fromHash(base);
    if (h) return setS(h);
    const token = store.get("cls", "PRIEST");
    const c = base.classes.find((k) => k.token === token) ?? base.classes[0];
    setS({ cls: c.token, legacy: store.get("legacy", 0), ...restore(c, 60) });
  }, [base, s]);

  const c = useMemo(() => D?.classes.find((k) => k.token === s?.cls), [D, s?.cls]);
  const M = useMemo(() => (c ? byId(c) : {}), [c]);
  const talented = D?.legacy?.talented ?? null;
  const start = startLevel(talented, s?.legacy ?? 0);
  const total = s ? pointsAt(s.level, start) : 0;
  const used = c && s ? spent(c, s.ranks) : 0;
  const shown = useMemo(() => (s && preview != null ? ranksAtStep(s.order, preview) : s?.ranks ?? {}), [s, preview]);

  // keep link + autosave in sync (not in the notes preview: those trees are guesses)
  useEffect(() => {
    if (!c || !s || !D || np) return;
    const build = +D.build.split(".").pop()!;
    const h = "#" + makeLink(c, { level: s.level, legacy: s.legacy, ranks: s.ranks, order: s.order, build });
    if (location.hash !== h) history.replaceState(null, "", h);
    store.set("build." + c.token, { level: s.level, v: D.build, ranks: s.ranks, order: s.order } satisfies AutoSave);
    store.set("cls", c.token);
    store.set("legacy", s.legacy);
  }, [c, s, D, np]);

  /** Every edit leaves the "view at level" mode, as in the prototype. */
  const edit = (next: Build) => {
    setPreviewState(null);
    setS(next);
  };

  const add = useCallback(
    (id: number): "add" | "max" | false => {
      if (!c || !s) return false;
      const x = M[id];
      if (!x || !canAdd(x, c, M, s.ranks, total)) return false;
      const r = (s.ranks[id] || 0) + 1;
      edit({ ...s, ranks: { ...s.ranks, [id]: r }, order: [...s.order, id] });
      return r === x.max ? "max" : "add";
    },
    [c, s, M, total],
  );

  const remove = useCallback(
    (id: number): boolean => {
      if (!c || !s || !M[id]) return false;
      if (!canRemove(M[id], c, M, s.ranks)) return false;
      const ranks = { ...s.ranks, [id]: s.ranks[id] - 1 };
      if (!ranks[id]) delete ranks[id];
      const order = s.order.slice();
      const i = order.lastIndexOf(id);
      if (i >= 0) order.splice(i, 1);
      // a removed point may have been needed earlier in the order
      edit({ ...s, ranks, order: normOrder(c, ranks, order) });
      return true;
    },
    [c, s, M],
  );

  const resetTab = (ti: number) => {
    if (!c || !s) return;
    const ids = new Set(c.tabs[ti].talents.map((x) => x.id));
    const ranks: Ranks = Object.fromEntries(Object.entries(s.ranks).filter(([id]) => !ids.has(+id)));
    const before = Object.keys(ranks).length;
    pruneRanks(c, ranks);
    const all = Object.keys(ranks).length !== before;
    edit({ ...s, ranks: all ? {} : ranks, order: all ? [] : normOrder(c, ranks, s.order) });
  };

  const resetAll = () => s && edit({ ...s, ranks: {}, order: [] });

  const selectClass = (token: string) => {
    if (!D || !s) return;
    if (np && !npAvailable(notes, token)) return leaveNp(token);
    const k = D.classes.find((x) => x.token === token)!;
    setFlags(null);
    setActiveSave(null);
    edit({ ...s, cls: token, ...(np ? { ranks: {}, order: [] } : restore(k, s.level)) });
  };

  const setLevel = (level: number) => s && setS({ ...s, level: Math.max(start, Math.min(60, level)) });
  const setLegacy = (legacy: number) => {
    if (!s) return;
    const st = startLevel(talented, legacy);
    edit({ ...s, legacy, level: Math.max(st, s.level) });
  };

  // ----- leveling plan -----
  const setPreview = (n: number | null) => setPreviewState(n == null || !s || n >= s.order.length ? null : Math.max(0, n));
  const move = (from: number, before: number): OrderProblem | null => {
    if (!c || !s) return null;
    const r = moveRun(c, s.order, from, before);
    if (!r) return null;
    if ("problem" in r) return r.problem;
    edit({ ...s, order: r.order });
    return null;
  };
  const autoOrder = () => c && s && edit({ ...s, order: normOrder(c, s.ranks, rowOrder(c, s.ranks)) });

  // ----- saved builds -----
  const openSave = (sv: SavedBuild) => {
    if (!base || !s) return null;
    const k = base.classes.find((x) => x.token === sv.cls);
    if (!k) return null;
    if (np) setNpState(null);
    const a = analyzeSave(k, sv);
    edit({ cls: k.token, legacy: sv.legacy || 0, level: sv.level || 60, ranks: a.ranks, order: normOrder(k, a.ranks, sv.order) });
    setActiveSave(sv.example ? null : sv.id);
    setFlags(a.broken ? { name: sv.name, items: new Map([...a.changed, ...a.chain].map((f) => [f.id, f])) } : null);
    return { a, cls: k };
  };

  // ----- preview by the notes -----
  const enterNp = () => {
    if (!s || np) return;
    setNpState({ stash: s, flags, active: activeSave });
    setFlags(null);
    setActiveSave(null);
    edit({ ...s, ranks: {}, order: [] });
  };
  const leaveNp = (token?: string) => {
    if (!np) return;
    const st = np.stash;
    setNpState(null);
    setFlags(np.flags);
    setActiveSave(np.active);
    if (token && base) {
      const k = base.classes.find((x) => x.token === token)!;
      edit({ ...st, cls: token, ...restore(k, st.level) });
    } else edit(st);
  };

  return {
    D, s, c, M, talented, start, total, used, shown, preview, flags, activeSave, np: !!np,
    split: c && s ? tabSpent(c, s.ranks) : [0, 0, 0],
    add, remove, resetTab, resetAll, selectClass, setLevel, setLegacy,
    setPreview, move, autoOrder, openSave, setFlags, setActiveSave, enterNp, leaveNp,
  };
}

export type Calc = ReturnType<typeof useCalculator>;
