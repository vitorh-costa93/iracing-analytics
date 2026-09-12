import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { detectCornersFromGps, estimateLapLengthMeters, type DetectedCorner } from "@/lib/corner-detection";
import { computeCornerBaselines, type CoachSample, type CoachCorner } from "@/lib/local-coach-baselines";
import { lookupCornerNames } from "@/lib/track-corners";

// 12/09/2026: feeds iracing-live-coach (separate repo, C#/.NET) -- see
// docs/superpowers/specs/2026-09-12-live-coach-overlay-design.md. Distinct secret from
// GARAGE61_IMPORT_SECRET so the two integrations can be rotated independently.
export const maxDuration = 300;

type ChannelKey = "brake" | "steering" | "speed" | "gear" | "rpm" | "lat" | "lon" | "throttle";
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
// Same convention as app/api/telemetry/car-comparison/route.ts's own parseLapCsv -- kept local per
// this codebase's existing pattern of each telemetry route carrying its own small copy.
function parseLapCsv(csv: string): TracePoint[] {
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const delimiter = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const headers = parseCsvLine(lines[0], delimiter).map(normalizedHeader);
  const find = (...aliases: string[]) => headers.findIndex((header) => aliases.includes(header));
  const distanceIndex = find("lapdistpct", "lapdistancepct", "distancepct", "lapdist", "distance");
  if (distanceIndex < 0) return [];
  const indexes: Record<ChannelKey, number> = {
    brake: find("brake", "brakeraw", "brakepressure", "brakeinput"),
    steering: find("steeringwheelangle", "steeringangle"),
    speed: find("speed", "speedms", "speedkph", "carspeed"),
    gear: find("gear"), rpm: find("rpm", "enginerpm"),
    lat: find("lat", "latitude"), lon: find("lon", "longitude"),
    throttle: find("throttle", "throttleraw", "throttleposition", "throttleinput"),
  };
  const rows = lines.slice(1).map((line) => parseCsvLine(line, delimiter));
  const points = rows.map((row) => {
    const point: TracePoint = { distance: Number(row[distanceIndex]) };
    for (const [key, index] of Object.entries(indexes) as [ChannelKey, number][]) {
      if (index >= 0 && row[index] !== undefined && row[index] !== "") {
        const value = Number(row[index]);
        if (Number.isFinite(value)) point[key] = value;
      }
    }
    return point;
  }).filter((point) => Number.isFinite(point.distance)).sort((a, b) => a.distance - b.distance);
  if (!points.length) return [];
  // Same conditional normalization as app/api/telemetry/car-comparison/route.ts's own parseLapCsv --
  // depending on the CSV source column, lapDistPct can come through as either 0-1 or 0-100; only
  // rescale when the trace's own max distance shows it's actually the 0-1 scale.
  const maxDistance = Math.max(...points.map((point) => point.distance));
  if (maxDistance > 0 && maxDistance <= 1.01) points.forEach((point) => { point.distance *= 100; });
  return points;
}

const CANDIDATE_LAPS = 15; // recent laps to sample for this car/track -- enough for a stable median without downloading this driver's entire history every call
// Coarse backstop only, same value/reasoning as app/api/telemetry/car-comparison/route.ts's own
// MIN_PLAUSIBLE_LAP_SECONDS -- no road course this feature covers has a real lap anywhere near this short.
const MIN_PLAUSIBLE_LAP_SECONDS = 20;
// a genuine full lap's telemetry spans nearly the whole 0-100% lap distance -- same constant/reasoning
// as app/api/telemetry/car-comparison/route.ts's own MIN_LAP_COVERAGE_PCT.
const MIN_LAP_COVERAGE_PCT = 85;

function traceCoveragePct(points: TracePoint[]) {
  if (!points.length) return 0;
  const distances = points.map((point) => point.distance);
  return Math.max(...distances) - Math.min(...distances);
}

// PERMANENT GUARD-RAIL (CLAUDE.md "Non-negotiable rules" #7) -- see app/api/dashboard/report/route.ts's
// own comment for the real incident this class of guard-rail exists because of. This route downloads
// up to CANDIDATE_LAPS*3 CSVs from Supabase Storage per request; without a cache, repeated polling from
// the live-coach desktop app for the same car+track would hit that same Storage egress pattern. Keyed
// by car+track since that's this route's own natural cache key.
const baselineCache = new Map<string, { expiresAt: number; payload: unknown }>();
const BASELINE_CACHE_TTL_MS = 120_000;
const CACHE_CONTROL_HEADER = "private, max-age=120, stale-while-revalidate=300";

export async function GET(request: Request) {
  const secret = process.env.LOCAL_COACH_SECRET;
  if (!secret || request.headers.get("x-import-key") !== secret) {
    return NextResponse.json({ status: "error", message: "Chave inválida" }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const carParam = params.get("car");
  const trackParam = params.get("track");
  const carId = Number(carParam);
  const trackId = Number(trackParam);
  // Number(null) === 0 (finite), so a plain Number.isFinite check alone would silently accept a
  // missing param -- the param's raw presence must be checked too, not just whether its numeric
  // conversion happens to be finite.
  if (!carParam || !trackParam || !Number.isFinite(carId) || !Number.isFinite(trackId)) {
    return NextResponse.json({ status: "error", message: "car e track são obrigatórios" }, { status: 400 });
  }

  const cacheKey = `${carId}:${trackId}`;
  const cached = baselineCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.payload, { headers: { "Cache-Control": CACHE_CONTROL_HEADER } });
  }

  try {
    const { data: driver, error: driverError } = await supabaseAdmin.from("drivers").select("id").order("updated_at", { ascending: false }).limit(1).single();
    if (driverError || !driver) throw new Error("Piloto não encontrado");

    // Fetches a wider pool than CANDIDATE_LAPS and filters plausibility in application code (same
    // off_track/pit_lane/pit_in/pit_out/missing exclusion, plus the same MIN_PLAUSIBLE_LAP_SECONDS
    // floor, as app/api/telemetry/car-comparison/route.ts's own isValidLap) BEFORE capping --
    // selecting exactly CANDIDATE_LAPS rows first, then filtering, could leave a baseline built from
    // only 2-3 genuinely valid laps out of 15 fetched on a session with a lot of off-track excursions,
    // the same class of bug already found and fixed in car-comparison. `incomplete` is deliberately
    // NOT checked here either, for the same reason documented on isValidLap: it's nearly redundant
    // with off_track/clean=false on the cases that motivated it, and a hard gate on it over-excludes.
    const { data: rawLapRows, error: lapsError } = await supabaseAdmin
      .from("laps")
      .select("id,lap_time,telemetry_path,off_track,pit_lane,pit_in,pit_out,missing")
      .eq("driver_id", driver.id).eq("car_id", carId).eq("track_id", trackId)
      .not("telemetry_path", "is", null).not("lap_time", "is", null)
      .order("synced_at", { ascending: false })
      .limit(CANDIDATE_LAPS * 3);
    if (lapsError) throw lapsError;
    const lapRows = (rawLapRows ?? [])
      .filter((row) => Number(row.lap_time) > MIN_PLAUSIBLE_LAP_SECONDS && !row.off_track && !row.pit_lane && !row.pit_in && !row.pit_out && !row.missing)
      .slice(0, CANDIDATE_LAPS);
    if (!lapRows.length) return NextResponse.json({ status: "ok", trackLengthMeters: null, corners: [] });

    const traces = await Promise.all(lapRows.map(async (row) => {
      const { data: file, error } = await supabaseAdmin.storage.from("telemetry").download(row.telemetry_path!);
      if (error || !file) return null;
      return { points: parseLapCsv(await file.text()), lapTimeSeconds: Number(row.lap_time) };
    }));
    const valid = traces.filter((trace): trace is { points: TracePoint[]; lapTimeSeconds: number } => !!trace && trace.points.length > 20);
    if (!valid.length) return NextResponse.json({ status: "ok", trackLengthMeters: null, corners: [] });

    // GPS traces must have credible coverage before trusting them for corner geometry (CLAUDE.md:
    // "Reject broken/partial laps by GPS path coverage, not only by reported lap_time or clean flag").
    // Pick the highest-coverage lap among `valid` for corner detection/track length, rather than
    // valid[0] (the most-recently-synced lap, chosen for no quality reason).
    const bestForCorners = [...valid].sort((a, b) => traceCoveragePct(b.points) - traceCoveragePct(a.points))[0];
    if (traceCoveragePct(bestForCorners.points) < MIN_LAP_COVERAGE_PCT) {
      return NextResponse.json({ status: "ok", trackLengthMeters: null, corners: [] });
    }

    const detectedCorners: DetectedCorner[] = detectCornersFromGps(
      bestForCorners.points.map((point) => ({ distance: point.distance, lat: point.lat ?? null, lon: point.lon ?? null })),
    );
    const gpsPoints = bestForCorners.points
      .filter((point): point is TracePoint & { lat: number; lon: number } => point.lat !== undefined && point.lon !== undefined)
      .sort((a, b) => a.distance - b.distance);
    const meanLat = gpsPoints.length ? gpsPoints.reduce((sum, point) => sum + point.lat, 0) / gpsPoints.length : 0;
    const lonScale = Math.cos((meanLat * Math.PI) / 180);
    const trackLengthMeters = gpsPoints.length ? Math.round(estimateLapLengthMeters(gpsPoints, lonScale)) : null;

    const { data: trackRow } = await supabaseAdmin.from("tracks").select("name,variant").eq("id", trackId).maybeSingle();
    const cornerNames = trackRow ? lookupCornerNames(trackRow.name, trackRow.variant ?? "", detectedCorners.length) : null;
    const corners: CoachCorner[] = detectedCorners.map((corner) => ({
      number: corner.number, name: cornerNames?.[corner.number - 1] ?? null,
      startDistance: corner.startDistance, endDistance: corner.endDistance,
    }));

    const samples: CoachSample[][] = valid.map((trace) => trace.points.map((point) => ({
      distance: point.distance, brake: point.brake, steeringRad: point.steering, rpm: point.rpm, gear: point.gear, speedMs: point.speed,
      throttle: point.throttle,
    })));
    const baselines = computeCornerBaselines(samples, corners, valid.map((trace) => trace.lapTimeSeconds));

    const payload = { status: "ok", trackLengthMeters, corners: baselines.corners, gearModel: baselines.gearModel };
    baselineCache.set(cacheKey, { expiresAt: Date.now() + BASELINE_CACHE_TTL_MS, payload });
    return NextResponse.json(payload, { headers: { "Cache-Control": CACHE_CONTROL_HEADER } });
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
