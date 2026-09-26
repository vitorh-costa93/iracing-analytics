import { describe, expect, it } from "vitest";
import { analyzeSelfConsistency, buildGrid, MIN_LAPS_FOR_VARIATION, pickLever, type LapInput } from "./self-consistency";
import type { LapCorner } from "./corner-sequences";
import type { Trace, TracePoint } from "./telemetry-trace";

const TRACK_M = 4000;
const corner = (number: number, distance: number): LapCorner => ({ number, distance, name: null, startDistance: distance - 1.5, endDistance: distance + 1.5 });

function point(distance: number, speed: number, brake: number, throttle: number, steeringDeg: number): TracePoint {
  return {
    distance, speed, brake, throttle, steering: (steeringDeg * Math.PI) / 180,
    rpm: null, gear: 4, clutch: null, latAccel: null, longAccel: null, yaw: null, yawRate: null, abs: null, drs: null,
    pushToPass: null, p2pStatus: null, p2pCount: null, lat: null, lon: null,
  };
}

/** Uma volta com uma curva em 50%: freia em `brakeAt`%, mínimo de 25 m/s no ápice, acelera em `throttleAt`%. */
function makeLap(brakeAt: number, throttleAt: number, lift = false, steeringPeak = 60): { trace: Trace; lapTime: number } {
  const points: TracePoint[] = [];
  let seconds = 0;
  let previous: TracePoint | null = null;
  for (let d = 0; d <= 100.0001; d += 0.05) {
    let speed = 60;
    if (d >= brakeAt && d < 50) speed = 60 - (35 * (d - brakeAt)) / (50 - brakeAt);
    else if (d >= 50 && d < 54) speed = 25 + (35 * (d - 50)) / 4;
    if (d >= 50 && d < throttleAt) speed = 25;
    const brake = d >= brakeAt && d < 50 ? 0.8 : 0;
    let throttle = d >= brakeAt && d < throttleAt ? 0 : 1;
    if (lift && d >= throttleAt + 0.4 && d < throttleAt + 0.8) throttle = 0.2;
    const steer = d > 48.5 && d < 51.5 ? steeringPeak * Math.sin(((d - 48.5) / 3) * Math.PI) : 0;
    const current = point(Number(d.toFixed(3)), speed, brake, throttle, steer);
    if (previous) seconds += ((current.distance - previous.distance) / 100) * TRACK_M / ((current.speed! + previous.speed!) / 2);
    points.push(current);
    previous = current;
  }
  return { trace: { points, channels: [], trackLengthMeters: TRACK_M }, lapTime: seconds };
}

function lapsFrom(params: { brakeAt: number; throttleAt: number; lift?: boolean }[]): LapInput[] {
  return params.map((param, index) => {
    const { trace, lapTime } = makeLap(param.brakeAt, param.throttleAt, param.lift);
    return { lapNumber: index + 2, lapTime, trace, microDistances: [] };
  });
}

describe("analyzeSelfConsistency", () => {
  it("devolve null com menos voltas que o mínimo", () => {
    const laps = lapsFrom([{ brakeAt: 47, throttleAt: 50.5 }, { brakeAt: 47, throttleAt: 50.5 }]);
    expect(MIN_LAPS_FOR_VARIATION).toBe(3);
    expect(analyzeSelfConsistency(laps, [corner(1, 50)])).toBeNull();
  });

  it("acha a freada mais tardia das voltas rápidas e o ganho de repetir", () => {
    // 9 voltas: 3 freiam em 47,3% (tarde), 6 freiam em 47,0% (12 m antes)
    const laps = lapsFrom([
      { brakeAt: 47.3, throttleAt: 50.5 }, { brakeAt: 47.0, throttleAt: 50.5 }, { brakeAt: 47.0, throttleAt: 50.5 },
      { brakeAt: 47.3, throttleAt: 50.5 }, { brakeAt: 47.0, throttleAt: 50.5 }, { brakeAt: 47.0, throttleAt: 50.5 },
      { brakeAt: 47.3, throttleAt: 50.5 }, { brakeAt: 47.0, throttleAt: 50.5 }, { brakeAt: 47.0, throttleAt: 50.5 },
    ]);
    const result = analyzeSelfConsistency(laps, [corner(1, 50)])!;
    expect(result.canCompareFastSlow).toBe(true);
    expect(result.sections).toHaveLength(1);
    const section = result.sections[0];
    expect(section.brakeZone).toBe(true);
    expect(section.diff!.brakeLaterMeters!).toBeGreaterThan(10);
    expect(section.diff!.brakeLaterMeters!).toBeLessThan(14);
    expect(section.lever).toBe("brake-later");
    expect(section.gainIfRepeat!).toBeGreaterThan(0);
    expect(section.hits).toEqual({ hit: 3, of: 9 });
    expect(section.variation.brake!.value).toBeGreaterThan(4);
  });

  it("marca como estável quando todas as voltas são iguais", () => {
    const laps = lapsFrom(Array.from({ length: 6 }, () => ({ brakeAt: 47.2, throttleAt: 50.6 })));
    const section = analyzeSelfConsistency(laps, [corner(1, 50)])!.sections[0];
    expect(section.variation.brake!.value).toBeCloseTo(0, 5);
    expect(section.variation.brake!.tone).toBe("ok");
    expect(section.lever).toBe("stable");
  });

  it("detecta a tirada de pé no meio da curva nas voltas lentas", () => {
    const laps = lapsFrom([
      { brakeAt: 47.2, throttleAt: 50.6 }, { brakeAt: 47.2, throttleAt: 50.6 },
      { brakeAt: 47.2, throttleAt: 50.6, lift: true }, { brakeAt: 47.2, throttleAt: 50.6, lift: true },
      { brakeAt: 47.2, throttleAt: 50.6 }, { brakeAt: 47.2, throttleAt: 50.6, lift: true },
    ]);
    const section = analyzeSelfConsistency(laps, [corner(1, 50)])!.sections[0];
    expect(section.samples.filter((sample) => sample.lifted)).toHaveLength(3);
  });

  it("com 3 ou 4 voltas mede variação mas não separa rápidas e lentas", () => {
    const laps = lapsFrom([{ brakeAt: 47.3, throttleAt: 50.5 }, { brakeAt: 47.0, throttleAt: 50.5 }, { brakeAt: 47.1, throttleAt: 50.5 }]);
    const result = analyzeSelfConsistency(laps, [corner(1, 50)])!;
    expect(result.canCompareFastSlow).toBe(false);
    expect(result.sections[0].diff).toBeNull();
    expect(result.sections[0].variation.brake).not.toBeNull();
  });
});

describe("buildGrid", () => {
  it("interpola os canais numa grade fixa", () => {
    const grid = buildGrid([point(0, 10, 0, 1, 0), point(100, 30, 1, 0, 0)]);
    expect(grid.speed[500]).toBeCloseTo(20, 5);
    expect(grid.brake[1000]).toBeCloseTo(1, 5);
  });
});

describe("pickLever", () => {
  const ok = { value: 1, tone: "ok" as const };
  const tones = { brake: ok, throttle: ok, steering: ok };
  it("sem diferença clara e sem variação é estável", () => {
    expect(pickLever(null, tones, null)).toBe("stable");
  });
  it("prefere a maior diferença relativa", () => {
    const diff = { fastLaps: 3, slowLaps: 3, brakeLaterMeters: 4, throttleEarlierSeconds: 0.3, minSpeedGainKmh: 1, steeringLessDeg: 0, liftDropShare: 0, microLess: 0 };
    expect(pickLever(diff, tones, 0.1)).toBe("throttle-earlier");
  });
});
