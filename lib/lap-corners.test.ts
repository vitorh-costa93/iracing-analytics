import { describe, expect, it } from "vitest";
import { speedAnchors, splitLongCorners, LONG_CORNER_METERS } from "./lap-corners";

const LAP = 4000; // metros
// velocidade (m/s) em função da distância (% da volta): dois vales de 40 m/s para 25 m/s
const speedAt = (pct: number) => {
  const dip = (center: number, depth: number) => depth * Math.exp(-Math.pow((pct - center) / 1.2, 2));
  return 60 - dip(21, 35) - dip(35, 30);
};
const points = Array.from({ length: 400 }, (_, i) => ({ distance: i * 0.25, speed: speedAt(i * 0.25) }));

describe("speedAnchors", () => {
  it("acha um ponto por vale de velocidade, com separação mínima", () => {
    const anchors = speedAnchors(points, LAP);
    expect(anchors).toHaveLength(2);
    expect(anchors[0]).toBeCloseTo(21, 0);
    expect(anchors[1]).toBeCloseTo(35, 0);
  });
  it("ignora oscilação pequena de velocidade", () => {
    const flat = points.map((point) => ({ distance: point.distance, speed: 55 + Math.sin(point.distance) }));
    expect(speedAnchors(flat, LAP)).toEqual([]);
  });
});

describe("splitLongCorners", () => {
  const corner = (start: number, end: number) => ({ startDistance: start, endDistance: end, distance: (start + end) / 2 });
  const make = (source: ReturnType<typeof corner>, piece: { start: number; end: number; peak: number }) => ({ startDistance: piece.start, endDistance: piece.end, distance: piece.peak });

  it("divide uma 'curva' de 800 m que contém dois vales de velocidade", () => {
    const long = corner(16, 36); // 20% de 4 km = 800 m
    const result = splitLongCorners([long], [21, 35], LAP, make);
    expect(result).toHaveLength(2);
    expect(result[0].distance).toBeCloseTo(21, 5);
    expect(result[1].distance).toBeCloseTo(35, 5);
    expect(result[0].endDistance).toBeCloseTo(28, 5); // fronteira no meio dos dois vales
    expect(result[1].startDistance).toBeCloseTo(28, 5);
  });
  it("não mexe em curvas normais nem em curvas longas com um vale só", () => {
    expect(splitLongCorners([corner(10, 12)], [11], LAP, make)).toHaveLength(1);
    expect(splitLongCorners([corner(16, 36)], [21], LAP, make)).toHaveLength(1);
  });
  it("respeita o limite de comprimento", () => {
    const shortEnough = corner(20, 20 + (LONG_CORNER_METERS / LAP) * 100 - 0.1);
    expect(splitLongCorners([shortEnough], [20.5, 22], LAP, make)).toHaveLength(1);
  });
  it("trata uma curva que cruza a linha de chegada", () => {
    const wraps = corner(95, 20); // 25% da volta atravessando o 0
    const result = splitLongCorners([wraps], [98, 15], LAP, make);
    expect(result).toHaveLength(2);
    expect(result[0].distance).toBeCloseTo(98, 5);
    expect(result[1].distance).toBeCloseTo(15, 5);
  });
});
