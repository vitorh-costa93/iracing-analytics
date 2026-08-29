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

/** Splits one broad "turning" run into one or more real corners when it contains multiple distinct
 * apexes separated by a valley deep enough to count as a genuine separation, rather than reporting a
 * double-apex complex (Algarve's Samsung and Portimao corners, both same-direction and connected
 * without an intervening straight) as a single corner. Standard topographic-prominence peak merging:
 * repeatedly collapse the pair of adjacent peaks whose separating valley is shallowest, until the
 * shallowest remaining valley is deep enough (below `splitRatio` of the smaller neighboring peak) to
 * be trusted as two real corners. Operates purely on array position, not `distance`, so it works
 * unmodified on a run that has been unwrapped across the start/finish line. */
function splitByProminence(segment: { distance: number; value: number }[], splitRatio: number): Array<{ start: number; end: number; peakDistance: number; peak: number }> {
  const n = segment.length;
  if (n === 0) return [];
  if (n < 3) {
    let peakIdx = 0;
    for (let i = 1; i < n; i++) if (segment[i].value > segment[peakIdx].value) peakIdx = i;
    return [{ start: segment[0].distance, end: segment[n - 1].distance, peakDistance: segment[peakIdx].distance, peak: segment[peakIdx].value }];
  }

  type Extremum = { index: number; value: number };
  const peaks: Extremum[] = [];
  for (let i = 0; i < n; i++) {
    const value = segment[i].value;
    const prev = i > 0 ? segment[i - 1].value : -Infinity;
    const next = i < n - 1 ? segment[i + 1].value : -Infinity;
    if (value >= prev && value > next) peaks.push({ index: i, value });
  }
  if (peaks.length === 0) peaks.push({ index: n - 1, value: segment[n - 1].value });

  const valleyBetween = (a: number, b: number) => {
    let min = Infinity;
    for (let i = a; i <= b; i++) min = Math.min(min, segment[i].value);
    return min;
  };

  const kept = peaks.slice();
  while (kept.length > 1) {
    let weakestPos = -1, weakestRatio = -Infinity;
    for (let i = 0; i < kept.length - 1; i++) {
      const ratio = valleyBetween(kept[i].index, kept[i + 1].index) / Math.min(kept[i].value, kept[i + 1].value);
      if (ratio > weakestRatio) { weakestRatio = ratio; weakestPos = i; }
    }
    if (weakestRatio < splitRatio) break; // deepest-cut remaining valley is still a real separation
    const a = kept[weakestPos], b = kept[weakestPos + 1];
    kept.splice(weakestPos, 2, a.value >= b.value ? a : b); // merge the weaker peak into the stronger
  }

  return kept.map((peak, i) => {
    let startIdx = 0;
    if (i > 0) {
      let minIdx = kept[i - 1].index, minVal = Infinity;
      for (let j = kept[i - 1].index; j <= peak.index; j++) if (segment[j].value < minVal) { minVal = segment[j].value; minIdx = j; }
      startIdx = minIdx;
    }
    let endIdx = n - 1;
    if (i < kept.length - 1) {
      let minIdx = peak.index, minVal = Infinity;
      for (let j = peak.index; j <= kept[i + 1].index; j++) if (segment[j].value < minVal) { minVal = segment[j].value; minIdx = j; }
      endIdx = minIdx;
    }
    return { start: segment[startIdx].distance, end: segment[endIdx].distance, peakDistance: segment[peak.index].distance, peak: peak.value };
  });
}

/** GPS geometry is the authoritative fallback for corner ORDER.  Lateral acceleration can miss
 * a gentle turn when the driver is coasting, which made Indianapolis' first reported "corner"
 * land at the exit of Turn 3.  The heading change of the physical trace is independent of pedal
 * use and starts from the lap's true start/finish distance. */
export function detectCornersFromGps(points: Array<{ distance: number; lat: number | null; lon: number | null }>): DetectedCorner[] {
  const valid = points.filter((point): point is { distance: number; lat: number; lon: number } => point.lat !== null && point.lon !== null).sort((a, b) => a.distance - b.distance);
  if (valid.length < 30) return [];
  const meanLat = valid.reduce((sum, point) => sum + point.lat, 0) / valid.length;
  const lonScale = Math.cos(meanLat * Math.PI / 180);
  const nearest = (distance: number) => valid.reduce((best, point) => Math.abs(point.distance - distance) < Math.abs(best.distance - distance) ? point : best, valid[0]);
  const angleDelta = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

  // 0.15% steps (~7m on a 4.7km lap) -- much finer than the original 0.5% (~23m). The coarse grid was
  // smoothing away the brief straightening between apexes of a double-apex complex (Algarve's Samsung
  // and Portimao corners connect with no real straight between them), which under-counted Algarve's
  // real 15 turns as 11-12 even after this function replaced the lateral-accel-only detector.
  const STEP = 0.15;
  const total = Math.round(100 / STEP);
  const samples = Array.from({ length: total }, (_, index) => {
    const distance = index * STEP;
    const before = nearest((distance - 1 + 100) % 100), center = nearest(distance), after = nearest((distance + 1) % 100);
    const headingIn = Math.atan2(center.lat - before.lat, (center.lon - before.lon) * lonScale);
    const headingOut = Math.atan2(after.lat - center.lat, (after.lon - center.lon) * lonScale);
    return { distance, value: Math.abs(angleDelta(headingIn, headingOut)) };
  });
  const sorted = samples.map((item) => item.value).sort((a, b) => a - b);
  const threshold = (sorted[Math.floor(sorted.length * .65)] ?? 0) * .55;
  if (threshold <= 0) return [];

  // Broad turning runs as sample-INDEX ranges, so a run straddling the start/finish line wraps
  // cleanly (no distance-comparison edge case once the run is later unwrapped for prominence-splitting).
  const runs: Array<{ startIdx: number; endIdx: number }> = [];
  let runStartIdx: number | null = null;
  for (let i = 0; i < total; i++) {
    if (samples[i].value >= threshold) { if (runStartIdx === null) runStartIdx = i; }
    else if (runStartIdx !== null) { runs.push({ startIdx: runStartIdx, endIdx: i - 1 }); runStartIdx = null; }
  }
  if (runStartIdx !== null) runs.push({ startIdx: runStartIdx, endIdx: total - 1 });

  // A corner can straddle the start/finish line -- merge the first and last run if both touch an edge.
  if (runs.length >= 2) {
    const first = runs[0], last = runs[runs.length - 1];
    if (first.startIdx === 0 && last.endIdx === total - 1) {
      runs[0] = { startIdx: last.startIdx, endIdx: first.endIdx + total }; // endIdx left unwrapped (may exceed total)
      runs.pop();
    }
  }

  const MERGE_GAP = Math.max(1, Math.round(1 / STEP)); // runs separated by <1% of lap are one corner complex
  const merged: Array<{ startIdx: number; endIdx: number }> = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last && run.startIdx - last.endIdx < MERGE_GAP) last.endIdx = Math.max(last.endIdx, run.endIdx);
    else merged.push({ ...run });
  }

  const at = (idx: number) => samples[((idx % total) + total) % total];
  // Grid-searched against two real, independently-known corner counts (Algarve GP = 15, Red Bull Ring
  // GP = 10) via a temporary tuning route, 29/08/2026: 0.85 hits both exactly and stayed correct
  // across every step/threshold combination tried. A valley only needs to drop to <=85% of the
  // smaller neighboring peak to count as two real corners -- double-apex complexes (Samsung, Portimao)
  // barely dip between apexes, so a stricter (lower) ratio was merging them into one.
  const SPLIT_RATIO = 0.85;

  const corners: Array<{ start: number; end: number; peakDistance: number; peak: number }> = [];
  for (const run of merged) {
    const length = run.endIdx - run.startIdx + 1;
    const segment = Array.from({ length }, (_, k) => at(run.startIdx + k));
    corners.push(...splitByProminence(segment, SPLIT_RATIO));
  }

  return corners
    .filter((item) => item.end - item.start >= STEP * 2)
    .map((item, index) => ({ number: index + 1, distance: Number(item.peakDistance.toFixed(1)), startDistance: Number(item.start.toFixed(1)), endDistance: Number(item.end.toFixed(1)), peak: Number(item.peak.toFixed(3)) }));
}
