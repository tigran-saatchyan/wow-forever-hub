import { describe, expect, it } from "vitest";
import { computeState, nextReset, type StatusData } from "./status";

const base: StatusData = {
  generated: "2026-11-10T12:00:00Z",
  phase: "live",
  regions: {},
  builds: [],
  maintenance: [],
  levelCap: 60,
  dates: { beta_start: "2026-09-17", beta_end: "2026-10-21", launch: "2026-11-04T23:00:00Z" },
};
const at = (iso: string) => Date.parse(iso);

describe("computeState", () => {
  it("prelaunch between beta close and launch", () => {
    expect(computeState(base, at("2026-11-01T00:00:00Z")).k).toBe("prelaunch");
  });
  it("online when fresh and quiet; stale after 2h", () => {
    expect(computeState(base, at("2026-11-10T12:30:00Z")).k).toBe("online");
    expect(computeState(base, at("2026-11-10T14:30:00Z")).k).toBe("stale");
  });
  it("maintenance: soon within 24h, now from 15 min before start", () => {
    const st = { ...base, maintenance: [{ title: "m", url: "", start: "2026-11-11T07:00:00Z", end: "2026-11-11T09:00:00Z" }] };
    expect(computeState(st, at("2026-11-10T12:30:00Z")).k).toBe("soon");
    expect(computeState({ ...st, generated: "2026-11-11T06:50:00Z" }, at("2026-11-11T06:50:00Z")).k).toBe("now");
  });
  it("player reports: 3 topics in the last hour", () => {
    const t = (m: number) => ({ title: "down?", url: "", created: `2026-11-10T12:${m}:00Z`, region: "eu", posts: 3 });
    const st = { ...base, crowd: { topics: [t(10), t(20), t(30)] } };
    expect(computeState(st, at("2026-11-10T12:40:00Z")).k).toBe("reports");
  });
});

describe("nextReset", () => {
  it("US Tuesday 15:00 UTC, EU Wednesday 07:00 UTC", () => {
    const now = at("2026-11-10T16:00:00Z"); // Tuesday after US reset
    expect(new Date(nextReset("us", now)).toISOString()).toBe("2026-11-17T15:00:00.000Z");
    expect(new Date(nextReset("eu", now)).toISOString()).toBe("2026-11-11T07:00:00.000Z");
  });
});
