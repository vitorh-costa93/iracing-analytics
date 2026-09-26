import { buildLapSections, cornerLabel, sectionLabel, type LapCorner, type LapSection } from "./corner-sequences";
import { drivingLink } from "./lap-analysis";
import { countInWindow } from "./microcorrections";
import type { Trace, TracePoint } from "./telemetry-trace";

/**
 * "Curva a curva × Consistência" do Race Debrief (redesign etapa 4, 26/09/2026): o piloto contra ELE
 * MESMO nas voltas da corrida. Mesma unidade do Telemetry Lab: trechos de curva com curvas coladas
 * agrupadas em sequência (lib/corner-sequences.ts), nunca uma curva colada analisada sozinha.
 *
 * Para cada trecho e cada volta mede: tempo no trecho (integral de 1/velocidade, reescalada pelo tempo
 * oficial da volta), ponto de freio (primeiro cruzamento de 10% de freio), velocidade mínima, momento
 * de voltar ao acelerador (50%, depois do ponto mais lento, em segundos desde o início do trecho),
 * pico de volante e microcorreções. Daí sai:
 *  - quanto cada comando varia entre as voltas (desvio padrão: metros, segundos, graus);
 *  - o que muda nas voltas mais rápidas NAQUELE trecho (terço mais rápido contra o terço mais lento);
 *  - quanto se ganharia repetindo sempre o que se faz nas voltas rápidas (média de todas as voltas
 *    menos a média das rápidas) e em quantas voltas isso já acontece hoje.
 */

export const GRID_STEP_PCT = 0.1;
const BRAKE_ON = 0.1;
const BRAKE_ZONE_PEAK = 0.15;
const THROTTLE_ON = 0.5;
const LIFT_BELOW = 0.35;
/** mínimo de voltas com telemetria para medir variação */
export const MIN_LAPS_FOR_VARIATION = 3;
/** mínimo de voltas para separar voltas rápidas de lentas com alguma segurança */
export const MIN_LAPS_FOR_FAST_SLOW = 5;

/** limites de "varia pouco" / "varia muito" usados nas barras e nos textos */
export const VARIATION_LIMITS = {
  brakeMeters: { ok: 2.5, bad: 6 },
  throttleSeconds: { ok: 0.12, bad: 0.25 },
  steeringDeg: { ok: 5, bad: 10 },
} as const;

export type LapInput = { lapNumber: number | null; lapTime: number; trace: Trace; microDistances: number[] };

export type LapSectionSample = {
  lapNumber: number | null;
  seconds: number;
  /** distância desenrolada (% da volta) do início da freada; null se não freou */
  brakeOnset: number | null;
  minSpeedKmh: number | null;
  /** segundos desde o início da janela até voltar a 50% de acelerador depois do ponto mais lento */
  throttleOnSeconds: number | null;
  steeringPeakDeg: number | null;
  /** levantou o pé depois de já ter voltado ao acelerador, ainda dentro do trecho */
  lifted: boolean;
  micro: number;
};

export type Variation = { value: number; tone: "ok" | "warn" | "bad" } | null;

export type FastSlowDiff = {
  fastLaps: number;
  slowLaps: number;
  /** metros; positivo = nas voltas rápidas você freia MAIS TARDE */
  brakeLaterMeters: number | null;
  /** segundos; positivo = nas voltas rápidas você volta ao acelerador MAIS CEDO */
  throttleEarlierSeconds: number | null;
  /** km/h; positivo = nas voltas rápidas você leva mais velocidade */
  minSpeedGainKmh: number | null;
  /** graus; positivo = nas voltas rápidas você gira MENOS o volante */
  steeringLessDeg: number | null;
  /** fração de voltas com tirada de pé no meio do trecho (lentas menos rápidas) */
  liftDropShare: number;
  /** microcorreções por passagem (lentas menos rápidas) */
  microLess: number;
};

export type SelfSection = {
  id: string;
  label: string;
  isSequence: boolean;
  corners: LapCorner[];
  windowStart: number;
  windowEnd: number;
  laps: number;
  brakeZone: boolean;
  variation: { brake: Variation; throttle: Variation; steering: Variation };
  diff: FastSlowDiff | null;
  /** segundos por volta que se ganharia repetindo as voltas rápidas do trecho */
  gainIfRepeat: number | null;
  /** em quantas voltas o "jeito das voltas rápidas" já acontece (para o alavanca principal) */
  hits: { hit: number; of: number } | null;
  lever: Lever;
  samples: LapSectionSample[];
};

export type Lever = "brake-later" | "throttle-earlier" | "carry-speed" | "no-lift" | "less-steering" | "smoother" | "stable" | "none";

type Grid = { speed: Float64Array; brake: Float64Array; throttle: Float64Array; steering: Float64Array; count: number };

const GRID_COUNT = Math.round(100 / GRID_STEP_PCT) + 1;

function mean(values: number[]) { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function stddev(values: number[]) {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length);
}

/** Amostra a volta numa grade fixa de GRID_STEP_PCT (uma passada só, ponteiro crescente). */
export function buildGrid(points: TracePoint[]): Grid {
  const sorted = [...points].filter((point) => Number.isFinite(point.distance)).sort((a, b) => a.distance - b.distance);
  const speed = new Float64Array(GRID_COUNT).fill(NaN);
  const brake = new Float64Array(GRID_COUNT).fill(NaN);
  const throttle = new Float64Array(GRID_COUNT).fill(NaN);
  const steering = new Float64Array(GRID_COUNT).fill(NaN);
  if (sorted.length < 2) return { speed, brake, throttle, steering, count: GRID_COUNT };
  let j = 0;
  for (let i = 0; i < GRID_COUNT; i += 1) {
    const d = i * GRID_STEP_PCT;
    while (j < sorted.length - 2 && sorted[j + 1].distance < d) j += 1;
    const a = sorted[j], b = sorted[j + 1];
    const span = b.distance - a.distance;
    const ratio = span > 0 ? Math.min(1, Math.max(0, (d - a.distance) / span)) : 0;
    const lerp = (x: number | null, y: number | null) => (x === null || y === null || !Number.isFinite(x) || !Number.isFinite(y) ? NaN : x + (y - x) * ratio);
    speed[i] = lerp(a.speed, b.speed);
    brake[i] = lerp(a.brake, b.brake);
    throttle[i] = lerp(a.throttle, b.throttle);
    steering[i] = lerp(a.steering, b.steering);
  }
  return { speed, brake, throttle, steering, count: GRID_COUNT };
}

function gridIndex(distance: number) {
  const wrapped = ((distance % 100) + 100) % 100;
  return Math.min(GRID_COUNT - 1, Math.round(wrapped / GRID_STEP_PCT));
}

/** Segundos por "passo da grade", reescalados para a volta somar o tempo oficial. */
function lapScale(grid: Grid, lapTime: number) {
  let integral = 0;
  for (let i = 0; i < grid.count - 1; i += 1) {
    const v = grid.speed[i];
    if (Number.isFinite(v) && v > 1) integral += GRID_STEP_PCT / v;
  }
  return integral > 0 ? lapTime / integral : 0;
}

/** Distâncias desenroladas da janela, em passos da grade. */
function windowSteps(start: number, end: number) {
  const steps: number[] = [];
  const first = Math.ceil(start / GRID_STEP_PCT);
  const last = Math.floor(end / GRID_STEP_PCT);
  for (let k = first; k <= last; k += 1) steps.push(Number((k * GRID_STEP_PCT).toFixed(4)));
  return steps;
}

export function measureSectionLap(grid: Grid, scale: number, section: LapSection, microDistances: number[], lapNumber: number | null): LapSectionSample | null {
  const steps = windowSteps(section.windowStart, section.windowEnd);
  if (steps.length < 5 || scale <= 0) return null;
  const at = (channel: keyof Omit<Grid, "count">, d: number) => grid[channel][gridIndex(d)];
  let seconds = 0;
  const elapsed: number[] = [];
  for (const d of steps) {
    elapsed.push(seconds);
    const v = at("speed", d);
    if (Number.isFinite(v) && v > 1) seconds += (GRID_STEP_PCT / v) * scale;
  }
  if (seconds <= 0) return null;

  let brakeOnset: number | null = null;
  let brakePeak = 0;
  for (let i = 0; i < steps.length; i += 1) {
    const value = at("brake", steps[i]);
    if (!Number.isFinite(value)) continue;
    brakePeak = Math.max(brakePeak, value);
    if (brakeOnset === null && i > 0) {
      const previous = at("brake", steps[i - 1]);
      if (Number.isFinite(previous) && previous < BRAKE_ON && value >= BRAKE_ON) {
        const ratio = (BRAKE_ON - previous) / Math.max(1e-9, value - previous);
        brakeOnset = steps[i - 1] + GRID_STEP_PCT * ratio;
      }
    }
  }
  if (brakePeak < BRAKE_ZONE_PEAK) brakeOnset = null;

  let minIndex = -1;
  let minSpeed = Infinity;
  for (let i = 0; i < steps.length; i += 1) {
    const d = steps[i];
    if (d < section.start || d > section.end) continue;
    const v = at("speed", d);
    if (Number.isFinite(v) && v > 1 && v < minSpeed) { minSpeed = v; minIndex = i; }
  }
  const minSpeedKmh = minIndex >= 0 ? minSpeed * 3.6 : null;

  let throttleOnSeconds: number | null = null;
  let lifted = false;
  if (minIndex >= 0) {
    let onIndex = -1;
    for (let i = Math.max(1, minIndex - 5); i < steps.length; i += 1) {
      const previous = at("throttle", steps[i - 1]), value = at("throttle", steps[i]);
      if (Number.isFinite(previous) && Number.isFinite(value) && previous < THROTTLE_ON && value >= THROTTLE_ON) { onIndex = i; break; }
    }
    if (onIndex >= 0) {
      throttleOnSeconds = elapsed[onIndex];
      for (let i = onIndex + 1; i < steps.length; i += 1) {
        if (steps[i] > section.end) break;
        const value = at("throttle", steps[i]);
        if (Number.isFinite(value) && value < LIFT_BELOW) { lifted = true; break; }
      }
    }
  }

  let steeringPeak = 0;
  let hasSteering = false;
  for (const d of steps) {
    if (d < section.start || d > section.end) continue;
    const value = at("steering", d);
    if (Number.isFinite(value)) { hasSteering = true; steeringPeak = Math.max(steeringPeak, Math.abs(value)); }
  }

  return {
    lapNumber,
    seconds,
    brakeOnset,
    minSpeedKmh,
    throttleOnSeconds,
    steeringPeakDeg: hasSteering ? (steeringPeak * 180) / Math.PI : null,
    lifted,
    micro: countInWindow(microDistances, section.windowStart, section.windowEnd),
  };
}

function variation(values: number[], limits: { ok: number; bad: number }, minCount: number): Variation {
  if (values.length < minCount) return null;
  const value = stddev(values);
  return { value, tone: value <= limits.ok ? "ok" : value <= limits.bad ? "warn" : "bad" };
}

function valuesOf<T>(items: T[], pick: (item: T) => number | null) {
  return items.map(pick).filter((value): value is number => value !== null && Number.isFinite(value));
}

function meanOrNull(values: number[]) { return values.length ? mean(values) : null; }

/** Escolhe a alavanca principal do trecho: o que mais muda entre as voltas rápidas e as lentas. */
export function pickLever(diff: FastSlowDiff | null, variationTones: SelfSection["variation"], gainIfRepeat: number | null): Lever {
  const stable = [variationTones.brake, variationTones.throttle, variationTones.steering].every((item) => !item || item.tone === "ok");
  if (!diff || gainIfRepeat === null) return stable ? "stable" : "none";
  if (gainIfRepeat < 0.02 && stable) return "stable";
  const candidates: { lever: Lever; score: number }[] = [];
  if (diff.brakeLaterMeters !== null && diff.brakeLaterMeters >= 3) candidates.push({ lever: "brake-later", score: diff.brakeLaterMeters / 3 });
  if (diff.throttleEarlierSeconds !== null && diff.throttleEarlierSeconds >= 0.1) candidates.push({ lever: "throttle-earlier", score: diff.throttleEarlierSeconds / 0.1 });
  if (diff.liftDropShare >= 0.34) candidates.push({ lever: "no-lift", score: diff.liftDropShare * 3 });
  if (diff.minSpeedGainKmh !== null && diff.minSpeedGainKmh >= 2) candidates.push({ lever: "carry-speed", score: diff.minSpeedGainKmh / 2 });
  if (diff.steeringLessDeg !== null && diff.steeringLessDeg >= 5) candidates.push({ lever: "less-steering", score: diff.steeringLessDeg / 5 });
  if (diff.microLess >= 1) candidates.push({ lever: "smoother", score: diff.microLess });
  if (!candidates.length) return stable ? "stable" : "none";
  return candidates.sort((a, b) => b.score - a.score)[0].lever;
}

export type SelfConsistencyResult = {
  lapsAnalyzed: number;
  canCompareFastSlow: boolean;
  trackLengthMeters: number | null;
  sections: SelfSection[];
};

export function analyzeSelfConsistency(laps: LapInput[], corners: LapCorner[]): SelfConsistencyResult | null {
  const usable = laps.filter((lap) => lap.trace.points.length > 50 && lap.lapTime > 0);
  if (usable.length < MIN_LAPS_FOR_VARIATION || !corners.length) return null;
  const fastest = usable.reduce((best, lap) => (lap.lapTime < best.lapTime ? lap : best));
  const trackLengthMeters = fastest.trace.trackLengthMeters ?? usable.find((lap) => lap.trace.trackLengthMeters)?.trace.trackLengthMeters ?? null;
  const sections = buildLapSections(corners, trackLengthMeters, drivingLink(fastest.trace, fastest.trace, trackLengthMeters));
  const grids = usable.map((lap) => {
    const grid = buildGrid(lap.trace.points);
    return { lap, grid, scale: lapScale(grid, lap.lapTime) };
  });
  const canCompareFastSlow = usable.length >= MIN_LAPS_FOR_FAST_SLOW;
  const pctToMeters = (pct: number) => (trackLengthMeters ? (pct / 100) * trackLengthMeters : null);

  const results = sections.map((section): SelfSection => {
    const samples = grids
      .map(({ lap, grid, scale }) => measureSectionLap(grid, scale, section, lap.microDistances, lap.lapNumber))
      .filter((item): item is LapSectionSample => item !== null);
    const brakeCount = samples.filter((item) => item.brakeOnset !== null).length;
    const brakeZone = brakeCount >= Math.max(2, Math.ceil(samples.length * 0.6));
    const brakeMeters = brakeZone && trackLengthMeters ? valuesOf(samples, (item) => (item.brakeOnset === null ? null : pctToMeters(item.brakeOnset))) : [];
    const varTones = {
      brake: variation(brakeMeters, VARIATION_LIMITS.brakeMeters, MIN_LAPS_FOR_VARIATION),
      throttle: variation(valuesOf(samples, (item) => item.throttleOnSeconds), VARIATION_LIMITS.throttleSeconds, MIN_LAPS_FOR_VARIATION),
      steering: variation(valuesOf(samples, (item) => item.steeringPeakDeg), VARIATION_LIMITS.steeringDeg, MIN_LAPS_FOR_VARIATION),
    };

    let diff: FastSlowDiff | null = null;
    let gainIfRepeat: number | null = null;
    let hits: SelfSection["hits"] = null;
    if (canCompareFastSlow && samples.length >= MIN_LAPS_FOR_FAST_SLOW) {
      const ordered = [...samples].sort((a, b) => a.seconds - b.seconds);
      const groupSize = Math.max(2, Math.round(ordered.length / 3));
      const fast = ordered.slice(0, groupSize);
      const slow = ordered.slice(-groupSize);
      const diffOf = (pick: (item: LapSectionSample) => number | null, sign: 1 | -1) => {
        const fastMean = meanOrNull(valuesOf(fast, pick));
        const slowMean = meanOrNull(valuesOf(slow, pick));
        return fastMean === null || slowMean === null ? null : (fastMean - slowMean) * sign;
      };
      const brakeLaterPct = brakeZone ? diffOf((item) => item.brakeOnset, 1) : null;
      diff = {
        fastLaps: fast.length,
        slowLaps: slow.length,
        brakeLaterMeters: brakeLaterPct === null ? null : pctToMeters(brakeLaterPct),
        throttleEarlierSeconds: diffOf((item) => item.throttleOnSeconds, -1),
        minSpeedGainKmh: diffOf((item) => item.minSpeedKmh, 1),
        steeringLessDeg: diffOf((item) => item.steeringPeakDeg, -1),
        liftDropShare: slow.filter((item) => item.lifted).length / slow.length - fast.filter((item) => item.lifted).length / fast.length,
        microLess: mean(slow.map((item) => item.micro)) - mean(fast.map((item) => item.micro)),
      };
      gainIfRepeat = Math.max(0, mean(samples.map((item) => item.seconds)) - mean(fast.map((item) => item.seconds)));
      const lever = pickLever(diff, varTones, gainIfRepeat);
      hits = hitCount(lever, samples, fast, trackLengthMeters);
      return build(section, samples, brakeZone, varTones, diff, gainIfRepeat, hits, lever);
    }
    return build(section, samples, brakeZone, varTones, diff, gainIfRepeat, hits, pickLever(null, varTones, null));
  }).filter((section) => section.laps >= MIN_LAPS_FOR_VARIATION);

  return { lapsAnalyzed: usable.length, canCompareFastSlow, trackLengthMeters, sections: results };
}

function build(section: LapSection, samples: LapSectionSample[], brakeZone: boolean, variationTones: SelfSection["variation"], diff: FastSlowDiff | null, gainIfRepeat: number | null, hits: SelfSection["hits"], lever: Lever): SelfSection {
  return {
    id: section.id,
    label: sectionLabel(section.corners),
    isSequence: section.corners.length > 1,
    corners: section.corners,
    windowStart: section.windowStart,
    windowEnd: section.windowEnd,
    laps: samples.length,
    brakeZone,
    variation: variationTones,
    diff,
    gainIfRepeat,
    hits,
    lever,
    samples,
  };
}

/** Em quantas voltas o piloto já faz o que faz nas voltas rápidas (para a alavanca escolhida). */
function hitCount(lever: Lever, samples: LapSectionSample[], fast: LapSectionSample[], trackLengthMeters: number | null): SelfSection["hits"] {
  if (lever === "brake-later" && trackLengthMeters) {
    const onsets = valuesOf(fast, (item) => item.brakeOnset);
    if (!onsets.length) return null;
    const target = mean(onsets) - (1.5 / trackLengthMeters) * 100; // até 1,5 m antes do ponto das voltas rápidas
    const valid = samples.filter((item) => item.brakeOnset !== null);
    return { hit: valid.filter((item) => (item.brakeOnset as number) >= target).length, of: valid.length };
  }
  if (lever === "throttle-earlier") {
    const times = valuesOf(fast, (item) => item.throttleOnSeconds);
    if (!times.length) return null;
    const target = mean(times) + 0.05;
    const valid = samples.filter((item) => item.throttleOnSeconds !== null);
    return { hit: valid.filter((item) => (item.throttleOnSeconds as number) <= target).length, of: valid.length };
  }
  if (lever === "no-lift") return { hit: samples.filter((item) => !item.lifted).length, of: samples.length };
  return null;
}

/** Nome curto de uma curva para frase: "Curva 5" / nome verificado. */
export function sectionShortLabel(section: Pick<SelfSection, "corners">) {
  return section.corners.length === 1 ? cornerLabel(section.corners[0]) : sectionLabel(section.corners);
}
