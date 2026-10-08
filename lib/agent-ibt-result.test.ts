import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AgentValidationError } from "./agent-result";
import { estimateIratingDelta, parseAgentIbtResult, strengthOfField } from "./agent-ibt-result";

function entrant(carIdx: number, overrides: Record<string, unknown> = {}) {
  return { carIdx, classId: 10, irating: 2000, started: true, position: carIdx + 1, classPosition: carIdx, lapsComplete: 20, fastestTime: 90 + carIdx, ...overrides };
}
function fixture() {
  return { version: 1, kind: "ibt_result", key: "a".repeat(64), result: {
    origin: "live", resultsOfficial: true, official: true, customerId: 42, subsessionId: 89199619,
    seriesId: 447, seasonId: 5900, category: "SportsCar", raceWeek: 3, racedAt: "2026-10-07T21:40:00Z",
    trackId: 8, trackName: "Red Bull Ring", trackConfig: "Grand Prix",
    driver: { carIdx: 1, carId: 196, carName: "Ferrari 499P", licLevel: 18, licSubLevel: 281, lapsLed: 0, incidents: 4, gridPosition: 5 },
    // Overall Position is 1-based, ClassPosition 0-based (as observed in real SessionInfo).
    entrants: [
      entrant(0, { fastestTime: 89.5 }),
      entrant(1, { fastestTime: 89.9 }),
      entrant(2, { classId: 20, position: 3, classPosition: 0, irating: 1500, fastestTime: 95.2 }),
      entrant(3, { started: false, position: null, classPosition: null, lapsComplete: null, fastestTime: null }),
    ],
  } };
}

describe("estimateIratingDelta", () => {
  it("is symmetric for an equal field and matches the known formula", () => {
    const field = Array.from({ length: 10 }, (_, index) => ({ irating: 2000, started: true, position: index + 1 }));
    expect(estimateIratingDelta(field, 0)).toBe(89);
    expect(estimateIratingDelta(field, 9)).toBe(-89);
    const total = field.reduce((sum, _, index) => sum + estimateIratingDelta(field, index), 0);
    expect(Math.abs(total)).toBeLessThanOrEqual(10);
  });
  it("rewards beating stronger drivers more than weaker ones", () => {
    const strong = [{ irating: 1500, started: true, position: 1 }, { irating: 3000, started: true, position: 2 }];
    const weak = [{ irating: 3000, started: true, position: 1 }, { irating: 1500, started: true, position: 2 }];
    expect(estimateIratingDelta(strong, 0)).toBeGreaterThan(estimateIratingDelta(weak, 0));
    expect(estimateIratingDelta(weak, 0)).toBeGreaterThan(0);
  });
  it("gives a non-starter a loss", () => {
    const field = [{ irating: 2000, started: true, position: 1 }, { irating: 2000, started: true, position: 2 }, { irating: 2000, started: false, position: null }];
    expect(estimateIratingDelta(field, 2)).toBeLessThan(0);
  });
  it("computes iRacing strength of field", () => {
    expect(strengthOfField([2000, 2000])).toBe(2000);
    expect(strengthOfField([1000, 3000])).toBeLessThan(2000);
  });
});

describe("parseAgentIbtResult", () => {
  it("maps class field, 1-based overall and 0-based class positions, estimate and no official rating", () => {
    const parsed = parseAgentIbtResult(fixture(), 42);
    expect(parsed).toMatchObject({ subsessionId: 89199619, nativeCarId: 196, nativeTrackId: 8, seriesId: 447, trackConfig: "Grand Prix" });
    const classField = [{ irating: 2000, started: true, position: 1 }, { irating: 2000, started: true, position: 2 }, { irating: 2000, started: false, position: null }];
    const delta = estimateIratingDelta(classField, 1);
    expect(parsed.row).toEqual({
      raced_at: "2026-10-07T21:40:00.000Z", track_name: "Red Bull Ring", car_name: "Ferrari 499P", category: "sports_car", season_week: 4,
      license_class: "A", safety_rating: 2.81, irating_display: String(2000 + delta), irating_delta: delta,
      grid_position: 5, finish_position: 2, class_finish_position: 2, position_change: 3, laps: 20, laps_led: 0,
      fastest_lap_time: "1:29.900", race_fastest_lap_time: "1:29.500", winner_fastest_lap_time: "1:29.500", class_fastest_lap_time: "1:29.500",
      incidents: 4, points: null, sof: strengthOfField([2000, 2000, 1500]), official_irating_before: null, official_irating_after: null,
    });
  });
  it("re-ranks positions regardless of base and tolerates filtered gaps", () => {
    const payload = fixture();
    payload.result.entrants[0].position = 0; payload.result.entrants[1].position = 5; payload.result.entrants[2].position = 2;
    expect(parseAgentIbtResult(payload, 42).row.finish_position).toBe(3);
  });
  it.each([
    ["another customer", (p: ReturnType<typeof fixture>) => { p.result.customerId = 7; }],
    ["unofficial event", (p: ReturnType<typeof fixture>) => { p.result.official = false as unknown as true; }],
    ["oval category", (p: ReturnType<typeof fixture>) => { p.result.category = "Oval"; }],
    ["driver not classified", (p: ReturnType<typeof fixture>) => { p.result.driver.carIdx = 3; }],
    ["duplicate class positions", (p: ReturnType<typeof fixture>) => { p.result.entrants[1].classPosition = 0; }],
    ["duplicate car", (p: ReturnType<typeof fixture>) => { p.result.entrants[1].carIdx = 0; }],
    ["starter without position", (p: ReturnType<typeof fixture>) => { (p.result.entrants[0] as Record<string, unknown>).position = null; }],
    ["future date", (p: ReturnType<typeof fixture>) => { p.result.racedAt = "2099-01-01T00:00:00Z"; }],
    ["unknown origin", (p: ReturnType<typeof fixture>) => { p.result.origin = "yaml"; }],
  ])("rejects %s", (_, mutate) => {
    const payload = fixture(); mutate(payload);
    expect(() => parseAgentIbtResult(payload, 42)).toThrow(AgentValidationError);
  });
});

describe("ibt_result database precedence (migration contract)", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261008150000_agent_ibt_result.sql", import.meta.url), "utf8");
  it("inserts estimates only when absent and refreshes only its own rows", () => {
    const branch = sql.slice(sql.indexOf("elsif p_kind='ibt_result'"), sql.indexOf("elsif p_kind='telemetry'"));
    expect(branch).toContain("'iracing_ibt',null,null)");
    expect(branch).toMatch(/where race_results\.driver_id=d\.driver_id and race_results\.result_source='iracing_ibt';/);
    expect(branch).not.toContain(",result_source=");
  });
  it("keeps the official JSON overwriting any row and never downgrades it", () => {
    const official = sql.slice(sql.indexOf("if p_kind='result'"), sql.indexOf("elsif p_kind='ibt_result'"));
    expect(official).toContain("result_source='iracing_agent'");
    expect(official).not.toContain("result_source='iracing_ibt'");
    expect(sql).toContain("old.result_source='iracing_agent' and new.result_source is distinct from 'iracing_agent'");
  });
});
