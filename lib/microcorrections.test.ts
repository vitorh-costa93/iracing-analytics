import { describe, expect, it } from "vitest";
import { countInWindow, detectMicrocorrections, resampleByTime, summarizeMicrocorrections, type SteeringSample } from "./microcorrections";

const DEG = Math.PI / 180;

/** Volta sintética de `seconds` a velocidade constante, `hz` amostras por segundo, volante dado por
 * uma função do tempo (em graus). */
function lap(seconds: number, hz: number, steeringDeg: (t: number) => number, speed = 40): SteeringSample[] {
  const n = Math.round(seconds * hz);
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / hz;
    return { distance: (t / seconds) * 100, speed, steering: steeringDeg(t) * DEG };
  });
}

describe("detectMicrocorrections", () => {
  it("não conta nada numa volta com volante parado", () => {
    expect(detectMicrocorrections(lap(60, 60, () => 0), 60).count).toBe(0);
  });

  it("ignora tremida pequena de force feedback (abaixo da histerese)", () => {
    const result = detectMicrocorrections(lap(60, 60, (t) => 1.5 * Math.sin(2 * Math.PI * 4 * t)), 60);
    expect(result.count).toBe(0);
  });

  it("não conta uma entrada e saída de curva longa e contínua", () => {
    // 10 curvas de 4 s: gira 60° em 2 s e desfaz em 2 s
    const result = detectMicrocorrections(lap(40, 60, (t) => 60 * Math.abs(Math.sin((Math.PI * t) / 4))), 40);
    expect(result.count).toBe(0);
  });

  it("conta correções rápidas de ±6° (1,5 Hz)", () => {
    // 20 s com oscilação de 1,5 Hz: 2 viradas por ciclo, cada meia-onda dura 0,33 s
    const result = detectMicrocorrections(lap(20, 60, (t) => 6 * Math.sin(2 * Math.PI * 1.5 * t)), 20);
    expect(result.count).toBeGreaterThanOrEqual(56);
    expect(result.count).toBeLessThanOrEqual(60);
    expect(result.perMinute).toBeCloseTo(result.count * 3, 5);
    expect(result.distances.every((d) => d >= 0 && d <= 100)).toBe(true);
  });

  it("dá praticamente o mesmo número a 60 Hz e a 20 Hz (independe da fonte)", () => {
    const wave = (t: number) => 30 * Math.sin(t / 3) + 5 * Math.sin(2 * Math.PI * 1.2 * t);
    const high = detectMicrocorrections(lap(60, 60, wave), 60).count;
    const low = detectMicrocorrections(lap(60, 20, wave), 60).count;
    expect(Math.abs(high - low)).toBeLessThanOrEqual(Math.max(2, high * 0.1));
  });

  it("não conta abaixo da velocidade mínima (box, largada, rodada)", () => {
    const result = detectMicrocorrections(lap(20, 60, (t) => 6 * Math.sin(2 * Math.PI * 1.5 * t), 10), 20);
    expect(result.count).toBe(0);
  });

  it("devolve zero sem tempo de volta ou com poucas amostras", () => {
    expect(detectMicrocorrections(lap(20, 60, (t) => 6 * Math.sin(t * 9)), 0).count).toBe(0);
    expect(detectMicrocorrections(lap(20, 60, (t) => 6 * Math.sin(t * 9)).slice(0, 5), 20).count).toBe(0);
  });
});

describe("resampleByTime", () => {
  it("usa o tempo da volta para escalar a grade", () => {
    const grid = resampleByTime(lap(30, 60, () => 0), 30, 10);
    expect(grid.length).toBeGreaterThanOrEqual(300);
    expect(grid[grid.length - 1].t).toBeLessThanOrEqual(30);
  });
});

describe("countInWindow", () => {
  it("conta dentro da janela, inclusive cruzando a linha de chegada", () => {
    expect(countInWindow([1, 5, 50, 98.5, 99.9], -2, 2)).toBe(3);
    expect(countInWindow([1, 5, 50], 4, 60)).toBe(2);
  });
});

describe("summarizeMicrocorrections", () => {
  it("pondera pelo tempo de volta", () => {
    const summary = summarizeMicrocorrections([
      { result: { count: 30, perMinute: 30, distances: [] }, lapTimeSeconds: 60 },
      { result: { count: 60, perMinute: 30, distances: [] }, lapTimeSeconds: 120 },
    ]);
    expect(summary).toEqual({ laps: 2, perLap: 45, perMinute: 30 });
    expect(summarizeMicrocorrections([])).toBeNull();
  });
});
