import { NextResponse } from "next/server";
import { garage61Get } from "@/lib/garage61";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { readTelemetryText, storeTelemetryCsv } from "@/lib/telemetry-storage";
import { lookupCornerNames } from "@/lib/track-corners";
import { raceWinnerGap } from "@/lib/winner-gap";
import { detectCorners as detectCornersFromLatAccel, detectCornersFromGps } from "@/lib/corner-detection";
import { summarizeTractionEvents, type TractionSample } from "@/lib/traction-events";
import { describeWheelspinHabit, describeCorrectionHabit } from "@/lib/traction-narrative";

// Same missing-maxDuration bug as the sync routes (see app/api/sync/incremental/route.ts's comment):
// this is the heaviest route in the app -- up to MAX_LAPS laps across up to 3 rating categories, each
// needing its own paginated Garage61 /laps fetch plus telemetry download/decode -- and Vercel was
// killing it at the platform default well before that finished, which is exactly the "Meu Debrief não
// tá carregando" symptom reported (29/08/2026): the request just hangs client-side with no error.
export const maxDuration = 300;

const GARAGE61_BASE = "https://garage61.net/api/v1";
const MIN_LAPS = 5;
const MAX_LAPS = 10;
const PAGE_SIZE = 250;
// "gtp_car" is a debrief-only grouping, not an iRacing/Garage61 iRating category — Garage61 only
// tracks separate iRating for formula_car/sports_car (see rating_history.category), GTP races count
// towards the sports_car iRating. We still split it into its own debrief tab since GTP (Ferrari 499P,
// Porsche 963, etc.) drives very differently from GT3 and the driver races it as a distinct category.
const RATING_CATEGORIES = ["formula_car", "sports_car", "gtp_car"] as const;
type RatingCategory = (typeof RATING_CATEGORIES)[number];

type Garage61Lap = {
  id: string; startTime?: string; lapTime?: number; lapNumber?: number; sessionType?: number; event?: string | { id?: string };
  clean?: boolean; joker?: boolean; discontinuity?: boolean; missing?: boolean; incomplete?: boolean;
  offtrack?: boolean; pitLane?: boolean; pitIn?: boolean; pitOut?: boolean; canViewTelemetry?: boolean;
};
type Garage61LapsResponse = { items?: Garage61Lap[]; total?: number };

/** Paginates through Garage61's /laps endpoint fully — some car/track pairs have 250+ laps
 * this season, and fetching only offset=0 silently drops everything past the first page. */
async function fetchAllLaps(carId: number, trackId: number): Promise<Garage61Lap[]> {
  const all: Garage61Lap[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const response = await garage61Get<Garage61LapsResponse>("/laps", { cars: carId, tracks: trackId, drivers: "me", group: "none", unclean: "true", lapTypes: "1,2,3,4", limit: PAGE_SIZE, offset });
    const items = response.items ?? [];
    all.push(...items);
    if (items.length < PAGE_SIZE) break;
  }
  return all;
}

type ChannelKey = "throttle" | "brake" | "steering" | "gear" | "rpm" | "speed" | "latAccel" | "lat" | "lon" | "yawRate";
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

function parseLapCsv(csv: string): { points: TracePoint[]; hasOvertakeChannel: boolean } {
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return { points: [], hasOvertakeChannel: false };
  const delimiter = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const headers = parseCsvLine(lines[0], delimiter).map(normalizedHeader);
  const find = (...aliases: string[]) => headers.findIndex((header) => aliases.includes(header));
  const distanceIndex = find("lapdistpct", "lapdistancepct", "distancepct", "lapdist", "distance");
  if (distanceIndex < 0) return { points: [], hasOvertakeChannel: false };
  const indexes: Record<ChannelKey, number> = {
    throttle: find("throttle", "throttleraw", "throttleposition", "throttleinput"),
    brake: find("brake", "brakeraw", "brakepressure", "brakeinput"),
    steering: find("steeringwheelangle", "steeringangle"),
    gear: find("gear"), rpm: find("rpm", "engine0rpm"),
    speed: find("speed", "speedms", "speedkph", "carspeed"),
    latAccel: find("lataccel", "lateralacceleration"),
    lat: find("lat", "latitude"), lon: find("lon", "longitude"),
    // Added 11/09/2026 for destracionamento/microcorreções detection (lib/traction-events.ts).
    yawRate: find("yawrate"),
  };
  const hasOvertakeChannel = find("pushtopass") >= 0 || find("p2pstatus") >= 0;
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
  if (!points.length) return { points: [], hasOvertakeChannel };
  const maxDistance = Math.max(...points.map((point) => point.distance));
  if (maxDistance > 0 && maxDistance <= 1.01) points.forEach((point) => { point.distance *= 100; });
  return { points, hasOvertakeChannel };
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

const CHANNEL_LABELS: Record<ChannelKey, string> = { throttle: "Acelerador", brake: "Freio", steering: "Volante", gear: "Marcha", rpm: "RPM", speed: "Velocidade", latAccel: "Força na curva", lat: "Latitude", lon: "Longitude", yawRate: "Taxa de guinada" };
const CHANNEL_PHRASE: Record<ChannelKey, string> = { throttle: "a mesma abertura de acelerador", brake: "a mesma pressão de freio", steering: "o mesmo tanto de volante", gear: "a mesma marcha", rpm: "a mesma rotação do motor", speed: "a mesma velocidade", latAccel: "a mesma força nas curvas", lat: "a mesma posição", lon: "a mesma posição", yawRate: "a mesma rotação do carro" };
const CHART_CHANNELS: ChannelKey[] = ["throttle", "brake", "steering"];

function formatLapTime(value: number) { const minutes = Math.floor(value / 60), seconds = value - minutes * 60; return `${minutes}:${seconds.toFixed(3).padStart(6, "0")}`; }

function mean(values: number[]) { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function stddev(values: number[], avg: number) { return Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length); }
function median(values: number[]) { const sorted = [...values].sort((a, b) => a - b); const mid = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2; }

/**
 * Flags statistically anomalous lap times using a robust median + MAD (median absolute deviation)
 * z-score instead of mean/stddev, since a single overtake-boosted lap is exactly the kind of point
 * that would otherwise skew a plain mean/stddev calculation and hide itself. Garage61's lap CSV
 * export has no push-to-pass/overtake channel at all (confirmed by inspecting real headers), so this
 * is the only available proxy: an abnormally FAST lap relative to the rest of the pool is flagged as
 * a likely-overtake outlier and excluded from the consistency analysis rather than silently kept.
 */
function findOutlierLaps<T extends { lapTime: number }>(items: T[], zThreshold = 2.5) {
  if (items.length < 5) return { kept: items, outliers: [] as (T & { zScore: number })[] };
  const times = items.map((item) => item.lapTime);
  const med = median(times);
  const mad = median(times.map((value) => Math.abs(value - med))) || 0.001;
  const scaled = mad * 1.4826; // scale MAD to be comparable to stddev under normality
  const withScore = items.map((item) => ({ ...item, zScore: (item.lapTime - med) / scaled }));
  const outliers = withScore.filter((item) => item.zScore < -zThreshold);
  const outlierIds = new Set(outliers.map((item) => item));
  const kept = withScore.filter((item) => !outlierIds.has(item));
  return { kept, outliers };
}

const CORNER_WINDOW = 7; // % of lap distance searched around each corner apex for onset/reapply crossings
const BRAKE_THRESHOLD = 0.15;
const THROTTLE_THRESHOLD = 0.2;

type CornerPointMetrics = { brakeOnset: number | null; apexSpeed: number | null; apexDistance: number | null; throttleReapply: number | null };

function analyzeCornerForLap(points: TracePoint[], cornerDistance: number): CornerPointMetrics {
  const windowStart = cornerDistance - CORNER_WINDOW;
  const windowEnd = cornerDistance + CORNER_WINDOW;
  const step = 0.5;
  const samples: { distance: number; speed: number | null; brake: number | null; throttle: number | null }[] = [];
  for (let distance = windowStart; distance <= windowEnd; distance += step) {
    const wrapped = ((distance % 100) + 100) % 100;
    samples.push({ distance, speed: interpolate(points, wrapped, "speed"), brake: interpolate(points, wrapped, "brake"), throttle: interpolate(points, wrapped, "throttle") });
  }
  let apexSpeed: number | null = null, apexDistance: number | null = null;
  for (const sample of samples) {
    if (sample.speed === null) continue;
    if (apexSpeed === null || sample.speed < apexSpeed) { apexSpeed = sample.speed; apexDistance = sample.distance; }
  }
  let brakeOnset: number | null = null;
  if (apexDistance !== null) {
    for (const sample of samples) {
      if (sample.distance > apexDistance) break;
      if (sample.brake !== null && sample.brake >= BRAKE_THRESHOLD) { brakeOnset = sample.distance; break; }
    }
  }
  let throttleReapply: number | null = null;
  if (apexDistance !== null) {
    for (const sample of samples) {
      if (sample.distance < apexDistance) continue;
      if (sample.throttle !== null && sample.throttle >= THROTTLE_THRESHOLD) { throttleReapply = sample.distance; break; }
    }
  }
  return { brakeOnset, apexSpeed, apexDistance, throttleReapply };
}

function consistencyLabel(sd: number, scale: number) {
  const ratio = sd / scale;
  return ratio < 0.4 ? "muito consistente" : ratio < 1 ? "consistente" : ratio < 2 ? "variável" : "muito inconsistente";
}

/** Mean±stddev band of a channel across all valid laps, sampled around a corner (offset in % of lap
 * distance, negative = before the corner, positive = after), used to graph how consistently the
 * driver repeats the actual brake/throttle CURVE (not just a single onset point) at that corner —
 * e.g. whether trail-braking pressure and release are applied the same way lap after lap. */
function cornerBand(validTraces: { points: TracePoint[] }[], cornerDistance: number, channel: ChannelKey) {
  const band: { offset: number; mean: number; stddev: number }[] = [];
  for (let offset = -CORNER_WINDOW; offset <= CORNER_WINDOW; offset += 1) {
    const distance = ((cornerDistance + offset) % 100 + 100) % 100;
    const values = validTraces.map(({ points }) => interpolate(points, distance, channel)).filter((value): value is number => value !== null);
    if (values.length < 3) continue;
    const avg = mean(values);
    band.push({ offset, mean: Number(avg.toFixed(3)), stddev: Number(stddev(values, avg).toFixed(3)) });
  }
  return band;
}

/** Time (seconds) integrated over a distance range via Σ(Δ% / speed), then rescaled by this lap's
 * own lapTime/fullLapIntegral ratio — the same technique compareTraces already uses to turn a
 * reference lap's %-space integral into a comparable time. Used both for a whole lap (scale=1, to
 * derive that ratio) and for a narrow corner window (to rank laps by pace through ONE corner,
 * independent of how fast the rest of the lap was). */
function integrateInverseSpeed(points: TracePoint[], windowStart: number, windowEnd: number, step = 0.5) {
  let integral = 0;
  for (let distance = windowStart; distance <= windowEnd; distance += step) {
    const wrapped = ((distance % 100) + 100) % 100;
    const speed = interpolate(points, wrapped, "speed");
    if (speed !== null && speed > 1) integral += step / speed;
  }
  return integral;
}

/** Fine-grained (0.5%-step) brake/throttle/speed trace of ONE specific lap around a corner — unlike
 * cornerBand's mean±stddev across all laps, this is a single real lap's actual curve, detailed
 * enough to trace by eye: "brake like this, at this exact point, and you're faster here." */
function laneCurve(points: TracePoint[], cornerDistance: number, channel: "brake" | "throttle" | "speed") {
  const curve: { offset: number; value: number }[] = [];
  for (let offset = -CORNER_WINDOW; offset <= CORNER_WINDOW; offset += 0.5) {
    const distance = ((cornerDistance + offset) % 100 + 100) % 100;
    const value = interpolate(points, distance, channel);
    if (value !== null) curve.push({ offset: Number(offset.toFixed(1)), value: Number(value.toFixed(3)) });
  }
  return curve;
}

const SESSION_MATCH_WINDOW_MS = 3 * 3600_000; // driving_sessions.started_at vs race_results.raced_at drift observed in practice is minutes, not hours

/** Locates the driving_sessions row that holds the telemetry for a given race_results row. There is
 * no foreign key between the two (different sources, iRStats vs Garage61) — match on car+track+time
 * proximity instead, scoped to a single race so this stays a cheap, narrow query. */
async function findSessionForRace(driverId: string, race: { car_id: number; track_id: number; raced_at: string }) {
  const racedAt = new Date(race.raced_at).getTime();
  const { data, error } = await supabaseAdmin
    .from("driving_sessions")
    .select("id,garage61_event_id,car_id,track_id,started_at,ended_at,lap_count")
    .eq("driver_id", driverId).eq("session_type", 3).eq("car_id", race.car_id).eq("track_id", race.track_id)
    .not("garage61_event_id", "is", null)
    .gte("started_at", new Date(racedAt - SESSION_MATCH_WINDOW_MS).toISOString())
    .lte("started_at", new Date(racedAt + SESSION_MATCH_WINDOW_MS).toISOString());
  if (error) throw error;
  if (!data?.length) return null;
  return data.reduce((closest, row) =>
    Math.abs(new Date(row.started_at).getTime() - racedAt) < Math.abs(new Date(closest.started_at).getTime() - racedAt) ? row : closest
  );
}

async function computeDebrief(driverId: string, gtpCarIds: Set<number>) {
  // race_results (iRStats) is the source of truth for which race was actually completed — see
  // DATA_ARCHITECTURE.md. driving_sessions.lap_count (Garage61) is NOT the same thing: it counts
  // every lap driven in the session window (formation lap, reconnects), so an abandoned race can
  // still clear a lap-count floor there. Concretely: a Super Formula race at Algarve abandoned on
  // lap 2 (race_results.laps = 1) had driving_sessions.lap_count = 5, which used to beat MIN_LAPS
  // and get picked over the actually-valid earlier race that finished P4 (laps = 15). Selecting the
  // candidate race from race_results directly, then locating its telemetry session, fixes that.
  const { data: races, error: racesError } = await supabaseAdmin
    .from("race_results")
    .select("id,raced_at,category,car_id,track_id,laps,fastest_lap_time,winner_fastest_lap_time")
    .eq("driver_id", driverId)
    .not("car_id", "is", null).not("track_id", "is", null)
    .order("raced_at", { ascending: false }).limit(400);
  if (racesError) throw racesError;

  const results: Record<RatingCategory, unknown> = { formula_car: null, sports_car: null, gtp_car: null };

  for (const category of RATING_CATEGORIES) {
    const pool = (races ?? []).filter((race) => {
      if (category === "gtp_car") return race.category === "sports_car" && gtpCarIds.has(race.car_id);
      if (category === "sports_car") return race.category === "sports_car" && !gtpCarIds.has(race.car_id);
      return race.category === "formula_car";
    });
    // Matches the sector-consistency sub-tab's own floor (app/api/telemetry/sectors/route.ts) so
    // "valid" means the same thing everywhere, now measured in real classified race laps.
    const validRace = pool.find((race) => (race.laps ?? 0) >= MIN_LAPS);
    const categoryLabel = category === "formula_car" ? "Formula Car" : category === "gtp_car" ? "GTP" : "Sports Car";
    if (!validRace) { results[category] = { status: "ok", session: null, message: `Nenhuma corrida de ${categoryLabel} com pelo menos ${MIN_LAPS} voltas completadas encontrada.` }; continue; }

    const candidate = await findSessionForRace(driverId, validRace);
    if (!candidate) { results[category] = { status: "ok", session: null, message: `Achei sua última corrida válida de ${categoryLabel} (${validRace.laps} voltas, ${new Date(validRace.raced_at).toLocaleDateString("pt-BR")}), mas a telemetria dessa sessão ainda não sincronizou do Garage61.` }; continue; }

    const { data: cached } = await supabaseAdmin.from("race_debriefs").select("session_id,payload").eq("driver_id", driverId).eq("rating_category", category).maybeSingle();
    // "trackOutline" was added after some payloads were already cached — treat its absence as a stale
    // schema and force a rebuild once, rather than serving old payloads without the corner map forever.
    // 11/09/2026: this check wanted version 4, but buildDebriefPayload below had always written 3 --
    // meaning every payload was permanently "stale" the instant it landed in cache, and this route
    // recomputed from scratch (full Garage61 pagination + telemetry download, the reason it needs
    // maxDuration=300 at all) on EVERY request, never actually benefiting from the cache table. Fixed
    // here (both sides now write/expect 5) while also bumping it for the new destracionamento/
    // microcorreções fields added below -- one version bump covers both.
    const cachedIsFresh = cached && Number(cached.session_id) === Number(candidate.id) && (cached.payload as Record<string, unknown>)?.cornerDetectionVersion === 5;
    // Kept out of the cached payload: it comes from race_results, not telemetry, so it must not
    // depend on (or invalidate) the cache version.
    const gap = raceWinnerGap(validRace.fastest_lap_time, validRace.winner_fastest_lap_time);
    const winnerGap = gap ? { ownLap: validRace.fastest_lap_time, winnerLap: validRace.winner_fastest_lap_time, seconds: Number(gap.seconds.toFixed(3)), pct: Number(gap.pct.toFixed(3)) } : null;
    if (cachedIsFresh) { results[category] = { ...(cached!.payload as Record<string, unknown>), winnerGap }; continue; }

    try {
      const payload = await buildDebriefPayload(candidate);
      results[category] = { ...payload, winnerGap };
      await supabaseAdmin.from("race_debriefs").upsert({ driver_id: driverId, rating_category: category, session_id: candidate.id, payload, computed_at: new Date().toISOString() }, { onConflict: "driver_id,rating_category" });
    } catch (error) {
      results[category] = { status: "error", message: error instanceof Error ? error.message : String(error) };
    }
  }
  return results;
}

async function buildDebriefPayload(session: { id: number; garage61_event_id: string; car_id: number; track_id: number; started_at: string; ended_at: string }) {
  const [carRow, trackRow] = await Promise.all([
    supabaseAdmin.from("cars").select("id,name").eq("id", session.car_id).maybeSingle(),
    supabaseAdmin.from("tracks").select("id,name,variant").eq("id", session.track_id).maybeSingle(),
  ]);
  const carName = carRow.data?.name ?? `Carro ${session.car_id}`;
  const isSuperFormula = /super formula/i.test(carName);

  const allLaps = await fetchAllLaps(session.car_id, session.track_id);
  const eventLaps = allLaps.filter((lap) =>
    (typeof lap.event === "string" ? lap.event : lap.event?.id) === session.garage61_event_id && lap.canViewTelemetry &&
    Number.isFinite(lap.lapTime) && Number(lap.lapTime) > 0 &&
    !lap.incomplete && !lap.missing && !lap.pitLane && !lap.pitIn && !lap.pitOut
  );
  // Fetches a pool larger than MAX_LAPS so that, after excluding statistical outlier laps
  // (likely-overtake proxy, see findOutlierLaps), MAX_LAPS clean laps still remain for analysis.
  const OUTLIER_POOL_EXTRA = 5;
  const candidateLaps = [...eventLaps].sort((a, b) => Number(a.lapTime) - Number(b.lapTime)).slice(0, MAX_LAPS + OUTLIER_POOL_EXTRA);
  if (candidateLaps.length < 3) return { status: "ok", session: null, message: "Poucas voltas com telemetria disponível nessa corrida para uma análise de consistência confiável (mínimo 3)." };

  const token = process.env.GARAGE61_API_TOKEN;
  if (!token) throw new Error("GARAGE61_API_TOKEN não configurado");

  // Storage-first, same as the telemetry viewer (app/api/garage61/laps/[id]/telemetry): the
  // recurring sync should have already downloaded these laps' CSVs, so this normally reads
  // Supabase, not Garage61. Live-fetch only covers a lap the sync hasn't reached yet, and stores
  // it opportunistically so the next debrief/telemetry view of that same lap is already fast.
  const { data: storedPaths } = await supabaseAdmin.from("laps").select("id,telemetry_path,track_id").in("id", candidateLaps.map((lap) => lap.id));
  const pathByLapId = new Map((storedPaths ?? []).map((row) => [row.id, row]));
  const traces = await Promise.all(candidateLaps.map(async (lap) => {
    const stored = pathByLapId.get(lap.id);
    if (stored?.telemetry_path) {
      // .gz-aware and budget-enforced (lib/telemetry-storage.ts). A stored lap that can't be read is
      // skipped rather than re-fetched and re-uploaded, which used to undo compression.
      const text = await readTelemetryText(stored.telemetry_path);
      return text ? { lap, lapTime: Number(lap.lapTime), ...parseLapCsv(text) } : null;
    }
    const response = await fetch(`${GARAGE61_BASE}/laps/${encodeURIComponent(lap.id)}/csv`, { headers: { Authorization: `Bearer ${token}`, Accept: "text/csv" }, cache: "no-store" });
    if (!response.ok) return null;
    const csv = await response.text();
    if (stored?.track_id) await storeTelemetryCsv(stored.track_id, lap.id, csv);
    const parsed = parseLapCsv(csv);
    return { lap, lapTime: Number(lap.lapTime), ...parsed };
  }));
  const downloadedTraces = traces.filter((item): item is { lap: Garage61Lap; lapTime: number; points: TracePoint[]; hasOvertakeChannel: boolean } => !!item && item.points.length > 20);
  if (downloadedTraces.length < 3) throw new Error("Não foi possível baixar telemetria suficiente para essas voltas");

  // A Garage61 não exporta um canal de overtake/push-to-pass no CSV de volta (testado e confirmado
  // ausente em todas as voltas), então não há como filtrar voltas com overtake automaticamente hoje.
  const overtakeChannelAvailable = downloadedTraces.some((item) => item.hasOvertakeChannel);

  const { kept, outliers } = findOutlierLaps(downloadedTraces);
  const validTraces = kept.sort((a, b) => a.lapTime - b.lapTime).slice(0, MAX_LAPS);
  const excludedOutliers = outliers.map((item) => ({ lapNumber: item.lap.lapNumber ?? null, lapTime: formatLapTime(item.lapTime), zScore: Number(item.zScore.toFixed(2)) }));

  const bins = Array.from({ length: 51 }, (_, index) => index * 2);
  const channels: ChannelKey[] = ["throttle", "brake", "steering", "gear", "rpm"];
  const channelStats = channels.map((channel) => {
    const binStats = bins.map((distance) => {
      const values = validTraces.map(({ points }) => interpolate(points, distance, channel)).filter((value): value is number => value !== null);
      if (values.length < 3) return null;
      const avg = mean(values);
      return { distance, stddev: stddev(values, avg), mean: avg };
    }).filter((item): item is { distance: number; stddev: number; mean: number } => item !== null);
    if (!binStats.length) return null;
    const scale = channel === "rpm" ? 1000 : channel === "steering" ? 0.15 : channel === "gear" ? 0.3 : 1;
    const normalized = binStats.map((item) => ({ ...item, score: item.stddev / scale }));
    const avgScore = mean(normalized.map((item) => item.score));
    const worst = [...normalized].sort((a, b) => b.score - a.score).slice(0, 3);
    const best = [...normalized].sort((a, b) => a.score - b.score).slice(0, 3);
    return { channel, label: CHANNEL_LABELS[channel], avgScore, binStats, worstZones: worst.map((item) => ({ distance: item.distance, stddev: item.stddev })), bestZones: best.map((item) => ({ distance: item.distance, stddev: item.stddev })) };
  }).filter((item): item is NonNullable<typeof item> => item !== null);

  const lapTimes = validTraces.map(({ lap }) => Number(lap.lapTime));
  const sortedLapTimes = [...lapTimes].sort((a, b) => a - b);
  const avgLapTime = mean(lapTimes);
  const lapTimeStddev = stddev(lapTimes, avgLapTime);
  const spread = sortedLapTimes[sortedLapTimes.length - 1] - sortedLapTimes[0];

  // Ordem cronológica real dentro da corrida (pelo número da volta), para o gráfico de dispersão
  // mostrar se o ritmo caiu/melhorou ao longo do stint, não só o ranking por velocidade.
  const chronological = [...validTraces].sort((a, b) => (a.lap.lapNumber ?? 0) - (b.lap.lapNumber ?? 0));
  const lapScatter = chronological.map(({ lap }) => ({ lapNumber: lap.lapNumber ?? null, lapTime: Number(lap.lapTime), deltaFromBest: Number((Number(lap.lapTime) - sortedLapTimes[0]).toFixed(3)) }));

  // Análise por curva: detecta toda curva real da pista (qualquer trecho que não seja reta, usando a
  // aceleração lateral — não só onde há frenagem forte, o que antes fazia curvas rápidas sem frenagem
  // como a Curva Grande de Monza serem ignoradas ou contadas com o número errado) e compara ponto de
  // frenagem, velocidade mínima e retomada do acelerador entre TODAS as voltas válidas.
  const referenceTrace = validTraces.reduce((fastest, item) => (item.lapTime < fastest.lapTime ? item : fastest), validTraces[0]);
  const gpsDetected = detectCornersFromGps(referenceTrace.points.map((point) => ({ distance: point.distance, lat: point.lat ?? null, lon: point.lon ?? null })));
  const detected = gpsDetected.length >= 3 ? gpsDetected : detectCornersFromLatAccel(referenceTrace.points.map((point) => ({ distance: point.distance, lateralAccel: point.latAccel ?? null })));
  // Thinned GPS outline of the fastest lap, sent to the client so each corner card can show WHERE on
  // track it is (not just a %) — the driver asked to locate variance on the map, not just read a number.
  const gpsPoints = referenceTrace.points.filter((point) => point.lat !== undefined && point.lon !== undefined);
  const outlineStride = Math.max(1, Math.ceil(gpsPoints.length / 400));
  const trackOutline = gpsPoints.length >= 20
    ? gpsPoints.filter((_, index) => index % outlineStride === 0).map((point) => ({ distance: point.distance, lat: point.lat as number, lon: point.lon as number }))
    : null;
  const cornerDistances = detected.map((corner) => corner.distance);
  const trackDisplayName = trackRow.data?.name ?? "";
  const trackVariant = trackRow.data?.variant ?? "";
  const researchedNames = lookupCornerNames(trackDisplayName, trackVariant, detected.length);
  // Per-lap %-to-seconds scale, computed once (not per corner): lapTime ÷ that lap's own full-lap
  // Σ(Δ%/speed). Reused below to rank laps by pace through EACH corner window independently of
  // whole-lap pace — the fastest lap overall is not always the fastest through any given corner.
  const lapScale = new Map(validTraces.map(({ lap, lapTime, points }) => {
    const fullLapIntegral = integrateInverseSpeed(points, 0, 100);
    return [lap.id, fullLapIntegral > 0 ? lapTime / fullLapIntegral : 0] as const;
  }));
  const cornerReports = cornerDistances.map((distance, index) => {
    const perLap = validTraces.map(({ lap, points }) => ({ lapNumber: lap.lapNumber ?? null, ...analyzeCornerForLap(points, distance) }));
    const brakeOnsets = perLap.map((item) => item.brakeOnset).filter((value): value is number => value !== null);
    const apexSpeeds = perLap.map((item) => item.apexSpeed).filter((value): value is number => value !== null);
    const reapplies = perLap.map((item) => item.throttleReapply).filter((value): value is number => value !== null);
    const brakeMean = brakeOnsets.length ? mean(brakeOnsets) : null;
    const brakeSd = brakeOnsets.length >= 3 ? stddev(brakeOnsets, brakeMean!) : null;
    const apexMean = apexSpeeds.length ? mean(apexSpeeds) : null;
    const apexSd = apexSpeeds.length >= 3 ? stddev(apexSpeeds, apexMean!) : null;
    const reapplyMean = reapplies.length ? mean(reapplies) : null;
    const reapplySd = reapplies.length >= 3 ? stddev(reapplies, reapplyMean!) : null;

    const brakeBand = cornerBand(validTraces, distance, "brake");
    const throttleBand = cornerBand(validTraces, distance, "throttle");
    const brakeShapeSd = brakeBand.length ? mean(brakeBand.map((point) => point.stddev)) : null;
    const throttleShapeSd = throttleBand.length ? mean(throttleBand.map((point) => point.stddev)) : null;

    // "Copy this braking/throttle curve" reference: not the fastest lap overall, but whichever
    // valid lap was fastest through THIS specific corner window — a driver can nail one corner on
    // an otherwise average lap. Ranked by real seconds (via lapScale), not just apex speed, so it
    // accounts for the whole entry-mid-exit shape, not one instant.
    const segmentTimes = validTraces.map(({ lap, points }) => {
      const scale = lapScale.get(lap.id) ?? 0;
      if (scale <= 0) return null;
      const seconds = integrateInverseSpeed(points, distance - CORNER_WINDOW, distance + CORNER_WINDOW) * scale;
      return seconds > 0 ? { lap, points, seconds } : null;
    }).filter((item): item is { lap: Garage61Lap; points: TracePoint[]; seconds: number } => item !== null);
    const idealEntry = segmentTimes.length >= 3 ? segmentTimes.reduce((best, item) => item.seconds < best.seconds ? item : best) : null;
    const avgSegmentSeconds = segmentTimes.length ? mean(segmentTimes.map((item) => item.seconds)) : null;
    const idealLine = idealEntry && avgSegmentSeconds !== null ? {
      lapNumber: idealEntry.lap.lapNumber ?? null,
      seconds: Number(idealEntry.seconds.toFixed(3)),
      gainSeconds: Number((avgSegmentSeconds - idealEntry.seconds).toFixed(3)),
      brakeCurve: laneCurve(idealEntry.points, distance, "brake"),
      throttleCurve: laneCurve(idealEntry.points, distance, "throttle"),
      speedCurve: laneCurve(idealEntry.points, distance, "speed"),
    } : null;

    return {
      cornerNumber: index + 1,
      name: researchedNames?.[index] ?? null,
      distancePct: distance,
      sampleSize: perLap.length,
      braking: brakeSd === null ? null : { meanDistancePct: Number(brakeMean!.toFixed(1)), stddev: Number(brakeSd.toFixed(2)), consistency: consistencyLabel(brakeSd, 1.5) },
      apexSpeed: apexSd === null ? null : { mean: Number(apexMean!.toFixed(1)), stddev: Number(apexSd.toFixed(2)), consistency: consistencyLabel(apexSd, 3) },
      throttleReapply: reapplySd === null ? null : { meanDistancePct: Number(reapplyMean!.toFixed(1)), stddev: Number(reapplySd.toFixed(2)), consistency: consistencyLabel(reapplySd, 1.5) },
      brakeShape: brakeShapeSd === null ? null : { consistency: consistencyLabel(brakeShapeSd, 0.05) },
      throttleShape: throttleShapeSd === null ? null : { consistency: consistencyLabel(throttleShapeSd, 0.05) },
      brakeBand, throttleBand, idealLine,
    };
  });
  const isGood = (consistency: string) => consistency === "muito consistente" || consistency === "consistente";
  const cornerNarratives = cornerReports.map((corner) => {
    const parts: string[] = [];
    if (corner.braking) {
      parts.push(isGood(corner.braking.consistency)
        ? "você pisa no freio sempre no mesmo lugar aqui — ótimo, é isso que dá confiança pra explorar o limite"
        : "você está pisando no freio em pontos diferentes a cada volta aqui — escolha uma referência de pista (uma placa, uma mancha de pneu) e freie sempre no mesmo ponto");
    }
    if (corner.brakeShape) {
      parts.push(isGood(corner.brakeShape.consistency)
        ? "a força que você faz no freio e o jeito que solta ele até o ponto mais lento também se repetem bem"
        : "a força e a forma como você solta o freio mudam de volta pra volta — tente manter a mesma pressão do início ao fim da freada, sem soltar de repente");
    }
    if (corner.apexSpeed) {
      parts.push(isGood(corner.apexSpeed.consistency)
        ? "a velocidade mais baixa que você chega nessa curva é sempre parecida"
        : "a velocidade mais baixa que você chega nessa curva varia bastante — isso geralmente é reflexo do ponto de freada mudar; resolvendo a freada, isso tende a melhorar junto");
    }
    if (corner.throttleShape) {
      parts.push(isGood(corner.throttleShape.consistency)
        ? "e você volta a acelerar sempre do mesmo jeito na saída, sem hesitar"
        : "na saída, você às vezes acelera rápido demais e às vezes devagar demais — pise no acelerador de forma constante e crescente, sem tranco, assim que o carro estiver reto o suficiente");
    }
    if (corner.idealLine && corner.idealLine.gainSeconds > 0.03) {
      parts.push(`na volta ${corner.idealLine.lapNumber ?? "?"} você passou por aqui ${corner.idealLine.gainSeconds.toFixed(2)}s mais rápido que sua própria média nesse trecho — veja no gráfico como você freou e acelerou nessa passagem específica, é o seu próprio padrão pra repetir, não uma referência externa`);
    }
    const label = corner.name ?? `Curva ${corner.cornerNumber}`;
    return `${label} (~${corner.distancePct}% da volta): ${parts.join("; ")}.`;
  });

  const ranked = [...channelStats].sort((a, b) => a.avgScore - b.avgScore);
  const strengths = ranked.slice(0, 2).map((item) => `${item.label}: você repete o mesmo movimento em quase toda a volta — é um ponto forte seu agora, não precisa mexer nisso.`);
  const improvements = ranked.slice(-3).reverse().map((item) => {
    const zone = item.worstZones[0];
    return `${item.label}: o ponto onde você mais varia de volta pra volta é perto dos ${zone.distance}% da pista — você não está fazendo ${CHANNEL_PHRASE[item.channel as ChannelKey]} sempre igual ali. Repita o mesmo movimento, no mesmo lugar, todas as vezes — só depois de repetir bem vale tentar ganhar mais performance.`;
  });

  // 11/09/2026: "quero uma análise de quantas microcorreções eu tenho, se eu tô tentando toda volta é
  // um problema, caso seja pontual não é" -- Meu Debrief is the one surface with a real pool of RACE
  // laps from a single stint (not just test laps like Comparar Carros, not just two like Melhor Volta
  // vs Referência), so it's the natural place to answer "hábito ou pontual" for real. Runs on the
  // SAME validTraces already downloaded/parsed above -- no new Garage61 call, no new Storage read.
  // Outlier-rejected likely-overtake laps (findOutlierLaps above) are already excluded from
  // validTraces, so Super Formula P2P contamination doesn't need separate handling here.
  const toTractionSamples = (points: TracePoint[]): TractionSample[] => points.map((point) => ({
    distance: point.distance,
    throttle: point.throttle, rpm: point.rpm, gear: point.gear,
    speedMs: point.speed, steeringRad: point.steering, yawRate: point.yawRate,
  }));
  const tractionEvents = summarizeTractionEvents(validTraces.map(({ points }) => toTractionSamples(points)));
  const tractionNarrative = [describeWheelspinHabit(tractionEvents), describeCorrectionHabit(tractionEvents)]
    .filter((line): line is string => line !== null);

  const consistencyWord = lapTimeStddev < 0.3 ? "bem consistente" : lapTimeStddev < 0.8 ? "moderadamente consistente" : "pouco consistente";
  const trendDeltas = lapScatter.map((item) => item.deltaFromBest);
  const trendDirection = trendDeltas.length >= 4 ? mean(trendDeltas.slice(-Math.ceil(trendDeltas.length / 2))) - mean(trendDeltas.slice(0, Math.floor(trendDeltas.length / 2))) : 0;
  const trendText = trendDirection > 0.2 ? " Seu ritmo caiu ao longo do stint (voltas finais mais lentas que as iniciais) — pode ser degradação de pneu/combustível ou cansaço." : trendDirection < -0.2 ? " Seu ritmo melhorou ao longo do stint (voltas finais mais rápidas) — sinal de que você estava se ajustando ao carro/pista." : " Seu ritmo se manteve estável ao longo do stint, sem tendência clara de queda ou melhora.";

  return {
    status: "ok",
    session: {
      startedAt: session.started_at, endedAt: session.ended_at,
      durationMinutes: Math.round((new Date(session.ended_at).getTime() - new Date(session.started_at).getTime()) / 60000),
      car: carName, track: `${trackRow.data?.name ?? `Pista ${session.track_id}`}${trackRow.data?.variant ? ` (${trackRow.data.variant})` : ""}`,
      // 31/08/2026: "garanta que os mapas dessa página também leiam os mesmos mapas que temos nas
      // outras sub-abas" -- the frontend's CornerTrackMap only ever had the driver's own synthetic
      // trace-derived outline to draw (trackOutline below), not the real OSM boundary every other
      // map in the app now uses; needs the numeric track id to fetch that boundary itself.
      trackId: session.track_id,
    },
    lapsAnalyzed: validTraces.length,
    overtakeChannelAvailable,
    excludedOutliers,
    bestLap: formatLapTime(sortedLapTimes[0]),
    worstLap: formatLapTime(sortedLapTimes[sortedLapTimes.length - 1]),
    lapTimeSpread: spread.toFixed(3),
    lapTimeStddev: lapTimeStddev.toFixed(3),
    lapScatter,
    corners: cornerReports,
    cornerNarratives,
    trackOutline,
    cornerDetectionVersion: 5,
    tractionEvents, tractionNarrative,
    summary: `Analisei suas ${validTraces.length} voltas mais rápidas dessa corrida (${formatLapTime(sortedLapTimes[0])} a ${formatLapTime(sortedLapTimes[sortedLapTimes.length - 1])}, desvio padrão de ${lapTimeStddev.toFixed(3)}s), com ${cornerReports.length} curvas identificadas e comparadas volta a volta. Seu ritmo foi ${consistencyWord} entre as voltas.${trendText}${excludedOutliers.length ? ` Descartei ${excludedOutliers.length} volta(s) estatisticamente anômala(s) (rápida(s) demais para o seu ritmo real, provável overtake): ${excludedOutliers.map((item) => `volta ${item.lapNumber ?? "?"} em ${item.lapTime}`).join(", ")}.` : ""}${!overtakeChannelAvailable && isSuperFormula ? " Aviso: a Garage61 não exporta o canal de overtake/push-to-pass nessas voltas, então a detecção acima é estatística (outlier de tempo), não uma leitura direta do overtake — confira manualmente se restar dúvida." : ""}`,
    strengths,
    improvements,
    channelStats: channelStats.map((item) => ({ channel: item.channel, label: item.label, avgScore: Number(item.avgScore.toFixed(2)), binStats: CHART_CHANNELS.includes(item.channel) ? item.binStats : undefined })),
  };
}

export async function GET() {
  try {
    const { data: driver } = await supabaseAdmin.from("drivers").select("id").order("updated_at", { ascending: false }).limit(1).single();
    if (!driver) throw new Error("Piloto não encontrado");

    // GTP cars (Ferrari 499P, Porsche 963, etc.) are scored as "sports_car" by race_results/iRStats
    // (there's no separate GTP category there), but drive differently enough from GT3 that the
    // driver races it as its own tab — split it out by car_id membership in the GTP car_groups group.
    const gtpCarIds = new Set<number>();
    const { data: gtpGroup } = await supabaseAdmin.from("car_groups").select("id").eq("name", "GTP").maybeSingle();
    if (gtpGroup) {
      const { data: gtpMembers } = await supabaseAdmin.from("car_group_members").select("car_id").eq("car_group_id", gtpGroup.id);
      for (const row of gtpMembers ?? []) gtpCarIds.add(row.car_id);
    }

    const categories = await computeDebrief(driver.id, gtpCarIds);
    return NextResponse.json({ status: "ok", categories });
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
