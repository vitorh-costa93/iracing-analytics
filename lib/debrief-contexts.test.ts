import { describe, expect, it } from "vitest";
import { buildContexts, MIN_CONTEXT_RACES, MIN_CONTEXT_RACES_WEEK } from "@/lib/debrief-contexts";
import type { RaceInput } from "@/lib/race-engineer-analysis";

const race = (track: string, car: string, before: number, after: number, positionChange = 0): RaceInput =>
  ({ raced_at: "2026-09-01T00:00:00Z", category: "sports_car", series_name: "GT3", track_name: track, car_name: car, season_week: 1, finish_position: 5, grid_position: 5, position_change: positionChange, irating_before: before, irating_after: after, sof: 2000, incidents: 0, laps: 20, fastest_lap_time: null }) as RaceInput;

describe("buildContexts", () => {
  it("usa o mesmo minimo de 2 corridas da Visao Geral", () => {
    expect(MIN_CONTEXT_RACES).toBe(2);
    const result = buildContexts([race("Monza", "A", 2000, 1900)], 100);
    expect(result.losses).toEqual([]);
  });
  it("ranqueia pela media por corrida, nao pela soma", () => {
    // Monza: 3 corridas, soma -90, media -30. Spa: 2 corridas, soma -80, media -40 (pior media).
    const rows = [race("Monza", "A", 2000, 1970), race("Monza", "A", 1970, 1940), race("Monza", "A", 1940, 1910), race("Spa", "A", 1910, 1870), race("Spa", "A", 1870, 1830)];
    const { losses } = buildContexts(rows, 170);
    expect(losses.map((item) => item.track)).toEqual(["Spa", "Monza"]);
    expect(losses[0].avgDelta).toBe(-40);
    expect(losses[0].shareOfLosses).toBe(47);
  });
  it("separa ganhos e calcula a variacao media de posicoes", () => {
    const rows = [race("Imola", "B", 2000, 2030, 3), race("Imola", "B", 2030, 2050, 1)];
    const { gains, losses } = buildContexts(rows, 0);
    expect(losses).toEqual([]);
    expect(gains[0]).toMatchObject({ avgDelta: 25, avgPositionChange: 2, shareOfLosses: null });
  });
});

describe("buildContexts na week", () => {
  it("aceita 1 corrida por combinação na week e continua exigindo 2 na season", () => {
    expect(MIN_CONTEXT_RACES_WEEK).toBe(1);
    const rows = [race("Monza", "A", 2000, 1900)];
    expect(buildContexts(rows, 100, "week").losses).toHaveLength(1);
    expect(buildContexts(rows, 100, "season").losses).toHaveLength(0);
  });
});
