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
    const inCorner = distance >= 10 && distance < 20;
    samples.push({ distance, steeringRad: inCorner ? (cornerWiggleDeg * Math.PI) / 180 : 0 });
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
