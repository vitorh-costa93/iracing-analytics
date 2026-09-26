import { describe, expect, it } from "vitest";
import { currentSeasonWeek, weekLabel, weekShort } from "./season-week";

describe("season-week", () => {
  it("formata a mesma numeração em todos os formatos", () => {
    expect(weekLabel(2)).toBe("Semana 2");
    expect(weekShort(2)).toBe("W2");
  });
  it("a week atual é a maior de qualquer categoria", () => {
    expect(currentSeasonWeek([{ season_week: 1 }, { season_week: 2 }, { season_week: null }])).toBe(2);
    expect(currentSeasonWeek([])).toBeNull();
  });
});
