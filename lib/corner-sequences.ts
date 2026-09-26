import { ABSOLUTE_MERGE_GAP_METERS, MERGE_GAP_PCT } from "./corner-detection";

/**
 * Curva a curva com SEQUÊNCIAS (redesign etapa 3, 25/09/2026).
 *
 * lib/corner-detection.ts já funde corridas de heading separadas por menos de MERGE_GAP_PCT (ou
 * ABSOLUTE_MERGE_GAP_METERS) num mesmo complexo e depois o divide por proeminência em curvas reais.
 * Isso separa corretamente as curvas, mas curvas COLADAS (esses, chicanes, S de Suzuka, 3-4 de uma
 * sequência) não podem ser julgadas isoladas: o piloto pode sacrificar a entrada de uma para sair
 * mais forte da seguinte. Aqui essas curvas viram uma sequência analisada como um todo, e cada curva
 * dela vira uma "parte" para mostrar quem paga e quem ganha dentro da sequência.
 *
 * Distâncias em % da volta (0-100). Uma curva/sequência que cruza a linha de chegada fica com
 * início negativo (ex.: -2 = 98%), para que início < fim sempre valha.
 */
export type LapCorner = { number: number; distance: number; name: string | null; startDistance: number; endDistance: number };

export type CornerSequence = { corners: LapCorner[]; start: number; end: number };

export type LapSectionPart = { corner: LapCorner; start: number; end: number };

export type LapSection = {
  id: string;
  corners: LapCorner[];
  /** trecho de curva propriamente dito (entrada da primeira curva até a saída da última) */
  start: number;
  end: number;
  /** janela analisada: inclui a zona de frenagem antes e um pouco da reaceleração depois */
  windowStart: number;
  windowEnd: number;
  parts: LapSectionPart[];
};

/** Curvas separadas por uma reta mais curta que isto formam uma sequência. Precisa ser maior que o
 * intervalo de fusão da detecção (80 m), senão nunca haveria curvas separadas a agrupar. */
export const SEQUENCE_GAP_METERS = ABSOLUTE_MERGE_GAP_METERS * 1.5;
/** Sem comprimento de pista conhecido, usa uma fração da volta proporcional ao MERGE_GAP_PCT. */
export const SEQUENCE_GAP_PCT_FALLBACK = MERGE_GAP_PCT * 1.5;
/** Em pista curta, 120 m viraria uma fração grande demais da volta. */
export const SEQUENCE_GAP_PCT_MAX = 2.5;
/** Zona de frenagem incluída antes da entrada (a frenagem acontece antes do heading mudar). */
export const APPROACH_METERS = 150;
export const APPROACH_PCT_FALLBACK = 2.5;
/** Reaceleração incluída depois da saída. */
export const EXIT_METERS = 40;
export const EXIT_PCT_FALLBACK = 0.8;

function metersToPct(meters: number, trackLengthMeters: number | null | undefined, fallbackPct: number) {
  return trackLengthMeters && trackLengthMeters > 0 ? meters / (trackLengthMeters / 100) : fallbackPct;
}

export function sequenceGapPct(trackLengthMeters: number | null | undefined) {
  if (!trackLengthMeters || trackLengthMeters <= 0) return SEQUENCE_GAP_PCT_FALLBACK;
  return Math.min(SEQUENCE_GAP_PCT_MAX, metersToPct(SEQUENCE_GAP_METERS, trackLengthMeters, SEQUENCE_GAP_PCT_FALLBACK));
}

function normalizedSpan(corner: LapCorner) {
  // A detecção devolve uma curva que cruza a linha de chegada como início > fim (ex.: 99,4 → 0,8).
  const start = corner.startDistance > corner.endDistance ? corner.startDistance - 100 : corner.startDistance;
  return { start, end: corner.endDistance };
}

/** Critério de pilotagem opcional para ligar duas curvas coladas: a detecção por heading costuma
 * devolver um "complexo" contínuo longo (ex.: Road Atlanta 1-7, mais de 1 km sem reta pelo GPS),
 * então proximidade geométrica sozinha encadeia curvas que o piloto trata como independentes.
 * lib/lap-analysis.ts passa aqui "o carro não volta a acelerar tudo entre as duas curvas". */
export type CornerLink = (a: LapCorner, b: LapCorner) => boolean;

/** Agrupa curvas coladas em sequências. Curvas isoladas viram sequências de uma curva só. */
export function groupCornerSequences(corners: LapCorner[], trackLengthMeters: number | null | undefined, isLinked?: CornerLink): CornerSequence[] {
  const gap = sequenceGapPct(trackLengthMeters);
  const ordered = corners
    .map((corner) => ({ corner, ...normalizedSpan(corner) }))
    .sort((a, b) => a.start - b.start);
  const groups: CornerSequence[] = [];
  for (const item of ordered) {
    const last = groups[groups.length - 1];
    if (last && item.start - last.end < gap && (!isLinked || isLinked(last.corners[last.corners.length - 1], item.corner))) {
      last.corners.push(item.corner);
      last.end = Math.max(last.end, item.end);
    } else {
      groups.push({ corners: [item.corner], start: item.start, end: item.end });
    }
  }
  // A última e a primeira sequência podem ser coladas através da linha de chegada.
  if (groups.length >= 2) {
    const first = groups[0], last = groups[groups.length - 1];
    if (first.start + 100 - last.end < gap && (!isLinked || isLinked(last.corners[last.corners.length - 1], first.corners[0]))) {
      groups[0] = { corners: [...last.corners, ...first.corners], start: last.start - 100, end: first.end };
      groups.pop();
    }
  }
  return groups;
}

/** Monta os trechos analisados: cada sequência ganha uma janela com a zona de frenagem antes e um
 * pouco de reaceleração depois, sem nunca sobrepor a janela vizinha (a reta entre duas sequências é
 * dividida: no máximo 30% dela vira saída da anterior, o resto pode ser aproximação da seguinte). */
export function buildLapSections(corners: LapCorner[], trackLengthMeters: number | null | undefined, isLinked?: CornerLink): LapSection[] {
  const sequences = groupCornerSequences(corners, trackLengthMeters, isLinked);
  const n = sequences.length;
  if (!n) return [];
  const approach = metersToPct(APPROACH_METERS, trackLengthMeters, APPROACH_PCT_FALLBACK);
  const exit = metersToPct(EXIT_METERS, trackLengthMeters, EXIT_PCT_FALLBACK);
  const exitAfter = (sequence: CornerSequence, nextStart: number) => Math.min(exit, Math.max(0, nextStart - sequence.end) * 0.3);

  return sequences.map((sequence, index) => {
    const prev = sequences[(index - 1 + n) % n];
    const next = sequences[(index + 1) % n];
    const prevEnd = index === 0 ? prev.end - 100 : prev.end;
    const nextStart = index === n - 1 ? next.start + 100 : next.start;
    const prevExit = exitAfter({ ...prev, end: prevEnd }, sequence.start);
    const windowStart = Math.max(sequence.start - approach, prevEnd + prevExit);
    const windowEnd = sequence.end + exitAfter(sequence, nextStart);

    const spans = sequence.corners.map((corner) => ({ corner, ...normalizedSpan(corner) }));
    // Dentro de uma sequência que cruza a chegada, as curvas depois da linha ficam "depois de 100".
    for (let i = 1; i < spans.length; i += 1) {
      if (spans[i].start < spans[i - 1].start - 50) { spans[i].start += 100; spans[i].end += 100; }
    }
    if (sequence.start < 0) {
      for (const span of spans) if (span.start > 50) { span.start -= 100; span.end -= 100; }
    }
    const parts: LapSectionPart[] = spans.map((span, i) => ({
      corner: span.corner,
      start: i === 0 ? windowStart : (spans[i - 1].end + span.start) / 2,
      end: i === spans.length - 1 ? windowEnd : (span.end + spans[i + 1].start) / 2,
    }));
    return { id: `s${index + 1}`, corners: sequence.corners, start: sequence.start, end: sequence.end, windowStart, windowEnd, parts };
  });
}

/** Distância de uma amostra (0-100) na coordenada "desenrolada" da janela, ou null se estiver fora. */
export function unwrapIntoWindow(distance: number, windowStart: number, windowEnd: number): number | null {
  for (const candidate of [distance, distance - 100, distance + 100]) {
    if (candidate >= windowStart && candidate < windowEnd) return candidate;
  }
  return null;
}

/** Converte uma distância desenrolada de volta para 0-100. */
export function wrapDistance(distance: number) {
  return ((distance % 100) + 100) % 100;
}

export function cornerLabel(corner: LapCorner) {
  return corner.name ?? `Curva ${corner.number}`;
}

function joinWithE(items: string[]) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}

/** "Curva 5", "La Source", "Curvas 3–4", "Curvas 14, 15 e 1", "Eau Rouge–Raidillon". Nomes reais só
 * quando TODAS as curvas da sequência têm nome verificado (lib/track-corners.ts); senão, números. */
export function sectionLabel(corners: LapCorner[]) {
  if (corners.length === 1) return cornerLabel(corners[0]);
  if (corners.every((corner) => corner.name)) return Array.from(new Set(corners.map((corner) => corner.name as string))).join("–");
  const numbers = corners.map((corner) => corner.number);
  const consecutive = numbers.every((value, index) => index === 0 || value === numbers[index - 1] + 1);
  return consecutive ? `Curvas ${numbers[0]}–${numbers[numbers.length - 1]}` : `Curvas ${joinWithE(numbers.map(String))}`;
}
