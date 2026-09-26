import { buildLapSections, sectionLabel, cornerLabel, unwrapIntoWindow, wrapDistance, type CornerLink, type LapCorner, type LapSection } from "./corner-sequences";
import { interpolate, type ChannelKey, type Trace, type TracePoint } from "./telemetry-trace";

/**
 * Comparação da volta representativa contra a referência (redesign etapa 3, 25/09/2026).
 *
 * Mesma base de tempo do compareTraces antigo de components/ActiveWeekTelemetry.tsx: grade de 0,25%
 * da volta, tempo = integral de 1/velocidade normalizada pelo tempo real da sua volta. A diferença é
 * o recorte: em vez das 6 piores janelas fixas de 5%, TODOS os trechos de curva (lib/corner-sequences:
 * curvas coladas = uma sequência) com o tempo ganho/perdido de cada um e de cada curva dentro dela.
 *
 * Convenção de sinal: `lost` > 0 = você perde tempo para a referência naquele ponto/trecho.
 */
export type GridSample = { distance: number; ownSpeed: number; refSpeed: number; lostSoFar: number };

export type SectionMetrics = {
  /** metros; negativo = você freia antes da referência */
  brakeDeltaMeters: number | null;
  /** quem pisa no freio no trecho */
  brakeUse: "both" | "own" | "ref" | "none";
  /** km/h no ponto mais lento; negativo = você mais devagar */
  minSpeedDeltaKmh: number | null;
  /** curva (parte) onde está o seu ponto mais lento, para sequências */
  apexCorner: LapCorner | null;
  /** segundos; positivo = você volta ao acelerador depois da referência */
  throttleOnDelaySeconds: number | null;
  /** km/h no fim da janela; negativo = você sai mais devagar */
  exitSpeedDeltaKmh: number | null;
  /** pontos de % de acelerador médio no trecho; negativo = você usa menos */
  throttleAvgDeltaPct: number | null;
  /** pico de freio; positivo = você pisa mais forte */
  brakePeakDeltaPct: number | null;
  /** graus de volante no pico; positivo = você gira mais */
  steeringDeltaDeg: number | null;
  gearAtApex: { own: number; ref: number } | null;
  /** distância média entre os traçados no meio da curva (m) e o lado do SEU traçado em relação ao da
   * referência; o lado só vem preenchido quando é confiável (mesmo lado em 80% das amostras). */
  lineOffsetMeters: number | null;
  lineSide: "esquerda" | "direita" | null;
};

export type SectionPartResult = { corner: LapCorner; label: string; start: number; end: number; lostSeconds: number };

export type SectionResult = {
  id: string;
  label: string;
  isSequence: boolean;
  corners: LapCorner[];
  start: number;
  end: number;
  windowStart: number;
  windowEnd: number;
  lostSeconds: number;
  parts: SectionPartResult[];
  metrics: SectionMetrics;
  /** tempo perdido acumulado dentro da janela (distância desenrolada), para o hover do popup */
  lostSeries: { distance: number; lost: number }[];
};

export type LapComparison = {
  estimatedReferenceTime: number;
  /** tempo da sua volta - tempo estimado da referência (positivo = você mais lento) */
  estimatedGap: number;
  trackLengthMeters: number | null;
  grid: GridSample[];
  sections: SectionResult[];
  /** o que sobra fora dos trechos de curva (retas e transições) */
  straightsLostSeconds: number;
};

const GRID_STEP = 0.25;
const BRAKE_ON = 0.1;
const BRAKE_MIN_PEAK = 0.15;
const THROTTLE_ON = 0.5;
/** Duas curvas coladas só formam sequência se o carro NÃO volta a acelerar tudo (>= 95%) por pelo
 * menos isto entre os ápices delas: se volta, cada curva começa do zero e é analisada sozinha. */
const FULL_THROTTLE = 0.95;
export const FULL_THROTTLE_RUN_METERS = 50;

function hasFullThrottleRun(points: TracePoint[], from: number, to: number, runPct: number) {
  let runStart: number | null = null;
  for (const { point, d } of pointsInWindow(points, from, to)) {
    const full = (point.throttle ?? 0) >= FULL_THROTTLE && (point.brake ?? 0) < 0.05;
    if (full) { if (runStart === null) runStart = d; if (d - runStart >= runPct) return true; }
    else runStart = null;
  }
  return false;
}

/** Liga duas curvas quando pelo menos um dos dois (você ou a referência) não chega a acelerar tudo
 * entre os ápices: é aí que se sacrifica uma curva para sair melhor da outra. */
export function drivingLink(own: Trace, reference: Trace, trackLengthMeters: number | null): CornerLink {
  const runPct = trackLengthMeters ? (FULL_THROTTLE_RUN_METERS / trackLengthMeters) * 100 : 1.2;
  return (a, b) => {
    let from = a.distance, to = b.distance;
    if (to < from) to += 100;
    if (to - from <= 0) return true;
    return !(hasFullThrottleRun(own.points, from, to, runPct) && hasFullThrottleRun(reference.points, from, to, runPct));
  };
}

export function pointsInWindow(points: TracePoint[], start: number, end: number) {
  return points
    .map((point) => ({ point, d: unwrapIntoWindow(point.distance, start, end) }))
    .filter((item): item is { point: TracePoint; d: number } => item.d !== null)
    .sort((a, b) => a.d - b.d);
}

function valueAt(points: TracePoint[], distance: number, field: ChannelKey) {
  return interpolate(points, wrapDistance(distance), field);
}

/** Primeiro ponto (distância desenrolada) em que o canal cruza o limiar para cima, interpolado. */
function firstCrossing(items: { point: TracePoint; d: number }[], field: ChannelKey, threshold: number, from = -Infinity) {
  for (let i = 1; i < items.length; i += 1) {
    if (items[i].d < from) continue;
    const a = items[i - 1].point[field], b = items[i].point[field];
    if (a === null || b === null) continue;
    if (a < threshold && b >= threshold) {
      const ratio = (threshold - a) / Math.max(1e-9, b - a);
      return items[i - 1].d + (items[i].d - items[i - 1].d) * ratio;
    }
  }
  return null;
}

function maxOf(items: { point: TracePoint; d: number }[], field: ChannelKey, abs = false) {
  let best: number | null = null;
  for (const { point } of items) {
    const raw = point[field];
    if (raw === null || !Number.isFinite(raw)) continue;
    const value = abs ? Math.abs(raw) : raw;
    if (best === null || value > best) best = value;
  }
  return best;
}

function mean(items: { point: TracePoint; d: number }[], field: ChannelKey) {
  const values = items.map(({ point }) => point[field]).filter((value): value is number => value !== null && Number.isFinite(value));
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function minSpeed(items: { point: TracePoint; d: number }[]) {
  let best: { speed: number; d: number; gear: number | null } | null = null;
  for (const { point, d } of items) {
    if (point.speed === null || !Number.isFinite(point.speed) || point.speed <= 1) continue;
    if (!best || point.speed < best.speed) best = { speed: point.speed, d, gear: point.gear };
  }
  return best;
}

/** Deslocamento lateral (m) do traçado de referência em relação ao seu, positivo = referência à sua
 * ESQUERDA. Projeção local plana; a tangente é o seu próprio heading (produto vetorial u × r). */
export function lateralOffsetMeters(own: { lat: number; lon: number }, ownPrev: { lat: number; lon: number }, ownNext: { lat: number; lon: number }, ref: { lat: number; lon: number }) {
  const latRad = ((ownPrev.lat + ownNext.lat) / 2) * Math.PI / 180;
  const tx = (ownNext.lon - ownPrev.lon) * 111_320 * Math.cos(latRad);
  const ty = (ownNext.lat - ownPrev.lat) * 110_540;
  const length = Math.hypot(tx, ty);
  if (length <= 0) return null;
  const ux = tx / length, uy = ty / length;
  const rx = (ref.lon - own.lon) * 111_320 * Math.cos(latRad);
  const ry = (ref.lat - own.lat) * 110_540;
  return ux * ry - uy * rx;
}

function lineOffset(own: Trace, reference: Trace, start: number, end: number): { meters: number | null; side: "esquerda" | "direita" | null } {
  const offsets: number[] = [];
  const step = GRID_STEP;
  for (let d = start; d <= end; d += step) {
    const at = (trace: Trace, x: number) => {
      const lat = valueAt(trace.points, x, "lat"), lon = valueAt(trace.points, x, "lon");
      return lat === null || lon === null ? null : { lat, lon };
    };
    const o = at(own, d), p = at(own, d - step), n = at(own, d + step), r = at(reference, d);
    if (!o || !p || !n || !r) continue;
    const value = lateralOffsetMeters(o, p, n, r);
    if (value !== null && Number.isFinite(value) && Math.abs(value) < 30) offsets.push(value);
  }
  if (offsets.length < 5) return { meters: null, side: null };
  const average = offsets.reduce((sum, value) => sum + value, 0) / offsets.length;
  const sameSide = offsets.filter((value) => Math.sign(value) === Math.sign(average)).length / offsets.length;
  const meters = Math.abs(average);
  // referência à esquerda (positivo) = o SEU traçado passa mais à direita
  const side = meters >= 1.5 && sameSide >= 0.8 ? (average > 0 ? "direita" : "esquerda") : null;
  return { meters, side };
}

export function sectionMetrics(own: Trace, reference: Trace, section: LapSection, trackLengthMeters: number | null): SectionMetrics {
  const ownWindow = pointsInWindow(own.points, section.windowStart, section.windowEnd);
  const refWindow = pointsInWindow(reference.points, section.windowStart, section.windowEnd);
  const ownCorner = ownWindow.filter((item) => item.d >= section.start && item.d <= section.end);
  const refCorner = refWindow.filter((item) => item.d >= section.start && item.d <= section.end);
  const toMeters = (pct: number) => (trackLengthMeters ? pct / 100 * trackLengthMeters : null);

  const ownBrakes = (maxOf(ownWindow, "brake") ?? 0) >= BRAKE_MIN_PEAK;
  const refBrakes = (maxOf(refWindow, "brake") ?? 0) >= BRAKE_MIN_PEAK;
  const brakeUse = ownBrakes && refBrakes ? "both" : ownBrakes ? "own" : refBrakes ? "ref" : "none";
  let brakeDeltaMeters: number | null = null;
  if (brakeUse === "both") {
    const ownOnset = firstCrossing(ownWindow, "brake", BRAKE_ON);
    const refOnset = firstCrossing(refWindow, "brake", BRAKE_ON);
    if (ownOnset !== null && refOnset !== null) brakeDeltaMeters = toMeters(ownOnset - refOnset);
  }

  const ownMin = minSpeed(ownCorner.length ? ownCorner : ownWindow);
  const refMin = minSpeed(refCorner.length ? refCorner : refWindow);
  const minSpeedDeltaKmh = ownMin && refMin ? (ownMin.speed - refMin.speed) * 3.6 : null;
  const apexCorner = ownMin
    ? section.parts.find((part) => ownMin.d >= part.start && ownMin.d < part.end)?.corner ?? section.corners[0]
    : null;

  let throttleOnDelaySeconds: number | null = null;
  if (ownMin && refMin) {
    const ownLift = ownWindow.some((item) => (item.point.throttle ?? 1) < THROTTLE_ON);
    const refLift = refWindow.some((item) => (item.point.throttle ?? 1) < THROTTLE_ON);
    if (ownLift && refLift) {
      const ownOn = firstCrossing(ownWindow, "throttle", THROTTLE_ON, ownMin.d - 1);
      const refOn = firstCrossing(refWindow, "throttle", THROTTLE_ON, refMin.d - 1);
      const meters = ownOn !== null && refOn !== null ? toMeters(ownOn - refOn) : null;
      const speed = ownOn !== null ? valueAt(own.points, ownOn, "speed") : null;
      if (meters !== null && speed && speed > 1) throttleOnDelaySeconds = meters / speed;
    }
  }

  const ownExit = valueAt(own.points, section.windowEnd, "speed");
  const refExit = valueAt(reference.points, section.windowEnd, "speed");
  const exitSpeedDeltaKmh = ownExit !== null && refExit !== null ? (ownExit - refExit) * 3.6 : null;

  const ownThrottle = mean(ownWindow, "throttle"), refThrottle = mean(refWindow, "throttle");
  const throttleAvgDeltaPct = ownThrottle !== null && refThrottle !== null ? (ownThrottle - refThrottle) * 100 : null;
  const ownBrakePeak = maxOf(ownWindow, "brake"), refBrakePeak = maxOf(refWindow, "brake");
  const brakePeakDeltaPct = brakeUse === "both" && ownBrakePeak !== null && refBrakePeak !== null ? (ownBrakePeak - refBrakePeak) * 100 : null;
  const ownSteer = maxOf(ownCorner, "steering", true), refSteer = maxOf(refCorner, "steering", true);
  const steeringDeltaDeg = ownSteer !== null && refSteer !== null ? (ownSteer - refSteer) * 180 / Math.PI : null;
  const gearAtApex = ownMin?.gear != null && refMin?.gear != null ? { own: Math.round(ownMin.gear), ref: Math.round(refMin.gear) } : null;
  const line = lineOffset(own, reference, section.start, section.end);

  return {
    brakeDeltaMeters, brakeUse, minSpeedDeltaKmh, apexCorner, throttleOnDelaySeconds, exitSpeedDeltaKmh,
    throttleAvgDeltaPct, brakePeakDeltaPct, steeringDeltaDeg, gearAtApex,
    lineOffsetMeters: line.meters, lineSide: line.side,
  };
}

export function compareLaps(own: Trace, reference: Trace, ownLapTime: number, corners: LapCorner[]): LapComparison | null {
  const rows: { distance: number; ownSpeed: number; refSpeed: number }[] = [];
  if (own.points.length < 2 || reference.points.length < 2) return null;
  for (let index = 0; index <= 100 / GRID_STEP; index += 1) {
    const distance = index * GRID_STEP;
    const ownSpeed = interpolate(own.points, distance, "speed");
    const refSpeed = interpolate(reference.points, distance, "speed");
    if (ownSpeed && refSpeed && ownSpeed > 1 && refSpeed > 1) rows.push({ distance, ownSpeed, refSpeed });
  }
  if (rows.length < 100) return null;
  const ownIntegral = rows.reduce((sum, row) => sum + 1 / row.ownSpeed, 0);
  const refIntegral = rows.reduce((sum, row) => sum + 1 / row.refSpeed, 0);
  const scale = ownLapTime / ownIntegral;
  const estimatedReferenceTime = refIntegral * scale;
  const stepLost = (row: { ownSpeed: number; refSpeed: number }) => (1 / row.ownSpeed - 1 / row.refSpeed) * scale;

  let running = 0;
  const grid: GridSample[] = rows.map((row) => {
    running += stepLost(row);
    return { ...row, lostSoFar: running };
  });

  const trackLengthMeters = own.trackLengthMeters ?? reference.trackLengthMeters;
  const lostBetween = (start: number, end: number) => rows.reduce((sum, row) => (unwrapIntoWindow(row.distance, start, end) !== null ? sum + stepLost(row) : sum), 0);

  const sections: SectionResult[] = buildLapSections(corners, trackLengthMeters, drivingLink(own, reference, trackLengthMeters)).map((section) => {
    const inWindow = rows
      .map((row) => ({ row, d: unwrapIntoWindow(row.distance, section.windowStart, section.windowEnd) }))
      .filter((item): item is { row: typeof rows[number]; d: number } => item.d !== null)
      .sort((a, b) => a.d - b.d);
    let cumulative = 0;
    const lostSeries = inWindow.map(({ row, d }) => { cumulative += stepLost(row); return { distance: d, lost: cumulative }; });
    const parts = section.parts.map((part) => ({ corner: part.corner, label: cornerLabel(part.corner), start: part.start, end: part.end, lostSeconds: lostBetween(part.start, part.end) }));
    return {
      id: section.id,
      label: sectionLabel(section.corners),
      isSequence: section.corners.length > 1,
      corners: section.corners,
      start: section.start,
      end: section.end,
      windowStart: section.windowStart,
      windowEnd: section.windowEnd,
      lostSeconds: cumulative,
      parts,
      metrics: sectionMetrics(own, reference, section, trackLengthMeters),
      lostSeries,
    };
  });

  const estimatedGap = ownLapTime - estimatedReferenceTime;
  const straightsLostSeconds = estimatedGap - sections.reduce((sum, section) => sum + section.lostSeconds, 0);
  return { estimatedReferenceTime, estimatedGap, trackLengthMeters, grid, sections, straightsLostSeconds };
}

/** Tempo perdido acumulado na volta até uma distância (interpolado na grade). */
export function lostAt(grid: GridSample[], distance: number) {
  if (!grid.length) return 0;
  if (distance <= grid[0].distance) return grid[0].lostSoFar;
  for (let i = 1; i < grid.length; i += 1) {
    if (grid[i].distance >= distance) {
      const a = grid[i - 1], b = grid[i];
      const ratio = (distance - a.distance) / Math.max(1e-9, b.distance - a.distance);
      return a.lostSoFar + (b.lostSoFar - a.lostSoFar) * ratio;
    }
  }
  return grid[grid.length - 1].lostSoFar;
}

/** Tempo perdido acumulado dentro de um trecho até a distância desenrolada `distance`. */
export function lostInSectionAt(series: { distance: number; lost: number }[], distance: number) {
  if (!series.length || distance <= series[0].distance) return 0;
  const last = series[series.length - 1];
  if (distance >= last.distance) return last.lost;
  for (let i = 1; i < series.length; i += 1) {
    if (series[i].distance >= distance) {
      const a = series[i - 1], b = series[i];
      const ratio = (distance - a.distance) / Math.max(1e-9, b.distance - a.distance);
      return a.lost + (b.lost - a.lost) * ratio;
    }
  }
  return last.lost;
}
