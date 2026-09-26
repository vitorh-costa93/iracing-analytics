import { describe, expect, it } from "vitest";
import { dec, lossTimingText, quickSummary, signedDec, signedInt, weekPressureSubtitle, weekRacesSubtitle, type SummaryInput } from "./debrief-narrative";
import { buildRecommendation, type RecommendationInput } from "./recommendation";
import { paceVsResultInsight } from "./pace-vs-result-insight";
import { paceConsistencyNote } from "./pace-consistency-note";
import type { PacePoint } from "./debrief-charts";

// Palavras que o piloto pediu para sumir dos debriefs (docs/redesign-plan.md, etapa 5).
const FORBIDDEN = [/p\.p\./i, /pontos percentuais/i, /coeficiente/i, /repetibilidade/i, /concentra/i, /pior sequência/i, /--/, /Leitura:/, /Recomendação:/, /desvio-padrão/i];
const clean = (text: string) => { for (const pattern of FORBIDDEN) expect(text).not.toMatch(pattern); };

const summary = (over: Partial<SummaryInput>): SummaryInput => ({
  scope: "season", races: 47, referenceRaces: 40, net: 214, referenceNet: 71, wins: 3, referenceWins: 1, severeCount: 0, severeLossTotal: 0,
  gainTotal: 500, lossTotal: 286, incidentsNow: 3.8, incidentsRef: 4.4, ...over,
});
const rec = (over: Partial<RecommendationInput>): RecommendationInput => ({
  net: 100, netBetter: true, netWorse: false, paceImproved: false, consistencyImproved: false, paceWorsened: false, severeCount: 0, lossFocus: null,
  fastLoss: 0, pacePoints: 10, incidentsWorse: false, ...over,
});
const point = (gapPct: number, delta: number, incidents: number | null = 2): PacePoint => ({ key: String(gapPct) + delta, label: "W", gapPct, delta, incidents, races: 1 });

describe("number formatting", () => {
  it("uses comma decimals and a real minus sign", () => {
    expect(signedInt(62)).toBe("+62");
    expect(signedInt(-4.4)).toBe("−4");
    expect(signedInt(0.2)).toBe("0");
    expect(dec(3.84)).toBe("3,8");
    expect(signedDec(-0.04)).toBe("0,0");
  });
});

describe("quick summary", () => {
  it("season with wins and a clean campaign praises it", () => {
    const text = quickSummary(summary({}));
    expect(text).toBe("Você teve 3 vitórias nesta season, contra 1 na anterior, e o iRating subiu 214 pontos (na anterior, subiu 71 pontos). Nenhuma perda grande: você ganhou sem sustos. E você correu mais limpo: 3,8 incidentes por corrida, contra 4,4.");
    clean(text);
  });

  it("season where big losses ate the gains", () => {
    const text = quickSummary(summary({ severeCount: 2, severeLossTotal: 230, incidentsNow: 4, incidentsRef: 4 }));
    expect(text).toContain("Mas duas perdas grandes engoliram quase metade do que você ganhou.");
    clean(text);
  });

  it("losing season blames the big losses in plain words", () => {
    const text = quickSummary(summary({ net: -120, wins: 0, referenceWins: 0, severeCount: 1, severeLossTotal: 70, lossTotal: 200, incidentsNow: 5.5, incidentsRef: 4 }));
    expect(text).toContain("o iRating caiu 120 pontos");
    expect(text).toContain("Uma perda grande responde por 35% de tudo o que você perdeu.");
    expect(text).toContain("Os incidentes subiram: 5,5 por corrida, contra 4,0.");
    clean(text);
  });

  it("week compares per race and flags the best week", () => {
    const text = quickSummary(summary({ scope: "week", races: 9, net: 62, referenceRaces: 50, referenceNet: -200, wins: 2, weekRank: { best: true, worst: false, weeks: 12 } }));
    expect(text).toContain("Nesta semana você fez 9 corridas e o iRating subiu 62 pontos, bem acima das outras semanas (média de −4 por corrida).");
    expect(text).toContain("Foi a sua melhor semana da season, com 2 vitórias.");
    clean(text);
  });
});

describe("pace vs result", () => {
  it("counts aligned weeks and calls out fast-but-losing ones with incidents", () => {
    const points = [point(0.2, 30), point(0.3, 20), point(0.9, -10), point(0.1, -40, 6), point(0.95, -5)];
    const text = paceVsResultInsight({ unit: "week", points, quadrants: { fastGain: 2, slowGain: 0, fastLoss: 1, slowLoss: 2 }, split: 0.5, netWorse: false, netBetter: true, gapDeltaSeconds: null });
    expect(text).toBe("O ritmo acompanha o resultado em 4 de 5 semanas. Em uma, você foi rápido e mesmo assim perdeu iRating, com mais incidentes que o normal. O problema foi a corrida, não o carro.");
    clean(text);
  });

  it("week scope opens with the average distance and handles the all-aligned case", () => {
    const points = [point(0.2, 30), point(0.3, 20), point(0.4, 5)];
    const text = paceVsResultInsight({ unit: "race", points, quadrants: { fastGain: 3, slowGain: 0, fastLoss: 0, slowLoss: 0 }, split: 0.5, netWorse: false, netBetter: true, gapDeltaSeconds: null });
    expect(text).toBe("Sua melhor volta ficou, em média, a 0,3% da sua referência em cada pista. O resultado acompanhou o ritmo em todas as 3 corridas, sem surpresa.");
  });

  it("uses telemetry to confirm faster-but-losing", () => {
    const points = [point(0.2, -30), point(0.3, -20), point(0.9, -10)];
    const text = paceVsResultInsight({ unit: "week", points, quadrants: { fastGain: 0, slowGain: 0, fastLoss: 2, slowLoss: 1 }, split: 0.5, netWorse: true, netBetter: false, gapDeltaSeconds: -0.15 });
    expect(text).toContain("A telemetria confirma: suas voltas ficaram 0,15 s mais perto da sua melhor volta do que na referência.");
    clean(text);
  });

  it("says when there is no lap data", () => {
    expect(paceVsResultInsight({ unit: "week", points: [], quadrants: { fastGain: 0, slowGain: 0, fastLoss: 0, slowLoss: 0 }, split: null, netWorse: false, netBetter: false, gapDeltaSeconds: null })).toContain("Ainda não há volta");
  });
});

describe("recommendation", () => {
  it("praises a good season and points to one focus", () => {
    expect(buildRecommendation(rec({}))).toBe("Continue com a preparação atual, ela está funcionando. Repita o que fez: mesma rotina de treino antes de cada corrida.");
    const text = buildRecommendation(rec({ severeCount: 3, lossFocus: { bin: 0, count: 2 } }));
    expect(text).toBe("Continue com a preparação atual, ela está funcionando. O ponto a olhar é a largada e a primeira volta, que apareceu em 2 das 3 perdas grandes.");
  });

  it("separates race craft from pace", () => {
    const text = buildRecommendation(rec({ net: -80, netBetter: false, netWorse: true, paceImproved: true, incidentsWorse: true }));
    expect(text).toContain("O ritmo está aí; o que está custando iRating é a corrida.");
    expect(text).toContain("Menos incidentes");
  });

  it("asks for a pause after a big loss when pace is not there", () => {
    expect(buildRecommendation(rec({ net: -80, netBetter: false, netWorse: true, severeCount: 1 }))).toMatch(/^Depois de uma perda grande/);
    expect(buildRecommendation(rec({ net: -30, netBetter: false, netWorse: true, paceWorsened: true }))).toMatch(/^Falta ritmo/);
  });

  it("never uses the banned words", () => {
    const variants = [rec({}), rec({ severeCount: 1 }), rec({ netWorse: true, netBetter: false, severeCount: 2 }), rec({ net: -5, netBetter: true, netWorse: false }), rec({ net: -5, netBetter: false, netWorse: true })];
    for (const variant of variants) clean(buildRecommendation(variant));
  });
});

describe("loss timing text", () => {
  it("highlights the dominant phase and the shift against the reference", () => {
    const text = lossTimingText({ scope: "season", severeCount: 4, bins: [3, 1, 0, 0], sample: 4, averagePct: 18, referenceSample: 5, referenceAveragePct: 40 });
    expect(text).toEqual({ before: "A maioria das suas perdas grandes acontece ", strong: "no começo da corrida", after: ", em média 22% da corrida mais cedo que na referência. Largada e primeira volta são o problema, não o ritmo." });
  });

  it("covers empty and tied cases", () => {
    expect(lossTimingText({ scope: "week", severeCount: 0, bins: [0, 0, 0, 0], sample: 0, averagePct: null, referenceSample: 0, referenceAveragePct: null }).before).toBe("Sem perdas grandes nesta semana. Nada para corrigir aqui.");
    expect(lossTimingText({ scope: "season", severeCount: 2, bins: [1, 0, 0, 1], sample: 2, averagePct: 50, referenceSample: 0, referenceAveragePct: null }).before).toContain("espalhadas");
  });
});

describe("chart subtitles", () => {
  it("names the most expensive week", () => {
    expect(weekPressureSubtitle([{ week: 1, delta: 40 }, { week: 5, delta: -58 }, { week: 6, delta: 12 }])).toBe("Saldo de cada semana. A W5 foi a mais cara da season (−58).");
    expect(weekPressureSubtitle([{ week: 1, delta: 40 }, { week: 2, delta: 12 }])).toContain("Nenhuma fechou no vermelho");
    expect(weekRacesSubtitle(0, 9)).toBe("Sem perdas grandes nesta semana");
    expect(weekRacesSubtitle(2, 9)).toBe("Duas perdas grandes nesta semana");
  });
});

describe("pace consistency note", () => {
  it("talks in track language", () => {
    expect(paceConsistencyNote(0.05, -0.05)).toBe("Você ficou mais constante, só que num ritmo mais lento. Agora é buscar velocidade sem perder essa constância.");
    expect(paceConsistencyNote(null, null)).toBeNull();
    for (const pair of [[-0.1, -0.1], [0.1, 0.1], [-0.1, 0.1], [0, 0], [-0.1, 0], [0.1, 0]] as const) clean(paceConsistencyNote(pair[0], pair[1])!);
  });
});

describe("quick summary without wins", () => {
  it("does not say zero wins", () => {
    const text = quickSummary(summary({ wins: 0, referenceWins: 1, net: 31, referenceNet: 247 }));
    expect(text).toMatch(/^Ainda sem vitória nesta season \(na anterior, foi uma\), e o iRating subiu 31 pontos/);
  });
});
