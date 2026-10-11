/** Converts an official iRacing event result into the local persistence contract.
 * Customer identity is supplied by the authenticated credential, never the body.
 */
export class AgentValidationError extends Error {
  constructor() { super("Resultado oficial inválido."); this.name = "AgentValidationError"; }
}

type RecordValue = Record<string, unknown>;
function invalid(): never { throw new AgentValidationError(); }
function object(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as RecordValue;
}
function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) invalid();
  return value;
}
function name(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 300 || /[\u0000-\u001f]/.test(value)) invalid();
  return value.trim();
}
function instant(value: unknown): string {
  if (typeof value !== "string") invalid();
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) invalid();
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (year < 2008 || month < 1 || month > 12 || day < 1 || day > days || hour > 23 || minute > 59 || second > 59) invalid();
  if (match[7] !== "Z") {
    const [offsetHour, offsetMinute] = match[7].slice(1).split(":").map(Number);
    if (offsetHour > 23 || offsetMinute > 59) invalid();
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) invalid();
  return parsed.toISOString();
}
function lapTicks(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  // iRacing uses non-positive sentinel values when no timed lap exists.
  if (typeof value !== "number" || !Number.isSafeInteger(value)) invalid();
  return value > 0 ? value : null;
}
function lapTime(ticks: number | null): string | null {
  if (ticks === null) return null;
  const milliseconds = Math.round(ticks / 10);
  const minutes = Math.floor(milliseconds / 60000);
  const seconds = ((milliseconds % 60000) / 1000).toFixed(3).padStart(6, "0");
  return `${minutes}:${seconds}`;
}
function minimum(values: (number | null)[]): number | null {
  return values.reduce<number | null>((best, value) => value === null ? best : best === null ? value : Math.min(best, value), null);
}
function license(level: unknown): string {
  const value = integer(level, 2);
  return value >= 22 ? "Pro" : value >= 18 ? "A" : value >= 14 ? "B" : value >= 10 ? "C" : value >= 6 ? "D" : "Rookie";
}

// ---- Full field (event + every human of the practice/qualify/race sessions) ----
const FIELD_SESSION_LIMIT = 128;
const SIM_SESSIONS: Record<number, "practice" | "qualify" | "race"> = { 3: "practice", 4: "qualify", 6: "race" };
/** iRacing uses -1 as "not applicable"; absent/null/-1 become null, anything else must be a bounded integer. */
function optional(value: unknown, max = 2147483647): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < -1 || value > max) invalid();
  return value === -1 ? null : value;
}
/** Display text is cosmetic: control chars are stripped and the length capped instead of rejecting the whole result. */
function text(value: unknown, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") invalid();
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
  return clean || null;
}
function pickScalars(value: unknown, keys: Record<string, "n" | "b" | "s">, maxKeys = 32): RecordValue {
  if (value === undefined || value === null) return {};
  const source = object(value); const out: RecordValue = {};
  for (const [key, kind] of Object.entries(keys)) {
    const v = source[key]; if (v === undefined || v === null) continue;
    if (kind === "n") { if (typeof v !== "number" || !Number.isFinite(v)) invalid(); out[key] = v; }
    else if (kind === "b") { if (typeof v !== "boolean") invalid(); out[key] = v; }
    else { if (typeof v !== "string") invalid(); out[key] = v.replace(/[\u0000-\u001f]/g, "").slice(0, 40); }
  }
  if (Object.keys(out).length > maxKeys) invalid();
  return out;
}
function fieldRow(entrant: RecordValue, session: "practice" | "qualify" | "race", customerId: number) {
  const custId = integer(entrant.cust_id, 1);
  return {
    sim_session_type: session, cust_id: custId, display_name: text(entrant.display_name, 100),
    country_code: text(entrant.country_code, 8),
    car_class_id: integer(entrant.car_class_id, 1), car_class_name: text(entrant.car_class_name, 100),
    car_id: integer(entrant.car_id, 1), car_name: name(entrant.car_name),
    starting_position: optional(entrant.starting_position, 2147483646), starting_position_in_class: optional(entrant.starting_position_in_class, 2147483646),
    finish_position: optional(entrant.finish_position, 2147483646), finish_position_in_class: optional(entrant.finish_position_in_class, 2147483646),
    interval: optional(entrant.interval, Number.MAX_SAFE_INTEGER), class_interval: optional(entrant.class_interval, Number.MAX_SAFE_INTEGER),
    laps_complete: integer(entrant.laps_complete, 0, 1000000), laps_lead: integer(entrant.laps_lead, 0, 1000000),
    incidents: integer(entrant.incidents, 0, 100000),
    best_lap_time: lapTicks(entrant.best_lap_time), average_lap: lapTicks(entrant.average_lap), qual_lap_time: lapTicks(entrant.qual_lap_time),
    oldi_rating: optional(entrant.oldi_rating), newi_rating: optional(entrant.newi_rating),
    old_license_level: optional(entrant.old_license_level, 100), new_license_level: optional(entrant.new_license_level, 100),
    old_sub_level: optional(entrant.old_sub_level, 499), new_sub_level: optional(entrant.new_sub_level, 499),
    reason_out: text(entrant.reason_out, 60), division: optional(entrant.division, 1000),
    is_me: custId === customerId,
  };
}
function parseField(sessions: RecordValue[], customerId: number) {
  const field: ReturnType<typeof fieldRow>[] = [];
  const seen = new Set<string>();
  for (const session of sessions) {
    const kind = SIM_SESSIONS[session.simsession_type as number];
    if (!kind) continue;
    if (seen.has(kind) || !Array.isArray(session.results)) invalid();
    seen.add(kind);
    if (session.results.length > FIELD_SESSION_LIMIT * 4) invalid(); // raw list may include AI; humans are capped below
    const entrants = session.results.map(object);
    for (const entrant of entrants) if (typeof entrant.ai !== "boolean") invalid();
    const humans = entrants.filter(entrant => entrant.ai === false);
    if (humans.length > FIELD_SESSION_LIMIT) invalid();
    const ids = new Set<number>();
    for (const entrant of humans) {
      const row = fieldRow(entrant, kind, customerId);
      if (ids.has(row.cust_id)) invalid();
      ids.add(row.cust_id); field.push(row);
    }
  }
  return field;
}
function parseSplits(value: unknown) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 64) invalid();
  return value.map(item => { const split = object(item); return { subsession_id: integer(split.subsession_id, 1), event_strength_of_field: optional(split.event_strength_of_field) }; });
}

export function parseAgentResult(payload: unknown, customerId: number) {
  integer(customerId, 1);
  const envelope = object(payload);
  if (envelope.type !== "event_result") invalid();
  const data = object(envelope.data);
  if (data.official_session !== true) invalid();
  const categories = { Sports_Car: "sports_car", Formula_Car: "formula_car", Road: "road" } as const;
  if (typeof data.license_category !== "string" || !Object.hasOwn(categories, data.license_category)) invalid();
  const category = categories[data.license_category as keyof typeof categories];
  const subsessionId = integer(data.subsession_id, 1);
  // Validate official season metadata even though persistence currently only needs week.
  integer(data.season_year, 2008, 9999);
  integer(data.season_quarter, 1, 4);
  const seasonWeek = integer(data.race_week_num, 0, 12) + 1;
  const racedAt = instant(data.start_time);
  const track = object(data.track);
  const nativeTrackId = integer(track.track_id, 1);
  const trackName = name(track.track_name);
  const trackConfig = track.config_name === undefined || track.config_name === null || track.config_name === "" ? null : name(track.config_name);
  if (!Array.isArray(data.session_results)) invalid();
  const sessions = data.session_results.map(object);
  for (const session of sessions) integer(session.simsession_type, 0);
  const races = sessions.filter(session => session.simsession_type === 6);
  if (races.length !== 1 || !Array.isArray(races[0].results)) invalid();
  const entrants = races[0].results.map(object);
  const matching = entrants.filter(entrant => entrant.cust_id === customerId);
  if (matching.length !== 1 || matching[0].ai !== false) invalid();
  const pilot = matching[0];
  const humans = entrants.filter(entrant => entrant.ai === false);
  for (const entrant of entrants) if (typeof entrant.ai !== "boolean") invalid();
  for (const entrant of humans) integer(entrant.cust_id, 1);
  const nativeCarId = integer(pilot.car_id, 1);
  const carName = name(pilot.car_name);
  const classId = integer(pilot.car_class_id, 1);
  const classEntrants = humans.filter(entrant => integer(entrant.car_class_id, 1) === classId);
  const classWinners = classEntrants.filter(entrant => integer(entrant.finish_position_in_class) === 0);
  if (classWinners.length > 1) invalid();
  const before = integer(pilot.oldi_rating, 0, 2147483647);
  const after = integer(pilot.newi_rating, 0, 2147483647);
  const grid = integer(pilot.starting_position, 0, 2147483646) + 1;
  const finish = integer(pilot.finish_position, 0, 2147483646) + 1;
  const laps = integer(pilot.laps_complete);
  const lapsLed = integer(pilot.laps_lead, 0, laps);
  const seriesName = name(data.series_name);
  const field = parseField(sessions, customerId);
  const event = {
    subsession_id: subsessionId, series_id: optional(data.series_id), series_name: seriesName,
    season_year: data.season_year as number, season_quarter: data.season_quarter as number, race_week: seasonWeek,
    track_id: nativeTrackId, track_name: trackName, track_config: trackConfig, start_time: racedAt, license_category: category,
    sof: integer(data.event_strength_of_field), num_drivers: optional(data.num_drivers, 1000), num_cautions: optional(data.num_cautions, 100000),
    num_caution_laps: optional(data.num_caution_laps, 1000000), num_lead_changes: optional(data.num_lead_changes, 1000000),
    event_average_lap: lapTicks(data.event_average_lap), event_best_lap_time: lapTicks(data.event_best_lap_time),
    weather: pickScalars(data.weather, { type: "n", skies: "n", temp_value: "n", temp_units: "n", rel_humidity: "n", wind_dir: "n", wind_value: "n", wind_units: "n", precip_option: "n", precip_time_pct: "n", time_of_day: "n", simulated_start_time: "s", allow_fog: "b" }),
    track_state: pickScalars(data.track_state, { leave_marbles: "b", practice_rubber: "n", qualify_rubber: "n", race_rubber: "n", warmup_rubber: "n" }),
    session_splits: parseSplits(data.session_splits),
  };
  return {
    subsessionId, customerId, carName, trackName, trackConfig, nativeCarId, nativeTrackId, event, field,
    row: {
      raced_at: racedAt, series_name: seriesName, track_name: trackName, car_name: carName,
      category, season_week: seasonWeek, license_class: license(pilot.new_license_level),
      safety_rating: integer(pilot.new_sub_level, 0, 499) / 100,
      irating_display: String(after), irating_delta: after - before,
      grid_position: grid, finish_position: finish, class_finish_position: integer(pilot.finish_position_in_class, 0, 2147483646) + 1,
      position_change: grid - finish, laps, laps_led: lapsLed,
      fastest_lap_time: lapTime(lapTicks(pilot.best_lap_time)),
      race_fastest_lap_time: lapTime(minimum(humans.map(entrant => lapTicks(entrant.best_lap_time)))),
      winner_fastest_lap_time: lapTime(classWinners.length ? lapTicks(classWinners[0].best_lap_time) : null),
      class_fastest_lap_time: lapTime(minimum(classEntrants.map(entrant => lapTicks(entrant.best_lap_time)))),
      incidents: integer(pilot.incidents), points: integer(pilot.champ_points),
      sof: integer(data.event_strength_of_field), official_irating_before: before, official_irating_after: after,
    },
  };
}

export type ParsedAgentResult = ReturnType<typeof parseAgentResult>;
