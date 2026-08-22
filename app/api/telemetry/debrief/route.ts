import { NextResponse } from "next/server";
import { garage61Get } from "@/lib/garage61";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { lookupCornerName } from "@/lib/track-corners";

const GARAGE61_BASE = "https://garage61.net/api/v1";
const MIN_RACE_MINUTES = 15;
const MAX_LAPS = 10;
const PAGE_SIZE = 250;
// "gtp_car" is a debrief-only grouping, not an iRacing/Garage61 iRating category — Garage61 only
// tracks separate iRating for formula_car/sports_car (see rating_history.category), GTP races count
// towards the sports_car iRating. We still split it into its own debrief tab since GTP (Ferrari 499P,
// Porsche 963, etc.) drives very differently from GT3 and the driver races it as a distinct category.
const RATING_CATEGORIES = ["formula_car", "sports_car", "gtp_car"] as const;
type RatingCategory = (typeof RATING_CATEGORIES)[number];

type Garage61Lap = {
  id: string; startTime?: string; lapTime?: number; lapNumber?: number; sessionType?: number; event?: string;
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

type ChannelKey = "throttle" | "brake" | "steering" | "gear" | "rpm" | "speed";
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

const CHANNEL_LABELS: Record<ChannelKey, string> = { throttle: "Acelerador", brake: "Freio", steering: "Volante", gear: "Marcha", rpm: "RPM", speed: "Velocidade" };
const CHANNEL_PHRASE: Record<ChannelKey, string> = { throttle: "a mesma abertura de acelerador", brake: "a mesma pressão de freio", steering: "o mesmo tanto de volante", gear: "a mesma marcha", rpm: "a mesma rotação do motor", speed: "a mesma velocidade" };
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
const CORNER_MERGE_MIN_GAP = 9; // must exceed 2*CORNER_WINDOW minus overlap slack, or adjacent corners' search windows collapse onto the same apex and report as duplicates
const BRAKE_THRESHOLD = 0.15;
const THROTTLE_THRESHOLD = 0.2;

/** Detects corners as local minima in speed along the reference (fastest) lap's trace, merging
 * minima that are too close together to be distinct braking zones. Reused pattern from the
 * "Zona de frenagem" detection in ActiveWeekTelemetry.tsx, adapted to operate on percent-distance bins. */
function detectCorners(referencePoints: TracePoint[]): number[] {
  const bins = Array.from({ length: 101 }, (_, index) => index);
  const speedAt = bins.map((distance) => interpolate(referencePoints, distance, "speed"));
  const minimaDistances: number[] = [];
  const PROMINENCE = 3;
  for (let index = 2; index < bins.length - 2; index += 1) {
    const value = speedAt[index];
    if (value === null) continue;
    const window = speedAt.slice(Math.max(0, index - 4), index + 5).filter((v): v is number => v !== null);
    if (!window.length) continue;
    const localMin = Math.min(...window);
    if (value !== localMin) continue;
    const localMax = Math.max(...window);
    if (localMax - value < PROMINENCE) continue;
    minimaDistances.push(bins[index]);
  }
  const merged: number[] = [];
  for (const distance of minimaDistances) {
    if (merged.length && distance - merged[merged.length - 1] < CORNER_MERGE_MIN_GAP) continue;
    merged.push(distance);
  }
  return merged;
}

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

async function computeDebrief(driverId: string, rowCarIds: Map<number, RatingCategory>) {
  const carIdsForCategory = new Map<RatingCategory, number[]>();
  for (const [carId, category] of rowCarIds) carIdsForCategory.set(category, [...(carIdsForCategory.get(category) ?? []), carId]);

  const { data: sessions, error: sessionsError } = await supabaseAdmin
    .from("driving_sessions")
    .select("id,garage61_event_id,car_id,track_id,started_at,ended_at")
    .eq("driver_id", driverId).eq("session_type", 3)
    .not("garage61_event_id", "is", null).not("car_id", "is", null).not("track_id", "is", null)
    .order("started_at", { ascending: false }).limit(200);
  if (sessionsError) throw sessionsError;

  const results: Record<RatingCategory, unknown> = { formula_car: null, sports_car: null, gtp_car: null };

  for (const category of RATING_CATEGORIES) {
    const carIds = new Set(carIdsForCategory.get(category) ?? []);
    const candidate = (sessions ?? []).find((row) => {
      if (!carIds.has(row.car_id)) return false;
      const minutes = (new Date(row.ended_at).getTime() - new Date(row.started_at).getTime()) / 60000;
      return Number.isFinite(minutes) && minutes >= MIN_RACE_MINUTES;
    });
    const categoryLabel = category === "formula_car" ? "Formula Car" : category === "gtp_car" ? "GTP" : "Sports Car";
    if (!candidate) { results[category] = { status: "ok", session: null, message: `Nenhuma corrida de ${categoryLabel} com pelo menos ${MIN_RACE_MINUTES} minutos encontrada.` }; continue; }

    const { data: cached } = await supabaseAdmin.from("race_debriefs").select("session_id,payload").eq("driver_id", driverId).eq("rating_category", category).maybeSingle();
    if (cached && Number(cached.session_id) === Number(candidate.id)) { results[category] = cached.payload; continue; }

    try {
      const payload = await buildDebriefPayload(candidate);
      results[category] = payload;
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
    lap.event === session.garage61_event_id && lap.canViewTelemetry &&
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

  const traces = await Promise.all(candidateLaps.map(async (lap) => {
    const response = await fetch(`${GARAGE61_BASE}/laps/${encodeURIComponent(lap.id)}/csv`, { headers: { Authorization: `Bearer ${token}`, Accept: "text/csv" }, cache: "no-store" });
    if (!response.ok) return null;
    const csv = await response.text();
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

  // Análise por curva: para cada zona de frenagem detectada na volta mais rápida, compara ponto de
  // frenagem, velocidade de ápice e ponto de reabertura do acelerador entre TODAS as voltas válidas,
  // como pedido explicitamente — a mesma curva analisada em contextos (voltas) diferentes.
  const referenceTrace = validTraces.reduce((fastest, item) => (item.lapTime < fastest.lapTime ? item : fastest), validTraces[0]);
  const cornerDistances = referenceTrace.points.some((point) => point.speed !== undefined) ? detectCorners(referenceTrace.points) : [];
  const trackDisplayName = trackRow.data?.name ?? "";
  const trackVariant = trackRow.data?.variant ?? "";
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

    return {
      cornerNumber: index + 1,
      name: lookupCornerName(trackDisplayName, trackVariant, distance),
      distancePct: distance,
      sampleSize: perLap.length,
      braking: brakeSd === null ? null : { meanDistancePct: Number(brakeMean!.toFixed(1)), stddev: Number(brakeSd.toFixed(2)), consistency: consistencyLabel(brakeSd, 1.5) },
      apexSpeed: apexSd === null ? null : { mean: Number(apexMean!.toFixed(1)), stddev: Number(apexSd.toFixed(2)), consistency: consistencyLabel(apexSd, 3) },
      throttleReapply: reapplySd === null ? null : { meanDistancePct: Number(reapplyMean!.toFixed(1)), stddev: Number(reapplySd.toFixed(2)), consistency: consistencyLabel(reapplySd, 1.5) },
      brakeShape: brakeShapeSd === null ? null : { consistency: consistencyLabel(brakeShapeSd, 0.05) },
      throttleShape: throttleShapeSd === null ? null : { consistency: consistencyLabel(throttleShapeSd, 0.05) },
      brakeBand, throttleBand,
    };
  });
  const cornerNarratives = cornerReports.map((corner) => {
    const parts: string[] = [];
    if (corner.braking) parts.push(`você começa a frear ${corner.braking.consistency === "muito consistente" || corner.braking.consistency === "consistente" ? "sempre no mesmo ponto" : "em pontos diferentes a cada volta"} (perto dos ${corner.braking.meanDistancePct}% da pista)`);
    if (corner.brakeShape) parts.push(`a forma como você solta o freio até o ponto mais lento da curva (trail braking) é ${corner.brakeShape.consistency}`);
    if (corner.apexSpeed) parts.push(`a velocidade mais baixa que você atinge na curva é ${corner.apexSpeed.consistency} entre as voltas (variação de ${corner.apexSpeed.stddev})`);
    if (corner.throttleShape) parts.push(`a forma como você volta a acelerar depois da curva é ${corner.throttleShape.consistency}`);
    // Sem o nome real, não numeramos como "Curva N": só detectamos zonas de frenagem (mínimos de
    // velocidade), então uma sequência de curvas rápidas sem frenagem forte (ex: a segunda curva de
    // Monza, em alta velocidade) não vira uma zona nossa, e numerar sequencialmente aqui erraria a
    // numeração oficial da pista (nossa 2ª zona pode ser a curva 4 de verdade). "Zona de frenagem N"
    // é o rótulo honesto quando não sabemos o nome real da curva.
    const label = corner.name ?? `Zona de frenagem ${corner.cornerNumber}`;
    return `${label} — ~${corner.distancePct}% da volta: ${parts.join("; ")}.`;
  });

  const ranked = [...channelStats].sort((a, b) => a.avgScore - b.avgScore);
  const strengths = ranked.slice(0, 2).map((item) => `${item.label}: você repete o mesmo padrão em quase toda a volta — essa é uma das suas maiores forças agora, não mexa nisso sem motivo.`);
  const improvements = ranked.slice(-3).reverse().map((item) => {
    const zone = item.worstZones[0];
    return `${item.label}: a maior variação entre as voltas acontece perto de ${zone.distance}% da pista — você não está repetindo ${CHANNEL_PHRASE[item.channel as ChannelKey]} ali volta a volta. Foque em fazer o mesmo movimento, no mesmo ponto, todas as vezes antes de tentar ganhar mais performance.`;
  });

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

    const { data: categoryRows, error: categoryError } = await supabaseAdmin.from("car_rating_categories").select("car_id,rating_category");
    if (categoryError) throw categoryError;
    const carCategoryMap = new Map<number, RatingCategory>();
    for (const row of categoryRows ?? []) {
      if (row.rating_category === "formula_car" || row.rating_category === "sports_car") carCategoryMap.set(row.car_id, row.rating_category);
    }

    // GTP cars (Ferrari 499P, Porsche 963, etc.) count towards the sports_car iRating in Garage61
    // (there's no separate GTP iRating bucket there), but drive differently enough from GT3 that the
    // driver races it as its own category — split it into its own debrief tab.
    const { data: gtpGroup } = await supabaseAdmin.from("car_groups").select("id").eq("name", "GTP").maybeSingle();
    if (gtpGroup) {
      const { data: gtpMembers } = await supabaseAdmin.from("car_group_members").select("car_id").eq("car_group_id", gtpGroup.id);
      for (const row of gtpMembers ?? []) carCategoryMap.set(row.car_id, "gtp_car");
    }

    const categories = await computeDebrief(driver.id, carCategoryMap);
    return NextResponse.json({ status: "ok", categories });
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
