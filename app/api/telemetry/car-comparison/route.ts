import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { detectCornersFromGps } from "@/lib/corner-detection";
import { lookupCornerNames } from "@/lib/track-corners";

// Same class of route as app/api/telemetry/debrief/route.ts: up to a handful of cars, each needing
// its own telemetry downloads/decodes, well past Vercel's platform-default timeout.
export const maxDuration = 300;

const GARAGE61_BASE = "https://garage61.net/api/v1";
const MAX_CARS = 6; // bounds cost if a driver has tested many cars at one track; covers every real case seen so far (2-4)
const TELEMETRY_SAMPLE_LAPS = 5; // per car, for input-consistency and track-usage -- same pool size logic as debrief's MAX_LAPS
const CANDIDATE_POOL_LAPS = 10; // wider than TELEMETRY_SAMPLE_LAPS -- see the GPS-coverage check below for why
const MIN_LAP_COVERAGE_PCT = 85; // a genuine full lap's telemetry spans nearly the whole 0-100% lap distance
const TIME_POOL_LAPS = 10; // per car, for lap-time consistency -- mirrors debrief's MAX_LAPS

type LapRow = {
  id: string; car_id: number | null; track_id: number | null; lap_time: number | null; clean: boolean | null;
  off_track: boolean | null; pit_lane: boolean | null; pit_in: boolean | null; pit_out: boolean | null;
  incomplete: boolean | null; missing: boolean | null; telemetry_path: string | null;
  session_id?: string | null;
  sessions?: { season_id: string | null; season_name: string | null; started_at: string | null } | null;
};

type ChannelKey = "throttle" | "brake" | "steering" | "lat" | "lon" | "speed" | "gear";
type TracePoint = { distance: number } & Partial<Record<ChannelKey, number>>;

function normalizedHeader(value: string) { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }

function parseCsvLine(line: string, delimiter: string) {
  const cells: string[] = []; let cell = ""; let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') { if (quoted && line[index + 1] === '"') { cell += '"'; index += 1; } else quoted = !quoted; }
    else if (char === delimiter && !quoted) { cells.push(cell); cell = ""; }
    else cell += char;
  }
  cells.push(cell);
  return cells;
}

// Same parsing approach as app/api/telemetry/debrief/route.ts's parseLapCsv (kept local per this
// codebase's existing convention of each telemetry route carrying its own small copy rather than a
// shared lib -- see app/api/telemetry/sectors/route.ts's own mean/stddev/median for the same pattern).
function parseLapCsv(csv: string): TracePoint[] {
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const delimiter = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const headers = parseCsvLine(lines[0], delimiter).map(normalizedHeader);
  const find = (...aliases: string[]) => headers.findIndex((header) => aliases.includes(header));
  const distanceIndex = find("lapdistpct", "lapdistancepct", "distancepct", "lapdist", "distance");
  if (distanceIndex < 0) return [];
  const indexes: Record<ChannelKey, number> = {
    throttle: find("throttle", "throttleraw", "throttleposition", "throttleinput"),
    brake: find("brake", "brakeraw", "brakepressure", "brakeinput"),
    steering: find("steeringwheelangle", "steeringangle"),
    lat: find("lat", "latitude"), lon: find("lon", "longitude"),
    speed: find("speed", "speedms", "speedkph", "carspeed"),
    gear: find("gear"),
  };
  const raw = lines.slice(1).map((line) => parseCsvLine(line, delimiter));
  const points = raw.map((cells) => {
    const point: TracePoint = { distance: Number(cells[distanceIndex]) };
    for (const key of Object.keys(indexes) as ChannelKey[]) {
      const index = indexes[key];
      const value = index >= 0 ? Number(cells[index]) : NaN;
      if (Number.isFinite(value)) point[key] = value;
    }
    return point;
  }).filter((point) => Number.isFinite(point.distance)).sort((a, b) => a.distance - b.distance);
  if (!points.length) return [];
  const maxDistance = Math.max(...points.map((point) => point.distance));
  if (maxDistance > 0 && maxDistance <= 1.01) points.forEach((point) => { point.distance *= 100; });
  return points;
}

function interpolate(points: TracePoint[], distance: number, field: ChannelKey): number | null {
  let previous = points[0];
  for (const point of points) {
    if (point.distance >= distance) {
      const left = previous[field], right = point[field];
      if (left === undefined || right === undefined) return null;
      const span = point.distance - previous.distance;
      const ratio = span > 0 ? (distance - previous.distance) / span : 0;
      return left + (right - left) * ratio;
    }
    previous = point;
  }
  const value = previous[field];
  return value === undefined ? null : value;
}

function mean(values: number[]) { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function stddev(values: number[], avg: number) { return Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length); }
function consistencyRatioLabel(ratio: number) {
  return ratio < 0.4 ? "muito consistente" : ratio < 1 ? "consistente" : ratio < 2 ? "variável" : "muito inconsistente";
}
function formatLapTime(value: number) { const minutes = Math.floor(value / 60), seconds = value - minutes * 60; return `${minutes}:${seconds.toFixed(3).padStart(6, "0")}`; }
function median(values: number[]) { const sorted = [...values].sort((a, b) => a - b); const mid = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2; }

/** "Limpar as sujeiras" (29/08/2026): a lap can be Garage61-"clean" (no off-track flag) and still be
 * a spin/save/reconnect that cost several seconds without leaving the racing surface -- the `clean`
 * flag alone doesn't catch that, and one such lap can single-handedly wreck a car's consistency
 * stddev when its own valid-lap pool is small. Same median+MAD robust z-score debrief.ts already uses
 * to drop likely-overtake FAST outliers (findOutlierLaps there), mirrored here for the opposite
 * (SLOW) tail -- this is about excluding a bad lap from consistency math, not about picking the best
 * lap, which the plain minimum already handles fine on its own. */
function trimSlowOutliers(times: number[], zThreshold = 2.5) {
  if (times.length < 5) return times;
  const med = median(times);
  const mad = median(times.map((value) => Math.abs(value - med))) || 0.001;
  const scaled = mad * 1.4826;
  return times.filter((value) => (value - med) / scaled < zThreshold);
}

const BINS = Array.from({ length: 21 }, (_, index) => index * 5); // 0,5,...,100 -- coarser than debrief's own (this only needs a per-car summary score, not a plottable curve)
const CHANNELS: ("throttle" | "brake" | "steering")[] = ["throttle", "brake", "steering"];
const CHANNEL_LABEL: Record<string, string> = { throttle: "Acelerador", brake: "Freio", steering: "Volante" };
const CHANNEL_SCALE: Record<string, number> = { throttle: 1, brake: 1, steering: 0.15 };

/** Per-channel input-consistency scores for a car (mean, over BINS, of stddev/scale -- same
 * normalize-then-average approach as debrief's channelStats), PLUS the combined mean of those --
 * the per-channel breakdown is what lets the UI reuse Meu Debrief's own "CONSISTÊNCIA POR CANAL" bar
 * style here (29/08/2026: "a parte de consistência ser igual a que temos em Meu Debrief") instead of
 * a single opaque number. */
function inputConsistencyScore(traces: TracePoint[][]) {
  if (traces.length < 3) return null;
  const channels = CHANNELS.map((channel) => {
    const binScores = BINS.map((distance) => {
      const values = traces.map((points) => interpolate(points, distance, channel)).filter((value): value is number => value !== null);
      if (values.length < 3) return null;
      const avg = mean(values);
      return stddev(values, avg) / CHANNEL_SCALE[channel];
    }).filter((value): value is number => value !== null);
    return binScores.length ? { channel: channel as string, name: CHANNEL_LABEL[channel], score: Number(mean(binScores).toFixed(2)) } : null;
  }).filter((item): item is { channel: string; name: string; score: number } => item !== null);
  if (!channels.length) return null;
  const overallScore = mean(channels.map((item) => item.score));
  return {
    overall: { score: Number(overallScore.toFixed(2)), label: consistencyRatioLabel(overallScore) },
    channels: channels.map((item) => ({ ...item, label: consistencyRatioLabel(item.score) })),
  };
}

/** Same technique as inputConsistencyScore, restricted to one corner's own distance window instead
 * of the whole lap's BINS -- lets the per-corner deep-dive show "is this car more consistent than
 * that one HERE" (29/08/2026: "a parte da consistência seria interessante que fosse por curva ou
 * por setor") using the same multi-lap sample already downloaded for the whole-lap score, not just
 * the single fastest lap's shape. */
function cornerConsistencyScore(traces: TracePoint[][], start: number, end: number) {
  if (traces.length < 3) return null;
  const sampleDistances = Array.from({ length: 6 }, (_, index) => start + (index / 5) * (end - start));
  const channelScores = CHANNELS.map((channel) => {
    const pointScores = sampleDistances.map((distance) => {
      const values = traces.map((points) => interpolate(points, distance, channel)).filter((value): value is number => value !== null);
      if (values.length < 3) return null;
      const avg = mean(values);
      return stddev(values, avg) / CHANNEL_SCALE[channel];
    }).filter((value): value is number => value !== null);
    return pointScores.length ? mean(pointScores) : null;
  }).filter((value): value is number => value !== null);
  if (!channelScores.length) return null;
  const score = mean(channelScores);
  return { score: Number(score.toFixed(2)), label: consistencyRatioLabel(score) };
}

/** Same width-usage metric as trackWidthUsage (below), scoped to one corner window instead of the
 * whole lap -- feeds the per-corner narrative (29/08/2026: "incorporar [track usage] dentro da
 * análise do deep-dive por curva... 'com um uso melhor da pista'"), which is now where this
 * information actually lives instead of a separate flat section. Declared up here since it needs
 * distanceToEdgeMeters/BoundaryEdge, defined further down -- hoisted like every other function
 * declaration in this file. */
function cornerTrackUsage(points: TracePoint[], boundary: BoundaryEdge[] | null, start: number, end: number) {
  if (!boundary) return null;
  const samples: number[] = [];
  for (let distance = start; distance <= end; distance += 0.75) {
    const lat = interpolate(points, distance, "lat"), lon = interpolate(points, distance, "lon");
    if (lat === null || lon === null) continue;
    let bestDist = Infinity, bestWidth = 0;
    for (const edge of boundary) {
      const dist = distanceToEdgeMeters(lat, lon, edge);
      if (dist < bestDist) { bestDist = dist; bestWidth = edge.width; }
    }
    if (bestWidth > 0) samples.push(bestDist / (bestWidth / 2));
  }
  return samples.length ? Number((mean(samples) * 100).toFixed(1)) : null;
}

/** "Quero que ali seja de fato um engenheiro me aconselhando, enxergar os white spaces que eu não
 * estou vendo" (29/08/2026) -- the fastest car by lap time isn't necessarily the one worth racing:
 * this surfaces tensions the driver wouldn't spot from the ranking bar alone (a slower car that's
 * actually more consistent, wins more real corners, or lets him use more of the track), the same way
 * a race engineer would flag them, not just restate the numbers already on screen. Deliberately picks
 * at most a few of these (one per axis) rather than dumping every metric as a sentence. */
type NarrativeCar = {
  carId: number; carName: string; bestLapSeconds: number;
  lapTimeConsistency: { stddev: number; label: string } | null;
  inputConsistency: { overall: { score: number; label: string }; channels: { channel: string; name: string; score: number; label: string }[] } | null;
  trackUsage: { avgPct: number; maxPct: number } | null;
};
type NarrativeSector = { name: string | null; cornerNumber: number; winnerCarId: number | null; times: { carId: number; seconds: number; deltaSeconds: number }[] };

// 01/09/2026: "esse insight aqui é bobeira, eu fui extremamente mais rápido de McLaren do que com os
// outros carros, o insight deveria ser elogiando minha performance... o contra-ponto [...] se aplicaria
// se a diferença fosse mínima. Uma diferença tão grande como essa nem vale a pena trocar de carro" --
// 0.6% of the fastest lap (e.g. ~0.6s in a 100s lap) is the line between "close enough that a
// consistency/track-usage tradeoff in another car is worth mentioning" and "so far ahead that framing
// it as a tradeoff is nonsense" -- picked because it's roughly the gap that shows up between genuinely
// competitive cars in this driver's own data, well under the multi-second McLaren gap that triggered
// this fix.
const LARGE_GAP_RATIO = 0.006;

function buildCarComparisonNarrative(cars: NarrativeCar[], sectors: NarrativeSector[]): string | null {
  if (cars.length < 2) return null;
  const fastest = cars[0]; // cars[] is already sorted by bestLapSeconds ascending
  const second = cars[1];
  const gapSeconds = second.bestLapSeconds - fastest.bestLapSeconds;
  const gapRatio = fastest.bestLapSeconds > 0 ? gapSeconds / fastest.bestLapSeconds : 0;

  if (gapRatio >= LARGE_GAP_RATIO) return buildDominantCarNarrative(fastest, second, gapSeconds, sectors);

  const parts: string[] = [];

  const withConsistency = cars.filter((car) => car.lapTimeConsistency);
  if (withConsistency.length >= 2) {
    const mostConsistent = withConsistency.reduce((best, car) => car.lapTimeConsistency!.stddev < best.lapTimeConsistency!.stddev ? car : best);
    if (mostConsistent.carId !== fastest.carId) {
      parts.push(`Apesar do ${fastest.carName} ter feito a volta mais rápida, você é mais consistente com o ${mostConsistent.carName} (desvio padrão de ${mostConsistent.lapTimeConsistency!.stddev.toFixed(3)}s contra ${fastest.lapTimeConsistency ? fastest.lapTimeConsistency.stddev.toFixed(3) : "—"}s do ${fastest.carName}) — numa corrida longa isso pode valer mais que o décimo de vantagem na volta rápida.`);
    }
  }

  if (sectors.length >= 3) {
    const winCounts = new Map<number, number>();
    for (const sector of sectors) {
      if (sector.winnerCarId !== null) winCounts.set(sector.winnerCarId, (winCounts.get(sector.winnerCarId) ?? 0) + 1);
    }
    const sortedWins = [...winCounts.entries()].sort((a, b) => b[1] - a[1]);
    if (sortedWins.length >= 2 && sortedWins[0][0] !== fastest.carId) {
      const winnerCar = cars.find((car) => car.carId === sortedWins[0][0]);
      if (winnerCar) parts.push(`Curva a curva, quem mais vence é o ${winnerCar.carName} (${sortedWins[0][1]} de ${sectors.length} curvas), mesmo sem ter a volta mais rápida — o ${fastest.carName} deve estar recuperando essa diferença em outro trecho específico, vale olhar o deep-dive abaixo pra achar onde.`);
    }
  }

  const channelNames = new Set<string>();
  for (const car of cars) if (car.inputConsistency) for (const channel of car.inputConsistency.channels) channelNames.add(channel.channel);
  for (const channelKey of channelNames) {
    const withChannel = cars.filter((car) => car.inputConsistency?.channels.some((channel) => channel.channel === channelKey));
    if (withChannel.length < 2) continue;
    const best = withChannel.reduce((bestCar, car) => {
      const score = car.inputConsistency!.channels.find((channel) => channel.channel === channelKey)!.score;
      const bestScore = bestCar.inputConsistency!.channels.find((channel) => channel.channel === channelKey)!.score;
      return score < bestScore ? car : bestCar;
    });
    if (best.carId !== fastest.carId) {
      const label = best.inputConsistency!.channels.find((channel) => channel.channel === channelKey)!.name;
      parts.push(`No ${label.toLowerCase()}, você também é mais consistente no ${best.carName} do que no ${fastest.carName}.`);
      break; // one channel insight is enough here -- the per-car chips below already break all of them down
    }
  }

  const withUsage = cars.filter((car) => car.trackUsage);
  if (withUsage.length >= 2) {
    const bestUsage = withUsage.reduce((bestCar, car) => car.trackUsage!.avgPct > bestCar.trackUsage!.avgPct ? car : bestCar);
    if (bestUsage.carId !== fastest.carId) {
      parts.push(`Você também usa mais da largura da pista no ${bestUsage.carName} (${bestUsage.trackUsage!.avgPct.toFixed(0)}% em média) do que no ${fastest.carName} — talvez esse carro te dê mais confiança pra explorar a pista inteira.`);
    }
  }

  if (!parts.length) return `O ${fastest.carName} vem na frente em praticamente tudo aqui — mais rápido, mais consistente e sem sinal claro de que outro carro te atende melhor nessa pista.`;
  return parts.join(" ");
}

/** The "so far ahead it's not a tradeoff" narrative: instead of contrasting the fastest car against a
 * more-consistent-but-slower one, explain WHERE (which corners) and WHY (which input) the gap comes
 * from, the way a race engineer would when a driver is simply on a different level with one car. */
function buildDominantCarNarrative(fastest: NarrativeCar, second: NarrativeCar, gapSeconds: number, sectors: NarrativeSector[]): string {
  const parts: string[] = [
    `Você é claramente mais rápido de ${fastest.carName} — ${gapSeconds.toFixed(2)}s por volta à frente do ${second.carName}, uma diferença grande demais para valer a pena trocar de carro aqui.`,
  ];

  // Which corners carry the most of that gap: for each sector, how much time the fastest car saves
  // over the NEXT-best other car there specifically (not just "won the corner"), so a corner where
  // fastest barely edges someone out doesn't outrank one where it's clearly dominant.
  const cornerGaps = sectors.map((sector) => {
    const fastestTime = sector.times.find((time) => time.carId === fastest.carId);
    const others = sector.times.filter((time) => time.carId !== fastest.carId);
    if (!fastestTime || !others.length) return null;
    const nextBest = others.reduce((best, time) => (time.seconds < best.seconds ? time : best));
    return { name: sector.name ?? `Curva ${sector.cornerNumber}`, gain: nextBest.seconds - fastestTime.seconds };
  }).filter((item): item is { name: string; gain: number } => item !== null && item.gain > 0.02)
    .sort((a, b) => b.gain - a.gain)
    .slice(0, 3);
  if (cornerGaps.length) {
    const cornerText = cornerGaps.map((item) => `${item.name} (+${item.gain.toFixed(2)}s)`).join(", ");
    parts.push(`Boa parte dessa vantagem sai de curvas específicas: ${cornerText} — vale olhar o deep-dive dessas curvas abaixo pra ver exatamente o que você faz diferente ali.`);
  }

  // Which input the fastest car is most consistent in, relative to the next-best car in that same
  // channel -- the "why": a steadier brake/throttle/steering trace usually IS the mechanism behind a
  // gap this size, not luck or a faster car alone.
  if (fastest.inputConsistency) {
    const channelEdges = fastest.inputConsistency.channels.map((channel) => {
      const secondScore = second.inputConsistency?.channels.find((other) => other.channel === channel.channel)?.score;
      return secondScore === undefined ? null : { name: channel.name, edge: secondScore - channel.score };
    }).filter((item): item is { name: string; edge: number } => item !== null && item.edge > 0)
      .sort((a, b) => b.edge - a.edge);
    if (channelEdges.length) {
      parts.push(`Isso combina com uma consistência bem maior no ${channelEdges[0].name.toLowerCase()} com o ${fastest.carName} do que com o ${second.carName} — provavelmente a maior parte de onde vem essa vantagem.`);
    }
  }

  return parts.join(" ");
}

const METERS_PER_DEGREE_LAT = 110_540;

type BoundaryEdge = { lat1: number; lon1: number; lat2: number; lon2: number; width: number };
let boundaryCache: Record<string, { trackId: number; segments: { width: number; pts: [number, number][] }[] }> | null = null;

/** Reads the same public/track-boundaries.json the client-side map uses (see lib/track-boundaries.ts
 * for provenance/regeneration notes) directly off disk -- this runs server-side, so it skips that
 * module's fetch()-based cache and just reads the file once per warm serverless instance. Returns
 * EDGES (consecutive point pairs), not bare points: OSM's own sampling is uneven -- Algarve alone has
 * points as close as 4m apart on corners but as far as 427m apart on a straight -- so measuring
 * distance to the nearest raw VERTEX (tried first, 29/08/2026) wildly overestimates how far off-line
 * a car is anywhere near one of those sparse long segments, producing nonsense like "427% of the
 * track width used". Distance to the nearest point ON a segment (clamped projection, not just its
 * endpoints) doesn't have that failure mode. */
async function loadTrackBoundaryEdges(trackId: number): Promise<BoundaryEdge[] | null> {
  if (!boundaryCache) {
    const file = await readFile(path.join(process.cwd(), "public", "track-boundaries.json"), "utf8");
    boundaryCache = JSON.parse(file);
  }
  const boundary = boundaryCache![String(trackId)];
  if (!boundary) return null;
  const edges: BoundaryEdge[] = [];
  for (const segment of boundary.segments) {
    for (let i = 1; i < segment.pts.length; i += 1) {
      const [lat1, lon1] = segment.pts[i - 1];
      const [lat2, lon2] = segment.pts[i];
      edges.push({ lat1, lon1, lat2, lon2, width: segment.width });
    }
  }
  return edges.length ? edges : null;
}

/** Meters from (lat,lon) to the closest point ON the edge (A->B), not just to A or B -- a simple
 * local-planar projection (edge.lat1/lon1 as origin, longitude scaled by cos(lat) same as
 * lib/track-map.ts) is accurate enough at track scale, clamped to the segment so it never reports a
 * point "beyond" either end as closer than it really is. */
function distanceToEdgeMeters(lat: number, lon: number, edge: BoundaryEdge) {
  const cosRef = Math.cos((edge.lat1 * Math.PI) / 180);
  const toXY = (la: number, lo: number): [number, number] => [(lo - edge.lon1) * METERS_PER_DEGREE_LAT * cosRef, (la - edge.lat1) * METERS_PER_DEGREE_LAT];
  const [px, py] = toXY(lat, lon);
  const [bx, by] = toXY(edge.lat2, edge.lon2);
  const lenSq = bx * bx + by * by;
  const t = lenSq > 0 ? Math.max(0, Math.min(1, (px * bx + py * by) / lenSq)) : 0;
  const dx = px - bx * t, dy = py - by * t;
  return Math.sqrt(dx * dx + dy * dy);
}

/** How much of the track's real width (per OSM's `highway=raceway` width tag) a lap's GPS trace
 * uses: for each sampled point, the distance to the nearest boundary edge expressed as a fraction
 * of that edge's half-width. 0 = always dead center; 1 = riding the tagged edge. This is the same
 * real boundary geometry built for the track map (29/08/2026 OSM work), repurposed here as the only
 * genuine "how aggressively does this car use the track" signal available -- there's no Garage61
 * track-limits channel to read instead. */
function trackWidthUsage(points: TracePoint[], boundary: BoundaryEdge[]) {
  const samples: number[] = [];
  for (let distance = 0; distance < 100; distance += 1.5) {
    const lat = interpolate(points, distance, "lat" as ChannelKey);
    const lon = interpolate(points, distance, "lon" as ChannelKey);
    if (lat === null || lon === null) continue;
    let bestDist = Infinity, bestWidth = 0;
    for (const edge of boundary) {
      const dist = distanceToEdgeMeters(lat, lon, edge);
      if (dist < bestDist) { bestDist = dist; bestWidth = edge.width; }
    }
    if (bestWidth > 0) samples.push(bestDist / (bestWidth / 2));
  }
  if (samples.length < 10) return null;
  return { avgPct: Number((mean(samples) * 100).toFixed(1)), maxPct: Number((Math.max(...samples) * 100).toFixed(1)) };
}

const TRACK_USAGE_SEGMENTS = 10; // 10% of the lap each -- coarse enough to read as a strip across cars, fine enough to localize "where" they diverge

// One stable color per car (by finishing order), reused across the ranking bars, the sector map,
// and the per-segment brake/throttle overlay charts -- distinct hues, chosen to stay readable on the
// app's dark background and distinguishable from the existing red/green channel colors.
const CAR_COLORS = ["#4fc3d6", "#e0973b", "#a97ee0", "#f3c614", "#ff5c9d", "#8bd450"];

/** Same width-usage metric as trackWidthUsage, broken into TRACK_USAGE_SEGMENTS fixed distance bins
 * instead of one whole-lap average -- lets the UI show WHERE on track cars diverge in how much
 * width they use, not just a single aggregate number (29/08/2026: "Track Usage dá pra fazer algo
 * mais quebrado em curvas ou sub-trechos para identificar as principais diferenças"). Bins are fixed
 * %-of-lap windows rather than actual detected corners -- cheap and track-agnostic; good enough to
 * spot "this car goes wider in the back straight's chicane" without needing per-track corner data. */
function trackWidthUsageBySegment(points: TracePoint[], boundary: BoundaryEdge[]) {
  const segments: (number | null)[] = [];
  for (let segment = 0; segment < TRACK_USAGE_SEGMENTS; segment += 1) {
    const start = (segment / TRACK_USAGE_SEGMENTS) * 100, end = ((segment + 1) / TRACK_USAGE_SEGMENTS) * 100;
    const samples: number[] = [];
    for (let distance = start; distance < end; distance += 1) {
      const lat = interpolate(points, distance, "lat" as ChannelKey);
      const lon = interpolate(points, distance, "lon" as ChannelKey);
      if (lat === null || lon === null) continue;
      let bestDist = Infinity, bestWidth = 0;
      for (const edge of boundary) {
        const dist = distanceToEdgeMeters(lat, lon, edge);
        if (dist < bestDist) { bestDist = dist; bestWidth = edge.width; }
      }
      if (bestWidth > 0) samples.push(bestDist / (bestWidth / 2));
    }
    segments.push(samples.length ? Number((mean(samples) * 100).toFixed(1)) : null);
  }
  return segments;
}

/** Same technique app/api/telemetry/debrief/route.ts uses to rank laps by pace through one corner
 * independent of the rest of the lap: Σ(Δ%/speed) over a distance window, scaled by
 * lapTime/wholeLapIntegral so the result is real seconds, not an arbitrary unit. Used here to find
 * which CAR is fastest through each of the TRACK_USAGE_SEGMENTS windows (29/08/2026: "mostraria em
 * cada trecho qual carro foi mais rápido"), reusing the exact same segment boundaries as track usage
 * so the two per-segment views line up 1:1. */
function integrateInverseSpeed(points: TracePoint[], windowStart: number, windowEnd: number, step = 0.5) {
  let integral = 0;
  for (let distance = windowStart; distance <= windowEnd; distance += step) {
    const wrapped = ((distance % 100) + 100) % 100;
    const speed = interpolate(points, wrapped, "speed");
    if (speed !== null && speed > 1) integral += step / speed;
  }
  return integral;
}

/** Fine-grained (0.5%-step) brake/throttle curve of one car's single fastest lap within a segment
 * window -- same idea as debrief.ts's laneCurve, reused here so each segment card can overlay every
 * car's actual input curve (29/08/2026: "mostrar os gráficos de acelerador e freio também ajuda a
 * entender a parte da consistência"), not just a numeric score. */
function segmentCurve(points: TracePoint[], start: number, end: number, channel: "brake" | "throttle" | "speed" | "steering" | "gear") {
  const curve: { offset: number; value: number }[] = [];
  for (let distance = start; distance <= end; distance += 0.5) {
    const value = interpolate(points, distance, channel);
    if (value !== null) curve.push({ offset: Number((distance - start).toFixed(1)), value: Number(value.toFixed(3)) });
  }
  return curve;
}

/** GPS points across a corner window -- sent straight in the sectors payload so the deep-dive corner
 * map (29/08/2026: "o minimapa focado naquela curva irá mostrar as linhas que cada carro fez") can
 * render each car's real driven line without the frontend needing a second telemetry fetch/parse.
 * Uses the RAW trace points in-window directly now (31/08/2026: "revisar as linhas de traçado, veja
 * que não está 'redonda', mostrando realmente o traçado do carro") -- this used to resample onto a
 * fixed 0.5%-of-LAP-distance grid, same as segmentCurve's own channel curves (fine there: throttle/
 * brake only need to look smooth over the whole corner window). For a short real corner (a couple %
 * of a long lap) that grid gives as few as 2-4 points across the whole turn, discarding nearly all of
 * the GPS trace's actual ~60Hz density and rendering as a visibly straight-sided polygon instead of a
 * curve. Raw points preserve whatever density the telemetry actually has. */
function segmentGps(points: TracePoint[], start: number, end: number) {
  const withGps = points.filter((point) => point.lat !== null && point.lon !== null);
  // A verified-genuine lap only needs >=MIN_LAP_COVERAGE_PCT% of the lap covered, not literally
  // 0-100% -- one that's short a fraction of a percent right at the very start or end (its telemetry
  // simply stopped recording a hair before the finish line) has ZERO points in a corner window that
  // falls entirely in that small gap, rendering as that car's line just silently missing from the
  // map (31/08/2026: "não estou conseguindo ver onde os traçados estão na pista", confirmed live:
  // Spa's final-chicane sectors landed exactly in this gap for one car -- 0 points inside 99.5-99.9%
  // when its trace's real data stopped at ~99.4%). Symmetrically widening the window in small steps
  // until there are enough points to draw a line at least picks up the trace's own trailing/leading
  // points near the edge, instead of rendering nothing for that car -- capped so a genuinely empty
  // trace doesn't reach into an unrelated corner's data.
  let windowStart = start, windowEnd = end;
  let inWindow = withGps.filter((point) => point.distance >= windowStart && point.distance <= windowEnd);
  for (let expand = 0; inWindow.length < 2 && expand < 10 && withGps.length; expand += 1) {
    windowStart -= 0.5; windowEnd += 0.5;
    inWindow = withGps.filter((point) => point.distance >= windowStart && point.distance <= windowEnd);
  }
  return inWindow.map((point) => ({ distance: Number(point.distance.toFixed(2)), lat: point.lat as number, lon: point.lon as number }));
}

// Only these two categories are offered as a filter (29/08/2026: "no caso GT3 e GTP... Super
// Fórmula e LMP2 não se aplicam aqui porque não tem diferença de carro") -- this driver only ever
// tests multiple distinct CARS within GT3 and GTP; Super Formula/oval/etc. are single-make classes
// for him, so a car-vs-car comparison there is meaningless even on the rare chance two car_ids show
// up (e.g. a car swap mid-season) -- those are just left out rather than given their own tab.
type Category = "gt3" | "gtp";
const CATEGORIES: Category[] = ["gt3", "gtp"];
const CATEGORY_LABEL: Record<Category, string> = { gt3: "GT3", gtp: "GTP" };

/** GT3 vs GTP isn't a column anywhere -- car_rating_categories only goes as coarse as
 * formula_car/sports_car/oval/etc (GT3, GTP, AND LMP2 all race as "sports_car" there), so GTP is
 * split out the same way app/api/telemetry/debrief/route.ts already does it: by car_id membership
 * in the "GTP" car_groups group. LMP2 gets the same treatment (own car_groups membership, mapped to
 * null/excluded here) rather than being left to fall into "gt3" by default -- confirmed live
 * (29/08/2026) that without this, the Dallara P217 (LMP2) showed up mixed into the GT3 comparison
 * table, which is exactly the wrong-classification bug, not just an unwanted extra filter tab.
 * Everything left in sports_car after both exclusions is "gt3". Non-sports_car cars (formula_car,
 * oval, ...) map to null too and are dropped everywhere this is used. */
async function resolveCarCategories(carIds: number[]): Promise<Map<number, Category | null>> {
  const result = new Map<number, Category | null>();
  if (!carIds.length) return result;
  const excludedCarIds = new Set<number>(); // GTP handled separately below; this is LMP2 and any other non-GT3 sports_car group
  const gtpCarIds = new Set<number>();
  const { data: groups } = await supabaseAdmin.from("car_groups").select("id,name").in("name", ["GTP", "LMP2"]);
  for (const group of groups ?? []) {
    const { data: members } = await supabaseAdmin.from("car_group_members").select("car_id").eq("car_group_id", group.id);
    const ids = (members ?? []).map((row) => row.car_id as number);
    if (group.name === "GTP") ids.forEach((id) => gtpCarIds.add(id));
    else ids.forEach((id) => excludedCarIds.add(id));
  }
  const { data: ratingRows } = await supabaseAdmin.from("car_rating_categories").select("car_id,rating_category").in("car_id", carIds);
  const ratingByCar = new Map((ratingRows ?? []).map((row) => [row.car_id as number, row.rating_category as string]));
  // Name-based fallback in case this Supabase instance never got an "LMP2" car_groups row seeded --
  // catches the exact car that leaked into "gt3" live (Dallara P217) plus the other current-era
  // iRacing LMP2 chassis, without depending on that group existing.
  const { data: carRows } = await supabaseAdmin.from("cars").select("id,name").in("id", carIds);
  const lmp2NamePattern = /\bLMP2\b|Dallara P217|Oreca 07/i;
  const lmp2ByName = new Set((carRows ?? []).filter((row) => lmp2NamePattern.test(row.name)).map((row) => row.id as number));
  for (const carId of carIds) {
    result.set(carId, gtpCarIds.has(carId) ? "gtp" : excludedCarIds.has(carId) || lmp2ByName.has(carId) ? null : ratingByCar.get(carId) === "sports_car" ? "gt3" : null);
  }
  return result;
}

// Coarse backstop only (used for the track-eligibility list, where getting the exact right
// threshold matters less than in the real comparison below) -- no road course this feature covers
// (GT3/GTP only, never ovals) has a real lap anywhere near this short.
const MIN_PLAUSIBLE_LAP_SECONDS = 20;

/** Deliberately does NOT require Garage61's own `clean` flag, unlike debrief.ts and sectors.ts
 * (which analyze RACE laps, where that's the right bar). Confirmed live (29/08/2026, driver-reported:
 * "Spa... por que não apareceu?"): McLaren 720S GT3 EVO had 39 real laps at Spa across
 * practice/qualy/race, with real positive lap times -- but only 1 was Garage61-"clean", so this
 * feature returned zero valid laps for that car and it silently vanished from the comparison, while
 * Dallara P217's 145 laps (mostly race-session) were 77% clean and showed up fine. That's not a sync
 * gap, and not a bug in `clean` either -- it's Garage61 legitimately flagging most PRACTICE/test-drive
 * laps unclean (track-limit exploration, setup testing), which is exactly the kind of lap this
 * feature exists to compare. Requiring "clean" here would silently drop whichever car the driver
 * tested the most aggressively.
 * `incomplete` ALSO isn't required, for the same reason -- for these same cars it was true on
 * almost the exact same rows as `clean=false` (McLaren: 38/39 both), so keeping it as a hard gate
 * just reintroduces the same near-total exclusion under a different flag. But dropping it naively
 * let through broken/partial telemetry records with implausible lap times (Ferrari 296 GT3's
 * fastest "lap" at Spa came back as 2.65s; other cars landed at 20-90s against a real ~2:15 Spa GT3
 * lap) that wrecked the ranking outright. A single fixed floor doesn't work across every track's own
 * lap-time scale -- see filterPlausibleTimes below, applied in buildComparison, for the real (dynamic,
 * per-track) fix; MIN_PLAUSIBLE_LAP_SECONDS here is only a cheap backstop for the track list.
 * off_track/pit/missing stay excluded -- those mean the lap genuinely isn't representative -- but a
 * real, plausibly-timed lap is fair game even if Garage61 wouldn't call it an official clean lap.
 * trimSlowOutliers (see below) is what keeps a wild practice lap from wrecking the consistency
 * numbers now that `clean`/`incomplete` alone no longer gate everything. */
function isValidLap(lap: LapRow) {
  return Number(lap.lap_time) > MIN_PLAUSIBLE_LAP_SECONDS && !lap.off_track && !lap.pit_lane && !lap.pit_in && !lap.pit_out && !lap.missing;
}

/** The real, per-track/category fix for the broken-record problem above. A single "half the pool's
 * median" floor (tried first) still failed live at Spa: legit ~2:15 McLaren laps survived, but so
 * did clearly-broken 1:27-1:52 "laps" for other cars -- broken/partial telemetry records made up
 * MORE than half of some cars' pools (confirmed: one had incomplete=true on 38 of 39 laps), so the
 * median itself was contaminated and no longer reflected genuine race pace.
 * Density clustering instead: sort every lap time in the pool, and single-link neighbors within 30%
 * of each other into the same cluster (broken records are scattered arbitrary fractions of a real
 * lap, so they essentially never cluster tightly with each other OR with the real pace group -- a
 * genuine lap, even an off-pace practice one, reliably lands within 30% of another genuine lap on
 * the same track). Keep only the LARGEST cluster; ties broken toward the slower one, since this
 * failure mode only ever produces bogus SHORT times, never bogus long ones. Needs at least 4 laps in
 * the pool to safely cluster; smaller pools are left alone (not enough signal to reject anything). */
function filterPlausibleTimes<T extends { lap_time: number | null }>(laps: T[]) {
  const withTimes = laps.filter((lap) => Number(lap.lap_time) > 0);
  if (withTimes.length < 4) return laps;
  const sorted = [...withTimes].sort((a, b) => Number(a.lap_time) - Number(b.lap_time));
  const clusters: T[][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = Number(sorted[i - 1].lap_time), current = Number(sorted[i].lap_time);
    if (current / prev <= 1.3) clusters[clusters.length - 1].push(sorted[i]);
    else clusters.push([sorted[i]]);
  }
  const maxSize = Math.max(...clusters.map((cluster) => cluster.length));
  const best = clusters.filter((cluster) => cluster.length === maxSize).pop()!; // pop = slowest among tied-largest
  return best;
}

/** How much of the 0-100% lap distance a downloaded trace actually covers -- see its call site
 * (perCar, further down) for why this is the real signal for "is this a genuine full lap", not the
 * recorded lap_time field, which is exactly what's wrong on a broken/partial telemetry record. */
function traceCoveragePct(points: TracePoint[]) {
  if (!points.length) return 0;
  const distances = points.map((point) => point.distance);
  return Math.max(...distances) - Math.min(...distances);
}

/** Real-world GPS path length of a trace, in meters -- confirmed live at Mount Panorama (31/08/2026)
 * that traceCoveragePct alone isn't enough: some laps there report a clean 0-100% lapDistPct sweep
 * (so they pass the coverage check) in a physically impossible time (a 6.2km real circuit "covered"
 * in 92s at 60Hz sample count matching the recorded lap_time almost exactly -- self-consistent, not
 * a parsing artifact) while their GPS trace's own halfway point sits nowhere near the real track's
 * geographic midpoint. lapDistPct itself is apparently mis-scaled for these laps (a known class of
 * iRacing SDK issue when a track's declared length is off), so the only channel that can't lie about
 * how far the car actually drove is the raw lat/lon path length -- summed as flat-earth planar
 * segments (same approximation as distanceToEdgeMeters), which is accurate enough at track scale. */
function traceGpsDistanceMeters(points: TracePoint[]) {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1], b = points[index];
    if (a.lat == null || a.lon == null || b.lat == null || b.lon == null) continue;
    const cosRef = Math.cos((a.lat * Math.PI) / 180);
    const dx = (b.lon - a.lon) * METERS_PER_DEGREE_LAT * cosRef;
    const dy = (b.lat - a.lat) * METERS_PER_DEGREE_LAT;
    total += Math.sqrt(dx * dx + dy * dy);
  }
  return total;
}

async function downloadTrace(lapId: string, trackId: number, telemetryPath: string | null): Promise<TracePoint[] | null> {
  if (telemetryPath) {
    const { data: file, error } = await supabaseAdmin.storage.from("telemetry").download(telemetryPath);
    if (!error && file) {
      const points = parseLapCsv(await file.text());
      if (points.length > 20) return points;
    }
  }
  const token = process.env.GARAGE61_API_TOKEN;
  if (!token) return null;
  const response = await fetch(`${GARAGE61_BASE}/laps/${encodeURIComponent(lapId)}/csv`, { headers: { Authorization: `Bearer ${token}`, Accept: "text/csv" }, cache: "no-store" });
  if (!response.ok) return null;
  const csv = await response.text();
  const path = `laps/${trackId}/${lapId}.csv`;
  const { error: uploadError } = await supabaseAdmin.storage.from("telemetry").upload(path, csv, { contentType: "text/csv; charset=utf-8", upsert: true });
  if (!uploadError) await supabaseAdmin.from("laps").update({ telemetry_path: path }).eq("id", lapId);
  const points = parseLapCsv(csv);
  return points.length > 20 ? points : null;
}

const LAPS_PAGE_SIZE = 1000; // matches Supabase's own default row cap -- a plain unranged .select()
// here silently truncated at 1000 rows once this driver's laps table passed that count, undercounting
// cars for whichever tracks' rows happened to land past the cutoff (confirmed live 29/08/2026: the
// track picker said "2 carros" for Interlagos while the actual per-track query -- which IS scoped by
// track_id and so stays under 1000 rows -- found 6). Paginating with .range() here fixes that.
async function fetchAllDriverLaps(driverId: string) {
  const rows: LapRow[] = [];
  for (let offset = 0; ; offset += LAPS_PAGE_SIZE) {
    const { data, error } = await supabaseAdmin
      .from("laps")
      .select("id,car_id,track_id,clean,lap_time,off_track,pit_lane,pit_in,pit_out,incomplete,missing,telemetry_path,session_id,sessions(season_id,season_name,started_at)")
      .eq("driver_id", driverId)
      .not("car_id", "is", null).not("track_id", "is", null)
      .range(offset, offset + LAPS_PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as unknown as LapRow[]));
    if (!data || data.length < LAPS_PAGE_SIZE) break;
  }
  return rows;
}

/** Season is now the PRIMARY filter (29/08/2026: "o filtro prioritário é o primeiro... eu devo ter
 * todas as season disponíveis, depois atualiza o filtro de pistas com o que eu preenchi primeiro" --
 * the season picker was wrongly scoped to whichever track happened to be selected, when it should be
 * the other way around). Seasons are listed for this CATEGORY across every track the driver has ever
 * touched, independent of track; the track list is then scoped to whichever season is selected (or
 * every season, for "todas as temporadas"). BoP changes between seasons (see buildComparison's own
 * comment), so the default is still the single most recent season with data for this category, not
 * all-time -- just computed globally instead of per-track now. */
async function listSeasonsAndTracks(driverId: string, category: Category, seasonParam: string | null) {
  const rows = await fetchAllDriverLaps(driverId);
  const roughlyValid = rows.filter(isValidLap);
  const allCarIds = [...new Set(roughlyValid.map((lap) => lap.car_id as number))];
  const categoryByCar = await resolveCarCategories(allCarIds);
  const categoryLaps = roughlyValid.filter((lap) => categoryByCar.get(lap.car_id as number) === category);

  const seasonInfo = new Map<string, { seasonName: string; latestStartedAt: string; lapCount: number }>();
  for (const lap of categoryLaps) {
    const seasonId = lap.sessions?.season_id;
    if (!seasonId) continue;
    const existing = seasonInfo.get(seasonId);
    const startedAt = lap.sessions?.started_at ?? "";
    if (existing) {
      existing.lapCount += 1;
      if (startedAt > existing.latestStartedAt) existing.latestStartedAt = startedAt;
    } else {
      seasonInfo.set(seasonId, { seasonName: lap.sessions?.season_name ?? seasonId, latestStartedAt: startedAt, lapCount: 1 });
    }
  }
  const seasons = [...seasonInfo.entries()]
    .map(([seasonId, info]) => ({ seasonId, seasonName: info.seasonName, lapCount: info.lapCount, latestStartedAt: info.latestStartedAt }))
    .sort((a, b) => b.latestStartedAt.localeCompare(a.latestStartedAt));
  const selectedSeasonId = seasonParam === "all" ? null : seasonParam ?? seasons[0]?.seasonId ?? null;

  const scopedLaps = selectedSeasonId ? categoryLaps.filter((lap) => lap.sessions?.season_id === selectedSeasonId) : categoryLaps;

  // Cross-car plausibility check (31/08/2026: "só mostre no drop-down list pistas para as
  // respectivas temporadas onde possamos fazer essa análise... em Spa não é possível... você afirma
  // que temos poucas voltas válidas") -- per-car density clustering (filterPlausibleTimes) alone
  // isn't enough here: it only compares a car's laps against ITSELF, so a car whose entire pool is
  // consistently broken clusters together as its own "plausible" group with nothing to catch it. A
  // broken/partial telemetry record's recorded lap_time is reliably too SHORT, never too long (same
  // fact filterPlausibleTimes itself relies on) -- so cross-checking each car's own best plausible
  // time against the MEDIAN best time across every OTHER car at this track catches exactly the
  // Ferrari-at-Spa case (a "2.65s" or "20-90s" fastest lap next to everyone else's genuine ~2:15).
  // Still cheap (lap_time arithmetic only, no telemetry download) -- it can't catch a record whose
  // lap_time looks fine but whose telemetry itself is corrupted (that needs the real per-lap GPS
  // check, deliberately not done here to keep the picker fast), so an eligible track can still
  // occasionally turn up short once actually opened.
  const lapsByTrackAndCar = new Map<number, Map<number, LapRow[]>>();
  for (const lap of scopedLaps) {
    const trackId = lap.track_id as number, carId = lap.car_id as number;
    if (!lapsByTrackAndCar.has(trackId)) lapsByTrackAndCar.set(trackId, new Map());
    const byCar = lapsByTrackAndCar.get(trackId)!;
    if (!byCar.has(carId)) byCar.set(carId, []);
    byCar.get(carId)!.push(lap);
  }
  const byTrack = new Map<number, Set<number>>();
  for (const [trackId, byCar] of lapsByTrackAndCar) {
    const bestByCar = new Map<number, number>();
    for (const [carId, laps] of byCar) {
      const plausible = filterPlausibleTimes(laps);
      const best = Math.min(...plausible.map((lap) => Number(lap.lap_time)));
      if (Number.isFinite(best)) bestByCar.set(carId, best);
    }
    const allBestTimes = [...bestByCar.values()].sort((a, b) => a - b);
    const median = allBestTimes.length ? allBestTimes[Math.floor(allBestTimes.length / 2)] : 0;
    const plausibleCars = new Set<number>();
    for (const [carId, best] of bestByCar) {
      if (median === 0 || best >= median * 0.75) plausibleCars.add(carId);
    }
    byTrack.set(trackId, plausibleCars);
  }
  const cheapEligible = [...byTrack.entries()].filter(([, cars]) => cars.size >= 2);
  if (!cheapEligible.length) return { seasons, selectedSeasonId, tracks: [] };

  // Real per-lap GPS verification (31/08/2026: "ainda segue com opções disponíveis que não podem ser
  // analisadas... se eu não consigo analisar Spa Francorchamps, então ele não precisa aparecer para
  // mim") -- the cheap cross-car check above catches an obviously-broken lap_time, but not a record
  // whose lap_time looks plausible while its telemetry itself is corrupted (lapDistPct mis-scaled,
  // same class of bug fixed for Mount Panorama) -- only downloading and checking the actual trace
  // catches that. Only run for tracks that already passed the cheap filter (bounds the cost to the
  // driver's real candidate set, not every track they've ever driven), and only try each car's
  // fastest few laps (not buildComparison's full CANDIDATE_POOL_LAPS=10) -- enough to find one
  // genuine lap in the common case without downloading everything twice over.
  const VERIFY_CANDIDATE_LAPS = 3;
  const eligible = (await Promise.all(cheapEligible.map(async ([trackId, plausibleCars]) => {
    const byCar = lapsByTrackAndCar.get(trackId)!;
    const verifiedByCar = await Promise.all([...plausibleCars].map(async (carId) => {
      const candidates = byCar.get(carId)!.slice().sort((a, b) => Number(a.lap_time) - Number(b.lap_time)).slice(0, VERIFY_CANDIDATE_LAPS);
      const traces = await Promise.all(candidates.map((lap) => downloadTrace(lap.id, trackId, lap.telemetry_path)));
      const fullCoverage = candidates
        .map((lap, index) => ({ lap, trace: traces[index] }))
        .filter((item): item is { lap: LapRow; trace: TracePoint[] } => !!item.trace && traceCoveragePct(item.trace) >= MIN_LAP_COVERAGE_PCT);
      if (!fullCoverage.length) return null;
      return { carId, gpsDistanceMeters: traceGpsDistanceMeters(fullCoverage[0].trace) };
    }));
    const verified = verifiedByCar.filter((item): item is { carId: number; gpsDistanceMeters: number } => item !== null);
    const referenceLapMeters = Math.max(0, ...verified.map((item) => item.gpsDistanceMeters));
    const finalCars = new Set(verified.filter((item) => referenceLapMeters === 0 || item.gpsDistanceMeters >= referenceLapMeters * 0.85).map((item) => item.carId));
    return [trackId, finalCars] as [number, Set<number>];
  }))).filter(([, cars]) => cars.size >= 2);
  if (!eligible.length) return { seasons, selectedSeasonId, tracks: [] };

  const trackIds = eligible.map(([trackId]) => trackId);
  const carIds = [...new Set(eligible.flatMap(([, cars]) => [...cars]))];
  const [tracksResult, carsResult] = await Promise.all([
    supabaseAdmin.from("tracks").select("id,name,variant").in("id", trackIds),
    supabaseAdmin.from("cars").select("id,name").in("id", carIds),
  ]);
  const trackNames = new Map((tracksResult.data ?? []).map((row) => [row.id, row]));
  const carNames = new Map((carsResult.data ?? []).map((row) => [row.id, row.name as string]));

  const tracks = eligible.map(([trackId, cars]) => {
    const track = trackNames.get(trackId);
    return {
      trackId,
      trackName: track?.name ?? `Pista ${trackId}`,
      trackVariant: track?.variant ?? null,
      carCount: cars.size,
      carNames: [...cars].map((id) => carNames.get(id) ?? `Carro ${id}`).sort((a, b) => a.localeCompare(b, "pt-BR")),
    };
  }).sort((a, b) => a.trackName.localeCompare(b.trackName, "pt-BR"));

  return { seasons, selectedSeasonId, tracks };
}

async function buildComparison(driverId: string, trackId: number, category: Category, seasonParam: string | null) {
  // Same silent-truncation bug fetchAllDriverLaps's own comment already documents (a plain
  // unranged .select() here caps at Supabase's own 1000-row default) -- this query was never given
  // the same .range() pagination when it was written, so a track with 1000+ total laps across every
  // category (not just this one) undercounted just like Interlagos did, just one query over from the
  // one that got fixed. Confirmed live (31/08/2026): Spa had 322 GT3 laps across 4 seasons per the
  // paginated query in listSeasonsAndTracks, but THIS query's single-page fetch was silently missing
  // the newest season (34) entirely, exactly the "Menos de 2 carros... você afirma que temos poucas
  // voltas válidas" the track picker showed despite otherwise correctly listing 3 cars for it.
  const lapsData: LapRow[] = [];
  for (let offset = 0; ; offset += LAPS_PAGE_SIZE) {
    const { data, error } = await supabaseAdmin
      .from("laps")
      .select("id,car_id,track_id,lap_time,clean,off_track,pit_lane,pit_in,pit_out,incomplete,missing,telemetry_path,session_id,sessions(season_id,season_name,started_at)")
      .eq("driver_id", driverId).eq("track_id", trackId)
      .range(offset, offset + LAPS_PAGE_SIZE - 1);
    if (error) throw error;
    lapsData.push(...((data ?? []) as unknown as LapRow[]));
    if (!data || data.length < LAPS_PAGE_SIZE) break;
  }

  const byCarAll = new Map<number, LapRow[]>();
  for (const lap of lapsData) {
    if (!isValidLap(lap)) continue;
    const carId = lap.car_id as number;
    if (!byCarAll.has(carId)) byCarAll.set(carId, []);
    byCarAll.get(carId)!.push(lap);
  }
  const categoryByCar = await resolveCarCategories([...byCarAll.keys()]);
  const byCarCategory = new Map([...byCarAll].filter(([carId]) => categoryByCar.get(carId) === category));

  // Seasons this category has laps in at this track, newest first -- BoP changes between seasons
  // (29/08/2026: "muitas vezes eles trocam os BoP dos carros e aí algo que eu testei duas temporadas
  // atrás, não é mais verdade no contexto atual"), so comparing across seasons by default would
  // silently mix cars under different balance rules. Default is therefore the single most recent
  // season with data, not "all time" -- "all" is still offered explicitly for when that's wanted.
  const seasonInfo = new Map<string, { seasonName: string; latestStartedAt: string; lapCount: number }>();
  for (const laps of byCarCategory.values()) {
    for (const lap of laps) {
      const seasonId = lap.sessions?.season_id;
      if (!seasonId) continue;
      const existing = seasonInfo.get(seasonId);
      const startedAt = lap.sessions?.started_at ?? "";
      if (existing) {
        existing.lapCount += 1;
        if (startedAt > existing.latestStartedAt) existing.latestStartedAt = startedAt;
      } else {
        seasonInfo.set(seasonId, { seasonName: lap.sessions?.season_name ?? seasonId, latestStartedAt: startedAt, lapCount: 1 });
      }
    }
  }
  const seasons = [...seasonInfo.entries()]
    .map(([seasonId, info]) => ({ seasonId, seasonName: info.seasonName, lapCount: info.lapCount, latestStartedAt: info.latestStartedAt }))
    .sort((a, b) => b.latestStartedAt.localeCompare(a.latestStartedAt));
  const selectedSeasonId = seasonParam === "all" ? null : seasonParam ?? seasons[0]?.seasonId ?? null;

  // Plausibility floor computed once, across every car in this category+season pool together (not
  // per car) -- a single car might legitimately have very few laps, too few to trust its own
  // median, but the whole pool sharing one track always has enough signal.
  const pooledLaps = [...byCarCategory.values()].flatMap((laps) => selectedSeasonId ? laps.filter((lap) => lap.sessions?.season_id === selectedSeasonId) : laps);
  const plausibleLapIds = new Set(filterPlausibleTimes(pooledLaps).map((lap) => lap.id));

  const byCar = new Map([...byCarCategory]
    .map(([carId, laps]): [number, LapRow[]] => [carId, (selectedSeasonId ? laps.filter((lap) => lap.sessions?.season_id === selectedSeasonId) : laps).filter((lap) => plausibleLapIds.has(lap.id))])
    .filter(([, laps]) => laps.length > 0));

  const carIds = [...byCar.keys()]
    .sort((a, b) => Math.min(...byCar.get(a)!.map((l) => Number(l.lap_time))) - Math.min(...byCar.get(b)!.map((l) => Number(l.lap_time))))
    .slice(0, MAX_CARS);
  if (carIds.length < 2) {
    const seasonName = seasons.find((s) => s.seasonId === selectedSeasonId)?.seasonName;
    return {
      status: "ok", track: null, cars: [], seasons, selectedSeasonId,
      message: `Menos de 2 carros de ${CATEGORY_LABEL[category]} com voltas válidas nessa pista${seasonName ? ` em ${seasonName}` : ""}.${selectedSeasonId ? " Tente \"todas as temporadas\"." : ""}`,
    };
  }

  const [carsResult, trackResult, boundary] = await Promise.all([
    supabaseAdmin.from("cars").select("id,name").in("id", carIds),
    supabaseAdmin.from("tracks").select("id,name,variant").eq("id", trackId).maybeSingle(),
    loadTrackBoundaryEdges(trackId).catch(() => null),
  ]);
  const carNames = new Map((carsResult.data ?? []).map((row) => [row.id, row.name as string]));

  // Two-phase per-car processing -- see the comment on traceGpsDistanceMeters for why phase 1's
  // lapDistPct-coverage check isn't the whole story: a lap can sweep a clean 0-100% lapDistPct range
  // in a physically impossible time when lapDistPct itself is mis-scaled for that track. Phase 1
  // gathers every coverage-verified candidate across every car along with its real GPS path length;
  // phase 2 then uses the LONGEST path length seen across ALL cars at this track as the "this is
  // what a genuine full lap actually covers on the ground" reference, and rejects any candidate whose
  // own path length falls well short of it, before finally picking each car's fastest survivor.
  const perCarPrepared = await Promise.all(carIds.map(async (carId) => {
    const laps = byCar.get(carId)!.slice().sort((a, b) => Number(a.lap_time) - Number(b.lap_time));

    // The density-clustering plausibility filter (filterPlausibleTimes) operates on the recorded
    // lap_time alone, which is exactly the field that's wrong for a broken/partial telemetry record
    // -- confirmed live at Mount Panorama, where every car's "best lap" came back 38-86s against a
    // real ~2min05s circuit (all 5 cars, so not one bad car, the whole cluster it picked was wrong).
    // The one thing that can't lie about how much of the lap was actually recorded is the telemetry's
    // own GPS distance coverage: a genuine full lap spans nearly the whole 0-100% range, a broken
    // record usually only covers a fraction of it. Downloads a wider candidate pool than
    // TELEMETRY_SAMPLE_LAPS specifically to have a real shot at finding ONE genuine full lap even
    // when the fastest-by-recorded-time candidates are all broken.
    const candidateLaps = laps.slice(0, CANDIDATE_POOL_LAPS);
    const candidateTraces = await Promise.all(candidateLaps.map((lap) => downloadTrace(lap.id, trackId, lap.telemetry_path)));
    const withCoverage = candidateLaps
      .map((lap, index) => ({ lap, trace: candidateTraces[index] }))
      .filter((item): item is { lap: LapRow; trace: TracePoint[] } => !!item.trace);
    const fullCoverage = withCoverage
      .filter((item) => traceCoveragePct(item.trace) >= MIN_LAP_COVERAGE_PCT)
      .map((item) => ({ ...item, gpsDistanceMeters: traceGpsDistanceMeters(item.trace) }));
    return { carId, laps, fullCoverage };
  }));

  // The reference "real lap length" -- the longest GPS path any car's coverage-verified candidate
  // actually drove at this track. A car whose own best candidates all fall well short of this (in
  // meters actually driven, not lapDistPct) never had a genuine full lap in its pool.
  const referenceLapMeters = Math.max(0, ...perCarPrepared.flatMap((car) => car.fullCoverage.map((item) => item.gpsDistanceMeters)));
  const MIN_GPS_DISTANCE_RATIO = 0.85;

  const perCarOrNull = perCarPrepared.map(({ carId, fullCoverage }) => {
    const verified = referenceLapMeters > 0
      ? fullCoverage.filter((item) => item.gpsDistanceMeters >= referenceLapMeters * MIN_GPS_DISTANCE_RATIO)
      : fullCoverage;
    // No genuine full lap found anywhere in the candidate pool -- this car's whole cluster for this
    // track/season/category is untrustworthy. Better to drop it from the comparison than show a
    // confidently wrong "38s lap" next to real ~2min ones.
    if (!verified.length) return null;

    const chosen = verified[0]; // candidateLaps was already time-sorted ascending, so this is the fastest VERIFIED-genuine lap
    const bestLapSeconds = Number(chosen.lap.lap_time);
    const traces = verified.slice(0, TELEMETRY_SAMPLE_LAPS).map((item) => item.trace);
    const laps = byCar.get(carId)!.slice().sort((a, b) => Number(a.lap_time) - Number(b.lap_time));

    // Same idea for the consistency pool: only laps within a sane pace band of the verified genuine
    // lap (not the raw density cluster, which just got shown to be unreliable) count toward stddev.
    const cleanedTimes = trimSlowOutliers(laps.map((lap) => Number(lap.lap_time)).filter((seconds) => seconds >= bestLapSeconds * 0.97 && seconds <= bestLapSeconds * 1.6)).sort((a, b) => a - b);
    const timePool = cleanedTimes.slice(0, TIME_POOL_LAPS);
    const lapTimeConsistency = timePool.length >= 3 ? (() => {
      const avg = mean(timePool);
      const sd = stddev(timePool, avg);
      return { stddev: Number(sd.toFixed(3)), label: consistencyRatioLabel(sd / 0.4) };
    })() : null;

    const inputConsistency = inputConsistencyScore(traces);
    const trackUsage = boundary && traces.length ? trackWidthUsage(traces[0], boundary) : null;
    const trackUsageSegments = boundary && traces.length ? trackWidthUsageBySegment(traces[0], boundary) : null;

    return {
      carId, carName: carNames.get(carId) ?? `Carro ${carId}`,
      lapsAnalyzed: timePool.length,
      bestLapSeconds, bestLapFormatted: formatLapTime(bestLapSeconds),
      lapTimeConsistency, inputConsistency, trackUsage, trackUsageSegments,
      fastestTrace: traces[0] ?? null, // stripped before the response is sent; kept only for the sector pass below
      sampleTraces: traces, // same -- kept for per-corner consistency below, stripped before response
    };
  });
  const perCar = perCarOrNull.filter((car): car is NonNullable<typeof car> => car !== null);
  if (perCar.length < 2) {
    return {
      status: "ok", track: null, cars: [], seasons, selectedSeasonId,
      message: `Não encontrei voltas com telemetria completa e confiável de pelo menos 2 carros de ${CATEGORY_LABEL[category]} nessa pista. Os tempos registrados aqui parecem vir de voltas parciais/quebradas, não de voltas completas -- provavelmente precisa ressincronizar essas sessões.`,
    };
  }

  const overallBest = Math.min(...perCar.map((car) => car.bestLapSeconds));
  const ranked = perCar
    .map((car) => ({ ...car, deltaSeconds: Number((car.bestLapSeconds - overallBest).toFixed(3)) }))
    .sort((a, b) => a.bestLapSeconds - b.bestLapSeconds);

  // GPS outline for the sector map: the single fastest car's fastest lap, thinned -- same idea as
  // debrief.ts's own trackOutline, just sourced from whichever car actually set the pace here.
  const outlineSource = ranked.find((car) => car.fastestTrace)?.fastestTrace ?? null;
  const gpsPoints = outlineSource ? outlineSource.filter((point) => point.lat !== undefined && point.lon !== undefined) : [];
  const outlineStride = Math.max(1, Math.ceil(gpsPoints.length / 300));
  const trackOutline = gpsPoints.length >= 20
    ? gpsPoints.filter((_, index) => index % outlineStride === 0).map((point) => ({ distance: point.distance, lat: point.lat as number, lon: point.lon as number }))
    : null;

  // Assigns each car a stable color (by finishing order) reused across the ranking, the sector map,
  // and the per-segment brake/throttle overlays -- one car, one color, everywhere in this view
  // (29/08/2026: "cada carro receberia uma cor").
  const carColor = new Map(ranked.map((car, index) => [car.carId, CAR_COLORS[index % CAR_COLORS.length]]));

  // Real detected corners (29/08/2026: "concordo, é isso que eu realmente quero, setores reais"),
  // not fixed %-of-lap bins -- same GPS-based lateral-acceleration detector Meu Debrief already uses
  // (lib/corner-detection.ts), run on whichever car's trace anchors the map above. Corner names come
  // from the same researched lookup table debrief.ts uses, matched by detected count.
  const gpsForDetection = outlineSource ? outlineSource.map((point) => ({ distance: point.distance, lat: point.lat ?? null, lon: point.lon ?? null })) : [];
  const detectedCorners = gpsForDetection.length ? detectCornersFromGps(gpsForDetection) : [];
  const cornerNames = trackResult.data ? lookupCornerNames(trackResult.data.name, trackResult.data.variant ?? "", detectedCorners.length) : null;

  const sectors = detectedCorners.map((corner, index) => {
    const start = corner.startDistance, end = corner.endDistance;
    const times = ranked.map((car) => {
      if (!car.fastestTrace) return null;
      const fullLapIntegral = integrateInverseSpeed(car.fastestTrace, 0, 100);
      if (fullLapIntegral <= 0) return null;
      const lapScale = car.bestLapSeconds / fullLapIntegral;
      const segmentSeconds = integrateInverseSpeed(car.fastestTrace, start, end) * lapScale;
      return segmentSeconds > 0 ? { carId: car.carId, carName: car.carName, seconds: Number(segmentSeconds.toFixed(3)) } : null;
    }).filter((item): item is { carId: number; carName: string; seconds: number } => item !== null);
    const winner = times.length ? times.reduce((best, item) => (item.seconds < best.seconds ? item : best)) : null;
    const withTraces = ranked.filter((car) => car.fastestTrace);
    const curves = withTraces.map((car) => ({
      carId: car.carId,
      brake: segmentCurve(car.fastestTrace!, start, end, "brake"),
      throttle: segmentCurve(car.fastestTrace!, start, end, "throttle"),
      speed: segmentCurve(car.fastestTrace!, start, end, "speed"),
      steering: segmentCurve(car.fastestTrace!, start, end, "steering"),
      gear: segmentCurve(car.fastestTrace!, start, end, "gear"),
    }));
    const gps = withTraces.map((car) => ({ carId: car.carId, points: segmentGps(car.fastestTrace!, start, end) }));
    const consistency = ranked.map((car) => ({ carId: car.carId, ...(cornerConsistencyScore(car.sampleTraces, start, end) ?? { score: null, label: null }) }));
    const trackUsage = withTraces.map((car) => ({ carId: car.carId, avgPct: cornerTrackUsage(car.fastestTrace!, boundary, start, end) }));
    return {
      segment: index, name: cornerNames?.[index] ?? null, cornerNumber: corner.number, startPct: start, endPct: end,
      winnerCarId: winner?.carId ?? null,
      times: times.map((item) => ({ ...item, deltaSeconds: winner ? Number((item.seconds - winner.seconds).toFixed(3)) : 0 })).sort((a, b) => a.seconds - b.seconds),
      curves, gps, consistency, trackUsage,
    };
  });

  // Overview map coloring stays fixed %-of-lap bins, NOT the real corners above (29/08/2026: "eu
  // ainda quero a coloração da pista por setor, não por curva") -- real corners leave long gray gaps
  // on every straight (nothing detected as "turning" there), which reads as missing data on the
  // summary map; fixed bins give full, even coverage for "who's fastest where" at a glance. The
  // per-corner deep-dive below is where real corners actually matter. Finer than TRACK_USAGE_SEGMENTS
  // (20 vs 10) since this is the only thing using these bins now, not shared with the width-usage
  // strip -- smoother color transitions on the map.
  const MAP_COLOR_SEGMENTS = 20;
  const mapSegments = Array.from({ length: MAP_COLOR_SEGMENTS }, (_, index) => {
    const start = (index / MAP_COLOR_SEGMENTS) * 100, end = ((index + 1) / MAP_COLOR_SEGMENTS) * 100;
    const times = ranked.map((car) => {
      if (!car.fastestTrace) return null;
      const fullLapIntegral = integrateInverseSpeed(car.fastestTrace, 0, 100);
      if (fullLapIntegral <= 0) return null;
      const lapScale = car.bestLapSeconds / fullLapIntegral;
      const segmentSeconds = integrateInverseSpeed(car.fastestTrace, start, end) * lapScale;
      return segmentSeconds > 0 ? { carId: car.carId, seconds: segmentSeconds } : null;
    }).filter((item): item is { carId: number; seconds: number } => item !== null);
    const winner = times.length ? times.reduce((best, item) => (item.seconds < best.seconds ? item : best)) : null;
    return { startPct: start, endPct: end, winnerCarId: winner?.carId ?? null };
  });

  const cars = ranked.map(({ fastestTrace: _fastestTrace, sampleTraces: _sampleTraces, ...car }) => ({ ...car, color: carColor.get(car.carId)! }));

  return {
    status: "ok",
    track: trackResult.data ? { id: trackResult.data.id, name: trackResult.data.name, variant: trackResult.data.variant } : { id: trackId, name: `Pista ${trackId}`, variant: null },
    seasons, selectedSeasonId,
    cars, trackOutline, sectors, mapSegments,
    narrative: buildCarComparisonNarrative(cars, sectors),
  };
}

export async function GET(request: Request) {
  try {
    const { data: driver } = await supabaseAdmin.from("drivers").select("id").order("updated_at", { ascending: false }).limit(1).single();
    if (!driver) throw new Error("Piloto não encontrado");

    const params = new URL(request.url).searchParams;
    const categoryParam = params.get("category");
    if (categoryParam !== "gt3" && categoryParam !== "gtp") return NextResponse.json({ status: "error", message: "category deve ser gt3 ou gtp" }, { status: 400 });
    const seasonParam = params.get("season"); // null = auto (latest season); "all" = no season filter; otherwise a specific season_id

    const trackIdParam = params.get("trackId");
    if (!trackIdParam) {
      const result = await listSeasonsAndTracks(driver.id, categoryParam, seasonParam);
      return NextResponse.json({ status: "ok", ...result });
    }
    const trackId = Number(trackIdParam);
    if (!Number.isFinite(trackId)) return NextResponse.json({ status: "error", message: "trackId inválido" }, { status: 400 });
    const result = await buildComparison(driver.id, trackId, categoryParam, seasonParam);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
