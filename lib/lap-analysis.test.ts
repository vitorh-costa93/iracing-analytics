import { describe, expect, it } from "vitest";
import { compareLaps, lateralOffsetMeters, lostAt, lostInSectionAt } from "./lap-analysis";
import type { LapCorner } from "./corner-sequences";
import type { Trace, TracePoint } from "./telemetry-trace";

const LENGTH = 5000;

type CornerShape = { at: number; depth: number; brakeAt: number; throttleAt: number };

/** Volta sintética: velocidade base 60 m/s, cada curva afunda a velocidade perto de `at`, freio de
 * `brakeAt` até `at`, acelerador fora de `brakeAt` até `throttleAt`. */
function makeTrace(shapes: CornerShape[]): Trace {
  const points: TracePoint[] = [];
  for (let i = 0; i <= 1000; i += 1) {
    const distance = i / 10;
    let speed = 60;
    let brake = 0;
    let throttle = 1;
    for (const shape of shapes) {
      speed -= shape.depth * Math.exp(-(((distance - shape.at) / 1.2) ** 2));
      if (distance >= shape.brakeAt && distance < shape.at) brake = 0.9;
      if (distance >= shape.brakeAt && distance < shape.throttleAt) throttle = 0;
    }
    points.push({
      distance, speed, brake, throttle, steering: 0, rpm: 7000, gear: speed < 40 ? 3 : 5, clutch: 0,
      latAccel: null, longAccel: null, yaw: null, yawRate: null, abs: null, drs: null, pushToPass: null, p2pStatus: null, p2pCount: null, lat: null, lon: null,
    });
  }
  return { points, channels: [], trackLengthMeters: LENGTH };
}

const corners: LapCorner[] = [
  { number: 1, name: null, startDistance: 19, endDistance: 22, distance: 20.5 },
  { number: 2, name: null, startDistance: 49, endDistance: 51.5, distance: 50 },
  { number: 3, name: null, startDistance: 51.8, endDistance: 54, distance: 53 },
];

const refShapes: CornerShape[] = [
  { at: 20.5, depth: 25, brakeAt: 18, throttleAt: 21.5 },
  { at: 50, depth: 20, brakeAt: 47.5, throttleAt: 50.5 },
  { at: 53, depth: 15, brakeAt: 51.2, throttleAt: 53.5 },
];

describe("compareLaps", () => {
  it("volta igual à referência: nenhum trecho perde tempo", () => {
    const trace = makeTrace(refShapes);
    const result = compareLaps(trace, makeTrace(refShapes), 90, corners)!;
    expect(result.estimatedGap).toBeCloseTo(0, 6);
    expect(result.sections).toHaveLength(2);
    for (const section of result.sections) expect(Math.abs(section.lostSeconds)).toBeLessThan(1e-9);
  });

  it("atribui a perda ao trecho certo e fecha a conta com as retas", () => {
    const own = makeTrace([{ at: 20.5, depth: 32, brakeAt: 17, throttleAt: 22.5 }, refShapes[1], refShapes[2]]);
    const result = compareLaps(own, makeTrace(refShapes), 91, corners)!;
    const [first, sequence] = result.sections;
    expect(first.lostSeconds).toBeGreaterThan(0.05);
    expect(Math.abs(sequence.lostSeconds)).toBeLessThan(0.01);
    const sum = result.sections.reduce((total, section) => total + section.lostSeconds, 0) + result.straightsLostSeconds;
    expect(sum).toBeCloseTo(result.estimatedGap, 9);
    expect(lostAt(result.grid, 100)).toBeCloseTo(result.estimatedGap, 6);
    expect(lostInSectionAt(first.lostSeries, first.windowEnd + 5)).toBeCloseTo(first.lostSeconds, 9);
  });

  it("mede ponto de freio, velocidade mínima e volta ao acelerador em unidades de pilotagem", () => {
    const own = makeTrace([{ at: 20.5, depth: 32, brakeAt: 17, throttleAt: 22.5 }, refShapes[1], refShapes[2]]);
    const metrics = compareLaps(own, makeTrace(refShapes), 91, corners)!.sections[0].metrics;
    expect(metrics.brakeUse).toBe("both");
    expect(metrics.brakeDeltaMeters).toBeCloseTo(-50, 0); // 1% de 5 km mais cedo
    expect(metrics.minSpeedDeltaKmh).toBeCloseTo(-7 * 3.6, 0);
    expect(metrics.throttleOnDelaySeconds).toBeGreaterThan(0.5);
  });

  it("sequência: partes somam o total e mostram quem paga e quem ganha", () => {
    // entra mais devagar na 2, sai mais rápido da 3
    const own = makeTrace([refShapes[0], { at: 50, depth: 24, brakeAt: 47.2, throttleAt: 50.5 }, { at: 53, depth: 8, brakeAt: 52.2, throttleAt: 53.2 }]);
    const sequence = compareLaps(own, makeTrace(refShapes), 90, corners)!.sections[1];
    expect(sequence.isSequence).toBe(true);
    expect(sequence.label).toBe("Curvas 2–3");
    const partSum = sequence.parts.reduce((total, part) => total + part.lostSeconds, 0);
    expect(partSum).toBeCloseTo(sequence.lostSeconds, 9);
    expect(sequence.parts[0].lostSeconds).toBeGreaterThan(0);
    expect(sequence.parts[1].lostSeconds).toBeLessThan(0);
  });

  it("curvas coladas com reta de acelerador cheio para os dois viram trechos separados", () => {
    const flat: CornerShape[] = [refShapes[0], refShapes[1], { at: 53, depth: 15, brakeAt: 52.2, throttleAt: 53.5 }];
    const result = compareLaps(makeTrace(flat), makeTrace(flat), 90, corners)!;
    expect(result.sections.map((section) => section.label)).toEqual(["Curva 1", "Curva 2", "Curva 3"]);
  });

  it("devolve null quando as voltas não se alinham", () => {
    const empty: Trace = { points: [], channels: [], trackLengthMeters: null };
    expect(compareLaps(empty, empty, 90, corners)).toBeNull();
  });
});

describe("lateralOffsetMeters", () => {
  it("positivo quando a referência está à esquerda do seu sentido de marcha", () => {
    const own = { lat: 0, lon: 0 }, prev = { lat: -0.0001, lon: 0 }, next = { lat: 0.0001, lon: 0 };
    // indo para o norte: leste = direita, oeste = esquerda
    expect(lateralOffsetMeters(own, prev, next, { lat: 0, lon: -0.00002 })!).toBeGreaterThan(2);
    expect(lateralOffsetMeters(own, prev, next, { lat: 0, lon: 0.00002 })!).toBeLessThan(-2);
  });
});
