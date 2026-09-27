import { describe, expect, it } from "vitest";
import { bestPassOf, buildBestPasses, passPoints, topGainSections } from "./debrief-best-pass";
import type { LapSectionSample, SelfSection } from "./self-consistency";
import type { Trace, TracePoint } from "./telemetry-trace";

const sample = (lapNumber: number | null, seconds: number): LapSectionSample => ({ lapNumber, seconds, brakeOnset: null, minSpeedKmh: null, throttleOnSeconds: null, steeringPeakDeg: null, lifted: false, micro: 0 });

const blank = { speed: 50, throttle: 1, brake: 0, steering: 0, rpm: null, gear: null, clutch: null, latAccel: null, longAccel: null, yaw: null, yawRate: null, abs: null, drs: null, pushToPass: null, p2pStatus: null, p2pCount: null };
function trace(offset = 0): Trace {
  const points: TracePoint[] = [];
  for (let i = 0; i < 1000; i += 1) points.push({ ...blank, distance: i / 10, lat: -23 + i / 1e5 + offset, lon: -46 + i / 1e5 });
  return { points, channels: [], trackLengthMeters: 4000 };
}

function section(id: string, gainIfRepeat: number | null, samples: LapSectionSample[], windowStart = 10, windowEnd = 18): SelfSection {
  return { id, label: id, isSequence: false, corners: [], windowStart, windowEnd, laps: samples.length, brakeZone: true, variation: { brake: null, throttle: null, steering: null }, diff: null, gainIfRepeat, hits: null, lever: "none", samples };
}

describe("bestPassOf (idealLine de 94c4d8d)", () => {
  it("melhor passagem do trecho e ganho contra a média das passagens", () => {
    const best = bestPassOf([sample(4, 10.3), sample(5, 10.1), sample(6, 10.5), sample(7, 10.3)]);
    expect(best?.sample.lapNumber).toBe(5);
    expect(best?.gainVsAverage).toBeCloseTo(0.2, 9);
  });

  it("pede pelo menos 3 passagens, como antes", () => {
    expect(bestPassOf([sample(4, 10.3), sample(5, 10.1)])).toBeNull();
  });
});

describe("topGainSections", () => {
  it("os 3 trechos com mais ganho, ignorando os sem ganho", () => {
    const sections = [section("a", 0.05, []), section("b", 0.2, []), section("c", null, []), section("d", 0.12, []), section("e", 0.01, []), section("f", 0, [])];
    expect(topGainSections(sections).map((item) => item.id)).toEqual(["b", "d", "a"]);
  });
});

describe("passPoints / buildBestPasses", () => {
  it("recorta só a janela do trecho e limita o número de pontos", () => {
    const points = passPoints(trace(), 10, 18, 40);
    expect(points.length).toBeLessThanOrEqual(40);
    expect(points[0].d).toBeGreaterThanOrEqual(10);
    expect(points[points.length - 1].d).toBeLessThanOrEqual(18);
  });

  it("janela que cruza a linha de chegada fica desenrolada", () => {
    const points = passPoints(trace(), -3, 4);
    expect(points[0].d).toBeLessThan(0);
    expect(points[points.length - 1].d).toBeGreaterThan(3);
  });

  it("usa a volta da melhor passagem, não a mais rápida da corrida", () => {
    const sections = [section("s1", 0.15, [sample(3, 9.9), sample(4, 9.7), sample(5, 10.0)])];
    const passes = buildBestPasses(sections, [{ lapNumber: 3, trace: trace(1) }, { lapNumber: 4, trace: trace(2) }, { lapNumber: 5, trace: trace(3) }]);
    expect(passes).toHaveLength(1);
    expect(passes[0]).toMatchObject({ sectionId: "s1", lapNumber: 4, seconds: 9.7, passes: 3 });
    expect(passes[0].gainVsAverage).toBeCloseTo(0.167, 3);
    expect(passes[0].points[0].lat).toBeCloseTo(-21, 1); // traço da volta 4 (offset 2)
  });
});
