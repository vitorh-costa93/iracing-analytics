// lib/traction-events.test.ts
import { describe, expect, it } from "vitest";
import { buildGearRpmModel, detectWheelspin, detectSteeringCorrections, summarizeTractionEvents, type TractionSample } from "./traction-events";

/** A clean, steady 3rd-gear run: RPM tracks speed via a fixed ratio (a=140, b=500), speed ramps
 * smoothly, no wheelspin, no steering activity -- the "nothing to see here" baseline every positive
 * test perturbs. */
function baselineLap(length = 200): TractionSample[] {
  const samples: TractionSample[] = [];
  for (let i = 0; i < length; i += 1) {
    const speedMs = 40 + i * 0.05;
    samples.push({
      distance: (i / length) * 100,
      throttle: 0.9,
      gear: 3,
      speedMs,
      rpm: 140 * speedMs + 500,
      steeringRad: 0,
      yawRate: 0,
    });
  }
  return samples;
}

describe("buildGearRpmModel", () => {
  it("fits the known linear ratio from clean samples", () => {
    const model = buildGearRpmModel([baselineLap()]);
    expect(model[3]).toBeDefined();
    expect(model[3]!.a).toBeCloseTo(140, 0);
    expect(model[3]!.b).toBeCloseTo(500, -1);
  });

  it("leaves out gears with too few samples rather than fitting an unreliable line", () => {
    const sparse: TractionSample[] = [{ distance: 0, gear: 5, speedMs: 50, rpm: 6000, throttle: 1 }];
    const model = buildGearRpmModel([sparse]);
    expect(model[5]).toBeUndefined();
  });
});

describe("detectWheelspin", () => {
  it("flags a genuine RPM spike at high throttle in a stable gear", () => {
    const lap = baselineLap();
    const model = buildGearRpmModel([lap]);
    const spiked = lap.map((sample, i) => (i === 100 ? { ...sample, rpm: sample.rpm! * 1.15 } : sample));
    const events = detectWheelspin(spiked, model);
    expect(events).toHaveLength(1);
    expect(events[0].rpmSurplusPct).toBeGreaterThanOrEqual(8);
  });

  it("does not flag a shift-induced RPM jump right after a gear change", () => {
    const lap = baselineLap();
    const model = buildGearRpmModel([lap]);
    // Simulate an upshift at index 100: gear changes to 4, RPM briefly doesn't track the new gear's
    // model cleanly (a real artifact, per the Road Atlanta validation lap) -- must not be reported as
    // wheelspin just because the raw RPM/speed ratio looks off for one sample near the shift.
    const shifted = lap.map((sample, i) => (i >= 100 ? { ...sample, gear: 4, rpm: sample.rpm! * 1.15 } : sample));
    const events = detectWheelspin(shifted, model);
    // Gear 4 never accumulated enough samples to get its own model entry, so nothing should fire at all.
    expect(events).toHaveLength(0);
  });

  it("ignores a matching RPM/speed mismatch when throttle is not near full", () => {
    const lap = baselineLap();
    const model = buildGearRpmModel([lap]);
    const lifted = lap.map((sample, i) => (i === 100 ? { ...sample, throttle: 0.3, rpm: sample.rpm! * 1.2 } : sample));
    expect(detectWheelspin(lifted, model)).toHaveLength(0);
  });

  it("merges adjacent flagged samples into a single event", () => {
    // Dense fixture (like a real ~60Hz Garage61 export, where consecutive samples sit a fraction of
    // a percent apart) -- baselineLap()'s default 200 samples spaces them 0.5% apart, wider than the
    // merge window itself, which would defeat the point of this test.
    const lap = baselineLap(2000);
    const model = buildGearRpmModel([lap]);
    const spiked = lap.map((sample, i) => (i >= 1000 && i <= 1010 ? { ...sample, rpm: sample.rpm! * 1.15 } : sample));
    expect(detectWheelspin(spiked, model)).toHaveLength(1);
  });
});

describe("detectSteeringCorrections", () => {
  // A clean single-reversal turn-in/unwind (what EVERY lap does at this corner normally) vs a zigzag
  // covering the same net displacement with much more back-and-forth (what only the "problem" lap
  // does there) -- this is the exact distinction an absolute reversal-count threshold couldn't make
  // (see this module's top comment) and the corner-relative baseline exists to catch.
  const NORMAL_CORNER_DEG = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
  const ZIGZAG_CORNER_DEG = [0, 2, 5, 8, 10, 7, 9, 6, 10, 8, 10, 7, 9, 5, 8, 4, 6, 2, 3, 1];
  const CORNER_START_INDEX = 1000; // bin 50 (distance 50-51%) in a 2000-sample lap

  function applyCornerShape(lap: TractionSample[], degrees: number[]): TractionSample[] {
    const copy = lap.map((sample) => ({ ...sample }));
    degrees.forEach((deg, k) => {
      const sample = copy[CORNER_START_INDEX + k];
      if (!sample) return;
      sample.steeringRad = (deg * Math.PI) / 180;
      sample.yawRate = deg / 100; // synthetic but proportional -- nonzero whenever the wheel is off-center, more when it moves more
    });
    return copy;
  }

  it("flags a lap with meaningfully more wasted steering motion than its own baseline at that spot", () => {
    const clean = () => applyCornerShape(baselineLap(2000), NORMAL_CORNER_DEG);
    const problem = applyCornerShape(baselineLap(2000), ZIGZAG_CORNER_DEG);
    const events = detectSteeringCorrections([problem, clean(), clean(), clean()]);
    expect(events).toHaveLength(1);
    expect(events[0].startDistance).toBeCloseTo(50, 0);
    expect(events[0].oscillationDeg).toBeGreaterThan(events[0].baselineDeg * 2.5);
  });

  it("does not flag every lap's own normal corner shape against itself", () => {
    const clean = () => applyCornerShape(baselineLap(2000), NORMAL_CORNER_DEG);
    expect(detectSteeringCorrections([clean(), clean(), clean(), clean()])).toHaveLength(0);
  });

  it("needs at least a few laps to trust a baseline -- returns nothing below that", () => {
    const clean = () => applyCornerShape(baselineLap(2000), NORMAL_CORNER_DEG);
    expect(detectSteeringCorrections([clean(), clean()])).toHaveLength(0);
  });

  it("ignores oscillation below the minimum speed (pit lane, parked)", () => {
    const clean = () => applyCornerShape(baselineLap(2000), NORMAL_CORNER_DEG);
    const problem = applyCornerShape(baselineLap(2000), ZIGZAG_CORNER_DEG).map((sample) => ({ ...sample, speedMs: 5 }));
    expect(detectSteeringCorrections([problem, clean(), clean(), clean()])).toHaveLength(0);
  });
});

describe("summarizeTractionEvents", () => {
  it("normalizes event counts to a per-10-laps rate across multiple laps", () => {
    const spikyLap = baselineLap().map((sample, i) => (i === 100 ? { ...sample, rpm: sample.rpm! * 1.15 } : sample));
    const cleanLap = baselineLap();
    const summary = summarizeTractionEvents([spikyLap, cleanLap, cleanLap, cleanLap, cleanLap]);
    expect(summary.lapsAnalyzed).toBe(5);
    expect(summary.wheelspinCount).toBe(1);
    expect(summary.wheelspinPer10Laps).toBeCloseTo(2, 1); // 1 event / 5 laps * 10
    expect(summary.worstWheelspin).not.toBeNull();
  });

  it("returns a zeroed-out summary for an empty lap pool", () => {
    const summary = summarizeTractionEvents([]);
    expect(summary).toEqual({ lapsAnalyzed: 0, wheelspinCount: 0, correctionCount: 0, wheelspinPer10Laps: 0, correctionsPer10Laps: 0, worstWheelspin: null, worstCorrection: null });
  });
});
