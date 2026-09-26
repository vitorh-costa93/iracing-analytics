import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { readTelemetryText } from "@/lib/telemetry-storage";
import { parseTelemetryCsv, type Trace } from "@/lib/telemetry-trace";
import { detectLapCorners } from "@/lib/lap-corners";
import { compareLaps } from "@/lib/lap-analysis";
import { detectMicrocorrections, summarizeMicrocorrections } from "@/lib/microcorrections";
import { analyzeSelfConsistency, type SelfSection } from "@/lib/self-consistency";
import { describeSelfSection, rightAndWrong, strengthsAndImprovements } from "@/lib/debrief-talk";
import { buildSectorReport } from "@/lib/sector-report";
import { raceWinnerGap } from "@/lib/winner-gap";
import { classifyRaceLaps, lapSetKey, parseLapTimeText, type RaceLapRow } from "@/lib/race-debrief-laps";

/**
 * Race Debrief do Night Grid (redesign etapa 4, 26/09/2026; mockup docs/redesign-mockup/Debrief.dc.html).
 *
 * Supabase-first, sem nenhuma chamada ao Garage61: a corrida vem de race_results (iRStats), a sessão
 * de driving_sessions (session_type = 3), as voltas da tabela laps (só sessionType 3 do evento) e a
 * telemetria do Storage (lib/telemetry-storage.ts, com o teto diário). Volta sem telemetry_path não é
 * baixada ao vivo: a tela diz quantas voltas ficaram sem telemetria armazenada.
 *
 * Cache: race_debriefs com rating_category = "race:<irstats_race_id>" (uma linha por corrida, chave
 * nova, sem tocar nas linhas por categoria que o Meu Debrief antigo usa). Versionado por
 * CACHE_VERSION e invalidado quando o conjunto de voltas com telemetria muda (telemetria chegou
 * depois). No máximo MAX_CACHED_RACES linhas "race:"; as mais antigas saem. Fora de produção o cache
 * não é gravado (só lido), para testes locais não escreverem no banco de produção; um cache em
 * memória evita recalcular a cada abertura.
 */
export const maxDuration = 120;

const CACHE_VERSION = 2;
const CACHE_PREFIX = "race:";
const MAX_CACHED_RACES = 30;
const LIST_LIMIT = 40; // ~6 semanas de corridas: o seletor alcança corridas que já têm telemetria armazenada
const MIN_RACE_LAPS = 3;
const MAX_ANALYZED_LAPS = 15;
const ANALYSIS_POINTS = 1500;
const SESSION_MATCH_WINDOW_MS = 3 * 3600_000;
const LAPS_PAGE = 1000;

const memoryCache = new Map<string, unknown>();

type RaceRow = {
  id: string; irstats_race_id: number; raced_at: string; series_name: string | null; car_name: string | null; track_name: string | null;
  car_id: number | null; track_id: number | null; category: string | null; grid_position: number | null; finish_position: number | null;
  laps: number | null; incidents: number | null; irating_delta: number | null; fastest_lap_time: string | null; winner_fastest_lap_time: string | null;
};
type SessionRow = { id: number; garage61_event_id: string | null; car_id: number; track_id: number; started_at: string };

async function currentDriverId() {
  const { data: driver } = await supabaseAdmin.from("drivers").select("id").order("updated_at", { ascending: false }).limit(1).single();
  if (!driver) throw new Error("Piloto não encontrado");
  return driver.id as string;
}

async function loadRaces(driverId: string): Promise<RaceRow[]> {
  const { data, error } = await supabaseAdmin
    .from("race_results")
    .select("id,irstats_race_id,raced_at,series_name,car_name,track_name,car_id,track_id,category,grid_position,finish_position,laps,incidents,irating_delta,fastest_lap_time,winner_fastest_lap_time")
    .eq("driver_id", driverId)
    .gte("laps", MIN_RACE_LAPS)
    .order("raced_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (error) throw error;
  return (data ?? []) as RaceRow[];
}

/** Sessão Garage61 de CORRIDA (session_type = 3) mais próxima de cada resultado do iRStats. */
async function matchSessions(driverId: string, races: RaceRow[]) {
  const withIds = races.filter((race) => race.car_id && race.track_id);
  if (!withIds.length) return new Map<string, SessionRow>();
  const times = withIds.map((race) => new Date(race.raced_at).getTime());
  const { data, error } = await supabaseAdmin
    .from("driving_sessions")
    .select("id,garage61_event_id,car_id,track_id,started_at")
    .eq("driver_id", driverId).eq("session_type", 3)
    .not("garage61_event_id", "is", null)
    .gte("started_at", new Date(Math.min(...times) - SESSION_MATCH_WINDOW_MS).toISOString())
    .lte("started_at", new Date(Math.max(...times) + SESSION_MATCH_WINDOW_MS).toISOString());
  if (error) throw error;
  const sessions = (data ?? []) as SessionRow[];
  const result = new Map<string, SessionRow>();
  for (const race of withIds) {
    const racedAt = new Date(race.raced_at).getTime();
    const candidates = sessions.filter((session) => session.car_id === race.car_id && session.track_id === race.track_id && Math.abs(new Date(session.started_at).getTime() - racedAt) <= SESSION_MATCH_WINDOW_MS);
    if (!candidates.length) continue;
    result.set(race.id, candidates.reduce((best, session) => (Math.abs(new Date(session.started_at).getTime() - racedAt) < Math.abs(new Date(best.started_at).getTime() - racedAt) ? session : best)));
  }
  return result;
}

/** Voltas de corrida (sessionType 3) dos eventos, paginadas. */
async function loadRaceLaps(driverId: string, sessions: SessionRow[]) {
  const eventIds = [...new Set(sessions.map((session) => session.garage61_event_id).filter((id): id is string => !!id))];
  const rows: (RaceLapRow & { event: string; car_id: number })[] = [];
  if (!eventIds.length) return rows;
  for (let offset = 0; ; offset += LAPS_PAGE) {
    const { data, error } = await supabaseAdmin
      .from("laps")
      .select("id,car_id,lap_number,lap_time,clean,off_track,pit_in,pit_out,pit_lane,incomplete,missing,telemetry_path,event:garage61_payload->>event")
      .eq("driver_id", driverId)
      .in("garage61_payload->>event", eventIds)
      .eq("garage61_payload->>sessionType", "3")
      .range(offset, offset + LAPS_PAGE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as unknown as (RaceLapRow & { event: string; car_id: number })[]));
    if (!data || data.length < LAPS_PAGE) break;
  }
  return rows;
}

function lapsOfSession(allLaps: (RaceLapRow & { event: string; car_id: number })[], session: SessionRow | undefined) {
  if (!session) return [];
  return allLaps.filter((lap) => lap.event === session.garage61_event_id && lap.car_id === session.car_id);
}

function raceLabel(race: RaceRow) {
  const date = new Date(race.raced_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });
  return `${date} · ${race.track_name ?? "Pista"} · ${race.car_name ?? "Carro"}`;
}

function decimate(trace: Trace, maxPoints: number): Trace {
  const stride = Math.max(1, Math.ceil(trace.points.length / maxPoints));
  return stride === 1 ? trace : { ...trace, points: trace.points.filter((_, index) => index % stride === 0) };
}

function coversLap(trace: Trace) {
  const first = trace.points[0]?.distance ?? 100;
  const last = trace.points[trace.points.length - 1]?.distance ?? 0;
  return trace.points.length > 200 && first <= 3 && last >= 97;
}

/** Parte das freadas (volta × trecho) a menos de 3 m da mediana daquele trecho. */
function brakeRepeatShare(sections: SelfSection[], trackLengthMeters: number | null) {
  if (!trackLengthMeters) return null;
  let within = 0, total = 0;
  for (const section of sections) {
    if (!section.brakeZone) continue;
    const onsets = section.samples.map((sample) => sample.brakeOnset).filter((value): value is number => value !== null).sort((a, b) => a - b);
    if (onsets.length < 3) continue;
    const median = onsets[Math.floor(onsets.length / 2)];
    for (const onset of onsets) { total += 1; if ((Math.abs(onset - median) / 100) * trackLengthMeters <= 3) within += 1; }
  }
  return total >= 6 ? within / total : null;
}

async function loadReference(driverId: string, carId: number, trackId: number): Promise<Trace | null> {
  const { data } = await supabaseAdmin.from("telemetry_references").select("storage_path").eq("driver_id", driverId).eq("car_id", carId).eq("track_id", trackId).order("uploaded_at", { ascending: false }).limit(1).maybeSingle();
  if (!data?.storage_path) return null;
  const csv = await readTelemetryText(data.storage_path, "telemetry-references");
  if (!csv) return null;
  try { return parseTelemetryCsv(csv, { maxPoints: Infinity }); } catch { return null; }
}

async function buildPayload(driverId: string, race: RaceRow, session: SessionRow | undefined, raceLaps: RaceLapRow[]) {
  const [ratingRow, trackRow] = await Promise.all([
    supabaseAdmin.from("v_race_results_irating").select("irating_before,irating_after").eq("id", race.id).maybeSingle(),
    race.track_id ? supabaseAdmin.from("tracks").select("name,variant").eq("id", race.track_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const classified = classifyRaceLaps(raceLaps);
  const clean = classified.kept;
  const bestFromLaps = clean.length ? Math.min(...clean.map((lap) => lap.lapTime)) : null;
  const officialBest = parseLapTimeText(race.fastest_lap_time);
  const bestLap = officialBest ?? bestFromLaps;
  const cleanAverage = clean.length ? clean.reduce((sum, lap) => sum + lap.lapTime, 0) / clean.length : null;
  const chronological = [...clean].sort((a, b) => (a.lapNumber ?? 0) - (b.lapNumber ?? 0));
  const half = Math.floor(chronological.length / 2);
  const paceTrend = chronological.length >= 6
    ? chronological.slice(-half).reduce((sum, lap) => sum + lap.lapTime, 0) / half - chronological.slice(0, half).reduce((sum, lap) => sum + lap.lapTime, 0) / half
    : null;

  // Telemetria: só as voltas limpas com arquivo no Storage, das mais rápidas para as mais lentas.
  const withTelemetry = clean.filter((lap) => lap.telemetryPath).sort((a, b) => a.lapTime - b.lapTime).slice(0, MAX_ANALYZED_LAPS);
  const lapsWithoutTelemetry = clean.filter((lap) => !lap.telemetryPath).length;
  const traces = (await Promise.all(withTelemetry.map(async (lap) => {
    const text = await readTelemetryText(lap.telemetryPath as string);
    if (!text) return null;
    try {
      const full = parseTelemetryCsv(text, { maxPoints: Infinity });
      if (!coversLap(full)) return null;
      const micro = detectMicrocorrections(full.points.map((point) => ({ distance: point.distance, speed: point.speed, steering: point.steering })), lap.lapTime);
      return { lap, trace: decimate(full, ANALYSIS_POINTS), micro };
    } catch { return null; }
  }))).filter((item): item is NonNullable<typeof item> => item !== null);

  const micro = summarizeMicrocorrections(traces.map((item) => ({ result: item.micro, lapTimeSeconds: item.lap.lapTime })));
  const fastest = traces.length ? traces.reduce((best, item) => (item.lap.lapTime < best.lap.lapTime ? item : best)) : null;
  const corners = fastest && race.track_id ? detectLapCorners(fastest.trace.points, trackRow.data?.name ?? race.track_name ?? "", trackRow.data?.variant ?? "") : [];
  const self = analyzeSelfConsistency(traces.map((item) => ({ lapNumber: item.lap.lapNumber, lapTime: item.lap.lapTime, trace: item.trace, microDistances: item.micro.distances })), corners);

  // Referência do carro/pista (volta enviada pelo piloto): tempo estimado e microcorreções dela.
  let reference: { gap: number; microPerMinute: number | null } | null = null;
  if (fastest && race.car_id && race.track_id) {
    const refFull = await loadReference(driverId, race.car_id, race.track_id);
    if (refFull && coversLap(refFull)) {
      const comparison = compareLaps(fastest.trace, decimate(refFull, ANALYSIS_POINTS), fastest.lap.lapTime, corners);
      if (comparison) {
        const refMicro = detectMicrocorrections(refFull.points.map((point) => ({ distance: point.distance, speed: point.speed, steering: point.steering })), comparison.estimatedReferenceTime);
        reference = { gap: comparison.estimatedReferenceTime - fastest.lap.lapTime, microPerMinute: refMicro.count ? Number(refMicro.perMinute.toFixed(1)) : null };
      }
    }
  }
  const winner = raceWinnerGap(race.fastest_lap_time, race.winner_fastest_lap_time);

  const sectorResult = session?.garage61_event_id && race.car_id && race.track_id
    ? await buildSectorReport(driverId, race.car_id, race.track_id, session.garage61_event_id).catch(() => null)
    : null;
  const sectorReport = sectorResult?.report ?? null;
  const worstSector = sectorReport ? sectorReport.sectors.reduce((a, b) => (b.stddev > a.stddev ? b : a)) : null;

  const sections = self?.sections ?? [];
  const facts = {
    gridPosition: race.grid_position, finishPosition: race.finish_position, incidents: race.incidents, laps: race.laps,
    bestLap, cleanAverage, paceTrend,
    microPerMinute: micro?.perMinute ?? null, referenceMicroPerMinute: reference?.microPerMinute ?? null,
    brakeRepeatShare: self ? brakeRepeatShare(sections, self.trackLengthMeters) : null,
    worstSector: worstSector ? { label: `S${worstSector.sector}`, spread: worstSector.stddev } : null,
    sections,
  };
  const { strengths, improvements } = strengthsAndImprovements(facts);
  const boxes = rightAndWrong(sections);

  const telemetryLaps = traces.length;
  let selfNote: string | null = null;
  if (!session) selfNote = "Não achei a sessão desta corrida no Garage61, então não há voltas nem telemetria para comparar você com você mesmo.";
  else if (telemetryLaps < 3) selfNote = `${telemetryLaps === 0 ? "Nenhuma volta limpa desta corrida tem" : telemetryLaps === 1 ? "Só 1 volta limpa desta corrida tem" : `Só ${telemetryLaps} voltas limpas desta corrida têm`} telemetria armazenada. Preciso de pelo menos 3 para comparar você com você mesmo.${lapsWithoutTelemetry ? ` ${lapsWithoutTelemetry} voltas limpas ainda estão sem telemetria no Storage.` : ""}`;
  else if (!self || !sections.length) selfNote = "Não consegui separar os trechos de curva desta pista com a telemetria disponível.";
  else if (!self.canCompareFastSlow) selfNote = `Com ${telemetryLaps} voltas com telemetria dá para medir quanto você varia, mas ainda não para separar as voltas rápidas das lentas (preciso de 5).`;
  else if (lapsWithoutTelemetry) selfNote = `${telemetryLaps} voltas com telemetria analisadas; ${lapsWithoutTelemetry} voltas limpas ainda estão sem telemetria armazenada.`;

  return {
    version: CACHE_VERSION,
    race: {
      id: race.id, racedAt: race.raced_at, label: raceLabel(race), series: race.series_name,
      car: race.car_name, track: race.track_name, carId: race.car_id, trackId: race.track_id, category: race.category,
      grid: race.grid_position, finish: race.finish_position, incidents: race.incidents, laps: race.laps,
      iratingDelta: race.irating_delta, iratingBefore: ratingRow.data?.irating_before ?? null, iratingAfter: ratingRow.data?.irating_after ?? null,
    },
    pace: {
      bestLap, cleanAverage, cleanLaps: clean.length,
      reference: reference ? { kind: "reference" as const, gap: Number(reference.gap.toFixed(3)) }
        : winner ? { kind: "winner" as const, gap: Number((-winner.seconds).toFixed(3)) } : null,
    },
    micro: micro ? { perMinute: micro.perMinute, perLap: micro.perLap, laps: micro.laps, reference: reference?.microPerMinute ?? null } : null,
    sample: { telemetryLaps, lapsWithoutTelemetry, robust: telemetryLaps >= 10 },
    strengths, improvements, right: boxes.right, wrong: boxes.wrong,
    selfNote,
    sections: sections.map((section, index) => ({
      id: section.id, label: section.label, isSequence: section.isSequence, laps: section.laps,
      variation: section.variation, lever: section.lever, gainIfRepeat: section.gainIfRepeat,
      talk: describeSelfSection(section, index, self?.canCompareFastSlow ?? false),
    })),
    sectors: sectorReport
      ? { lapsAnalyzed: sectorReport.lapsAnalyzed, idealLap: sectorReport.idealLapSeconds, bestLap: sectorReport.actualBestLapSeconds, gap: sectorReport.gapToIdealSeconds, worstSector: sectorReport.worstSector, rows: sectorReport.sectors.map((sector) => ({ sector: sector.sector, best: sector.best, stddev: sector.stddev, mean: sector.mean })) }
      : null,
    sectorsMessage: sectorReport ? null : sectorResult?.message ?? (session ? "Sem tempos de setor registrados para esta corrida." : "Sem a sessão do Garage61 não há tempos de setor."),
    discarded: classified.discarded,
  };
}

export async function GET(request: Request) {
  try {
    const driverId = await currentDriverId();
    const params = new URL(request.url).searchParams;
    const races = await loadRaces(driverId);
    if (!races.length) return NextResponse.json({ status: "ok", races: [], selectedId: null, debrief: null, message: `Nenhuma corrida com pelo menos ${MIN_RACE_LAPS} voltas importada do iRStats ainda.` });
    const sessionsByRace = await matchSessions(driverId, races);
    const allLaps = await loadRaceLaps(driverId, [...sessionsByRace.values()]);

    const list = races.map((race) => {
      const laps = lapsOfSession(allLaps, sessionsByRace.get(race.id));
      return { id: race.id, label: raceLabel(race), category: race.category, hasSession: sessionsByRace.has(race.id), telemetryLaps: laps.filter((lap) => lap.telemetry_path).length };
    });
    const requested = params.get("raceId");
    const selected = races.find((race) => race.id === requested)
      ?? races.find((race) => (list.find((item) => item.id === race.id)?.telemetryLaps ?? 0) >= 3)
      ?? races[0];
    const session = sessionsByRace.get(selected.id);
    const raceLaps = lapsOfSession(allLaps, session);
    const key = `${CACHE_PREFIX}${selected.irstats_race_id}`;
    const setKey = lapSetKey(raceLaps);

    const memoryKey = `${key}|${CACHE_VERSION}|${setKey}`;
    let debrief = memoryCache.get(memoryKey) ?? null;
    if (!debrief) {
      const { data: cached } = await supabaseAdmin.from("race_debriefs").select("session_id,payload").eq("driver_id", driverId).eq("rating_category", key).maybeSingle();
      const payload = cached?.payload as { version?: number; lapSetKey?: string } | undefined;
      if (payload && payload.version === CACHE_VERSION && payload.lapSetKey === setKey && Number(cached?.session_id ?? 0) === Number(session?.id ?? 0)) debrief = payload;
    }
    if (!debrief) {
      const payload = { ...(await buildPayload(driverId, selected, session, raceLaps)), lapSetKey: setKey };
      debrief = payload;
      if (process.env.NODE_ENV === "production" && session) {
        await supabaseAdmin.from("race_debriefs").upsert({ driver_id: driverId, rating_category: key, session_id: session.id, payload, computed_at: new Date().toISOString() }, { onConflict: "driver_id,rating_category" });
        const { data: rows } = await supabaseAdmin.from("race_debriefs").select("id").eq("driver_id", driverId).like("rating_category", `${CACHE_PREFIX}%`).order("computed_at", { ascending: false });
        const stale = (rows ?? []).slice(MAX_CACHED_RACES).map((row) => row.id);
        if (stale.length) await supabaseAdmin.from("race_debriefs").delete().in("id", stale);
      }
    }
    memoryCache.set(memoryKey, debrief);
    if (memoryCache.size > 40) memoryCache.delete(memoryCache.keys().next().value!);

    return NextResponse.json({ status: "ok", races: list, selectedId: selected.id, debrief });
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
