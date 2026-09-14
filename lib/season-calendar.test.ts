import { describe, expect, it } from "vitest";
import { getActiveSeason, getScheduledWeekContexts, getSeasonWeek } from "@/lib/season-calendar";

describe("2026 Season 4 calendar", () => {
  it("switches to S4 at Monday 21:00 in Brasilia (Tuesday 00:00 UTC)", () => {
    // The between-season week has no regular 12-week season assigned to it.
    expect(getActiveSeason(new Date("2026-09-14T23:59:59.999Z"))).toBeNull();
    expect(getActiveSeason(new Date("2026-09-15T00:00:00.000Z"))?.id).toBe("35");
  });

  it("advances a week every seven days without relying on race activity", () => {
    const season = getActiveSeason(new Date("2026-09-15T00:00:00.000Z"));
    expect(season?.id).toBe("35");
    expect(getSeasonWeek(new Date("2026-09-21T23:59:59.999Z"), season!)).toBe(1);
    expect(getSeasonWeek(new Date("2026-09-22T00:00:00.000Z"), season!)).toBe(2);
  });

  it("uses the official GT3 Challenge, not a regional tour", () => {
    const contexts = getScheduledWeekContexts("35", 1);
    expect(contexts?.map((item) => `${item.series}:${item.track}`)).toEqual([
      "Super Formula 23:Autódromo José Carlos Pace",
      "IMSA:Indianapolis Motor Speedway",
      "GT3 Challenge:Silverstone Circuit",
    ]);
  });
});
