/**
 * Detects real corners from lateral acceleration, not braking. A "corner" is any part of the track
 * that isn't a straight line — including flat, high-speed bends taken without braking (e.g. Curva
 * Grande at Monza) — so speed or brake-pressure local minima (the previous approach, used
 * independently and inconsistently in both ActiveWeekTelemetry.tsx and the debrief route) miss any
 * corner that doesn't require slowing down, and can attach a braking-zone number to the wrong real
 * corner. Lateral acceleration is a direct physical measurement of "the car is turning" and is far
 * less noisy than steering-wheel angle (which picks up small corrective inputs even on straights,
 * amplified by the car's steering ratio).
 *
 * The detection threshold is self-calibrating (a fraction of that lap's own 90th-percentile |lat
 * accel|) rather than a fixed number, since raw units/ranges vary by car and telemetry source.
 */

export type CornerSample = { distance: number; lateralAccel: number | null };
export type DetectedCorner = { number: number; distance: number; startDistance: number; endDistance: number; peak: number };

const GRID_STEP = 0.25; // % of lap distance
const THRESHOLD_RATIO = 0.35; // fraction of p90(|lateralAccel|) that counts as "turning"
const HIGH_PEAK_RATIO = 0.8; // a short but very sharp run (e.g. a chicane) is kept even if its arc is short
const MIN_ARC_PCT = 1.5; // minimum arc length to keep a run that isn't a high-peak spike
const MERGE_GAP_PCT = 1; // runs separated by less than this are treated as one corner complex

function interpolateCircular(sorted: CornerSample[], distance: number): number {
  const d = ((distance % 100) + 100) % 100;
  let previous = sorted[sorted.length - 1];
  for (const point of sorted) {
    if (point.distance >= d) {
      const value = point.lateralAccel ?? 0;
      const prevValue = previous.lateralAccel ?? 0;
      const span = point.distance - previous.distance;
      const ratio = span > 0 ? (d - previous.distance) / span : 0;
      return prevValue + (value - prevValue) * ratio;
    }
    previous = point;
  }
  return previous.lateralAccel ?? 0;
}

export function detectCorners(points: CornerSample[]): DetectedCorner[] {
  const valid = points.filter((point) => point.lateralAccel !== null);
  if (valid.length < 20) return [];
  const sorted = [...valid].sort((a, b) => a.distance - b.distance);

  const grid: { distance: number; value: number }[] = [];
  for (let distance = 0; distance < 100; distance += GRID_STEP) {
    grid.push({ distance, value: interpolateCircular(sorted, distance) });
  }

  const absSorted = grid.map((point) => Math.abs(point.value)).sort((a, b) => a - b);
  const p90 = absSorted[Math.floor(absSorted.length * 0.9)] || 0;
  if (p90 <= 0) return [];
  const threshold = p90 * THRESHOLD_RATIO;
  const highPeak = p90 * HIGH_PEAK_RATIO;

  type Run = { start: number; end: number; peakDistance: number; peak: number };
  const runs: Run[] = [];
  let current: Run | null = null;
  for (const point of grid) {
    const abs = Math.abs(point.value);
    if (abs >= threshold) {
      if (!current) current = { start: point.distance, end: point.distance, peakDistance: point.distance, peak: abs };
      else {
        current.end = point.distance;
        if (abs > current.peak) { current.peak = abs; current.peakDistance = point.distance; }
      }
    } else if (current) { runs.push(current); current = null; }
  }
  if (current) runs.push(current);

  // A corner can straddle the start/finish line — merge the first and last run if both touch the edge.
  if (runs.length >= 2) {
    const first = runs[0], last = runs[runs.length - 1];
    if (first.start <= GRID_STEP && last.end >= 100 - GRID_STEP && last.start - first.end - 100 < MERGE_GAP_PCT) {
      const combinedPeak = first.peak >= last.peak ? first.peakDistance : last.peakDistance;
      runs[0] = { start: last.start, end: first.end, peakDistance: combinedPeak, peak: Math.max(first.peak, last.peak) };
      runs.pop();
    }
  }

  const merged: Run[] = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last && run.start - last.end < MERGE_GAP_PCT) {
      last.end = run.end;
      if (run.peak > last.peak) { last.peak = run.peak; last.peakDistance = run.peakDistance; }
    } else merged.push({ ...run });
  }

  const filtered = merged.filter((run) => (run.end - run.start) >= MIN_ARC_PCT || run.peak >= highPeak);

  return filtered
    .sort((a, b) => a.start - b.start)
    .map((run, index) => ({
      number: index + 1,
      distance: Number(run.peakDistance.toFixed(1)),
      startDistance: Number(run.start.toFixed(1)),
      endDistance: Number(run.end.toFixed(1)),
      peak: Number(run.peak.toFixed(2)),
    }));
}
