/** Detects wheelspin (destracionamento) and steering micro-corrections from raw telemetry samples.
 * Validated by hand on a real Ferrari 499P lap at Road Atlanta (11/09/2026) before being turned into
 * this module, then validated AGAIN by running the actual module against that same real lap before
 * shipping (11/09/2026): the RPM-surplus wheelspin detector reproduced the hand-found event exactly
 * (same distance, speed, gear, +13% surplus) and correctly stayed quiet on the bigger RPM spike that
 * was really a gearshift artifact. The FIRST version of the steering-correction detector, though,
 * failed that same real-data check: an absolute "4+ reversals in 0.3s" threshold fired 37 times on
 * one lap, including at 300 km/h on what should read as committed, non-corrective cornering -- because
 * any normal corner's turn-in/apex/unwind shape already contains a direction reversal, an absolute
 * threshold can't tell "this is just what a corner looks like" from "this driver is fighting the car
 * here". The fix (current version below) compares each spot on track against this driver's OWN median
 * behavior at that exact spot across the other sampled laps -- same "corner-relative baseline"
 * philosophy the rest of this codebase already uses (e.g. car-comparison's cornerConsistencyScore) --
 * so a correction only counts when it's a genuine outlier against the driver's own normal line, not
 * just because cornering itself involves the wheel changing direction.
 *
 * "Limiares fixos por enquanto" (11/09/2026): the constants below are the exact ones validated this
 * way. This is the only iRacing driver this app serves, so there's no fleet to calibrate against yet
 * -- revisit if a car/category turns out to need different numbers in practice. */

export type TractionSample = {
  distance: number; // % of lap, 0-100
  throttle?: number; // 0-1
  rpm?: number;
  gear?: number;
  speedMs?: number;
  steeringRad?: number;
  yawRate?: number; // rad/s
};

export type WheelspinEvent = {
  distance: number; // % of lap where the RPM surplus peaked
  speedKmh: number;
  gear: number;
  throttlePct: number; // 0-100
  rpmSurplusPct: number; // how far actual RPM sat above the lap's own gear/speed model
};

export type CorrectionEvent = {
  startDistance: number; endDistance: number; // % of lap
  oscillationDeg: number; // "wasted" steering motion in this zone (sum of |Δ| minus net |Δ|), this lap
  baselineDeg: number; // this driver's own median wasted motion at this exact spot, across the other sampled laps
  speedKmh: number;
};

export type GearRpmModel = Record<number, { a: number; b: number; n: number } | undefined>;

const WHEELSPIN_THROTTLE_MIN = 0.85; // near-full throttle -- below this, an RPM/speed mismatch is more likely a lift or a shift, not spin
const WHEELSPIN_RPM_SURPLUS_PCT = 8; // % above the gear's own RPM-vs-speed model to count as spin
const WHEELSPIN_GEAR_STABLE_WINDOW = 3; // samples on each side that must share the same gear
const WHEELSPIN_MIN_GEAR_SAMPLES = 20; // minimum pooled samples in a gear before trusting its regression at all
const WHEELSPIN_MERGE_DISTANCE_PCT = 0.3; // two flagged samples this close together are one event, not two

const CORRECTION_BIN_PCT = 1; // % of lap per bin -- close to the real-world distance the original 0.33s time-window covered at typical corner speed
const CORRECTION_MIN_SPEED_KMH = 70; // ignore pit-lane/parked noise
const CORRECTION_MIN_LAPS = 3; // a median across fewer laps than this isn't a trustworthy "what's normal here" baseline
const CORRECTION_RATIO = 2.5; // this lap's wasted motion in a bin must be at least this many times the bin's own median across the other laps
const CORRECTION_ABS_FLOOR_DEG = 4; // AND exceed that median by at least this many degrees -- stops a near-zero baseline bin (a flat-out kink the driver always takes clean) from flagging off a trivial absolute wobble that happens to be a big ratio of ~nothing
const CORRECTION_MIN_YAW_VARIANCE = 0.015; // rad/s stddev inside the flagged bin -- sanity floor confirming the car is actually rotating there, not just a lone noisy sample on the steering channel
const CORRECTION_MERGE_DISTANCE_PCT = 1; // adjacent flagged bins are one event, not several

function mean(values: number[]) { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function stddev(values: number[], avg: number) { return Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length); }
function median(values: number[]) { const sorted = [...values].sort((a, b) => a - b); const mid = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2; }

/** Fits RPM = a*speed + b per gear, pooling every sample across every lap passed in (not per-lap) --
 * a shared, more robust baseline for "what this car/gear normally does at this speed" than any single
 * lap alone could give, same technique validated in the Road Atlanta lap. Gears with too few samples
 * are left out of the model entirely (undefined), which detectWheelspin then treats as "can't judge
 * this gear" rather than guessing from a handful of points. */
export function buildGearRpmModel(laps: TractionSample[][]): GearRpmModel {
  const byGear = new Map<number, { speed: number; rpm: number }[]>();
  for (const lap of laps) {
    for (const sample of lap) {
      if (sample.gear === undefined || sample.rpm === undefined || sample.speedMs === undefined) continue;
      if (sample.gear < 1 || sample.speedMs <= 1) continue; // neutral/reverse or near-stationary skew the fit
      if (!byGear.has(sample.gear)) byGear.set(sample.gear, []);
      byGear.get(sample.gear)!.push({ speed: sample.speedMs, rpm: sample.rpm });
    }
  }
  const model: GearRpmModel = {};
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
    const b = (sy - a * sx) / n;
    model[gear] = { a, b, n };
  }
  return model;
}

/** Flags samples where the engine is spinning meaningfully faster than the car's own gear/speed model
 * predicts, at high throttle, in a gear that hasn't just shifted -- the rear tire slipping instead of
 * driving the car forward. Deliberately excludes the few samples around any gear change: an upshift
 * or downshift produces a brief RPM/speed mismatch on its own (confirmed live: a +18.8% "surplus"
 * right at a 3rd-to-4th shift in the validation lap was the shift itself, not a second wheelspin
 * event, and had to be excluded by hand there -- this is that exclusion made automatic). */
export function detectWheelspin(samples: TractionSample[], model: GearRpmModel): WheelspinEvent[] {
  const flagged: (WheelspinEvent & { index: number })[] = [];
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    if (sample.throttle === undefined || sample.throttle < WHEELSPIN_THROTTLE_MIN) continue;
    if (sample.gear === undefined || sample.rpm === undefined || sample.speedMs === undefined) continue;
    const fit = model[sample.gear];
    if (!fit) continue;

    const windowStart = Math.max(0, index - WHEELSPIN_GEAR_STABLE_WINDOW);
    const windowEnd = Math.min(samples.length - 1, index + WHEELSPIN_GEAR_STABLE_WINDOW);
    let gearStable = true;
    for (let i = windowStart; i <= windowEnd; i += 1) { if (samples[i].gear !== sample.gear) { gearStable = false; break; } }
    if (!gearStable) continue;

    const predictedRpm = fit.a * sample.speedMs + fit.b;
    if (predictedRpm <= 0) continue;
    const surplusPct = ((sample.rpm - predictedRpm) / predictedRpm) * 100;
    if (surplusPct < WHEELSPIN_RPM_SURPLUS_PCT) continue;

    flagged.push({
      index, distance: sample.distance, speedKmh: sample.speedMs * 3.6, gear: sample.gear,
      throttlePct: sample.throttle * 100, rpmSurplusPct: Number(surplusPct.toFixed(1)),
    });
  }
  return mergeNearbyPeaks(flagged, WHEELSPIN_MERGE_DISTANCE_PCT);
}

function mergeNearbyPeaks<T extends { distance: number; index: number; rpmSurplusPct: number }>(flagged: T[], mergeDistancePct: number): T[] {
  if (!flagged.length) return [];
  const sorted = [...flagged].sort((a, b) => a.distance - b.distance);
  const groups: T[][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i += 1) {
    const lastGroup = groups[groups.length - 1];
    if (sorted[i].distance - lastGroup[lastGroup.length - 1].distance <= mergeDistancePct) lastGroup.push(sorted[i]);
    else groups.push([sorted[i]]);
  }
  return groups.map((group) => group.reduce((best, item) => (item.rpmSurplusPct > best.rpmSurplusPct ? item : best)));
}

type BinStats = { oscillationDeg: number; yawStd: number; speedKmh: number } | null;

/** One lap's steering trace binned into CORRECTION_BIN_PCT-wide windows of lap distance. Per bin:
 * "wasted" steering motion = total absolute movement minus net displacement -- near zero for a smooth
 * monotonic turn-in (any real corner has some), large when the driver moves the wheel back and forth
 * without actually progressing the angle. */
function binSteeringOscillation(samples: TractionSample[]): BinStats[] {
  const binCount = Math.ceil(100 / CORRECTION_BIN_PCT);
  const bins: TractionSample[][] = Array.from({ length: binCount }, () => []);
  for (const sample of samples) {
    if (sample.steeringRad === undefined || sample.speedMs === undefined) continue;
    const index = Math.min(binCount - 1, Math.max(0, Math.floor(sample.distance / CORRECTION_BIN_PCT)));
    bins[index].push(sample);
  }
  return bins.map((binSamples) => {
    if (binSamples.length < 4) return null;
    let totalMoveDeg = 0;
    for (let i = 1; i < binSamples.length; i += 1) totalMoveDeg += Math.abs((binSamples[i].steeringRad! - binSamples[i - 1].steeringRad!) * (180 / Math.PI));
    const netMoveDeg = Math.abs((binSamples[binSamples.length - 1].steeringRad! - binSamples[0].steeringRad!) * (180 / Math.PI));
    const yawValues = binSamples.filter((sample) => sample.yawRate !== undefined).map((sample) => sample.yawRate!);
    return {
      oscillationDeg: totalMoveDeg - netMoveDeg,
      yawStd: yawValues.length >= 3 ? stddev(yawValues, mean(yawValues)) : 0,
      speedKmh: mean(binSamples.map((sample) => sample.speedMs!)) * 3.6,
    };
  });
}

/** Flags stretches of track where THIS lap's steering shows meaningfully more "wasted" back-and-forth
 * motion than this same driver's own median at that exact spot across the OTHER sampled laps --
 * corner-relative, the same philosophy as car-comparison's cornerConsistencyScore. Requires at least
 * CORRECTION_MIN_LAPS laps to build a baseline worth trusting; with fewer, returns nothing rather than
 * guessing from a single lap (see this file's top comment for why an absolute per-lap threshold failed
 * real validation). The yaw-variance floor stays as a light sanity check that the flagged bin reflects
 * the car actually rotating, not one noisy sample on the steering channel alone. */
export function detectSteeringCorrections(laps: TractionSample[][]): CorrectionEvent[] {
  if (laps.length < CORRECTION_MIN_LAPS) return [];
  const binnedPerLap = laps.map(binSteeringOscillation);
  const binCount = binnedPerLap[0]?.length ?? 0;

  const baselinePerBin: number[] = [];
  for (let bin = 0; bin < binCount; bin += 1) {
    const values = binnedPerLap.map((lapBins) => lapBins[bin]?.oscillationDeg).filter((value): value is number => value !== undefined);
    baselinePerBin.push(values.length ? median(values) : 0);
  }

  const events: CorrectionEvent[] = [];
  for (const lapBins of binnedPerLap) {
    const flagged: { bin: number; oscillationDeg: number; baselineDeg: number; speedKmh: number }[] = [];
    for (let bin = 0; bin < binCount; bin += 1) {
      const stats = lapBins[bin];
      if (!stats || stats.speedKmh < CORRECTION_MIN_SPEED_KMH) continue;
      const baseline = baselinePerBin[bin];
      const exceedsRatio = stats.oscillationDeg > baseline * CORRECTION_RATIO;
      const exceedsFloor = stats.oscillationDeg - baseline > CORRECTION_ABS_FLOOR_DEG;
      if (!exceedsRatio || !exceedsFloor) continue;
      if (stats.yawStd < CORRECTION_MIN_YAW_VARIANCE) continue;
      flagged.push({ bin, oscillationDeg: stats.oscillationDeg, baselineDeg: baseline, speedKmh: stats.speedKmh });
    }
    if (!flagged.length) continue;
    const groups: typeof flagged[] = [[flagged[0]]];
    for (let i = 1; i < flagged.length; i += 1) {
      const lastGroup = groups[groups.length - 1];
      if (flagged[i].bin - lastGroup[lastGroup.length - 1].bin <= CORRECTION_MERGE_DISTANCE_PCT / CORRECTION_BIN_PCT) lastGroup.push(flagged[i]);
      else groups.push([flagged[i]]);
    }
    for (const group of groups) {
      const peak = group.reduce((best, item) => (item.oscillationDeg - item.baselineDeg > best.oscillationDeg - best.baselineDeg ? item : best));
      events.push({
        startDistance: Number((group[0].bin * CORRECTION_BIN_PCT).toFixed(2)),
        endDistance: Number(((group[group.length - 1].bin + 1) * CORRECTION_BIN_PCT).toFixed(2)),
        oscillationDeg: Number(peak.oscillationDeg.toFixed(1)), baselineDeg: Number(peak.baselineDeg.toFixed(1)),
        speedKmh: Number(peak.speedKmh.toFixed(1)),
      });
    }
  }
  return events;
}

export type TractionSummary = {
  lapsAnalyzed: number;
  wheelspinCount: number; correctionCount: number;
  wheelspinPer10Laps: number; correctionsPer10Laps: number;
  worstWheelspin: WheelspinEvent | null;
  worstCorrection: CorrectionEvent | null;
};

/** The per-car summary every surface (Comparar Carros today, Melhor Volta vs Referência and Meu
 * Debrief later) consumes: how often, not just whether. Rates are normalized "per 10 laps" so a car
 * sampled on 3 laps and one sampled on 8 laps are comparable, answering "é hábito ou é pontual" --
 * the question this whole feature exists to answer, not a bare event count that scales with sample size. */
export function summarizeTractionEvents(laps: TractionSample[][]): TractionSummary {
  const validLaps = laps.filter((lap) => lap.length > 20);
  if (!validLaps.length) {
    return { lapsAnalyzed: 0, wheelspinCount: 0, correctionCount: 0, wheelspinPer10Laps: 0, correctionsPer10Laps: 0, worstWheelspin: null, worstCorrection: null };
  }
  const model = buildGearRpmModel(validLaps);
  const wheelspinEvents: WheelspinEvent[] = [];
  for (const lap of validLaps) wheelspinEvents.push(...detectWheelspin(lap, model));
  // detectSteeringCorrections needs the whole pool at once (it builds the corner-relative baseline
  // from every OTHER lap), unlike wheelspin which is judged per-lap against a shared model.
  const correctionEvents = detectSteeringCorrections(validLaps);

  const laneCount = validLaps.length;
  const worstWheelspin = wheelspinEvents.length ? wheelspinEvents.reduce((best, event) => (event.rpmSurplusPct > best.rpmSurplusPct ? event : best)) : null;
  const worstCorrection = correctionEvents.length
    ? correctionEvents.reduce((best, event) => (event.oscillationDeg - event.baselineDeg > best.oscillationDeg - best.baselineDeg ? event : best))
    : null;
  return {
    lapsAnalyzed: laneCount,
    wheelspinCount: wheelspinEvents.length, correctionCount: correctionEvents.length,
    wheelspinPer10Laps: Number(((wheelspinEvents.length / laneCount) * 10).toFixed(1)),
    correctionsPer10Laps: Number(((correctionEvents.length / laneCount) * 10).toFixed(1)),
    worstWheelspin, worstCorrection,
  };
}
