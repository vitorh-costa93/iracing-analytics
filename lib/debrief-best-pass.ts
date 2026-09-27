import { pointsInWindow } from "./lap-analysis";
import type { LapSectionSample, SelfSection } from "./self-consistency";
import type { Trace } from "./telemetry-trace";

/**
 * Melhor passagem individual por trecho no Race Debrief (auditoria B7, 26/09/2026).
 *
 * Restaura a `idealLine` de 94c4d8d:app/api/telemetry/debrief/route.ts: a volta mais rápida NAQUELE
 * trecho (não a volta mais rápida da corrida; dá para acertar uma curva numa volta média), com o
 * ganho = média das passagens − melhor passagem e as curvas de freio e acelerador dessa passagem para
 * o piloto copiar. Mesmo critério de antes: pelo menos 3 passagens medidas (MIN_PASSES). A unidade
 * agora é o trecho da versão nova (curvas coladas numa sequência), e o tempo de cada passagem vem de
 * lib/self-consistency.ts (integral de 1/velocidade reescalada pelo tempo da volta, como antes).
 *
 * Só os BEST_PASS_SECTIONS trechos com mais ganho recebem o traço (mapa local + curvas), para o
 * payload em cache continuar pequeno.
 */
export const MIN_PASSES = 3;
export const BEST_PASS_SECTIONS = 3;
/** pontos por passagem enviados ao navegador (mapa local e curvas) */
export const BEST_PASS_MAX_POINTS = 160;

export type BestPassPoint = { d: number; lat: number | null; lon: number | null; brake: number | null; throttle: number | null; speed: number | null };
export type BestPass = {
  sectionId: string;
  lapNumber: number | null;
  seconds: number;
  /** média das passagens − melhor passagem (segundos) */
  gainVsAverage: number;
  passes: number;
  points: BestPassPoint[];
  /** freio/acelerador da referência (a volta enviada pelo piloto) na mesma janela, se houver cobertura. */
  referencePoints: BestPassPoint[] | null;
};

export function bestPassOf(samples: LapSectionSample[]): { sample: LapSectionSample; gainVsAverage: number } | null {
  if (samples.length < MIN_PASSES) return null;
  const best = samples.reduce((a, b) => (b.seconds < a.seconds ? b : a));
  const average = samples.reduce((sum, item) => sum + item.seconds, 0) / samples.length;
  return { sample: best, gainVsAverage: Math.max(0, average - best.seconds) };
}

/** Os trechos com mais ganho (gainIfRepeat, o mesmo número da coluna "Se você fizer sempre assim"). */
export function topGainSections<T extends Pick<SelfSection, "gainIfRepeat">>(sections: T[], count = BEST_PASS_SECTIONS): T[] {
  return sections.filter((section) => (section.gainIfRepeat ?? 0) > 0).sort((a, b) => (b.gainIfRepeat ?? 0) - (a.gainIfRepeat ?? 0)).slice(0, count);
}

const round = (value: number | null, digits: number) => (value === null || !Number.isFinite(value) ? null : Number(value.toFixed(digits)));

/** Recorte da passagem (janela do trecho), reduzido a no máximo `maxPoints` pontos. */
export function passPoints(trace: Trace, windowStart: number, windowEnd: number, maxPoints = BEST_PASS_MAX_POINTS): BestPassPoint[] {
  const items = pointsInWindow(trace.points, windowStart, windowEnd);
  const stride = Math.max(1, Math.ceil(items.length / maxPoints));
  return items.filter((_, index) => index % stride === 0).map(({ point, d }) => ({
    d: Number(d.toFixed(3)),
    lat: round(point.lat, 6),
    lon: round(point.lon, 6),
    brake: round(point.brake, 3),
    throttle: round(point.throttle, 3),
    speed: round(point.speed, 2),
  }));
}

/** Pontos da referência têm cobertura o bastante na janela do trecho para valer a pena desenhar (evita
 * uma linha pontilhada picada, de 1 ou 2 pontos, quando a referência mal passa por ali). */
const MIN_REFERENCE_POINTS = 5;

export function buildBestPasses(sections: SelfSection[], traces: { lapNumber: number | null; trace: Trace }[], referenceTrace?: Trace | null): BestPass[] {
  const result: BestPass[] = [];
  for (const section of topGainSections(sections)) {
    const best = bestPassOf(section.samples);
    if (!best || best.sample.lapNumber === null) continue;
    const lap = traces.find((item) => item.lapNumber === best.sample.lapNumber);
    if (!lap) continue;
    const referencePoints = referenceTrace ? passPoints(referenceTrace, section.windowStart, section.windowEnd) : [];
    result.push({
      sectionId: section.id,
      lapNumber: best.sample.lapNumber,
      seconds: Number(best.sample.seconds.toFixed(3)),
      gainVsAverage: Number(best.gainVsAverage.toFixed(3)),
      passes: section.samples.length,
      points: passPoints(lap.trace, section.windowStart, section.windowEnd),
      referencePoints: referencePoints.length >= MIN_REFERENCE_POINTS ? referencePoints : null,
    });
  }
  return result;
}
