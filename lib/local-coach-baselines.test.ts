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
    const [corner] = computeCornerBaselines(laps, CORNERS);
    expect(corner.brakingPointPct).toBeCloseTo(8.25, 1);
    expect(corner.brakingPointStdDev).toBeGreaterThan(0);
  });

  it("returns null braking point for a corner nobody ever braked for", () => {
    const laps = [makeLap(50), makeLap(51), makeLap(52)]; // braking way outside corner 1's window
    const [corner] = computeCornerBaselines(laps, CORNERS);
    expect(corner.brakingPointPct).toBeNull();
  });
});

describe("computeCornerBaselines -- steering correction", () => {
  it("reports the median wasted steering motion inside the corner's own window", () => {
    const laps = [lapWithSteering(5), lapWithSteering(6), lapWithSteering(4), lapWithSteering(5.5)];
    const [corner] = computeCornerBaselines(laps, CORNERS);
    expect(corner.correctionBaselineDeg).not.toBeNull();
    expect(corner.correctionBaselineDeg!).toBeGreaterThan(0);
  });
});

function lapWithGearShift(rpmSurplusPct: number): CoachSample[] {
  const samples: CoachSample[] = [];
  for (let distance = 0; distance <= 100; distance += 0.5) {
    const inCorner = distance >= 10 && distance < 20;
    // Speed VARIES across the lap (unlike a constant) -- buildGearModel's linear regression needs
    // more than one distinct speed value or it's degenerate (zero variance in x collapses the
    // denominator to 0, silently skipping the gear entirely; verified numerically before this plan
    // was finalized).
    const speedMs = 20 + distance * 0.1;
    const baseRpm = speedMs * 100; // consistent RPM-per-speed for gear 3 across every lap
    samples.push({ distance, gear: 3, speedMs, rpm: inCorner ? baseRpm * (1 + rpmSurplusPct / 100) : baseRpm });
  }
  return samples;
}

describe("computeCornerBaselines -- wheelspin rate", () => {
  it("reports how often this corner's exit shows an RPM surplus over this car's own gear model", () => {
    const laps = [lapWithGearShift(15), lapWithGearShift(0), lapWithGearShift(0), lapWithGearShift(0)];
    const [corner] = computeCornerBaselines(laps, CORNERS);
    expect(corner.wheelspinRatePct).not.toBeNull();
    expect(corner.wheelspinRatePct!).toBeCloseTo(25, 0); // 1 of 4 laps showed a surplus
  });
});
