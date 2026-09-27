import { describe, expect, it } from "vitest";
import { brakePointText, comparePhrase, lapSpreadText, mapCaption, microFootnote, microTone, segmentWins, trackUsageText } from "./car-compare-talk";
import { carNoun, describeSection } from "./engineer-talk";
import { shortCarName } from "./car-short-name";
import type { SectionMetrics, SectionResult } from "./lap-analysis";

const metrics = (overrides: Partial<SectionMetrics>): SectionMetrics => ({
  brakeDeltaMeters: null, brakeUse: "both", minSpeedDeltaKmh: null, apexCorner: null, throttleOnDelaySeconds: null, exitSpeedDeltaKmh: null,
  throttleAvgDeltaPct: null, brakePeakDeltaPct: null, steeringDeltaDeg: null, gearAtApex: null, lineOffsetMeters: null, lineSide: null,
  ...overrides,
});
const FORBIDDEN = [/p\.p\./i, /Δ/, /--/, /coeficiente/i, /repetibilidade/i, /referência/i];

describe("brakePointText", () => {
  it("fala o ponto de freio como no mockup", () => {
    expect(brakePointText(metrics({ brakeDeltaMeters: -12.2 }))).toBe("freia 12 m antes");
    expect(brakePointText(metrics({ brakeDeltaMeters: 4.4 }))).toBe("freia 4 m depois");
    expect(brakePointText(metrics({ brakeDeltaMeters: 0.8 }))).toBe("igual");
    expect(brakePointText(metrics({ brakeUse: "own" }))).toBe("só você freia");
    expect(brakePointText(metrics({ brakeUse: "none" }))).toBe("sem freada");
  });
});

describe("textos contra outro carro", () => {
  it("trocam 'a referência' pelo nome do carro", () => {
    const section: SectionResult = {
      id: "s1", label: "Curvas 3–4", isSequence: false, corners: [{ number: 3, distance: 20, name: null, startDistance: 19, endDistance: 21 }],
      start: 19, end: 21, windowStart: 17, windowEnd: 22, lostSeconds: 0.14, parts: [], lostSeries: [],
      metrics: metrics({ brakeDeltaMeters: -12, minSpeedDeltaKmh: -9, steeringDeltaDeg: 12, gearAtApex: { own: 3, ref: 4 } }),
    };
    const talk = describeSection(section, { ref: carNoun(shortCarName("Cadillac V-Series.R GTP")) });
    const text = [talk.note, talk.detail, ...talk.chips.map((chip) => chip.v)].join(" ");
    expect(text).toContain("do Cadillac");
    for (const pattern of FORBIDDEN) expect(text).not.toMatch(pattern);
  });
  it("legenda do mapa e frase com microcorreções", () => {
    const ref = carNoun("Cadillac");
    expect(mapCaption("Curvas 3–4", { own: 96, rival: 105 }, ref, "x")).toBe("Curvas 3–4: o Cadillac mantém 9 km/h a mais no ponto mais lento.");
    expect(comparePhrase("Você entra devagar.", 6, 2)).toBe("Você entra devagar. Ele faz 4 microcorreções a menos: o carro fica mais assentado.");
    expect(comparePhrase("Boa saída.", 2, 2)).toBe("Boa saída.");
    const generic = "Ponto forte, sem diferença clara nos pedais.";
    expect(comparePhrase(generic, 1, 1, 0)).not.toBe(comparePhrase(generic, 1, 1, 1));
  });
});

describe("microTone / microFootnote", () => {
  it("colore relativo ao menor valor", () => {
    expect(microTone(34, 34)).toBe("ok");
    expect(microTone(41, 34)).toBe("warn");
    expect(microTone(52, 34)).toBe("bad");
    expect(microTone(null, 34)).toBe("none");
  });
  it("rodapé com os carros reais", () => {
    expect(microFootnote([
      { carName: "Cadillac V-Series.R GTP", bestLapSeconds: 94.3, microPerLap: 34 },
      { carName: "BMW M Hybrid V8", bestLapSeconds: 94.7, microPerLap: 41 },
    ], shortCarName)).toContain("volta: o Cadillac fica mais colado ao chão");
    expect(microFootnote([
      { carName: "Ford Mustang GT3", bestLapSeconds: 97.4, microPerLap: 40 },
      { carName: "McLaren 720S GT3 EVO", bestLapSeconds: 97.6, microPerLap: 27 },
    ], shortCarName)).toBe("Menos correção nem sempre é mais rápido aqui: você corrige menos com o McLaren, mas a volta mais rápida saiu com o Mustang.");
  });
});

describe("quem manda em cada pedaço / consistência / uso de pista (restaurados, auditoria B11)", () => {
  it("conta os pedaços vencidos por carro, na ordem pedida", () => {
    const segments = [{ winnerCarId: 2 }, { winnerCarId: 1 }, { winnerCarId: 2 }, { winnerCarId: null }, { winnerCarId: 9 }];
    expect(segmentWins(segments, [1, 2, 3])).toEqual([{ carId: 1, wins: 1 }, { carId: 2, wins: 2 }, { carId: 3, wins: 0 }]);
  });

  it("textos curtos de uso da pista e desvio do tempo de volta", () => {
    expect(trackUsageText({ avgPct: 61.6, maxPct: 104.2 })).toBe("média 62% · máx. 104%");
    expect(trackUsageText(null)).toBe("sem contorno da pista");
    expect(lapSpreadText({ stddev: 0.214, label: "consistente" })).toBe("±0,21 s · consistente");
    expect(lapSpreadText(null)).toBe("poucas voltas");
  });
});
