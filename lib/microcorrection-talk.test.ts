import { describe, expect, it } from "vitest";
import { microLapSummary, microSectionChip, microTone, worstMicroSection } from "./microcorrection-talk";

const result = (distances: number[], lapSeconds = 90) => ({ count: distances.length, perMinute: distances.length / (lapSeconds / 60), distances });
const sections = [
  { label: "Curva 1", windowStart: 8, windowEnd: 14 },
  { label: "Curvas 2–3", windowStart: 40, windowEnd: 52 },
];

describe("microTone (mesmos limites do Race Debrief: 90% e 115%)", () => {
  it("classifica menos, parecido e mais", () => {
    expect(microTone(27, 30)).toBe("gain");
    expect(microTone(28, 30)).toBe("neutral");
    expect(microTone(34, 30)).toBe("neutral");
    expect(microTone(35, 30)).toBe("loss");
    expect(microTone(0, 0)).toBe("neutral");
  });
});

describe("worstMicroSection", () => {
  it("aponta o trecho com mais correções a mais, só a partir de 2", () => {
    expect(worstMicroSection(sections, [10, 11, 12, 45], [10, 45])).toEqual({ label: "Curva 1", own: 3, reference: 1 });
    expect(worstMicroSection(sections, [10, 45], [10])).toBeNull();
  });
});

describe("microLapSummary", () => {
  it("fala em mais correção que a referência, com números e o pior trecho", () => {
    const own = result([10, 11, 12, 13, 45, 46, 70, 71, 72, 73, 80, 81]);
    const ref = result([10, 45, 70, 71, 80, 90, 91, 92, 93]);
    const summary = microLapSummary(own, ref, sections);
    expect(summary?.tone).toBe("loss");
    expect(summary?.text).toBe("Microcorreções: você corrigiu o volante mais que a referência nesta volta, 12 contra 9 da referência (8 e 6 por minuto). Sinal de estar segurando o carro em vez de conduzir limpo. Onde mais aparece: Curva 1, 4 contra 1.");
  });

  it("menos correção é ponto forte; sem nenhuma correção nos dois lados não diz nada", () => {
    expect(microLapSummary(result([1, 2]), result([1, 2, 3, 4, 5]), sections)?.tone).toBe("gain");
    expect(microLapSummary(result([]), result([]), sections)).toBeNull();
  });

  it("não usa Δ nem abreviações", () => {
    const summary = microLapSummary(result([1, 2, 3]), result([1, 2, 3]), sections);
    expect(summary?.text).toBe("Microcorreções: parecido com a referência nesta volta, 3 contra 3 da referência (2 e 2 por minuto).");
    expect(summary?.text).not.toMatch(/Δ|p\.p\.|--/);
  });
});

describe("microSectionChip", () => {
  it("conta dentro da janela do trecho", () => {
    expect(microSectionChip([10, 11, 12], [10], sections[0])).toEqual({ k: "Microcorreções no trecho", v: "você 3 · referência 1", tone: "loss" });
    expect(microSectionChip([45], [44, 45, 46], sections[1], "Cadillac")).toEqual({ k: "Microcorreções no trecho", v: "você 1 · Cadillac 3", tone: "gain" });
  });
});
