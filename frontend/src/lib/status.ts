/** Server state from data/status.json, ported from the prototype's computeState(). Pure: pass `now`. */

export interface Maintenance {
  title: string;
  url: string;
  excerpt?: string;
  start?: string;
  end?: string;
  announced?: string;
  reopening?: string; // time Blizzard promised
  reopened?: string; // confirmed
}

export interface CrowdTopic {
  title: string;
  url: string;
  created: string;
  region: string;
  posts: number;
}

export interface StatusData {
  generated: string;
  phase: string;
  regions: Record<string, { build: number; version: string }>;
  latestBuild?: { version: string; build: number; seen: string };
  builds: { version: string; build: number; seen: string }[];
  maintenance: Maintenance[];
  crowd?: { topics: CrowdTopic[] };
  levelCap: number;
  dates: { beta_start: string; beta_end: string; beta_closed?: string; launch: string };
}

export type ServerState =
  | { k: "prelaunch" }
  | { k: "now"; m: Maintenance; reports: CrowdTopic[] }
  | { k: "soon"; m: Maintenance }
  | { k: "stale"; age: number }
  | { k: "reports"; reports: CrowdTopic[] }
  | { k: "online" };

const H = 3600e3;
const MIN = 60e3;
export const STALE_MS = 2 * H;

export const launchMs = (st: StatusData) => Date.parse(st.dates.launch || "2026-11-04T23:00:00Z");
const betaClosedMs = (st: StatusData) => Date.parse(st.dates.beta_closed || st.dates.beta_end + "T21:00:00Z");

function crowdRecent(st: StatusData, sinceMs: number, now: number) {
  const since = Math.max(sinceMs, now - H);
  return (st.crowd?.topics || []).filter((x) => Date.parse(x.created) >= since);
}

export function computeState(st: StatusData, now = Date.now()): ServerState {
  if (now > betaClosedMs(st) && now < launchMs(st)) return { k: "prelaunch" };
  const age = now - Date.parse(st.generated);
  for (const m of st.maintenance || []) {
    if (!m.start) continue;
    const s = Date.parse(m.start);
    // Over only when confirmed, or once the promised time has passed AND players stopped reporting it down.
    const e = m.reopened
      ? Date.parse(m.reopened)
      : m.reopening
        ? Date.parse(m.reopening) + 30 * MIN
        : m.end
          ? Date.parse(m.end) + 30 * MIN
          : s + 3 * H;
    const reports = crowdRecent(st, e - 30 * MIN, now);
    if (now >= s - 15 * MIN && (now <= e || (!m.reopened && reports.length >= 2 && now - e < 6 * H)))
      return { k: "now", m, reports: crowdRecent(st, s, now) };
    if (s > now && s - now < 24 * H) return { k: "soon", m };
  }
  if (age > STALE_MS) return { k: "stale", age };
  const reports = crowdRecent(st, 0, now);
  if (reports.length >= 3) return { k: "reports", reports };
  return { k: "online" };
}

/**
 * Next weekly reset. Blizzard has not published Forever's reset times; these are the usual
 * Classic ones (US Tuesday 15:00 UTC, EU Wednesday 07:00 UTC) and live in one place to adjust.
 */
export const RESETS = { us: { day: 2, hour: 15 }, eu: { day: 3, hour: 7 } } as const;

export function nextReset(region: keyof typeof RESETS, now = Date.now()): number {
  const { day, hour } = RESETS[region];
  const d = new Date(now);
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour);
  const add = (day - d.getUTCDay() + 7) % 7;
  let next = t + add * 864e5;
  if (next <= now) next += 7 * 864e5;
  return next;
}
