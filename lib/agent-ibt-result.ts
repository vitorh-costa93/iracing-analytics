/** Race result extracted by the Windows agent from iRacing SessionInfo (the YAML that the
 * simulator publishes live in shared memory and snapshots into each .ibt).
 *
 * Contract `kind:"ibt_result"` (version 1): only extracted fields travel, never the raw YAML,
 * names or setup. Positions are normalized here: SessionInfo `ResultsPositions.Position` is
 * 1-based and `ClassPosition` is 0-based (verified on local .ibt files, 08/10/2026), so both
 * are re-ranked by order instead of trusting a fixed base.
 *
 * The iRating change is an ESTIMATE: SessionInfo has no post-race rating, so the community
 * reverse-engineered Elo-like iRacing formula is applied to the class field (see
 * estimateIratingDelta). `official_irating_*` stay null; the official JSON export, or a later
 * iRStats import, replaces the row (database precedence in 20261008150000_agent_ibt_result.sql).
 */
import { AgentValidationError } from "./agent-result";

type RecordValue = Record<string, unknown>;
function invalid(): never { throw new AgentValidationError(); }
function object(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as RecordValue;
}
function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) invalid();
  return value;
}
function finite(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) invalid();
  return value;
}
function name(value: unknown, empty = false): string {
  if (typeof value !== "string" || value.length > 300 || (!empty && !value.trim()) || /[\u0000-\u001f]/.test(value)) invalid();
  return value.trim();
}
function instant(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|[+-]\d\d:\d\d)$/.test(value)) invalid();
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 2008 || date.getTime() > Date.now() + 86_400_000) invalid();
  return date.toISOString();
}
function lapTime(seconds: number | null): string | null {
  if (seconds === null) return null;
  const milliseconds = Math.round(seconds * 1000);
  const minutes = Math.floor(milliseconds / 60000);
  return `${minutes}:${((milliseconds % 60000) / 1000).toFixed(3).padStart(6, "0")}`;
}
function license(level: number): string {
  return level >= 22 ? "Pro" : level >= 18 ? "A" : level >= 14 ? "B" : level >= 10 ? "C" : level >= 6 ? "D" : "Rookie";
}

const BR1 = 1600 / Math.LN2;
/** Probability that a driver rated `a` beats one rated `b` (iRacing's Elo-like curve). */
function chance(a: number, b: number) {
  const ea = Math.exp(-a / BR1), eb = Math.exp(-b / BR1);
  return ((1 - ea) * eb) / ((1 - eb) * ea + (1 - ea) * eb);
}
export type FieldEntry = { irating: number; started: boolean; position: number | null };

/** Community reverse-engineered iRating formula (per class, as iRacing computes multiclass).
 * Starters: (n - pos - expected - fudge) * 200 / starters. Non-starters share the negative
 * of the starters' sum proportionally to their expected score. Ratings of 0 (new license)
 * are treated as 1350 like the iRacing default. Not official: documented as an estimate. */
export function estimateIratingDelta(field: FieldEntry[], me: number): number {
  const n = field.length;
  if (n < 2 || me < 0 || me >= n) return 0;
  const ratings = field.map(entry => entry.irating > 0 ? entry.irating : 1350);
  const starters = field.filter(entry => entry.started).length;
  const nonStarters = n - starters;
  if (starters === 0) return 0;
  const expected = ratings.map(rating => ratings.reduce((sum, other) => sum + chance(rating, other), 0) - 0.5);
  const starterChange = (index: number) => {
    const position = field[index].position!;
    const fudge = ((n - nonStarters / 2) / 2 - position) / 100;
    return (n - position - expected[index] - fudge) * 200 / starters;
  };
  if (field[me].started) return Math.round(starterChange(me));
  const starterSum = field.reduce((sum, entry, index) => entry.started ? sum + starterChange(index) : sum, 0);
  const nonStarterExpected = field.reduce((sum, entry, index) => entry.started ? sum : sum + expected[index], 0) / nonStarters;
  return Math.round(-starterSum / nonStarters * expected[me] / nonStarterExpected);
}

/** iRacing strength of field: BR1 * ln(N / sum(exp(-iR / BR1))). */
export function strengthOfField(ratings: number[]): number | null {
  if (!ratings.length) return null;
  const sum = ratings.reduce((total, rating) => total + Math.exp(-(rating > 0 ? rating : 1350) / BR1), 0);
  return Math.round(BR1 * Math.log(ratings.length / sum));
}

/** Re-rank 0- or 1-based positions to 1..n by order (an entrant filtered out by the agent,
 * e.g. a car without a DriverInfo row, leaves a gap); duplicates are ambiguous and rejected. */
function ranks(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  if (new Set(sorted).size !== sorted.length) invalid();
  return values.map(value => sorted.indexOf(value) + 1);
}

const CATEGORIES = { SportsCar: "sports_car", FormulaCar: "formula_car", Road: "road" } as const;
export const IBT_RESULT_MAX_BYTES = 131072;

export function parseAgentIbtResult(payload: unknown, customerId: number) {
  integer(customerId, 1, Number.MAX_SAFE_INTEGER);
  const body = object(payload);
  const r = object(body.result);
  if (r.origin !== "ibt" && r.origin !== "live") invalid();
  if (typeof r.resultsOfficial !== "boolean") invalid();
  if (r.official !== true) invalid();
  if (r.customerId !== customerId) invalid();
  const subsessionId = integer(r.subsessionId, 1, Number.MAX_SAFE_INTEGER);
  const seriesId = integer(r.seriesId, 1, 2147483647);
  integer(r.seasonId, 1, 2147483647);
  if (typeof r.category !== "string" || !Object.hasOwn(CATEGORIES, r.category)) invalid();
  const category = CATEGORIES[r.category as keyof typeof CATEGORIES];
  const seasonWeek = integer(r.raceWeek, 0, 12) + 1;
  const racedAt = instant(r.racedAt);
  const nativeTrackId = integer(r.trackId, 1, 2147483647);
  const trackName = name(r.trackName);
  const trackConfig = r.trackConfig === undefined || r.trackConfig === null || r.trackConfig === "" ? null : name(r.trackConfig);
  const driver = object(r.driver);
  const carIdx = integer(driver.carIdx, 0, 255);
  const nativeCarId = integer(driver.carId, 1, 2147483647);
  const carName = name(driver.carName);
  const licenseLevel = integer(driver.licLevel, 1, 30);
  const safety = integer(driver.licSubLevel, 0, 499);
  const lapsLed = integer(driver.lapsLed, 0, 10000);
  const incidents = integer(driver.incidents, 0, 1000);
  const grid = driver.gridPosition === null || driver.gridPosition === undefined ? null : integer(driver.gridPosition, 1, 255);

  if (!Array.isArray(r.entrants) || r.entrants.length < 1 || r.entrants.length > 128) invalid();
  const entrants = r.entrants.map(object).map(entry => ({
    carIdx: integer(entry.carIdx, 0, 255),
    classId: integer(entry.classId, 0, 2147483647),
    irating: integer(entry.irating, 0, 20000),
    started: typeof entry.started === "boolean" ? entry.started : invalid(),
    position: entry.position === null ? null : integer(entry.position, 0, 255),
    classPosition: entry.classPosition === null ? null : integer(entry.classPosition, 0, 255),
    lapsComplete: entry.lapsComplete === null ? null : integer(entry.lapsComplete, -1, 10000),
    fastestTime: entry.fastestTime === null ? null : finite(entry.fastestTime, -1, 3600),
  }));
  if (new Set(entrants.map(entry => entry.carIdx)).size !== entrants.length) invalid();
  for (const entry of entrants) if (entry.started !== (entry.position !== null) || entry.started !== (entry.classPosition !== null)) invalid();
  const mine = entrants.find(entry => entry.carIdx === carIdx);
  if (!mine || !mine.started) invalid();

  const starters = entrants.filter(entry => entry.started);
  const overall = ranks(starters.map(entry => entry.position!));
  const finishByIdx = new Map(starters.map((entry, index) => [entry.carIdx, overall[index]]));
  const classField = entrants.filter(entry => entry.classId === mine.classId);
  const classStarters = classField.filter(entry => entry.started);
  const classRanks = ranks(classStarters.map(entry => entry.classPosition!));
  const classByIdx = new Map(classStarters.map((entry, index) => [entry.carIdx, classRanks[index]]));
  // Non-starters are tied after the last starter, as in iRacing's DNS handling.
  const field: FieldEntry[] = classField.map(entry => ({ irating: entry.irating, started: entry.started, position: entry.started ? classByIdx.get(entry.carIdx)! : null }));
  const delta = estimateIratingDelta(field, classField.indexOf(mine));
  const best = (list: typeof entrants) => {
    const times = list.map(entry => entry.fastestTime).filter((time): time is number => time !== null && time > 0);
    return times.length ? Math.min(...times) : null;
  };
  const classWinner = classStarters.find(entry => classByIdx.get(entry.carIdx) === 1) ?? null;
  const finish = finishByIdx.get(carIdx)!;
  const before = mine.irating;
  const laps = mine.lapsComplete === null || mine.lapsComplete < 0 ? null : mine.lapsComplete;

  return {
    subsessionId, customerId, seriesId, carName, trackName, trackConfig, nativeCarId, nativeTrackId,
    resultsOfficial: r.resultsOfficial, origin: r.origin as "ibt" | "live",
    row: {
      raced_at: racedAt, track_name: trackName, car_name: carName, category, season_week: seasonWeek,
      license_class: license(licenseLevel), safety_rating: safety / 100,
      irating_display: String(Math.max(0, before + delta)), irating_delta: delta,
      grid_position: grid, finish_position: finish, class_finish_position: classByIdx.get(carIdx)!,
      position_change: grid === null ? null : grid - finish,
      laps, laps_led: laps === null ? lapsLed : Math.min(lapsLed, laps),
      fastest_lap_time: lapTime(mine.fastestTime !== null && mine.fastestTime > 0 ? mine.fastestTime : null),
      race_fastest_lap_time: lapTime(best(starters)),
      winner_fastest_lap_time: lapTime(classWinner && classWinner.fastestTime !== null && classWinner.fastestTime > 0 ? classWinner.fastestTime : null),
      class_fastest_lap_time: lapTime(best(classStarters)),
      incidents, points: null, sof: strengthOfField(starters.map(entry => entry.irating)),
      official_irating_before: null, official_irating_after: null,
    },
  };
}

export type ParsedAgentIbtResult = ReturnType<typeof parseAgentIbtResult>;
