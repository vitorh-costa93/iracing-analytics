import { NextResponse } from "next/server";
import { garage61Get } from "@/lib/garage61";
import { supabaseAdmin } from "@/lib/supabase-admin";

const GARAGE61_BASE = "https://garage61.net/api/v1";
const MIN_RACE_MINUTES = 15;
const MAX_LAPS = 10;
const RATING_CATEGORIES = ["formula_car", "sports_car"] as const;
type RatingCategory = (typeof RATING_CATEGORIES)[number];

type Garage61Lap = {
  id: string; startTime?: string; lapTime?: number; sessionType?: number; event?: string;
  clean?: boolean; joker?: boolean; discontinuity?: boolean; missing?: boolean; incomplete?: boolean;
  offtrack?: boolean; pitLane?: boolean; pitIn?: boolean; pitOut?: boolean; canViewTelemetry?: boolean;
};
type Garage61LapsResponse = { items?: Garage61Lap[] };

type ChannelKey = "throttle" | "brake" | "steering" | "gear" | "rpm";
type TracePoint = { distance: number } & Partial<Record<ChannelKey, number>> & { pushToPass?: number; p2pStatus?: number };

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
    gear: find("gear"), rpm: find("rpm", "engine0rpm"),
  };
  const pushToPassIndex = find("pushtopass");
  const p2pStatusIndex = find("p2pstatus");
  const raw = lines.slice(1).map((line) => parseCsvLine(line, delimiter));
  const points = raw.map((cells) => {
    const point: TracePoint = { distance: Number(cells[distanceIndex]) };
    for (const key of Object.keys(indexes) as ChannelKey[]) {
      const index = indexes[key];
      const value = index >= 0 ? Number(cells[index]) : NaN;
      if (Number.isFinite(value)) point[key] = value;
    }
    if (pushToPassIndex >= 0) { const value = Number(cells[pushToPassIndex]); if (Number.isFinite(value)) point.pushToPass = value; }
    if (p2pStatusIndex >= 0) { const value = Number(cells[p2pStatusIndex]); if (Number.isFinite(value)) point.p2pStatus = value; }
    return point;
  }).filter((point) => Number.isFinite(point.distance)).sort((a, b) => a.distance - b.distance);
  if (!points.length) return [];
  const maxDistance = Math.max(...points.map((point) => point.distance));
  if (maxDistance > 0 && maxDistance <= 1.01) points.forEach((point) => { point.distance *= 100; });
  return points;
}

function usedOvertake(points: TracePoint[]) {
  return points.some((point) => (point.pushToPass ?? 0) > 0 || (point.p2pStatus ?? 0) > 0);
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

const CHANNEL_LABELS: Record<ChannelKey, string> = { throttle: "Acelerador", brake: "Freio", steering: "Volante", gear: "Marcha", rpm: "RPM" };
const CHANNEL_PHRASE: Record<ChannelKey, string> = { throttle: "o mesmo acelerador", brake: "o mesmo freio", steering: "o mesmo ângulo de volante", gear: "a mesma marcha", rpm: "a mesma rotação" };

function formatLapTime(value: number) { const minutes = Math.floor(value / 60), seconds = value - minutes * 60; return `${minutes}:${seconds.toFixed(3).padStart(6, "0")}`; }

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

  const results: Record<RatingCategory, unknown> = { formula_car: null, sports_car: null };

  for (const category of RATING_CATEGORIES) {
    const carIds = new Set(carIdsForCategory.get(category) ?? []);
    const candidate = (sessions ?? []).find((row) => {
      if (!carIds.has(row.car_id)) return false;
      const minutes = (new Date(row.ended_at).getTime() - new Date(row.started_at).getTime()) / 60000;
      return Number.isFinite(minutes) && minutes >= MIN_RACE_MINUTES;
    });
    if (!candidate) { results[category] = { status: "ok", session: null, message: `Nenhuma corrida de ${category === "formula_car" ? "Formula Car" : "Sports Car"} com pelo menos ${MIN_RACE_MINUTES} minutos encontrada.` }; continue; }

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

  const lapsResponse = await garage61Get<Garage61LapsResponse>("/laps", { cars: session.car_id, tracks: session.track_id, drivers: "me", group: "none", unclean: "true", lapTypes: "1,2,3,4", limit: 250, offset: 0 });
  const eventLaps = (lapsResponse.items ?? []).filter((lap) =>
    lap.event === session.garage61_event_id && lap.canViewTelemetry &&
    Number.isFinite(lap.lapTime) && Number(lap.lapTime) > 0 &&
    !lap.incomplete && !lap.missing && !lap.pitLane && !lap.pitIn && !lap.pitOut
  );
  const candidateLaps = [...eventLaps].sort((a, b) => Number(a.lapTime) - Number(b.lapTime));
  if (candidateLaps.length < 3) return { status: "ok", session: null, message: "Poucas voltas com telemetria disponível nessa corrida para uma análise de consistência confiável (mínimo 3)." };

  const token = process.env.GARAGE61_API_TOKEN;
  if (!token) throw new Error("GARAGE61_API_TOKEN não configurado");

  // Baixa telemetria de voltas extras além do topo, caso algumas precisem ser descartadas por overtake ativo (Super Formula).
  const poolSize = isSuperFormula ? Math.min(candidateLaps.length, MAX_LAPS + 8) : Math.min(candidateLaps.length, MAX_LAPS);
  const pool = candidateLaps.slice(0, poolSize);
  const traces = await Promise.all(pool.map(async (lap) => {
    const response = await fetch(`${GARAGE61_BASE}/laps/${encodeURIComponent(lap.id)}/csv`, { headers: { Authorization: `Bearer ${token}`, Accept: "text/csv" }, cache: "no-store" });
    if (!response.ok) return null;
    const csv = await response.text();
    return { lap, points: parseLapCsv(csv) };
  }));
  let validTraces = traces.filter((item): item is { lap: Garage61Lap; points: TracePoint[] } => !!item && item.points.length > 20);
  let overtakeExcluded = 0;
  if (isSuperFormula) {
    const before = validTraces.length;
    validTraces = validTraces.filter(({ points }) => !usedOvertake(points));
    overtakeExcluded = before - validTraces.length;
  }
  validTraces = validTraces.sort((a, b) => Number(a.lap.lapTime) - Number(b.lap.lapTime)).slice(0, MAX_LAPS);
  if (validTraces.length < 3) throw new Error("Não foi possível baixar telemetria suficiente para essas voltas (descontando voltas com overtake, se aplicável)");

  const bins = Array.from({ length: 51 }, (_, index) => index * 2);
  const channels: ChannelKey[] = ["throttle", "brake", "steering", "gear", "rpm"];
  const channelStats = channels.map((channel) => {
    const binStats = bins.map((distance) => {
      const values = validTraces.map(({ points }) => interpolate(points, distance, channel)).filter((value): value is number => value !== null);
      if (values.length < 3) return null;
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
      return { distance, stddev: Math.sqrt(variance), mean };
    }).filter((item): item is { distance: number; stddev: number; mean: number } => item !== null);
    if (!binStats.length) return null;
    const scale = channel === "rpm" ? 1000 : channel === "steering" ? 0.15 : channel === "gear" ? 0.3 : 1;
    const normalized = binStats.map((item) => ({ ...item, score: item.stddev / scale }));
    const avgScore = normalized.reduce((sum, item) => sum + item.score, 0) / normalized.length;
    const worst = [...normalized].sort((a, b) => b.score - a.score).slice(0, 3);
    const best = [...normalized].sort((a, b) => a.score - b.score).slice(0, 3);
    return { channel, label: CHANNEL_LABELS[channel], avgScore, worstZones: worst.map((item) => ({ distance: item.distance, stddev: item.stddev })), bestZones: best.map((item) => ({ distance: item.distance, stddev: item.stddev })) };
  }).filter((item): item is NonNullable<typeof item> => item !== null);

  const lapTimes = validTraces.map(({ lap }) => Number(lap.lapTime)).sort((a, b) => a - b);
  const avgLapTime = lapTimes.reduce((sum, value) => sum + value, 0) / lapTimes.length;
  const lapTimeStddev = Math.sqrt(lapTimes.reduce((sum, value) => sum + (value - avgLapTime) ** 2, 0) / lapTimes.length);
  const spread = lapTimes[lapTimes.length - 1] - lapTimes[0];

  const ranked = [...channelStats].sort((a, b) => a.avgScore - b.avgScore);
  const strengths = ranked.slice(0, 2).map((item) => `${item.label}: você repete o mesmo padrão em quase toda a volta — essa é uma das suas maiores forças agora, não mexa nisso sem motivo.`);
  const improvements = ranked.slice(-3).reverse().map((item) => {
    const zone = item.worstZones[0];
    return `${item.label}: a maior variação entre as voltas acontece perto de ${zone.distance}% da pista — você não está repetindo ${CHANNEL_PHRASE[item.channel as ChannelKey]} ali volta a volta. Foque em fazer o mesmo movimento, no mesmo ponto, todas as vezes antes de tentar ganhar mais performance.`;
  });

  return {
    status: "ok",
    session: {
      startedAt: session.started_at, endedAt: session.ended_at,
      durationMinutes: Math.round((new Date(session.ended_at).getTime() - new Date(session.started_at).getTime()) / 60000),
      car: carName, track: `${trackRow.data?.name ?? `Pista ${session.track_id}`}${trackRow.data?.variant ? ` (${trackRow.data.variant})` : ""}`,
    },
    lapsAnalyzed: validTraces.length,
    overtakeExcluded,
    bestLap: formatLapTime(lapTimes[0]),
    worstLap: formatLapTime(lapTimes[lapTimes.length - 1]),
    lapTimeSpread: spread.toFixed(3),
    lapTimeStddev: lapTimeStddev.toFixed(3),
    summary: `Analisei suas ${validTraces.length} voltas mais rápidas dessa corrida (${formatLapTime(lapTimes[0])} a ${formatLapTime(lapTimes[lapTimes.length - 1])}, variação de ${spread.toFixed(3)}s).${overtakeExcluded ? ` ${overtakeExcluded} volta(s) com overtake ativo foram descartadas da análise.` : ""} ${lapTimeStddev < 0.3 ? "Seu ritmo foi bem consistente entre as voltas." : lapTimeStddev < 0.8 ? "Seu ritmo variou de forma moderada entre as voltas." : "Seu ritmo variou bastante entre as voltas — há tempo sendo perdido na repetição, não só na velocidade máxima."}`,
    strengths,
    improvements,
    channelStats: channelStats.map((item) => ({ channel: item.channel, label: item.label, avgScore: Number(item.avgScore.toFixed(2)) })),
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

    const categories = await computeDebrief(driver.id, carCategoryMap);
    return NextResponse.json({ status: "ok", categories });
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
