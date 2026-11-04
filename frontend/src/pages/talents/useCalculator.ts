import { useCallback, useEffect, useMemo, useState } from "react";
import {
  analyzeSave, byId, canAdd, canRemove, decodeOrder, decodeRanks, makeLink, normOrder, parseLink, pointsAt, pruneRanks,
  spent, startLevel, tabSpent, type ClassData, type Ranks, type SavedBuild, type TalentDataset,
} from "../../engine";
import { store } from "../../lib/store";

interface State {
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

/** Restore a class from its per-class autosave (by node id, so it survives layout changes). */
function restore(c: ClassData, level: number): Pick<State, "level" | "ranks" | "order"> {
  const saved = store.get<AutoSave | null>("build." + c.token, null);
  if (!saved?.ranks) return { level, ranks: {}, order: [] };
  const M = byId(c);
  const r: Ranks = {};
  for (const [id, v] of Object.entries(saved.ranks)) if (M[+id] && v > 0) r[+id] = Math.min(v, M[+id].max);
  pruneRanks(c, r);
  return { level: saved.level || level, ranks: r, order: normOrder(c, r, saved.order) };
}

function fromHash(D: TalentDataset): State | null {
  const p = parseLink(location.hash);
  if (!p) return null;
  const c = D.classes.find((k) => k.token.toLowerCase() === p.cls);
  if (!c) return null;
  // v2 links name their game build; ranks are positional, so a different build may shift talents.
  const ranks = decodeRanks(c, p.ranksCode);
  pruneRanks(c, ranks);
  return { cls: c.token, level: p.level, legacy: p.legacy, ranks, order: normOrder(c, ranks, decodeOrder(c, p.orderCode)) };
}

export function useCalculator(D: TalentDataset | undefined) {
  const [s, setS] = useState<State | null>(null);

  // init once data is there: link > autosave of the last class > empty priest (the first planned main)
  useEffect(() => {
    if (!D || s) return;
    const h = fromHash(D);
    if (h) return setS(h);
    const token = store.get("cls", "PRIEST");
    const c = D.classes.find((k) => k.token === token) ?? D.classes[0];
    setS({ cls: c.token, legacy: store.get("legacy", 0), ...restore(c, 60) });
  }, [D, s]);

  const c = useMemo(() => D?.classes.find((k) => k.token === s?.cls), [D, s?.cls]);
  const M = useMemo(() => (c ? byId(c) : {}), [c]);
  const talented = D?.legacy?.talented ?? null;
  const start = startLevel(talented, s?.legacy ?? 0);
  const total = s ? pointsAt(s.level, start) : 0;
  const used = c && s ? spent(c, s.ranks) : 0;

  // keep link + autosave in sync
  useEffect(() => {
    if (!c || !s || !D) return;
    const build = +D.build.split(".").pop()!;
    const h = "#" + makeLink(c, { level: s.level, legacy: s.legacy, ranks: s.ranks, order: s.order, build });
    if (location.hash !== h) history.replaceState(null, "", h);
    store.set("build." + c.token, { level: s.level, v: D.build, ranks: s.ranks, order: s.order } satisfies AutoSave);
    store.set("cls", c.token);
    store.set("legacy", s.legacy);
  }, [c, s, D]);

  const add = useCallback(
    (id: number): "add" | "max" | false => {
      if (!c || !s) return false;
      const x = M[id];
      if (!canAdd(x, c, M, s.ranks, total)) return false;
      const r = (s.ranks[id] || 0) + 1;
      setS({ ...s, ranks: { ...s.ranks, [id]: r }, order: [...s.order, id] });
      return r === x.max ? "max" : "add";
    },
    [c, s, M, total],
  );

  const remove = useCallback(
    (id: number): boolean => {
      if (!c || !s) return false;
      if (!canRemove(M[id], c, M, s.ranks)) return false;
      const ranks = { ...s.ranks, [id]: s.ranks[id] - 1 };
      if (!ranks[id]) delete ranks[id];
      const order = s.order.slice();
      const i = order.lastIndexOf(id);
      if (i >= 0) order.splice(i, 1);
      setS({ ...s, ranks, order: normOrder(c, ranks, order) });
      return true;
    },
    [c, s, M],
  );

  const resetTab = (ti: number) => {
    if (!c || !s) return;
    const ids = new Set(c.tabs[ti].talents.map((x) => x.id));
    const ranks = Object.fromEntries(Object.entries(s.ranks).filter(([id]) => !ids.has(+id)));
    // if the build is no longer valid (other trees depended on nothing here, but be safe), reset everything
    const before = Object.keys(ranks).length;
    pruneRanks(c, ranks);
    const all = Object.keys(ranks).length !== before;
    setS({ ...s, ranks: all ? {} : ranks, order: all ? [] : normOrder(c, ranks, s.order) });
  };

  const resetAll = () => s && setS({ ...s, ranks: {}, order: [] });

  const selectClass = (token: string) => {
    if (!D || !s) return;
    const k = D.classes.find((x) => x.token === token)!;
    setS({ ...s, cls: token, ...restore(k, s.level) });
  };

  const setLevel = (level: number) => s && setS({ ...s, level: Math.max(start, Math.min(60, level)) });
  const setLegacy = (legacy: number) => {
    if (!s) return;
    const st = startLevel(talented, legacy);
    setS({ ...s, legacy, level: Math.max(st, s.level) });
  };

  const openSave = (sv: SavedBuild) => {
    if (!D || !s) return null;
    const k = D.classes.find((x) => x.token === sv.cls);
    if (!k) return null;
    const a = analyzeSave(k, sv);
    setS({ cls: k.token, legacy: sv.legacy || 0, level: sv.level || 60, ranks: a.ranks, order: normOrder(k, a.ranks, sv.order) });
    return a;
  };

  return {
    s, c, M, talented, start, total, used,
    split: c && s ? tabSpent(c, s.ranks) : [0, 0, 0],
    add, remove, resetTab, resetAll, selectClass, setLevel, setLegacy, openSave,
  };
}
