import { describe, expect, it } from "vitest";
import { AgentValidationError, parseAgentResult } from "./agent-result";

function entrant(overrides: Record<string, unknown> = {}) {
  return { cust_id: 42, ai: false, car_id: 7, car_name: "Example GT", car_class_id: 10,
    starting_position: 3, finish_position: 2, finish_position_in_class: 1,
    oldi_rating: 2000, newi_rating: 2040, new_license_level: 18, new_sub_level: 325,
    laps_complete: 12, laps_lead: 0, best_lap_time: 910123, incidents: 2, champ_points: 88, ...overrides };
}
function fixture() {
  return { type: "event_result", data: { subsession_id: 123, official_session: true,
    license_category: "Sports_Car", season_year: 2026, season_quarter: 4, race_week_num: 3,
    start_time: "2026-10-08T19:00:00Z", series_name: "Example Multiclass", event_strength_of_field: 2200,
    track: { track_id: 8, track_name: "Example Circuit", config_name: "Grand Prix" },
    session_results: [
      { simsession_type: 3, results: [entrant({ newi_rating: 1 })] },
      { simsession_type: 6, results: [entrant(),
        entrant({ cust_id: 43, finish_position: 1, finish_position_in_class: 0, best_lap_time: 900000 }),
        entrant({ cust_id: 44, car_class_id: 20, finish_position: 0, finish_position_in_class: 0, best_lap_time: 800000 }),
        entrant({ cust_id: 45, ai: true, best_lap_time: 700000 }),
      ] },
    ] } };
}

describe("parseAgentResult", () => {
  it("maps the authenticated driver, zero-based positions/week, exact ratings and class winner", () => {
    const parsed = parseAgentResult(fixture(), 42);
    expect(parsed).toMatchObject({ subsessionId: 123, customerId: 42, nativeCarId: 7, nativeTrackId: 8, trackConfig: "Grand Prix" });
    expect(parsed.row).toEqual({ raced_at: "2026-10-08T19:00:00.000Z", series_name: "Example Multiclass", track_name: "Example Circuit", car_name: "Example GT",
      category: "sports_car", season_week: 4, license_class: "A", safety_rating: 3.25,
      irating_display: "2040", irating_delta: 40, official_irating_before: 2000, official_irating_after: 2040,
      grid_position: 4, finish_position: 3, class_finish_position: 2, position_change: 1,
      laps: 12, laps_led: 0, fastest_lap_time: "1:31.012", race_fastest_lap_time: "1:20.000",
      class_fastest_lap_time: "1:30.000", winner_fastest_lap_time: "1:30.000", incidents: 2, points: 88, sof: 2200 });
  });
  it.each([[2, "Rookie"], [5, "Rookie"], [6, "D"], [9, "D"], [10, "C"], [13, "C"], [14, "B"], [17, "B"], [18, "A"], [21, "A"], [22, "Pro"]])("maps license level %s to %s", (level, expected) => {
    const payload = fixture(); payload.data.session_results[1].results[0].new_license_level = level as number;
    expect(parseAgentResult(payload, 42).row.license_class).toBe(expected);
  });
  it.each([["Formula_Car", "formula_car"], ["Road", "road"]])("maps category %s", (category, expected) => {
    const payload = fixture(); payload.data.license_category = category;
    expect(parseAgentResult(payload, 42).row.category).toBe(expected);
  });
  it("ignores non-positive lap sentinels and permits no timed laps", () => {
    const payload = fixture(); payload.data.session_results[1].results.forEach((row, i) => { row.best_lap_time = i ? -1 : 0; });
    expect(parseAgentResult(payload, 42).row).toMatchObject({ fastest_lap_time: null, race_fastest_lap_time: null, class_fastest_lap_time: null, winner_fastest_lap_time: null });
  });
  it("rounds ticks with minute carry and accepts a real leap-day offset date", () => {
    const payload = fixture(); payload.data.start_time = "2024-02-29T23:00:00-03:00";
    payload.data.session_results[1].results[0].best_lap_time = 599999;
    expect(parseAgentResult(payload, 42).row).toMatchObject({ fastest_lap_time: "1:00.000", raced_at: "2024-03-01T02:00:00.000Z" });
  });
  it.each(["2026-02-29T10:00:00Z", "2026-04-31T10:00:00Z", "2026-10-08", "2026-10-08T24:00:00Z", "2026-10-08T12:00:00+03:60"])("rejects invalid date %s", date => {
    const payload = fixture(); payload.data.start_time = date;
    expect(() => parseAgentResult(payload, 42)).toThrow(AgentValidationError);
  });
  it.each([
    (p: ReturnType<typeof fixture>) => { p.type = "other"; },
    (p: ReturnType<typeof fixture>) => { p.data.official_session = false; },
    (p: ReturnType<typeof fixture>) => { p.data.license_category = "Oval"; },
    (p: ReturnType<typeof fixture>) => { p.data.subsession_id = Number.MAX_SAFE_INTEGER + 1; },
    (p: ReturnType<typeof fixture>) => { p.data.track.track_id = 0; },
    (p: ReturnType<typeof fixture>) => { p.data.season_quarter = 5; },
    (p: ReturnType<typeof fixture>) => { p.data.race_week_num = -1; },
    (p: ReturnType<typeof fixture>) => { p.data.session_results.pop(); },
    (p: ReturnType<typeof fixture>) => { p.data.session_results.push(p.data.session_results[1]); },
    (p: ReturnType<typeof fixture>) => { p.data.session_results[1].results.push(entrant()); },
    (p: ReturnType<typeof fixture>) => { p.data.session_results[1].results[0].ai = true; },
    (p: ReturnType<typeof fixture>) => { p.data.session_results[1].results[0].newi_rating = -1; },
    (p: ReturnType<typeof fixture>) => { p.data.session_results[1].results[0].oldi_rating = NaN; },
    (p: ReturnType<typeof fixture>) => { p.data.session_results[1].results[0].new_sub_level = 500; },
    (p: ReturnType<typeof fixture>) => { p.data.session_results[1].results[0].finish_position = -1; },
    (p: ReturnType<typeof fixture>) => { p.data.session_results[1].results[0].laps_lead = 13; },
    (p: ReturnType<typeof fixture>) => { p.data.series_name = ""; },
  ])("rejects malformed or ambiguous official input without disclosing fields", mutate => {
    const payload = fixture(); mutate(payload);
    expect(() => parseAgentResult(payload, 42)).toThrow("Resultado oficial inválido.");
  });
  it("requires credential identity and does not mutate or return the raw input", () => {
    const payload = fixture(); const original = structuredClone(payload);
    expect(() => parseAgentResult(payload, 999)).toThrow(AgentValidationError);
    expect(() => parseAgentResult(payload, 0)).toThrow(AgentValidationError);
    expect(parseAgentResult(payload, 42)).not.toHaveProperty("data");
    expect(payload).toEqual(original);
    expect(() => parseAgentResult(null, 42)).toThrow(AgentValidationError);
  });
});
