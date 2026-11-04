/** Shapes of data/talents/<build>/<lang>.json, written by the collector (legacy/collector/talents.py). */

export interface TalentMeta {
  passive?: boolean;
  cost?: string;
  range?: string;
  cast?: string;
  cd?: string;
}

export interface Talent {
  id: number; // trait node id, same in every language
  spell: number;
  row: number; // 0..6
  col: number; // 0..3
  name: string;
  icon: string;
  max: number;
  ranks: string[]; // text per rank
  meta: TalentMeta;
  gate?: { points: number; from: number[] } | null; // N points spent in `from` (rows above) unlocks the row
  requires?: number[]; // arrows: parent must be fully ranked
  fp?: string; // fingerprint of everything that matters for a build
  flag8?: boolean;
}

export interface Tab {
  id: number;
  name: string;
  icon: string;
  background: string;
  talents: Talent[];
}

export interface ClassData {
  id: number;
  token: string; // WARRIOR, PRIEST, ...
  tree: number;
  name: string;
  color: string;
  icon: string;
  tabs: Tab[];
}

export interface LegacyTalented {
  node: number;
  spell: number;
  name: string;
  icon: string;
  tiers: { start: number; desc: string }[];
  baseStart: number;
  gatePoints: number;
  requires?: { name: string; max: number };
}

export interface Rules {
  firstLevel: number;
  maxLevel: number;
  maxPoints: number;
  rows: number;
  cols: number;
}

export interface TalentDataset {
  build: string;
  lang: string;
  rules: Rules;
  classes: ClassData[];
  legacy?: { talented?: LegacyTalented };
}

/** node id -> spent ranks */
export type Ranks = Record<number, number>;

/** Talent with the index of its tab, as the prototype's allTalents() returns. */
export interface PlacedTalent extends Talent {
  tab: number;
}
