import { describe, expect, it } from "vitest";
import { describeSelfSection, formatVariation, hitPhrase, rightAndWrong, strengthsAndImprovements, whereIn, type DebriefFacts } from "./debrief-talk";
import type { LapCorner } from "./corner-sequences";
import type { Lever, SelfSection } from "./self-consistency";

const FORBIDDEN = [/p\.p\./i, /Δ/, /--/, /coeficiente/i, /repetibilidade/i, /undefined/, /NaN/, /null/];
const c = (number: number, name: string | null = null): LapCorner => ({ number, distance: number * 5, name, startDistance: number * 5 - 1, endDistance: number * 5 + 1 });

function section(overrides: Partial<SelfSection> & { lever: Lever }): SelfSection {
  return {
    id: "s1", label: "Curva 1", isSequence: false, corners: [c(1)], windowStart: 0, windowEnd: 5, laps: 9, brakeZone: true,
    variation: { brake: { value: 1.2, tone: "ok" }, throttle: { value: 0.08, tone: "ok" }, steering: { value: 3, tone: "ok" } },
    diff: { fastLaps: 3, slowLaps: 3, brakeLaterMeters: 8, throttleEarlierSeconds: 0.3, minSpeedGainKmh: 1, steeringLessDeg: 0, liftDropShare: 0, microLess: 0 },
    gainIfRepeat: 0.12, hits: { hit: 3, of: 9 }, samples: [],
    ...overrides,
  };
}

function clean(texts: string[]) {
  for (const text of texts) for (const pattern of FORBIDDEN) expect(text, text).not.toMatch(pattern);
}

describe("describeSelfSection", () => {
  it("freada tardia: fala metros, ganho e acerto como no mockup", () => {
    const talk = describeSelfSection(section({ lever: "brake-later", corners: [c(3), c(4)], isSequence: true }), 0, true);
    expect(talk.fastLaps).toBe("Nas suas 3 voltas mais rápidas: freou 8 m mais tarde e acelerou 0,3 s mais cedo.");
    expect(talk.ifAlways).toContain("Se você repetir a freada tardia em toda volta, ganha cerca de 1,2 décimo.");
    expect(talk.ifAlways).toContain("1 a cada 3 voltas");
    clean([talk.fastLaps, talk.ifAlways]);
  });

  it("todas as alavancas geram texto limpo", () => {
    const levers: Lever[] = ["brake-later", "throttle-earlier", "carry-speed", "no-lift", "less-steering", "smoother", "stable", "none"];
    const texts = levers.flatMap((lever, index) => {
      const talk = describeSelfSection(section({ lever, diff: { fastLaps: 3, slowLaps: 3, brakeLaterMeters: 5, throttleEarlierSeconds: 0.2, minSpeedGainKmh: 4, steeringLessDeg: 7, liftDropShare: 0.5, microLess: 2 } }), index, true);
      return [talk.fastLaps, talk.ifAlways];
    });
    clean(texts);
  });

  it("trechos estáveis vizinhos não repetem a mesma frase", () => {
    const a = describeSelfSection(section({ lever: "stable" }), 0, true);
    const b = describeSelfSection(section({ lever: "stable" }), 1, true);
    expect(a.fastLaps).not.toBe(b.fastLaps);
    expect(a.ifAlways).not.toBe(b.ifAlways);
  });

  it("sem voltas suficientes diz isso em vez de inventar", () => {
    const talk = describeSelfSection(section({ lever: "none", diff: null, gainIfRepeat: null, hits: null }), 0, false);
    expect(talk.fastLaps).toContain("menos de 5 voltas");
    clean([talk.fastLaps, talk.ifAlways]);
  });
});

describe("whereIn / hitPhrase", () => {
  it("fala o lugar com a preposição certa", () => {
    expect(whereIn([c(5)])).toBe("na Curva 5");
    expect(whereIn([c(3), c(4)])).toBe("na sequência 3–4");
    expect(whereIn([c(1, "La Source")])).toBe("em La Source");
  });
  it("frações faladas", () => {
    expect(hitPhrase(3, 9)).toBe("em 1 a cada 3 voltas");
    expect(hitPhrase(9, 9)).toBe("em todas as voltas");
    expect(hitPhrase(2, 7)).toBe("em 2 de 7 voltas");
    expect(hitPhrase(9, 10)).toBe("em quase todas as voltas");
  });
});

describe("rightAndWrong", () => {
  it("monta os dois quadros a partir da variação e do acerto", () => {
    const sections = [
      section({ id: "a", lever: "stable", corners: [c(6), c(7)], isSequence: true, variation: { brake: { value: 0.9, tone: "ok" }, throttle: { value: 0.05, tone: "ok" }, steering: { value: 2, tone: "ok" } } }),
      section({ id: "b", lever: "stable", corners: [c(8)], variation: { brake: { value: 1.1, tone: "ok" }, throttle: { value: 0.3, tone: "bad" }, steering: { value: 4, tone: "ok" } } }),
      section({ id: "c", lever: "brake-later", corners: [c(3), c(4)], isSequence: true, variation: { brake: { value: 4.2, tone: "warn" }, throttle: { value: 0.2, tone: "warn" }, steering: { value: 5, tone: "ok" } } }),
    ];
    const { right, wrong } = rightAndWrong(sections);
    expect(right[0]).toBe("Freio muito constante na sequência 6–7 e na 8: você acerta o ponto quase sempre.");
    expect(wrong.some((text) => text.includes("Na Curva 8"))).toBe(true);
    expect(wrong.some((text) => text.startsWith("Na sequência 3–4 você só acerta a freada tardia em 1 a cada 3 voltas"))).toBe(true);
    clean([...right, ...wrong]);
  });
});

describe("strengthsAndImprovements", () => {
  const base: DebriefFacts = {
    gridPosition: 6, finishPosition: 3, incidents: 2, laps: 31, bestLap: 95.412, cleanAverage: 96.02, paceTrend: 0.05,
    microPerMinute: 41, referenceMicroPerMinute: 34, brakeRepeatShare: 0.84, worstSector: { label: "S2", spread: 0.21 },
    sections: [section({ lever: "brake-later", corners: [c(3), c(4)], isSequence: true })],
  };
  it("gera no máximo 3 de cada, sem termos proibidos", () => {
    const { strengths, improvements } = strengthsAndImprovements(base);
    expect(strengths.length).toBeGreaterThan(0);
    expect(strengths.length).toBeLessThanOrEqual(3);
    expect(improvements.length).toBeLessThanOrEqual(3);
    expect(strengths[0]).toBe("Você ganhou 3 posições: largou em P6 e terminou em P3.");
    clean([...strengths, ...improvements]);
  });
  it("sempre devolve algo, mesmo sem dados", () => {
    const empty: DebriefFacts = { gridPosition: null, finishPosition: null, incidents: null, laps: null, bestLap: null, cleanAverage: null, paceTrend: null, microPerMinute: null, referenceMicroPerMinute: null, brakeRepeatShare: null, worstSector: null, sections: [] };
    const { strengths, improvements } = strengthsAndImprovements(empty);
    expect(strengths).toHaveLength(1);
    expect(improvements).toHaveLength(1);
    clean([...strengths, ...improvements]);
  });
  it("posições perdidas e muitos incidentes viram melhoria", () => {
    const { improvements } = strengthsAndImprovements({ ...base, gridPosition: 3, finishPosition: 9, incidents: 12, laps: 20 });
    expect(improvements[0]).toContain("Você perdeu 6 posições");
    expect(improvements[1]).toContain("12 incidentes em 20 voltas");
  });
});

describe("formatVariation", () => {
  it("formata como no mockup", () => {
    expect(formatVariation("brake", 4.21)).toBe("±4,2 m");
    expect(formatVariation("throttle", 0.214)).toBe("±0,21 s");
    expect(formatVariation("steering", 5.4)).toBe("±5°");
  });
});
