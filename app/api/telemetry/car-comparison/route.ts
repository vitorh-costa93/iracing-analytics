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
  session_id?: string | null;
  sessions?: { season_id: string | null; season_name: string | null; started_at: string | null } | null;
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

/** The real, per-track/category fix for the broken-record problem above: a fixed time floor can't
 * work across every track's own lap-time scale (20s excludes junk at Spa but would also exclude a
 * genuine short-oval lap elsewhere), so instead this computes the pool's own median lap time and
 * excludes anything under half of it. A real practice lap -- even a messy, off-pace one -- is very
 * rarely under half the field's typical pace; a broken/partial telemetry record reporting a handful
 * of seconds for a 2+ minute circuit always is. Needs at least 4 laps in the pool to trust the
 * median; smaller pools are left alone (not enough signal to safely reject anything). */
function filterPlausibleTimes<T extends { lap_time: number | null }>(laps: T[]) {
  const times = laps.map((lap) => Number(lap.lap_time)).filter((value) => value > 0);
  if (times.length < 4) return laps;
  const floor = median(times) * 0.5;
  return laps.filter((lap) => Number(lap.lap_time) >= floor);
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
  if (!byTrack.size) return [];

  const allCarIds = [...new Set([...byTrack.values()].flatMap((set) => [...set]))];
  const categoryByCar = await resolveCarCategories(allCarIds);

  const perTrackCategoryCars = new Map<number, Partial<Record<Category, number[]>>>();
  for (const [trackId, cars] of byTrack) {
    const byCategory: Partial<Record<Category, number[]>> = {};
    for (const carId of cars) {
      const category = categoryByCar.get(carId);
      if (!category) continue;
      (byCategory[category] ??= []).push(carId);
    }
    const eligibleCategories: Partial<Record<Category, number[]>> = {};
    for (const category of CATEGORIES) {
      if ((byCategory[category]?.length ?? 0) >= 2) eligibleCategories[category] = byCategory[category];
    }
    if (Object.keys(eligibleCategories).length) perTrackCategoryCars.set(trackId, eligibleCategories);
  }
  if (!perTrackCategoryCars.size) return [];

  const trackIds = [...perTrackCategoryCars.keys()];
  const carIds = [...new Set([...perTrackCategoryCars.values()].flatMap((byCategory) => Object.values(byCategory).flat()))];
  const [tracksResult, carsResult] = await Promise.all([
    supabaseAdmin.from("tracks").select("id,name,variant").in("id", trackIds),
    supabaseAdmin.from("cars").select("id,name").in("id", carIds),
  ]);
  const trackNames = new Map((tracksResult.data ?? []).map((row) => [row.id, row]));
  const carNames = new Map((carsResult.data ?? []).map((row) => [row.id, row.name as string]));

  return [...perTrackCategoryCars.entries()].map(([trackId, byCategory]) => {
    const track = trackNames.get(trackId);
    return {
      trackId,
      trackName: track?.name ?? `Pista ${trackId}`,
      trackVariant: track?.variant ?? null,
      categories: CATEGORIES.filter((category) => byCategory[category]).map((category) => ({
        category, label: CATEGORY_LABEL[category],
        carCount: byCategory[category]!.length,
        carNames: byCategory[category]!.map((id) => carNames.get(id) ?? `Carro ${id}`).sort((a, b) => a.localeCompare(b, "pt-BR")),
      })),
    };
  }).sort((a, b) => a.trackName.localeCompare(b.trackName, "pt-BR"));
}

async function buildComparison(driverId: string, trackId: number, category: Category, seasonParam: string | null) {
  const { data: lapsData, error } = await supabaseAdmin
    .from("laps")
    .select("id,car_id,track_id,lap_time,clean,off_track,pit_lane,pit_in,pit_out,incomplete,missing,telemetry_path,session_id,sessions(season_id,season_name,started_at)")
    .eq("driver_id", driverId).eq("track_id", trackId);
  if (error) throw error;

  const byCarAll = new Map<number, LapRow[]>();
  for (const lap of (lapsData ?? []) as unknown as LapRow[]) {
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

  const perCar = await Promise.all(carIds.map(async (carId) => {
    const laps = byCar.get(carId)!.slice().sort((a, b) => Number(a.lap_time) - Number(b.lap_time));
    const bestLapSeconds = Number(laps[0].lap_time);
    const cleanedTimes = trimSlowOutliers(laps.map((lap) => Number(lap.lap_time))).sort((a, b) => a - b);
    const timePool = cleanedTimes.slice(0, TIME_POOL_LAPS);
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
    const trackUsageSegments = boundary && traces.length ? trackWidthUsageBySegment(traces[0], boundary) : null;

    return {
      carId, carName: carNames.get(carId) ?? `Carro ${carId}`,
      lapsAnalyzed: laps.length,
      bestLapSeconds, bestLapFormatted: formatLapTime(bestLapSeconds),
      lapTimeConsistency, inputConsistency, trackUsage, trackUsageSegments,
    };
  }));

  const overallBest = Math.min(...perCar.map((car) => car.bestLapSeconds));
  const cars = perCar
    .map((car) => ({ ...car, deltaSeconds: Number((car.bestLapSeconds - overallBest).toFixed(3)) }))
    .sort((a, b) => a.bestLapSeconds - b.bestLapSeconds);

  return {
    status: "ok",
    track: trackResult.data ? { id: trackResult.data.id, name: trackResult.data.name, variant: trackResult.data.variant } : { id: trackId, name: `Pista ${trackId}`, variant: null },
    seasons, selectedSeasonId,
    cars,
  };
}

export async function GET(request: Request) {
  try {
    const { data: driver } = await supabaseAdmin.from("drivers").select("id").order("updated_at", { ascending: false }).limit(1).single();
    if (!driver) throw new Error("Piloto não encontrado");

    const params = new URL(request.url).searchParams;
    const trackIdParam = params.get("trackId");
    if (!trackIdParam) {
      const tracks = await listEligibleTracks(driver.id);
      return NextResponse.json({ status: "ok", tracks });
    }
    const trackId = Number(trackIdParam);
    if (!Number.isFinite(trackId)) return NextResponse.json({ status: "error", message: "trackId inválido" }, { status: 400 });
    const categoryParam = params.get("category");
    if (categoryParam !== "gt3" && categoryParam !== "gtp") return NextResponse.json({ status: "error", message: "category deve ser gt3 ou gtp" }, { status: 400 });
    const seasonParam = params.get("season"); // null = auto (latest season); "all" = no season filter; otherwise a specific season_id
    const result = await buildComparison(driver.id, trackId, categoryParam, seasonParam);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
