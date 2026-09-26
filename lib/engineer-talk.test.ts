import { describe, expect, it } from "vitest";
import { describeSection, formatSignedSeconds, talkDuration, talkTime } from "./engineer-talk";
import type { SectionMetrics, SectionResult } from "./lap-analysis";
import type { LapCorner } from "./corner-sequences";

const c = (number: number, name: string | null = null): LapCorner => ({ number, name, startDistance: number, endDistance: number + 1, distance: number + 0.5 });

const emptyMetrics: SectionMetrics = {
  brakeDeltaMeters: null, brakeUse: "none", minSpeedDeltaKmh: null, apexCorner: null, throttleOnDelaySeconds: null,
  exitSpeedDeltaKmh: null, throttleAvgDeltaPct: null, brakePeakDeltaPct: null, steeringDeltaDeg: null, gearAtApex: null,
  lineOffsetMeters: null, lineSide: null,
};

function section(partial: Partial<SectionResult> & { lostSeconds: number }): SectionResult {
  const corners = partial.corners ?? [c(5)];
  return {
    id: "s1", label: "Curva 5", isSequence: corners.length > 1, corners, start: 10, end: 12, windowStart: 8, windowEnd: 13,
    parts: corners.map((corner) => ({ corner, label: `Curva ${corner.number}`, start: 8, end: 13, lostSeconds: partial.lostSeconds / corners.length })),
    metrics: emptyMetrics, lostSeries: [], ...partial,
  };
}

const FORBIDDEN = [/p\.p\./, /pontos percentuais/i, /Δ/, /--/, /Também reparei/i, /Ganho relevante aqui/i, /NaN/, /undefined/, /null/];

function expectClean(text: string) {
  for (const pattern of FORBIDDEN) expect(text).not.toMatch(pattern);
}

describe("formatação", () => {
  it("usa vírgula decimal e sinal de menos tipográfico", () => {
    expect(formatSignedSeconds(-0.172)).toBe("−0,172 s");
    expect(formatSignedSeconds(0.093)).toBe("+0,093 s");
    expect(formatSignedSeconds(0)).toBe("0,000 s");
  });
  it("fala o tempo como um engenheiro", () => {
    expect(talkTime(0.002)).toBe("menos de 1 centésimo");
    expect(talkTime(-0.048)).toBe("uns 5 centésimos");
    expect(talkTime(0.012)).toBe("cerca de 1 centésimo");
    expect(talkTime(0.172)).toBe("cerca de 1,7 décimo");
    expect(talkTime(0.25)).toBe("cerca de 2,5 décimos");
    expect(talkTime(0.1)).toBe("cerca de 1 décimo");
    expect(talkTime(1.23)).toBe("cerca de 1,2 segundo");
  });
  it("fala durações curtas", () => {
    expect(talkDuration(0.5)).toBe("meio segundo");
    expect(talkDuration(0.3)).toBe("3 décimos de segundo");
    expect(talkDuration(0.12)).toBe("1 décimo de segundo");
    expect(talkDuration(1.4)).toBe("1,4 segundo");
  });
});

describe("describeSection", () => {
  it("curva isolada com perda: tempo, causas em metros/km/h e um conselho", () => {
    const talk = describeSection(section({
      lostSeconds: 0.172,
      metrics: { ...emptyMetrics, brakeUse: "both", brakeDeltaMeters: -12.4, minSpeedDeltaKmh: -9.2, throttleOnDelaySeconds: 0.5, apexCorner: c(5) },
    }), { isBiggestLoss: true });
    expect(talk.tag).toBe("Onde perde");
    expect(talk.detail).toContain("É a maior oportunidade da volta: você perde cerca de 1,7 décimo aqui.");
    expect(talk.detail).toContain("Freia uns 12 metros antes da referência");
    expect(talk.detail).toContain("9 km/h mais devagar no meio da curva");
    expect(talk.detail).toContain("só volta ao acelerador meio segundo depois");
    expect(talk.detail).toContain("Vá adiando a freada aos poucos");
    expect(talk.detail).toContain("Freia uns 12 metros antes da referência, chega 9 km/h mais devagar no meio da curva e só volta ao acelerador meio segundo depois.");
    expect(talk.note).toBe("Você chega devagar no meio da curva e demora a voltar ao acelerador.");
    expect(talk.chips.map((chip) => chip.k)).toEqual(["Ponto de freio", "Velocidade no meio", "Acelerador na saída"]);
    expect(talk.chips.every((chip) => chip.tone === "loss")).toBe(true);
    expectClean(talk.detail);
    expectClean(talk.note);
  });

  it("sequência em que o piloto sacrifica a primeira curva e a troca compensa", () => {
    const corners = [c(6), c(7)];
    const talk = describeSection(section({
      label: "Curvas 6–7", corners, isSequence: true, lostSeconds: -0.093,
      parts: [
        { corner: corners[0], label: "Curva 6", start: 1, end: 2, lostSeconds: 0.022 },
        { corner: corners[1], label: "Curva 7", start: 2, end: 3, lostSeconds: -0.115 },
      ],
      metrics: { ...emptyMetrics, exitSpeedDeltaKmh: 6 },
    }));
    expect(talk.tag).toBe("Ponto forte");
    expect(talk.detail).toContain("A 6 e a 7 são uma coisa só: o que você faz na entrada da 6 decide como você sai da 7.");
    expect(talk.detail).toContain("Você entra um pouco devagar na 6 (perde uns 2 centésimos)");
    expect(talk.detail).toContain("você ganha cerca de 1,2 décimo na 7");
    expect(talk.detail).toContain("No total sobra uns 9 centésimos a seu favor.");
    expect(talk.detail).toContain("Não mexa nisso.");
    expect(talk.note).toBe("Ponto forte. Você sacrifica a 6 para sair forte da 7, e a troca compensa.");
    expectClean(talk.detail);
  });

  it("sequência em que entrar forte na primeira custa a saída da segunda", () => {
    const corners = [c(3, "Esses"), c(4, "Degner")];
    const talk = describeSection(section({
      label: "Esses–Degner", corners, isSequence: true, lostSeconds: 0.08,
      parts: [
        { corner: corners[0], label: "Esses", start: 1, end: 2, lostSeconds: -0.04 },
        { corner: corners[1], label: "Degner", start: 2, end: 3, lostSeconds: 0.12 },
      ],
      metrics: emptyMetrics,
    }));
    expect(talk.detail).toContain("Você ganha uns 4 centésimos em Esses, mas paga cerca de 1,2 décimo em Degner.");
    expect(talk.detail).toContain("entrar um pouco mais devagar em Esses para sair melhor de Degner");
    expect(talk.note).toBe("Você entra forte em Esses, mas paga em Degner.");
    expect(talk.detail).toContain("Não aparece um motivo claro");
    expectClean(talk.detail);
  });

  it("empate não vira 'onde perde'", () => {
    const talk = describeSection(section({ lostSeconds: 0.003, metrics: { ...emptyMetrics, minSpeedDeltaKmh: 0.5, throttleOnDelaySeconds: 0.02 } }));
    expect(talk.tag).toBe("Ponto forte");
    expect(talk.note).toBe("Igual à referência.");
    expect(talk.chips).toEqual([
      { k: "Velocidade no meio", v: "igual", tone: "neutral" },
      { k: "Acelerador na saída", v: "igual", tone: "neutral" },
    ]);
  });

  it("direção esquerda/direita só quando o lado é confiável", () => {
    const withSide = describeSection(section({ lostSeconds: 0.05, metrics: { ...emptyMetrics, lineOffsetMeters: 2.2, lineSide: "direita" } }));
    expect(withSide.detail).toContain("passa uns 2 metros mais à direita que a referência");
    const withoutSide = describeSection(section({ lostSeconds: 0.05, metrics: { ...emptyMetrics, lineOffsetMeters: 2.2, lineSide: null } }));
    expect(withoutSide.detail).not.toMatch(/esquerda|direita/);
    expect(withoutSide.detail).toContain("longe do traçado da referência");
  });

  it("nenhuma combinação gera jargão proibido", () => {
    const variants: Partial<SectionMetrics>[] = [
      { brakeUse: "own" }, { brakeUse: "ref" }, { throttleAvgDeltaPct: -12 }, { throttleAvgDeltaPct: 15 },
      { brakePeakDeltaPct: 20, brakeUse: "both" }, { steeringDeltaDeg: 18 }, { steeringDeltaDeg: -10 },
      { gearAtApex: { own: 3, ref: 4 } }, { exitSpeedDeltaKmh: -4 }, { throttleOnDelaySeconds: -0.2 },
    ];
    for (const lost of [0.2, -0.2]) {
      for (const variant of variants) {
        const talk = describeSection(section({ lostSeconds: lost, metrics: { ...emptyMetrics, ...variant } }));
        expectClean(talk.detail);
        expectClean(talk.note);
        for (const chip of talk.chips) { expectClean(chip.k); expectClean(chip.v); }
        expect(talk.detail.split(". ").length).toBe(new Set(talk.detail.split(". ")).size);
      }
    }
  });
});
