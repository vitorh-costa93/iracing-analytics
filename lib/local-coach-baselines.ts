/** Per-corner historical baselines for app/api/telemetry/local-coach/baselines/route.ts, consumed by
 * the iracing-live-coach desktop app to compare THIS lap's live values against. This module only
 * computes "what's normal here" -- it never flags an anomaly itself; the live app's own LiveCoachEngine
 * does the ratio/threshold comparison at runtime, the same corner-relative-baseline philosophy already
 * validated in lib/traction-events.ts, just split so the numbers can travel over HTTP as plain JSON. */

export type CoachSample = {
  distance: number; // % of lap, 0-100
  brake?: number; // 0-1
  steeringRad?: number;
  rpm?: number;
  gear?: number;
  speedMs?: number;
};

export type CoachCorner = {
  number: number;
  name: string | null;
  startDistance: number; // % of lap
  endDistance: number; // % of lap
};

export type CornerBaseline = {
  number: number;
  name: string | null;
  startPct: number;
  endPct: number;
  brakingPointPct: number | null;
  brakingPointStdDev: number | null;
  correctionBaselineDeg: number | null;
  wheelspinRatePct: number | null;
  lapTimeContributionSeconds: number | null;
  lapTimeStdDev: number | null;
};

const BRAKE_THRESHOLD = 0.1; // matches parseLapCsv's own brake channel scale (0-1)
const APPROACH_WINDOW_PCT = 8; // how far before a corner's own start to look for the brake-onset point
const MIN_LAPS_FOR_BASELINE = 3; // mirrors traction-events.ts's own CORRECTION_MIN_LAPS -- a median across fewer laps isn't trustworthy

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function stddev(values: number[]): number {
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length);
}

/** First distance, within [corner.start - APPROACH_WINDOW_PCT, corner.end), where brake crosses above
 * BRAKE_THRESHOLD after being below it -- the same "onset" idea as a driver's own brake point, not
 * just "any sample with the pedal down" (which would also catch trail-braking deep into the corner). */
function brakeOnsetDistance(lap: CoachSample[], corner: CoachCorner): number | null {
  const windowStart = corner.startDistance - APPROACH_WINDOW_PCT;
  const inWindow = lap
    .filter((sample) => sample.distance >= windowStart && sample.distance < corner.endDistance)
    .sort((a, b) => a.distance - b.distance);
  for (let index = 1; index < inWindow.length; index += 1) {
    const previous = inWindow[index - 1], current = inWindow[index];
    if ((previous.brake ?? 0) < BRAKE_THRESHOLD && (current.brake ?? 0) >= BRAKE_THRESHOLD) return current.distance;
  }
  return null;
}

/** "Wasted" steering motion inside a corner's own window for one lap -- total absolute wheel movement
 * minus net displacement, same measure lib/traction-events.ts's binSteeringOscillation already
 * validated (near zero for a smooth turn-in, large when the wheel moves back and forth without
 * progressing the angle). Whole-corner window here (not per-1%-bin) since this is a single per-corner
 * baseline number for the live app, not a bin-by-bin anomaly scan. */
function wastedSteeringDeg(lap: CoachSample[], corner: CoachCorner): number | null {
  const inCorner = lap
    .filter((sample) => sample.distance >= corner.startDistance && sample.distance < corner.endDistance && sample.steeringRad !== undefined)
    .sort((a, b) => a.distance - b.distance);
  if (inCorner.length < 4) return null;
  let totalMoveDeg = 0;
  for (let index = 1; index < inCorner.length; index += 1) {
    totalMoveDeg += Math.abs((inCorner[index].steeringRad! - inCorner[index - 1].steeringRad!) * (180 / Math.PI));
  }
  const netMoveDeg = Math.abs((inCorner[inCorner.length - 1].steeringRad! - inCorner[0].steeringRad!) * (180 / Math.PI));
  return totalMoveDeg - netMoveDeg;
}

export function computeCornerBaselines(laps: CoachSample[][], corners: CoachCorner[]): CornerBaseline[] {
  return corners.map((corner) => {
    const brakingPoints = laps.map((lap) => brakeOnsetDistance(lap, corner)).filter((value): value is number => value !== null);
    const hasEnoughBraking = brakingPoints.length >= MIN_LAPS_FOR_BASELINE;
    return {
      number: corner.number, name: corner.name, startPct: corner.startDistance, endPct: corner.endDistance,
      brakingPointPct: hasEnoughBraking ? Number(median(brakingPoints).toFixed(2)) : null,
      brakingPointStdDev: hasEnoughBraking ? Number(stddev(brakingPoints).toFixed(2)) : null,
      correctionBaselineDeg: (() => {
        const values = laps.map((lap) => wastedSteeringDeg(lap, corner)).filter((value): value is number => value !== null);
        return values.length >= MIN_LAPS_FOR_BASELINE ? Number(median(values).toFixed(2)) : null;
      })(),
      wheelspinRatePct: null, // Task 3
      lapTimeContributionSeconds: null, lapTimeStdDev: null, // Task 4
    };
  });
}
