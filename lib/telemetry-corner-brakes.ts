import { detectCornersFromGps } from "@/lib/corner-detection";

/** 08/09/2026: "fala que estou mais próximo da volta mais rápida, mas por quê?" -- o gap-pra-melhor-
 * volta em telemetry-input-profile.ts é um número sem causa. Isso quebra o gap por curva: reusa a
 * mesma detecção de curva (por heading GPS) já usada no Telemetry Lab, e pra cada curva encontra o
 * ponto de frenagem -- a % da volta onde o freio cruza um limiar calibrado pela própria volta (evita
 * um número fixo, já que a escala do canal de freio varia por fonte/carro). Curvas sem frenagem
 * (flat-out) voltam com brakePointPct null -- isso também é informação, não um erro.
 */

type Row = { distance: number; lat: number | null; lon: number | null; brake: number | null };
export type CornerBrakePoint = { corner: number; peakDistance: number; startDistance: number; endDistance: number; brakePointPct: number | null };

const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");
const pick = (head: string[], names: string[]) => head.findIndex((h) => names.some((n) => h.includes(n)));
const num = (v: string) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

// % da volta buscado ANTES do início detectado da curva pelo ponto onde o piloto começou a frear --
// a frenagem real quase sempre começa antes da curva "virar" fisicamente (que é o que a detecção por
// heading mede). 10% cobre até retas médias sem invadir a curva anterior na maioria das pistas.
const LOOKBACK_PCT = 10;
// Fração do pico de freio DESTA volta que conta como "frenagem" -- autocalibrado por volta em vez de
// um valor fixo, mesmo princípio já usado em corner-detection.ts pro limiar de aceleração lateral.
const BRAKE_THRESHOLD_RATIO = 0.15;
const MIN_ROWS = 50;

export function cornerBrakePoints(csv: string): CornerBrakePoint[] | null {
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/).filter(Boolean);
  if (lines.length < MIN_ROWS) { console.error("[corner-brakes] DEBUG too few lines", lines.length); return null; }
  const split = (line: string) => line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
  const head = split(lines[0]).map(norm);
  const di = pick(head, ["lapdistpct", "lapdist"]), lai = pick(head, ["lat"]), loi = pick(head, ["lon"]), bi = pick(head, ["brake"]);
  if (di < 0 || lai < 0 || loi < 0 || bi < 0) { console.error("[corner-brakes] DEBUG missing column", { di, lai, loi, bi, head }); return null; }

  const rows: Row[] = lines.slice(1).map((line) => {
    const cols = split(line);
    return { distance: num(cols[di] ?? "") ?? NaN, lat: num(cols[lai] ?? ""), lon: num(cols[loi] ?? ""), brake: num(cols[bi] ?? "") };
  }).filter((row) => Number.isFinite(row.distance));
  if (rows.length < MIN_ROWS) { console.error("[corner-brakes] DEBUG too few valid rows", rows.length, "sample", rows.slice(0,3)); return null; }

  const corners = detectCornersFromGps(rows.map((row) => ({ distance: row.distance, lat: row.lat, lon: row.lon })));
  if (!corners.length) { console.error("[corner-brakes] DEBUG no corners detected", "rows", rows.length, "sample lat/lon", rows.slice(0,3).map(r=>[r.lat,r.lon])); return null; }
  console.error("[corner-brakes] DEBUG ok", corners.length, "corners");

  const maxBrake = Math.max(0, ...rows.map((row) => row.brake ?? 0));
  const sorted = [...rows].sort((a, b) => a.distance - b.distance);
  if (maxBrake <= 0) return corners.map((corner) => ({ corner: corner.number, peakDistance: corner.distance, startDistance: corner.startDistance, endDistance: corner.endDistance, brakePointPct: null }));

  const threshold = maxBrake * BRAKE_THRESHOLD_RATIO;
  const nearestIndex = (distance: number) => {
    const target = ((distance % 100) + 100) % 100;
    let best = 0, bestDiff = Infinity;
    for (let i = 0; i < sorted.length; i++) {
      const diff = Math.abs(sorted[i].distance - target);
      if (diff < bestDiff) { bestDiff = diff; best = i; }
    }
    return best;
  };

  return corners.map((corner) => {
    const startIdx = nearestIndex(corner.startDistance - LOOKBACK_PCT), endIdx = nearestIndex(corner.startDistance);
    const window = startIdx <= endIdx ? sorted.slice(startIdx, endIdx + 1) : [...sorted.slice(startIdx), ...sorted.slice(0, endIdx + 1)];
    const braking = window.find((row) => (row.brake ?? 0) >= threshold);
    return {
      corner: corner.number,
      peakDistance: corner.distance,
      startDistance: corner.startDistance,
      endDistance: corner.endDistance,
      brakePointPct: braking ? Number((((braking.distance % 100) + 100) % 100).toFixed(1)) : null,
    };
  });
}
