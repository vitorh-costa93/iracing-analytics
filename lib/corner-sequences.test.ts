import { describe, expect, it } from "vitest";
import { buildLapSections, groupCornerSequences, sectionLabel, sequenceGapPct, unwrapIntoWindow, SEQUENCE_GAP_METERS, type LapCorner } from "./corner-sequences";
import { ABSOLUTE_MERGE_GAP_METERS } from "./corner-detection";

const corner = (number: number, startDistance: number, endDistance: number, name: string | null = null): LapCorner => ({
  number, name, startDistance, endDistance, distance: (startDistance + endDistance) / 2,
});

describe("sequenceGapPct", () => {
  it("fica acima do intervalo de fusão da detecção", () => {
    expect(SEQUENCE_GAP_METERS).toBeGreaterThan(ABSOLUTE_MERGE_GAP_METERS);
  });
  it("converte metros em % da volta e limita em pista curta", () => {
    expect(sequenceGapPct(6000)).toBeCloseTo(2, 5); // 120 m em 6 km
    expect(sequenceGapPct(3000)).toBe(2.5); // 4% seria demais
    expect(sequenceGapPct(null)).toBe(1.5);
  });
});

describe("groupCornerSequences", () => {
  it("junta curvas coladas e mantém isoladas as separadas por reta", () => {
    // 5 km: 120 m = 2,4% da volta
    const sequences = groupCornerSequences([corner(1, 5, 8), corner(2, 20, 23), corner(3, 24, 27), corner(4, 50, 53)], 5000);
    expect(sequences.map((sequence) => sequence.corners.map((item) => item.number))).toEqual([[1], [2, 3], [4]]);
    expect(sequences[1].start).toBe(20);
    expect(sequences[1].end).toBe(27);
  });

  it("encadeia uma sequência de várias curvas (esses)", () => {
    const sequences = groupCornerSequences([corner(3, 10, 12), corner(4, 13, 15), corner(5, 16, 18), corner(6, 19, 21)], 5800);
    expect(sequences).toHaveLength(1);
    expect(sequences[0].corners.map((item) => item.number)).toEqual([3, 4, 5, 6]);
  });

  it("junta a última e a primeira curva através da linha de chegada", () => {
    const sequences = groupCornerSequences([corner(1, 0.5, 3), corner(2, 40, 44), corner(3, 95, 99.2)], 4000);
    expect(sequences).toHaveLength(2);
    expect(sequences[0].corners.map((item) => item.number)).toEqual([3, 1]);
    expect(sequences[0].start).toBeCloseTo(-5, 5);
    expect(sequences[0].end).toBe(3);
  });

  it("aceita uma curva que já cruza a chegada (início > fim)", () => {
    const sequences = groupCornerSequences([corner(1, 99, 1.5), corner(2, 30, 34)], 4000);
    expect(sequences[0].start).toBe(-1);
    expect(sequences[0].end).toBe(1.5);
  });
});

describe("buildLapSections", () => {
  const sections = buildLapSections([corner(1, 10, 13), corner(2, 30, 32), corner(3, 32.5, 35), corner(4, 70, 74)], 5000);

  it("inclui a zona de frenagem antes da entrada e não sobrepõe janelas", () => {
    expect(sections).toHaveLength(3);
    expect(sections[0].windowStart).toBeCloseTo(10 - 3, 5); // 150 m = 3%
    for (let i = 1; i < sections.length; i += 1) expect(sections[i].windowStart).toBeGreaterThanOrEqual(sections[i - 1].windowEnd);
  });

  it("divide a sequência em partes contíguas, uma por curva", () => {
    const sequence = sections[1];
    expect(sequence.parts).toHaveLength(2);
    expect(sequence.parts[0].start).toBe(sequence.windowStart);
    expect(sequence.parts[0].end).toBe(sequence.parts[1].start);
    expect(sequence.parts[0].end).toBeCloseTo(32.25, 5);
    expect(sequence.parts[1].end).toBe(sequence.windowEnd);
  });

  it("mantém as partes em ordem quando a sequência cruza a chegada", () => {
    const wrapped = buildLapSections([corner(1, 1, 3), corner(2, 50, 53), corner(3, 96, 99.5)], 4000)[0];
    expect(wrapped.corners.map((item) => item.number)).toEqual([3, 1]);
    expect(wrapped.parts[0].end).toBeLessThan(wrapped.parts[1].end);
    expect(wrapped.parts[0].start).toBeLessThan(0);
  });
});

describe("unwrapIntoWindow", () => {
  it("encontra amostras de uma janela que cruza a chegada", () => {
    expect(unwrapIntoWindow(98, -3, 2)).toBe(-2);
    expect(unwrapIntoWindow(1, -3, 2)).toBe(1);
    expect(unwrapIntoWindow(50, -3, 2)).toBeNull();
  });
});

describe("sectionLabel", () => {
  it("usa números sem inventar nomes", () => {
    expect(sectionLabel([corner(5, 1, 2)])).toBe("Curva 5");
    expect(sectionLabel([corner(3, 1, 2), corner(4, 2, 3)])).toBe("Curvas 3–4");
    expect(sectionLabel([corner(15, 1, 2), corner(1, 2, 3)])).toBe("Curvas 15 e 1");
  });
  it("usa nomes verificados só quando todas têm nome", () => {
    expect(sectionLabel([corner(2, 1, 2, "Eau Rouge"), corner(3, 2, 3, "Raidillon")])).toBe("Eau Rouge–Raidillon");
    expect(sectionLabel([corner(2, 1, 2, "Eau Rouge"), corner(3, 2, 3, null)])).toBe("Curvas 2–3");
    expect(sectionLabel([corner(1, 1, 2, "La Source")])).toBe("La Source");
  });
});
