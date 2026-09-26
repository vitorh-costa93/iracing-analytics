import { detectCorners as detectCornersFromLatAccel, detectCornersFromGps } from "./corner-detection";
import { lookupCornerNames } from "./track-corners";
import type { LapCorner } from "./corner-sequences";
import type { TracePoint } from "./telemetry-trace";

/** Detecção de curvas de uma volta, igual em todo o Telemetry Lab (extraída de
 * components/ActiveWeekTelemetry.tsx na etapa 4 para o Race Debrief e a Comparação de carros usarem a
 * mesma): GPS primeiro, aceleração lateral só como reserva; nomes verificados (lib/track-corners.ts)
 * só quando a contagem bate, senão números. */
export function detectLapCorners(points: TracePoint[], trackName: string, trackVariant: string): LapCorner[] {
  const gpsDetected = detectCornersFromGps(points.map((point) => ({ distance: point.distance, lat: point.lat ?? null, lon: point.lon ?? null })));
  const raw = gpsDetected.length >= 3 ? gpsDetected : detectCornersFromLatAccel(points.map((point) => ({ distance: point.distance, lateralAccel: point.latAccel })));
  const names = lookupCornerNames(trackName, trackVariant, raw.length);
  return raw.map((corner, index) => ({ number: corner.number, distance: corner.distance, name: names?.[index] ?? null, startDistance: corner.startDistance, endDistance: corner.endDistance }));
}
