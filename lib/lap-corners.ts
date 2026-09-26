import { detectCorners as detectCornersFromLatAccel, detectCornersFromGps } from "./corner-detection";
import { lookupCornerNames } from "./track-corners";
import type { LapCorner } from "./corner-sequences";
import type { TracePoint } from "./telemetry-trace";

/** Detecção de curvas de uma volta, igual em todo o Telemetry Lab (extraída de
 * components/ActiveWeekTelemetry.tsx na etapa 4 para o Race Debrief e a Comparação de carros usarem a
 * mesma): GPS primeiro, aceleração lateral só como reserva; nomes verificados (lib/track-corners.ts)
 * só quando a contagem bate, senão números. */
/** Uma "curva" acima disto (em metros) não é uma curva: é um trecho contínuo em que a detecção por
 * heading não encontrou vale entre as curvas. Só nesse caso extremo a velocidade entra como apoio. */
export const LONG_CORNER_METERS = 400;
/** Ponto de velocidade mínima de verdade: ~15 km/h mais lento que o entorno, dos dois lados. */
const ANCHOR_PROMINENCE_MS = 4;
const ANCHOR_WINDOW_METERS = 300;
const ANCHOR_MIN_SEPARATION_METERS = 150;

type SpeedPoint = { distance: number; speed: number | null };
type Piece = { start: number; end: number; peak: number };

/** Mínimos locais de velocidade (distância em % da volta): o carro só desacelera de verdade onde há
 * curva, então servem de apoio para separar curvas que a detecção por heading juntou. */
export function speedAnchors(points: SpeedPoint[], lapMeters: number): number[] {
  const samples = points.filter((point): point is { distance: number; speed: number } => point.speed !== null).sort((a, b) => a.distance - b.distance);
  if (samples.length < 20 || lapMeters <= 0) return [];
  const windowPct = (ANCHOR_WINDOW_METERS / lapMeters) * 100;
  const separationPct = (ANCHOR_MIN_SEPARATION_METERS / lapMeters) * 100;
  const around = (center: number, from: number, to: number) => {
    let max = -Infinity; let min = Infinity;
    for (const sample of samples) {
      const delta = sample.distance - center;
      if (delta >= from && delta <= to) { max = Math.max(max, sample.speed); min = Math.min(min, sample.speed); }
    }
    return { max, min };
  };
  const found: Array<{ distance: number; speed: number }> = [];
  for (const sample of samples) {
    const left = around(sample.distance, -windowPct, 0);
    const right = around(sample.distance, 0, windowPct);
    const near = around(sample.distance, -windowPct / 3, windowPct / 3);
    if (sample.speed > near.min) continue;
    if (left.max - sample.speed < ANCHOR_PROMINENCE_MS || right.max - sample.speed < ANCHOR_PROMINENCE_MS) continue;
    found.push({ distance: sample.distance, speed: sample.speed });
  }
  // Mínimos vizinhos (o mesmo vale amostrado várias vezes) viram um só, o mais lento.
  const anchors: Array<{ distance: number; speed: number }> = [];
  for (const item of found) {
    const last = anchors[anchors.length - 1];
    if (last && item.distance - last.distance < separationPct) { if (item.speed < last.speed) anchors[anchors.length - 1] = item; }
    else anchors.push(item);
  }
  return anchors.map((item) => item.distance);
}

/** Divide cada "curva" longa demais nos pontos de velocidade mínima que ela contém (só se tiver dois ou
 * mais). As fronteiras ficam no meio entre dois pontos consecutivos e cada pedaço ganha o seu ápice.
 * Curvas normais passam intactas, então a numeração das pistas já calibradas não muda. */
export function splitLongCorners<T extends { startDistance: number; endDistance: number; distance: number }>(corners: T[], anchors: number[], lapMeters: number, make: (source: T, piece: Piece) => T): T[] {
  if (!anchors.length || lapMeters <= 0) return corners;
  const out: T[] = [];
  for (const corner of corners) {
    const wraps = corner.endDistance < corner.startDistance;
    const start = corner.startDistance;
    const end = wraps ? corner.endDistance + 100 : corner.endDistance;
    const lengthMeters = ((end - start) / 100) * lapMeters;
    const inside = anchors.map((anchor) => (wraps && anchor < start ? anchor + 100 : anchor)).filter((anchor) => anchor >= start && anchor <= end).sort((a, b) => a - b);
    if (lengthMeters <= LONG_CORNER_METERS || inside.length < 2) { out.push(corner); continue; }
    const bounds = [start, ...inside.slice(1).map((anchor, index) => (inside[index] + anchor) / 2), end];
    inside.forEach((anchor, index) => out.push(make(corner, { start: bounds[index] % 100, end: bounds[index + 1] % 100 === 0 ? 100 : bounds[index + 1] % 100, peak: anchor % 100 })));
  }
  return out;
}

export function detectLapCorners(points: TracePoint[], trackName: string, trackVariant: string): LapCorner[] {
  const gpsDetected = detectCornersFromGps(points.map((point) => ({ distance: point.distance, lat: point.lat ?? null, lon: point.lon ?? null })));
  const raw = gpsDetected.length >= 3 ? gpsDetected : detectCornersFromLatAccel(points.map((point) => ({ distance: point.distance, lateralAccel: point.latAccel })));
  const lapMeters = estimateLapMeters(points);
  const anchors = speedAnchors(points.map((point) => ({ distance: point.distance, speed: point.speed })), lapMeters);
  const split = splitLongCorners(raw, anchors, lapMeters, (source, piece) => ({ ...source, startDistance: Number(piece.start.toFixed(1)), endDistance: Number(piece.end.toFixed(1)), distance: Number(piece.peak.toFixed(1)) }));
  const names = lookupCornerNames(trackName, trackVariant, split.length);
  return split.map((corner, index) => ({ number: index + 1, distance: corner.distance, name: names?.[index] ?? null, startDistance: corner.startDistance, endDistance: corner.endDistance }));
}

/** Comprimento da volta em metros a partir do traço (o CSV já traz a pista; sem isso, ~5 km). */
function estimateLapMeters(points: TracePoint[]): number {
  const lat = points.map((point) => point.lat).filter((value): value is number => value !== null && value !== undefined);
  const lon = points.map((point) => point.lon).filter((value): value is number => value !== null && value !== undefined);
  if (lat.length < 10 || lon.length < 10) return 5000;
  const ordered = [...points].filter((point) => point.lat !== null && point.lon !== null).sort((a, b) => a.distance - b.distance);
  const scale = Math.cos((lat.reduce((a, b) => a + b, 0) / lat.length) * Math.PI / 180);
  let meters = 0;
  for (let i = 1; i < ordered.length; i += 1) {
    const dLat = ((ordered[i].lat as number) - (ordered[i - 1].lat as number)) * 111320;
    const dLon = ((ordered[i].lon as number) - (ordered[i - 1].lon as number)) * 111320 * scale;
    meters += Math.hypot(dLat, dLon);
  }
  return meters > 500 ? meters : 5000;
}
