import { describe, expect, it } from "vitest";
import { computeCornerBaselines, type CoachSample, type CoachCorner } from "./local-coach-baselines";

const CORNERS: CoachCorner[] = [{ number: 1, name: "Turn 1", startDistance: 10, endDistance: 20 }];

function makeLap(brakeOnsetPct: number): CoachSample[] {
  const samples: CoachSample[] = [];
  for (let distance = 0; distance <= 100; distance += 0.5) {
    samples.push({ distance, brake: distance >= brakeOnsetPct && distance < brakeOnsetPct + 5 ? 0.8 : 0 });
  }
  return samples;
}

function lapWithSteering(cornerWiggleDeg: number): CoachSample[] {
  const samples: CoachSample[] = [];
  for (let distance = 0; distance <= 100; distance += 0.5) {
    let steeringRad = 0;
    if (distance >= 12.5 && distance < 17.5) {
      steeringRad = (cornerWiggleDeg * Math.PI) / 180;
    }
    samples.push({ distance, steeringRad });
  }
  return samples;
}

describe("computeCornerBaselines", () => {
  it("reports the median brake-onset point within the corner's own approach window", () => {
    const laps = [makeLap(8), makeLap(8.5), makeLap(7.5), makeLap(9)];
    const { corners: [corner] } = computeCornerBaselines(laps, CORNERS, [90, 90, 90, 90]);
    expect(corner.brakingPointPct).toBeCloseTo(8.25, 1);
    expect(corner.brakingPointStdDev).toBeGreaterThan(0);
  });

  it("returns null braking point for a corner nobody ever braked for", () => {
    const laps = [makeLap(50), makeLap(51), makeLap(52)]; // braking way outside corner 1's window
    const { corners: [corner] } = computeCornerBaselines(laps, CORNERS, [90, 90, 90]);
    expect(corner.brakingPointPct).toBeNull();
  });

  it("returns an empty corners array (not an error) when there is no lap/corner data", () => {
    const { corners } = computeCornerBaselines([], [], []);
    expect(corners).toEqual([]);
  });
});

describe("computeCornerBaselines -- steering correction", () => {
  it("reports the median wasted steering motion inside the corner's own window", () => {
    const laps = [lapWithSteering(5), lapWithSteering(6), lapWithSteering(4), lapWithSteering(5.5)];
    const { corners: [corner] } = computeCornerBaselines(laps, CORNERS, [90, 90, 90, 90]);
    expect(corner.correctionBaselineDeg).not.toBeNull();
    expect(corner.correctionBaselineDeg!).toBeGreaterThan(0);
  });
});

function lapWithGearShift(rpmSurplusPct: number): CoachSample[] {
  const samples: CoachSample[] = [];
  for (let distance = 0; distance <= 100; distance += 0.5) {
    // Corner 1 spans [10, 20); only the EXIT half ([15, 20)) is checked for wheelspin now, so the
    // surplus is placed specifically there -- keeping it at [10, 20) would no longer exercise the
    // real detector once entry-half samples stopped being scanned.
    const inExit = distance >= 15 && distance < 20;
    // Speed VARIES across the lap (unlike a constant) -- buildGearModel's linear regression needs
    // more than one distinct speed value or it's degenerate (zero variance in x collapses the
    // denominator to 0, silently skipping the gear entirely; verified numerically before this plan
    // was finalized).
    const speedMs = 20 + distance * 0.1;
    const baseRpm = speedMs * 100; // consistent RPM-per-speed for gear 3 across every lap
    // throttle stays >= WHEELSPIN_THROTTLE_MIN (0.85) everywhere, including during the "spinning"
    // window, so the new throttle gate doesn't silently zero out the surplus this test exercises.
    samples.push({ distance, gear: 3, speedMs, throttle: 0.95, rpm: inExit ? baseRpm * (1 + rpmSurplusPct / 100) : baseRpm });
  }
  return samples;
}

describe("computeCornerBaselines -- wheelspin rate", () => {
  it("reports how often this corner's exit shows an RPM surplus over this car's own gear model", () => {
    const laps = [lapWithGearShift(15), lapWithGearShift(0), lapWithGearShift(0), lapWithGearShift(0)];
    const { corners: [corner] } = computeCornerBaselines(laps, CORNERS, [90, 90, 90, 90]);
    expect(corner.wheelspinRatePct).not.toBeNull();
    expect(corner.wheelspinRatePct!).toBeCloseTo(25, 0); // 1 of 4 laps showed a surplus
  });

  it("returns null wheelspin rate when there are fewer than MIN_LAPS_FOR_BASELINE laps in the pool", () => {
    const laps = [lapWithGearShift(15), lapWithGearShift(0)]; // only 2 laps, below the MIN_LAPS_FOR_BASELINE=3 floor
    const { corners: [corner] } = computeCornerBaselines(laps, CORNERS, [90, 90]);
    expect(corner.wheelspinRatePct).toBeNull();
  });
});

function lapWithConstantSpeed(speedMs: number): { samples: CoachSample[]; lapTimeSeconds: number } {
  const samples: CoachSample[] = [];
  for (let distance = 0; distance <= 100; distance += 0.5) samples.push({ distance, speedMs });
  return { samples, lapTimeSeconds: 1609 / speedMs }; // 1609m = arbitrary fixed lap length for this fixture
}

describe("computeCornerBaselines -- lap-time contribution", () => {
  it("reports how many seconds of the lap this corner's own window typically costs", () => {
    const laps = [lapWithConstantSpeed(40), lapWithConstantSpeed(41), lapWithConstantSpeed(39)];
    const { corners: [corner] } = computeCornerBaselines(
      laps.map((lap) => lap.samples), CORNERS, laps.map((lap) => lap.lapTimeSeconds),
    );
    expect(corner.lapTimeContributionSeconds).not.toBeNull();
    expect(corner.lapTimeContributionSeconds!).toBeGreaterThan(0);
    expect(corner.lapTimeStdDev).not.toBeNull();
  });
});
