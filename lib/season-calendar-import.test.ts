import { describe, expect, it } from "vitest";
import { parseOfficialSeasonCalendar, validateImportedSeasonCalendar } from "./season-calendar-import";

const page = (text: string) => ({ page: 1, text });
const weeks = Array.from({ length: 12 }, (_, index) => `Week ${index + 1} (2027-${String(index + 1).padStart(2, "0")}-15) Track ${index + 1} - Grand Prix (2027-${String(index + 1).padStart(2, "0")}-19 10:00 1x)`).join(" ");

describe("official season calendar importer", () => {
  it("selects the official open SF23/IMSA schedules and the official GT3 Challenge", () => {
    const result = parseOfficialSeasonCalendar([
      page("Formula B - Super Formula Series 2027 Season 1 " + weeks),
      page("IMSA iRacing Series by GO Fast - 2027 Season 1 " + weeks),
      page("GT3 Challenge Fixed by Fanatec - 2027 Season 1 " + weeks),
    ], "2027s1.pdf", "a".repeat(64));
    expect(result.seasonId).toBe("36");
    expect(result.seasonStart).toBe("2027-01-15T00:00:00.000Z");
    expect(result.contexts).toHaveLength(36);
    expect(result.contexts.filter((item) => item.weekNumber === 1).map((item) => item.contextKey)).toEqual(["sf23", "imsa", "gt3"]);
  });

  it("rejects incomplete schedules before they can reach Supabase", () => {
    expect(() => validateImportedSeasonCalendar({ seasonId: "36", seasonName: "2027 Season 1", seasonStart: "2027-01-15T00:00:00.000Z", sourceFileName: "x.pdf", sourceSha256: "a".repeat(64), contexts: [] })).toThrow("12 weeks");
  });
});
