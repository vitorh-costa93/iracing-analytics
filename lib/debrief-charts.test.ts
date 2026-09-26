import { describe, expect, it } from "vitest";
import type { RaceInput } from "./race-engineer-analysis";
import { buildPaceChart, classifyQuadrant, contextBestLaps, currentStreak, inputConsistencyPct, longestStreak, lossTimingBins, niceCeil, raceGapPct } from "./debrief-charts";

const race = (over: Partial<RaceInput>): RaceInput => ({
  raced_at: "2026-09-01T20:00:00Z", category: "sports_car", series_name: "GT3 Fanatec", track_name: "Spa", car_name: "Ferrari 296 GT3",
  season_week: 1, finish_position: 5, grid_position: 7, position_change: 2, irating_after: 2010, irating_before: 2000, sof: 2000, incidents: 2,
  fastest_lap_time: "2:20.000", ...over,
});

describe("pace reference", () => {
  it("uses the best race lap per car+track", () => {
    const rows = [race({ fastest_lap_time: "2:20.000" }), race({ fastest_lap_time: "2:18.600" }), race({ track_name: "Monza", fastest_lap_time: "1:48.000" })];
    const best = contextBestLaps(rows);
    expect(best.get("Ferrari 296 GT3|Spa")).toBeCloseTo(138.6);
    expect(raceGapPct(rows[0], best)).toBeCloseTo(1.01, 2);
    expect(raceGapPct(rows[1], best)).toBe(0);
  });

  it("drops missing laps and outliers beyond 5%", () => {
    const rows = [race({ fastest_lap_time: "2:00.000" }), race({ fastest_lap_time: "2:10.000" }), race({ fastest_lap_time: null })];
    const best = contextBestLaps(rows);
    expect(raceGapPct(rows[1], best)).toBeNull();
    expect(raceGapPct(rows[2], best)).toBeNull();
  });
});

describe("pace chart", () => {
  it("classifies quadrants against the split", () => {
    expect(classifyQuadrant({ gapPct: 0.2, delta: 10 }, 0.5)).toBe("fastGain");
    expect(classifyQuadrant({ gapPct: 0.9, delta: 10 }, 0.5)).toBe("slowGain");
    expect(classifyQuadrant({ gapPct: 0.2, delta: -10 }, 0.5)).toBe("fastLoss");
    expect(classifyQuadrant({ gapPct: 0.9, delta: 0 }, 0.5)).toBe("slowLoss");
  });

  it("groups season points by week and week points by race", () => {
    const rows = [
      race({ raced_at: "2026-09-01T20:00:00Z", season_week: 1, fastest_lap_time: "2:20.000", irating_after: 2020 }),
      race({ raced_at: "2026-09-02T20:00:00Z", season_week: 1, fastest_lap_time: "2:21.400", irating_after: 1990 }),
      race({ raced_at: "2026-09-09T20:00:00Z", season_week: 2, fastest_lap_time: "2:20.700", irating_after: 1970 }),
    ];
    const season = buildPaceChart("season", rows, rows);
    expect(season.unit).toBe("week");
    expect(season.points.map((point) => [point.label, point.delta, point.races])).toEqual([["W1", 10, 2], ["W2", -30, 1]]);
    expect(season.points[0].gapPct).toBe(0.5);
    const week = buildPaceChart("week", rows.slice(0, 2), rows);
    expect(week.points).toHaveLength(2);
    expect(week.split).toBe(0.5);
    expect(week.quadrants.fastGain + week.quadrants.slowGain + week.quadrants.fastLoss + week.quadrants.slowLoss).toBe(2);
  });

  it("rounds the axis up", () => {
    expect(niceCeil(1.2)).toBe(1.5);
    expect(niceCeil(0.1)).toBe(0.5);
    expect(niceCeil(3.4)).toBe(4);
  });
});

describe("loss timing", () => {
  it("bins only severe losses with a known progress", () => {
    const result = lossTimingBins([
      { delta: -60, progressPct: 10 }, { delta: -80, progressPct: 25 }, { delta: -55, progressPct: 60 }, { delta: -70, progressPct: 100 },
      { delta: -20, progressPct: 5 }, { delta: -90, progressPct: null },
    ], 50);
    expect(result.bins).toEqual([2, 0, 1, 1]);
    expect(result.sample).toBe(4);
    expect(result.averagePct).toBe(48.8);
  });
});

describe("streaks", () => {
  it("reads the open streak at the end and the longest runs", () => {
    expect(currentStreak([5, -3, 4, 8, 2])).toEqual({ length: 3, direction: "gain" });
    expect(currentStreak([5, -3, -1])).toEqual({ length: 2, direction: "loss" });
    expect(currentStreak([5, 0])).toEqual({ length: 0, direction: null });
    expect(longestStreak([1, 2, -1, 3, 4, 5, 0, -2, -2], "gain")).toBe(3);
    expect(longestStreak([1, 2, -1, 3, 4, 5, 0, -2, -2], "loss")).toBe(2);
  });

  it("turns variation into a 0-100 consistency score", () => {
    expect(inputConsistencyPct(12.4)).toBe(88);
    expect(inputConsistencyPct(140)).toBe(0);
    expect(inputConsistencyPct(null)).toBeNull();
  });
});
