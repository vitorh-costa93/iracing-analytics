import { describe, expect, it } from "vitest";
import { compareSeasons } from "@/lib/season-comparison";
import type { RaceInput } from "@/lib/race-engineer-analysis";

const race = (finish: number, before: number, after: number, positionChange = 0): RaceInput =>
  ({ raced_at: "2026-09-01T00:00:00Z", category: "formula_car", series_name: "SF", track_name: "T", car_name: "C", season_week: 1, finish_position: finish, grid_position: 5, position_change: positionChange, irating_before: before, irating_after: after, sof: 2000, incidents: 0, laps: 20, fastest_lap_time: null }) as RaceInput;

describe("compareSeasons (restaurado de 94c4d8d)", () => {
  const now = [race(1, 2000, 2050, 4), race(2, 2050, 2070, 2), race(9, 2070, 2040, -1)];
  const before = [race(8, 2000, 1960, -2), race(5, 1960, 1990, 1)];
  const result = compareSeasons(now, before);

  it("classifica melhorou / piorou / estavel pelo sentido de cada metrica", () => {
    expect(result.improved.map((item) => item.metric)).toContain("Taxa de vitórias");
    expect(result.improved.map((item) => item.metric)).toContain("iRating médio por corrida");
    expect(result.improved.map((item) => item.metric)).toContain("Taxa de pódios");
  });
  it("cada linha traz a unidade e o rotulo sem simbolos soltos", () => {
    const all = [...result.improved, ...result.worsened, ...result.stable];
    expect(all).toHaveLength(6);
    for (const item of all) {
      expect(item.unit).toMatch(/^(%|pts|pos)$/);
      expect(item.metric).not.toContain("Δ");
    }
  });
  it("diferenca menor que 0,1 conta como estavel", () => {
    const same = compareSeasons([race(1, 2000, 2010)], [race(1, 2000, 2010)]);
    expect(same.improved).toHaveLength(0);
    expect(same.worsened).toHaveLength(0);
    expect(same.stable).toHaveLength(6);
  });
});
