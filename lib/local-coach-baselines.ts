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
const WHEELSPIN_RPM_SURPLUS_PCT = 8; // matches lib/traction-events.ts's own validated threshold
const WHEELSPIN_MIN_GEAR_SAMPLES = 20; // matches lib/traction-events.ts's own validated threshold

type GearModel = Record<number, { a: number; b: number } | undefined>;

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

/** RPM = a*speed + b per gear, pooled across every lap in the pool -- same technique as
 * lib/traction-events.ts's buildGearRpmModel, reimplemented here since this module works on
 * CoachSample (distance-keyed, no lap-index bookkeeping needed) rather than TractionSample. */
function buildGearModel(laps: CoachSample[][]): GearModel {
  const byGear = new Map<number, { speed: number; rpm: number }[]>();
  for (const lap of laps) {
    for (const sample of lap) {
      if (sample.gear === undefined || sample.rpm === undefined || sample.speedMs === undefined) continue;
      if (sample.gear < 1 || sample.speedMs <= 1) continue;
      if (!byGear.has(sample.gear)) byGear.set(sample.gear, []);
      byGear.get(sample.gear)!.push({ speed: sample.speedMs, rpm: sample.rpm });
    }
  }
  const model: GearModel = {};
  for (const [gear, points] of byGear) {
    if (points.length < WHEELSPIN_MIN_GEAR_SAMPLES) continue;
    const n = points.length;
    const sx = points.reduce((sum, point) => sum + point.speed, 0);
    const sy = points.reduce((sum, point) => sum + point.rpm, 0);
    const sxx = points.reduce((sum, point) => sum + point.speed ** 2, 0);
    const sxy = points.reduce((sum, point) => sum + point.speed * point.rpm, 0);
    const denominator = n * sxx - sx * sx;
    if (denominator === 0) continue;
    const a = (n * sxy - sx * sy) / denominator;
    model[gear] = { a, b: (sy - a * sx) / n };
  }
  return model;
}

function hasWheelspinInCorner(lap: CoachSample[], corner: CoachCorner, model: GearModel): boolean {
  return lap.some((sample) => {
    if (sample.distance < corner.startDistance || sample.distance >= corner.endDistance) return false;
    if (sample.gear === undefined || sample.rpm === undefined || sample.speedMs === undefined) return false;
    const fit = model[sample.gear];
    if (!fit) return false;
    const predicted = fit.a * sample.speedMs + fit.b;
    if (predicted <= 0) return false;
    return ((sample.rpm - predicted) / predicted) * 100 >= WHEELSPIN_RPM_SURPLUS_PCT;
  });
}

export function computeCornerBaselines(laps: CoachSample[][], corners: CoachCorner[]): CornerBaseline[] {
  const gearModel = buildGearModel(laps);
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
      wheelspinRatePct: laps.length >= MIN_LAPS_FOR_BASELINE
        ? Number(((laps.filter((lap) => hasWheelspinInCorner(lap, corner, gearModel)).length / laps.length) * 100).toFixed(1))
        : null,
      lapTimeContributionSeconds: null, lapTimeStdDev: null, // Task 4
    };
  });
}
