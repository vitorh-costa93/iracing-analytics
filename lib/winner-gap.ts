export type Finisher = { carName: string; fastestLapTime: string | null };

/** Parses irstats' "M:SS.mmm" lap-time text (e.g. "1:27.305") into seconds. */
export function parseLapTimeSeconds(text: string | null | undefined): number | null {
  if (!text) return null;
  const match = text.match(/^(\d+):(\d{2}(?:\.\d+)?)$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

const RACE_CLASS_PATTERNS: Array<[string, RegExp]> = [
  ["GTP", /\bGTP\b/i],
  ["LMP2", /\bLMP2\b/i],
  ["LMP3", /\bLMP3\b/i],
  ["GT3", /\bGT3\b/i],
  ["GT4", /\bGT4\b/i],
];

/** Maps a car's Garage61 group names to one multiclass race class. Dallara P217 is LMP2 even
 * though Garage61 doesn't group it that way. Ambiguous (several classes) or unknown -> null. */
export function normalizeRaceClass(carName: string, groupNames: string[]): string | null {
  if (/dallara p217/i.test(carName)) return "LMP2";
  const matches = new Set<string>();
  for (const name of groupNames) {
    for (const [raceClass, pattern] of RACE_CLASS_PATTERNS) if (pattern.test(name)) matches.add(raceClass);
  }
  return matches.size === 1 ? [...matches][0] : null;
}

/** Best lap of the winner of the driver's own class. Single-class races use the overall winner;
 * multiclass races use the first finisher whose car resolves to the driver's class. Returns null
 * when the class can't be resolved rather than comparing against another class's car. */
export function classWinnerFastestLap(
  race: { multiclass: boolean; carName: string; finishers: Finisher[] },
  classOf: (carName: string) => string | null
): string | null {
  if (!race.multiclass) return race.finishers[0]?.fastestLapTime ?? null;
  const ownClass = classOf(race.carName);
  if (!ownClass) return null;
  const winner = race.finishers.find((finisher) => classOf(finisher.carName) === ownClass);
  return winner?.fastestLapTime ?? null;
}

/** Best lap among the finishers of the driver's own class (the whole field in a single-class race).
 * This is the gap reference: the winner is not necessarily the fastest driver. Null when the class
 * can't be resolved or nobody has a timed lap. */
export function classFastestLap(
  race: { multiclass: boolean; carName: string; finishers: Finisher[] },
  classOf: (carName: string) => string | null
): string | null {
  const ownClass = race.multiclass ? classOf(race.carName) : null;
  if (race.multiclass && !ownClass) return null;
  let best: { text: string; seconds: number } | null = null;
  for (const finisher of race.finishers) {
    if (race.multiclass && classOf(finisher.carName) !== ownClass) continue;
    const seconds = parseLapTimeSeconds(finisher.fastestLapTime);
    if (seconds === null || !finisher.fastestLapTime) continue;
    if (!best || seconds < best.seconds) best = { text: finisher.fastestLapTime, seconds };
  }
  return best?.text ?? null;
}

export type WinnerGapRace = {
  track_name: string;
  car_name?: string | null;
  fastest_lap_time: string | null;
  class_fastest_lap_time: string | null;
  series_name?: string | null;
  laps?: number | null;
};

export type WinnerGapByTrack = {
  track: string;
  races: number;
  avgGapSeconds: number;
  avgGapPct: number;
  bestGapSeconds: number;
  worstGapSeconds: number;
};

export function raceWinnerGap(ownLap: string | null, winnerLap: string | null): { seconds: number; pct: number } | null {
  const own = parseLapTimeSeconds(ownLap);
  const winner = parseLapTimeSeconds(winnerLap);
  if (own === null || winner === null || winner <= 0) return null;
  const seconds = own - winner;
  return { seconds, pct: (seconds / winner) * 100 };
}

/** A best lap more than 5% from the winner's is a damaged/aborted race, not pace (e.g. +56 s at
 * Imola) and would swamp the averages, so such races are left out of the gap statistics. */
export const MAX_PLAUSIBLE_GAP_PCT = 5;

/** A race where you completed under this share of the usual distance (same track, car and series)
 * ended early (crash/DNF): its best lap is a few cold-tyre laps, not comparable pace. */
export const MIN_RACE_COMPLETION = 0.6;

function percentile75(sorted: number[]) {
  const pos = (sorted.length - 1) * 0.75;
  const lo = Math.floor(pos);
  return sorted[lo] + (sorted[Math.ceil(pos)] - sorted[lo]) * (pos - lo);
}

/** Drops early-exit races. "Usual distance" is the 75th percentile of your lap counts for that
 * track + car + series, so sprint series aren't mistaken for DNFs. Rows without a lap count stay. */
export function dropEarlyExitRaces<T extends WinnerGapRace>(rows: T[]): T[] {
  const groups = new Map<string, number[]>();
  const keyOf = (row: T) => `${row.track_name}|${row.car_name ?? ""}|${row.series_name ?? ""}`;
  for (const row of rows) {
    if (typeof row.laps !== "number" || row.laps <= 0) continue;
    const list = groups.get(keyOf(row)) ?? [];
    list.push(row.laps);
    groups.set(keyOf(row), list);
  }
  const usual = new Map<string, number>();
  for (const [key, laps] of groups) usual.set(key, percentile75(laps.sort((a, b) => a - b)));
  return rows.filter((row) => {
    if (typeof row.laps !== "number" || row.laps <= 0) return true;
    return row.laps >= MIN_RACE_COMPLETION * (usual.get(keyOf(row)) ?? 0);
  });
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;

/** Gap = your best lap minus the best lap of your class in that race (never negative, since you
 * are part of the field). `by: "car"` groups by car name instead (the label still comes out in
 * `track`). Sorted by average gap in seconds, smallest first; the percentage stays for display. */
export function aggregateWinnerGapByTrack(rows: WinnerGapRace[], by: "track" | "car" = "track"): WinnerGapByTrack[] {
  const byTrack = new Map<string, Array<{ seconds: number; pct: number }>>();
  for (const row of rows) {
    const gap = raceWinnerGap(row.fastest_lap_time, row.class_fastest_lap_time);
    if (!gap || Math.abs(gap.pct) > MAX_PLAUSIBLE_GAP_PCT) continue;
    const key = by === "car" ? row.car_name : row.track_name;
    if (!key) continue;
    const list = byTrack.get(key) ?? [];
    list.push(gap);
    byTrack.set(key, list);
  }
  return [...byTrack.entries()]
    .map(([track, gaps]) => ({
      track,
      races: gaps.length,
      avgGapSeconds: round3(gaps.reduce((sum, gap) => sum + gap.seconds, 0) / gaps.length),
      avgGapPct: round3(gaps.reduce((sum, gap) => sum + gap.pct, 0) / gaps.length),
      bestGapSeconds: round3(Math.min(...gaps.map((gap) => gap.seconds))),
      worstGapSeconds: round3(Math.max(...gaps.map((gap) => gap.seconds))),
    }))
    .sort((a, b) => a.avgGapSeconds - b.avgGapSeconds);
}
