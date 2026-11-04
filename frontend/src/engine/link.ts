/**
 * Build links. Format v1 is the prototype's, kept readable forever:
 *   t-<class>-L<level>[-T<legacy>][-O<order>]-<ranks>
 * v2 adds the game build so a link opened after a tree change maps ranks by the right layout:
 *   t2-<class>-B<build>-L<level>[-T<legacy>][-O<order>]-<ranks>
 * ranks: base36 rank per talent in JSON order, tabs joined by "_", trailing zeros cut.
 * order: 2 chars per point: tab index + talent index (base36). Written only if it differs from the default.
 */
import { normOrder, rowOrder } from "./order";
import type { ClassData, Ranks } from "./types";

export function encodeRanks(c: ClassData, ranks: Ranks): string {
  return c.tabs
    .map((tb) =>
      tb.talents
        .map((x) => (ranks[x.id] || 0).toString(36))
        .join("")
        .replace(/0+$/, ""),
    )
    .join("_");
}

export function decodeRanks(c: ClassData, code: string): Ranks {
  const ranks: Ranks = {};
  (code || "").split("_").forEach((s, ti) => {
    const tb = c.tabs[ti];
    if (!tb) return;
    [...s].forEach((ch, i) => {
      const x = tb.talents[i];
      const v = parseInt(ch, 36) || 0;
      if (x && v) ranks[x.id] = Math.min(v, x.max);
    });
  });
  return ranks;
}

export function encodeOrder(c: ClassData, order: number[]): string {
  const pos: Record<number, string> = {};
  c.tabs.forEach((tb, ti) => tb.talents.forEach((x, i) => (pos[x.id] = ti + i.toString(36))));
  return order.map((id) => pos[id] || "").join("");
}

export function decodeOrder(c: ClassData, code: string): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < (code || "").length; i += 2) {
    const x = c.tabs[+code[i]]?.talents[parseInt(code[i + 1], 36)];
    if (x) out.push(x.id);
  }
  return out;
}

export interface LinkState {
  cls: string; // lower-case token as in the link
  build?: number; // v2 only
  level: number;
  legacy: number;
  orderCode: string;
  ranksCode: string;
}

export function makeLink(
  c: ClassData,
  s: { level: number; legacy: number; ranks: Ranks; order: number[]; build?: number },
): string {
  const def = encodeOrder(c, normOrder(c, s.ranks, rowOrder(c, s.ranks)));
  const cur = encodeOrder(c, s.order);
  const o = s.order.length && cur !== def ? "-O" + cur : "";
  const t = s.legacy ? "-T" + s.legacy : "";
  const head = s.build ? `t2-${c.token.toLowerCase()}-B${s.build}` : `t-${c.token.toLowerCase()}`;
  return `${head}-L${s.level}${t}${o}-${encodeRanks(c, s.ranks)}`;
}

const RE = /^t(2)?-([a-z]+)(?:-B(\d+))?-L(\d+)(?:-T(\d))?(?:-O([0-9a-z]*))?-([0-9a-z_]*)$/;

export function parseLink(hash: string): LinkState | null {
  const m = RE.exec(hash.replace(/^#/, ""));
  if (!m) return null;
  const [, v2, cls, build, level, legacy, orderCode, ranksCode] = m;
  if (v2 && !build) return null;
  return {
    cls,
    build: build ? +build : undefined,
    level: Math.max(5, Math.min(60, +level)),
    legacy: legacy ? +legacy : 0,
    orderCode: orderCode || "",
    ranksCode,
  };
}
