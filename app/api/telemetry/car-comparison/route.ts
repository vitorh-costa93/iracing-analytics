import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Same class of route as app/api/telemetry/debrief/route.ts: up to a handful of cars, each needing
// its own telemetry downloads/decodes, well past Vercel's platform-default timeout.
export const maxDuration = 300;

const GARAGE61_BASE = "https://garage61.net/api/v1";
const MAX_CARS = 6; // bounds cost if a driver has tested many cars at one track; covers every real case seen so far (2-4)
const TELEMETRY_SAMPLE_LAPS = 5; // per car, for input-consistency and track-usage -- same pool size logic as debrief's MAX_LAPS
const TIME_POOL_LAPS = 10; // per car, for lap-time consistency -- mirrors debrief's MAX_LAPS

type LapRow = {
  id: string; car_id: number | null; track_id: number | null; lap_time: number | null; clean: boolean | null;
  off_track: boolean | null; pit_lane: boolean | null; pit_in: boolean | null; pit_out: boolean | null;
  incomplete: boolean | null; missing: boolean | null; telemetry_path: string | null;
};

type ChannelKey = "throttle" | "brake" | "steering" | "lat" | "lon";
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

const BINS = Array.from({ length: 21 }, (_, index) => index * 5); // 0,5,...,100 -- coarser than debrief's own (this only needs a per-car summary score, not a plottable curve)
const CHANNELS: ("throttle" | "brake" | "steering")[] = ["throttle", "brake", "steering"];
const CHANNEL_SCALE: Record<string, number> = { throttle: 1, brake: 1, steering: 0.15 };

/** One combined input-consistency score for a car: mean, over throttle/brake/steering, of each
 * channel's mean(stddev/scale) across BINS -- the same normalize-then-average approach as debrief's
 * channelStats, collapsed to a single number since this view compares CARS, not channels. */
function inputConsistencyScore(traces: TracePoint[][]) {
  if (traces.length < 3) return null;
  const channelScores = CHANNELS.map((channel) => {
    const binScores = BINS.map((distance) => {
      const values = traces.map((points) => interpolate(points, distance, channel)).filter((value): value is number => value !== null);
      if (values.length < 3) return null;
      const avg = mean(values);
      return stddev(values, avg) / CHANNEL_SCALE[channel];
    }).filter((value): value is number => value !== null);
    return binScores.length ? mean(binScores) : null;
  }).filter((value): value is number => value !== null);
  if (!channelScores.length) return null;
  const score = mean(channelScores);
  return { score: Number(score.toFixed(2)), label: consistencyRatioLabel(score) };
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

function isValidLap(lap: LapRow) {
  return lap.clean && Number(lap.lap_time) > 0 && !lap.off_track && !lap.pit_lane && !lap.pit_in && !lap.pit_out && !lap.incomplete && !lap.missing;
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
      .select("car_id,track_id,clean,lap_time,off_track,pit_lane,pit_in,pit_out,incomplete,missing")
      .eq("driver_id", driverId)
      .not("car_id", "is", null).not("track_id", "is", null)
      .range(offset, offset + LAPS_PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as LapRow[]));
    if (!data || data.length < LAPS_PAGE_SIZE) break;
  }
  return rows;
}

async function listEligibleTracks(driverId: string) {
  const rows = await fetchAllDriverLaps(driverId);

  const byTrack = new Map<number, Set<number>>();
  for (const lap of rows) {
    if (!isValidLap(lap)) continue;
    const trackId = lap.track_id as number, carId = lap.car_id as number;
    if (!byTrack.has(trackId)) byTrack.set(trackId, new Set());
    byTrack.get(trackId)!.add(carId);
  }
  const eligible = [...byTrack.entries()].filter(([, cars]) => cars.size >= 2);
  if (!eligible.length) return [];

  const trackIds = eligible.map(([trackId]) => trackId);
  const carIds = [...new Set(eligible.flatMap(([, cars]) => [...cars]))];
  const [tracksResult, carsResult] = await Promise.all([
    supabaseAdmin.from("tracks").select("id,name,variant").in("id", trackIds),
    supabaseAdmin.from("cars").select("id,name").in("id", carIds),
  ]);
  const trackNames = new Map((tracksResult.data ?? []).map((row) => [row.id, row]));
  const carNames = new Map((carsResult.data ?? []).map((row) => [row.id, row.name as string]));

  return eligible.map(([trackId, cars]) => {
    const track = trackNames.get(trackId);
    return {
      trackId,
      trackName: track?.name ?? `Pista ${trackId}`,
      trackVariant: track?.variant ?? null,
      carCount: cars.size,
      carNames: [...cars].map((id) => carNames.get(id) ?? `Carro ${id}`).sort((a, b) => a.localeCompare(b, "pt-BR")),
    };
  }).sort((a, b) => a.trackName.localeCompare(b.trackName, "pt-BR"));
}

async function buildComparison(driverId: string, trackId: number) {
  const { data: lapsData, error } = await supabaseAdmin
    .from("laps")
    .select("id,car_id,track_id,lap_time,clean,off_track,pit_lane,pit_in,pit_out,incomplete,missing,telemetry_path")
    .eq("driver_id", driverId).eq("track_id", trackId);
  if (error) throw error;

  const byCar = new Map<number, LapRow[]>();
  for (const lap of (lapsData ?? []) as LapRow[]) {
    if (!isValidLap(lap)) continue;
    const carId = lap.car_id as number;
    if (!byCar.has(carId)) byCar.set(carId, []);
    byCar.get(carId)!.push(lap);
  }
  const carIds = [...byCar.keys()]
    .sort((a, b) => Math.min(...byCar.get(a)!.map((l) => Number(l.lap_time))) - Math.min(...byCar.get(b)!.map((l) => Number(l.lap_time))))
    .slice(0, MAX_CARS);
  if (carIds.length < 2) return { status: "ok", track: null, cars: [], message: "Menos de 2 carros com voltas válidas nessa pista." };

  const [carsResult, trackResult, boundary] = await Promise.all([
    supabaseAdmin.from("cars").select("id,name").in("id", carIds),
    supabaseAdmin.from("tracks").select("id,name,variant").eq("id", trackId).maybeSingle(),
    loadTrackBoundaryEdges(trackId).catch(() => null),
  ]);
  const carNames = new Map((carsResult.data ?? []).map((row) => [row.id, row.name as string]));

  const perCar = await Promise.all(carIds.map(async (carId) => {
    const laps = byCar.get(carId)!.slice().sort((a, b) => Number(a.lap_time) - Number(b.lap_time));
    const timePool = laps.slice(0, TIME_POOL_LAPS).map((lap) => Number(lap.lap_time));
    const bestLapSeconds = timePool[0];
    const lapTimeConsistency = timePool.length >= 3 ? (() => {
      const avg = mean(timePool);
      const sd = stddev(timePool, avg);
      return { stddev: Number(sd.toFixed(3)), label: consistencyRatioLabel(sd / 0.4) };
    })() : null;

    const sampleLaps = laps.slice(0, TELEMETRY_SAMPLE_LAPS);
    const traces = (await Promise.all(sampleLaps.map((lap) => downloadTrace(lap.id, trackId, lap.telemetry_path))))
      .filter((points): points is TracePoint[] => !!points);

    const inputConsistency = inputConsistencyScore(traces);
    const trackUsage = boundary && traces.length ? trackWidthUsage(traces[0], boundary) : null;

    return {
      carId, carName: carNames.get(carId) ?? `Carro ${carId}`,
      lapsAnalyzed: laps.length,
      bestLapSeconds, bestLapFormatted: formatLapTime(bestLapSeconds),
      lapTimeConsistency, inputConsistency, trackUsage,
    };
  }));

  const overallBest = Math.min(...perCar.map((car) => car.bestLapSeconds));
  const cars = perCar
    .map((car) => ({ ...car, deltaSeconds: Number((car.bestLapSeconds - overallBest).toFixed(3)) }))
    .sort((a, b) => a.bestLapSeconds - b.bestLapSeconds);

  return {
    status: "ok",
    track: trackResult.data ? { id: trackResult.data.id, name: trackResult.data.name, variant: trackResult.data.variant } : { id: trackId, name: `Pista ${trackId}`, variant: null },
    cars,
  };
}

export async function GET(request: Request) {
  try {
    const { data: driver } = await supabaseAdmin.from("drivers").select("id").order("updated_at", { ascending: false }).limit(1).single();
    if (!driver) throw new Error("Piloto não encontrado");

    const trackIdParam = new URL(request.url).searchParams.get("trackId");
    if (!trackIdParam) {
      const tracks = await listEligibleTracks(driver.id);
      return NextResponse.json({ status: "ok", tracks });
    }
    const trackId = Number(trackIdParam);
    if (!Number.isFinite(trackId)) return NextResponse.json({ status: "error", message: "trackId inválido" }, { status: 400 });
    const result = await buildComparison(driver.id, trackId);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
