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

export type WinnerGapRace = {
  track_name: string;
  car_name?: string | null;
  fastest_lap_time: string | null;
  winner_fastest_lap_time: string | null;
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

const round3 = (value: number) => Math.round(value * 1000) / 1000;

/** Gap is ranked by percentage, since a 0.8s gap means something different at Le Mans than at
 * the Red Bull Ring. Sorted smallest gap first. */
export function aggregateWinnerGapByTrack(rows: WinnerGapRace[]): WinnerGapByTrack[] {
  const byTrack = new Map<string, Array<{ seconds: number; pct: number }>>();
  for (const row of rows) {
    const gap = raceWinnerGap(row.fastest_lap_time, row.winner_fastest_lap_time);
    if (!gap) continue;
    const list = byTrack.get(row.track_name) ?? [];
    list.push(gap);
    byTrack.set(row.track_name, list);
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
    .sort((a, b) => a.avgGapPct - b.avgGapPct);
}
