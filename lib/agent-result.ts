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
  return {
    subsessionId, customerId, carName, trackName, trackConfig, nativeCarId, nativeTrackId,
    row: {
      raced_at: racedAt, series_name: name(data.series_name), track_name: trackName, car_name: carName,
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
