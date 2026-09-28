import { countInWindow, type MicrocorrectionResult } from "./microcorrections";
import type { TalkChip } from "./engineer-talk";

/**
 * Microcorreções da sua volta contra a referência, na semana ativa (auditoria B5, 26/09/2026).
 *
 * A versão anterior (94c4d8d, "Relatório de inputs") comparava as correções de volante da volta com as
 * da referência. A decisão foi voltar esse comparativo usando a métrica atual (lib/microcorrections.ts,
 * a mesma do Race Debrief e da Comparação de carros), sem RPM nem média de inputs. Os limites de "menos"
 * e "mais" são os mesmos do Race Debrief (lib/debrief-talk.ts): até 90% da referência é "menos", a
 * partir de 115% é "mais"; no meio, "parecido". Números sempre por volta (28/09/2026: consistente com
 * Race Debrief e Comparação de carros, nenhuma tela mostra por minuto).
 */
export const MICRO_LESS_RATIO = 0.9;
export const MICRO_MORE_RATIO = 1.15;
/** diferença mínima (em correções) para apontar um trecho no resumo */
export const MICRO_SECTION_MIN_DIFF = 2;

export type MicroTone = "gain" | "loss" | "neutral";

export function microTone(own: number, reference: number): MicroTone {
  if (own <= reference * MICRO_LESS_RATIO && own < reference) return "gain";
  if (own >= reference * MICRO_MORE_RATIO && own > reference) return "loss";
  return "neutral";
}

type SectionWindow = { label: string; windowStart: number; windowEnd: number };

/** Trecho em que você mais corrige a mais que a referência (null se nenhum passa de 2 correções). */
export function worstMicroSection(sections: SectionWindow[], own: number[], reference: number[]) {
  let worst: { label: string; own: number; reference: number } | null = null;
  for (const section of sections) {
    const o = countInWindow(own, section.windowStart, section.windowEnd);
    const r = countInWindow(reference, section.windowStart, section.windowEnd);
    if (o - r >= MICRO_SECTION_MIN_DIFF && (!worst || o - r > worst.own - worst.reference)) worst = { label: section.label, own: o, reference: r };
  }
  return worst;
}

/** Resumo da volta: "Você corrigiu o volante 34 vezes nesta volta, a referência 26 …". */
export function microLapSummary(own: MicrocorrectionResult, reference: MicrocorrectionResult, sections: SectionWindow[]): { text: string; tone: MicroTone } | null {
  if (own.count === 0 && reference.count === 0) return null;
  const tone = microTone(own.count, reference.count);
  const numbers = `${own.count} contra ${reference.count} da referência`;
  const worst = worstMicroSection(sections, own.distances, reference.distances);
  const where = worst ? ` Onde mais aparece: ${worst.label}, ${worst.own} contra ${worst.reference}.` : "";
  if (tone === "gain") return { tone, text: `Microcorreções: você mexeu menos no volante que a referência nesta volta, ${numbers}. Carro na mão.${where}` };
  if (tone === "loss") return { tone, text: `Microcorreções: você corrigiu o volante mais que a referência nesta volta, ${numbers}. Sinal de estar segurando o carro em vez de conduzir limpo.${where}` };
  return { tone, text: `Microcorreções: parecido com a referência nesta volta, ${numbers}.${where}` };
}

/** Chip do popup do trecho: "você 3 · referência 1". */
export function microSectionChip(own: number[], reference: number[], section: { windowStart: number; windowEnd: number }, refLabel = "referência"): TalkChip {
  const o = countInWindow(own, section.windowStart, section.windowEnd);
  const r = countInWindow(reference, section.windowStart, section.windowEnd);
  const diff = o - r;
  const tone: TalkChip["tone"] = diff >= MICRO_SECTION_MIN_DIFF ? "loss" : diff <= -MICRO_SECTION_MIN_DIFF ? "gain" : "neutral";
  return { k: "Microcorreções no trecho", v: `você ${o} · ${refLabel} ${r}`, tone };
}
