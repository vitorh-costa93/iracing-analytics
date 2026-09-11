import type { TractionSummary } from "@/lib/traction-events";

/** Shared "senior engineer" voice for destracionamento/microcorreções, reused across every surface
 * that shows this data (Comparar Carros first, 11/09/2026; Melhor Volta vs Referência and Meu Debrief
 * to follow) -- same pattern as netClause/paceVsResultInsight/recommendation.ts: small composable
 * phrase-builders instead of bespoke prose duplicated per screen. */

// Below this rate the driver isn't meaningfully fighting the car -- a stray flag or two across a
// handful of laps is noise, not a pattern worth a sentence. Matches "se eu tô tentando toda volta, é
// um problema, caso seja pontual, não é" (11/09/2026): the threshold is deliberately about RATE, not
// raw count, so it stays meaningful regardless of how many laps were sampled.
const NOTABLE_RATE_PER_10_LAPS = 2;
// A gap this size between two cars is a real behavioral difference, not sampling noise between two
// similarly-sized lap pools.
const MEANINGFUL_RATE_GAP = 1.5;

export function isNotableTractionPattern(summary: TractionSummary): boolean {
  return summary.wheelspinPer10Laps >= NOTABLE_RATE_PER_10_LAPS || summary.correctionsPer10Laps >= NOTABLE_RATE_PER_10_LAPS;
}

/** One car's own pattern, read in isolation -- "é hábito ou é pontual" stated directly. */
export function describeTractionPattern(summary: TractionSummary): string | null {
  if (summary.lapsAnalyzed === 0) return null;
  const parts: string[] = [];
  if (summary.wheelspinPer10Laps >= NOTABLE_RATE_PER_10_LAPS) {
    parts.push(`destraciona em média ${summary.wheelspinPer10Laps.toFixed(1)}x a cada 10 voltas`);
  } else if (summary.wheelspinCount > 0) {
    parts.push("destracionou pontualmente, não é um padrão");
  }
  if (summary.correctionsPer10Laps >= NOTABLE_RATE_PER_10_LAPS) {
    parts.push(`corrige o volante bruscamente ${summary.correctionsPer10Laps.toFixed(1)}x a cada 10 voltas`);
  } else if (summary.correctionCount > 0) {
    parts.push("corrigiu o volante pontualmente, não é um padrão");
  }
  if (!parts.length) return null;
  return parts.join(" e ").replace(/^./, (char) => char.toUpperCase()) + ".";
}

/** The cross-car insight for Comparar Carros (11/09/2026: "às vezes eu sou mais rápido com um do que
 * com outro, mas eu faço mais microcorreções, eu destraciono mais, o que leva a crer que eu vou ter
 * mais dificuldades de manter esse carro na mão por muitas voltas") -- only speaks when the gap is
 * real, same "only when it's genuinely worth saying" philosophy as buildCarComparisonNarrative's own
 * clauses. Deliberately doesn't care which car is faster: the point is the tradeoff itself. */
export function compareTractionAcrossCars(
  fasterCarName: string, fasterSummary: TractionSummary,
  otherCarName: string, otherSummary: TractionSummary,
): string | null {
  if (!isNotableTractionPattern(fasterSummary) && !isNotableTractionPattern(otherSummary)) return null;

  const wheelspinGap = fasterSummary.wheelspinPer10Laps - otherSummary.wheelspinPer10Laps;
  const correctionGap = fasterSummary.correctionsPer10Laps - otherSummary.correctionsPer10Laps;

  if (wheelspinGap >= MEANINGFUL_RATE_GAP || correctionGap >= MEANINGFUL_RATE_GAP) {
    const signals: string[] = [];
    if (wheelspinGap >= MEANINGFUL_RATE_GAP) signals.push(`destraciona ${wheelspinGap.toFixed(1)}x mais a cada 10 voltas`);
    if (correctionGap >= MEANINGFUL_RATE_GAP) signals.push(`corrige o volante ${correctionGap.toFixed(1)}x mais a cada 10 voltas`);
    return `No ${fasterCarName} você ${signals.join(" e ")} do que no ${otherCarName} -- é mais rápido, mas provavelmente mais difícil de segurar numa corrida longa; o ${otherCarName} pode valer mais em prova por ser mais fácil de manter consistente.`;
  }
  if (otherSummary.wheelspinPer10Laps - fasterSummary.wheelspinPer10Laps >= MEANINGFUL_RATE_GAP || otherSummary.correctionsPer10Laps - fasterSummary.correctionsPer10Laps >= MEANINGFUL_RATE_GAP) {
    return `Apesar de mais lento no ${otherCarName}, você destraciona e corrige menos nele do que no ${fasterCarName} -- vale considerar se a diferença de ritmo compensa o risco extra de manter o ${fasterCarName} na mão por muitas voltas.`;
  }
  return null;
}
