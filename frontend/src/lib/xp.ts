/**
 * Experience to the next level, as in classic WoW (1.12). Blizzard's profile gives only the experience gathered
 * inside the current level, and the client files hold no table, so the classic one is used: it agrees with
 * Forever's numbers seen so far (level 32 with 20 099 of 54 500).
 */
const TO_NEXT = [
  0, 400, 900, 1400, 2100, 2800, 3600, 4500, 5400, 6500, 7600, 8800, 10100, 11400, 12900, 14400, 16000, 17700, 19400,
  21300, 23200, 25200, 27300, 29400, 31700, 34000, 36400, 38900, 41400, 44300, 47400, 50800, 54500, 58600, 62800,
  67100, 71600, 76100, 80800, 85700, 90700, 95800, 101000, 106300, 111800, 117500, 123200, 129100, 135100, 141200,
  147500, 153900, 160400, 167100, 173900, 180800, 187900, 195000, 202300, 209800,
];
export const LEVEL_CAP = 60;

/** Experience needed from `level` to the next one; null at the cap or for an unknown level. */
export function xpToNext(level: number | null | undefined): number | null {
  if (!level || level < 1 || level >= LEVEL_CAP) return null;
  return TO_NEXT[level] ?? null;
}

/** Everything still to gather from (level, xp) to the cap. */
export function xpToCap(level: number, xp: number): number {
  let n = -xp;
  for (let l = level; l < LEVEL_CAP; l++) n += TO_NEXT[l];
  return Math.max(0, n);
}

/** All the experience gathered from level 1: the levels done plus what is in the current one. */
export function totalXp(level: number, xp: number): number {
  let n = xp;
  for (let l = 1; l < Math.min(level, LEVEL_CAP); l++) n += TO_NEXT[l];
  return n;
}

export interface XpPoint { t: number; l: number; x: number | null }
export interface Pace { perDay: number; levels: number; days: number; eta: number | null }

/**
 * The leveling pace from the saved points: experience a day over the last week (or all there is),
 * the levels gained in that time, and the days to 60 at that pace. Null until two points a few hours apart.
 */
export function pace(log: XpPoint[], now = Date.now() / 1000): Pace | null {
  const pts = log.filter((p) => p.x != null && p.l < LEVEL_CAP + 1);
  if (pts.length < 2) return null;
  const last = pts[pts.length - 1];
  const week = pts.filter((p) => p.t >= now - 7 * 86400);
  const first = (week.length >= 2 ? week : pts)[0];
  const span = (last.t - first.t) / 86400;
  if (span < 3 / 24) return null;
  const gained = totalXp(last.l, last.x!) - totalXp(first.l, first.x!);
  const perDay = gained / span;
  const left = last.l >= LEVEL_CAP ? 0 : xpToCap(last.l, last.x!);
  return { perDay, levels: last.l - first.l, days: span, eta: perDay > 0 && left > 0 ? left / perDay : null };
}
