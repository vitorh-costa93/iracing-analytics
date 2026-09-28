import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { readTelemetryText } from "@/lib/telemetry-storage";
import { parseTelemetryCsv, type Trace } from "@/lib/telemetry-trace";
import { detectLapCorners } from "@/lib/lap-corners";
import { compareLaps } from "@/lib/lap-analysis";
import { detectSteeringCorrections, type TractionSample } from "@/lib/traction-events";
import { analyzeSelfConsistency, type SelfSection } from "@/lib/self-consistency";
import { describeSelfSection, rightAndWrong, strengthsAndImprovements } from "@/lib/debrief-talk";
import { buildSectorReport } from "@/lib/sector-report";
import { raceWinnerGap } from "@/lib/winner-gap";
import { classifyRaceLaps, lapSetKey, MIN_RACE_LAPS, parseLapTimeText, type RaceLapRow } from "@/lib/race-debrief-laps";
import { buildBestPasses } from "@/lib/debrief-best-pass";
import { sectorSpreadRatio } from "@/lib/sector-consistency";

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
 * memória evita recalcular a cada abertura. O cache guarda só a análise de voltas e telemetria;
 * race_results e iRating entram fora dele, em composeDebrief (auditoria B, 26/09/2026).
 * Piso: corridas com pelo menos MIN_RACE_LAPS (5) voltas completadas, como no Meu Debrief antigo.
 */
export const maxDuration = 120;

const CACHE_VERSION = 3; // 3: sem race_results/iRating no payload, melhor passagem por trecho, setores relativos
const CACHE_PREFIX = "race:";
const MAX_CACHED_RACES = 30;
const LIST_LIMIT = 40; // ~6 semanas de corridas: o seletor alcança corridas que já têm telemetria armazenada
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

/** Mesmo mapeamento do Comparar Carros (app/api/telemetry/car-comparison/route.ts): lib/traction-events.ts
 * usa uma forma de amostra mínima e agnóstica de fonte, reaproveitada aqui para o mesmo detector
 * validado de microcorreções (corner-relative baseline), em vez do limiar absoluto que reintroduziu o
 * "conta o chacoalhão da pista" (28/09/2026). */
function toRaceTractionSamples(points: Trace["points"]): TractionSample[] {
  return points.map((point) => ({
    distance: point.distance, throttle: point.throttle ?? undefined, rpm: point.rpm ?? undefined, gear: point.gear ?? undefined,
    speedMs: point.speed ?? undefined, steeringRad: point.steering ?? undefined, yawRate: point.yawRate ?? undefined,
  }));
}

/** Ponto médio de cada trecho flagrado (lib/traction-events.ts dá início/fim, não um ponto único) --
 * o suficiente para o mesmo agrupamento por trecho (self-consistency, popup) que já existia com os
 * pontos discretos do detector antigo. */
function correctionMidpoints(events: { startDistance: number; endDistance: number; lapIndex?: number }[], lapIndex: number): number[] {
  return events.filter((event) => event.lapIndex === lapIndex).map((event) => Number(((event.startDistance + event.endDistance) / 2).toFixed(2)));
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

/**
 * Parte do debrief que depende só das voltas e da telemetria (vai para o cache race_debriefs).
 * Nada de race_results/iRating aqui (auditoria B, 26/09/2026): posição, incidentes, Δ iRating, melhor
 * volta oficial, vencedor e os pontos fortes/melhoria que usam esses números são montados a cada
 * abertura em composeDebrief, como o `winnerGap` da versão anterior (94c4d8d), para um reimport do
 * iRStats ou a correção de 2 dias da âncora de iRating aparecerem sem esperar o cache mudar.
 */
async function buildAnalysis(driverId: string, race: RaceRow, session: SessionRow | undefined, raceLaps: RaceLapRow[]) {
  const trackRow = race.track_id ? await supabaseAdmin.from("tracks").select("name,variant").eq("id", race.track_id).maybeSingle() : { data: null };
  const classified = classifyRaceLaps(raceLaps);
  const clean = classified.kept;
  const bestFromLaps = clean.length ? Math.min(...clean.map((lap) => lap.lapTime)) : null;
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
      return { lap, trace: decimate(full, ANALYSIS_POINTS), tractionSamples: toRaceTractionSamples(full.points) };
    } catch { return null; }
  }))).filter((item): item is NonNullable<typeof item> => item !== null);

  // Microcorreções: mesmo detector corner-relative do Comparar Carros (lib/traction-events.ts), sobre
  // o pool de voltas de telemetria já baixadas acima. A baseline por trecho vem do próprio pool, então
  // corrigido só conta quando destoa do que ESTE piloto normalmente faz ali -- uma zebra/bump que
  // aparece igual em toda volta some da contagem por já estar na mediana.
  const correctionEvents = traces.length ? detectSteeringCorrections(traces.map((item) => item.tractionSamples)) : [];
  const micro = traces.length ? { perLap: Number((correctionEvents.length / traces.length).toFixed(1)), laps: traces.length } : null;
  const fastest = traces.length ? traces.reduce((best, item) => (item.lap.lapTime < best.lap.lapTime ? item : best)) : null;
  const corners = fastest && race.track_id ? detectLapCorners(fastest.trace.points, trackRow.data?.name ?? race.track_name ?? "", trackRow.data?.variant ?? "") : [];
  const self = analyzeSelfConsistency(traces.map((item, index) => ({ lapNumber: item.lap.lapNumber, lapTime: item.lap.lapTime, trace: item.trace, microDistances: correctionMidpoints(correctionEvents, index) })), corners);

  // Referência do carro/pista: a volta que o PILOTO enviou (telemetry_references), não uma volta
  // "da classe". Tempo estimado e microcorreções dela -- entra no MESMO pool acima (uma volta a mais
  // não desloca a mediana por trecho de forma relevante) para ficar na mesma unidade do `micro` geral.
  let reference: { gap: number; microPerLap: number | null } | null = null;
  let referenceTrace: Trace | null = null;
  if (fastest && race.car_id && race.track_id) {
    const refFull = await loadReference(driverId, race.car_id, race.track_id);
    if (refFull && coversLap(refFull)) {
      referenceTrace = decimate(refFull, ANALYSIS_POINTS);
      const comparison = compareLaps(fastest.trace, referenceTrace, fastest.lap.lapTime, corners);
      if (comparison) {
        const withReference = detectSteeringCorrections([...traces.map((item) => item.tractionSamples), toRaceTractionSamples(refFull.points)]);
        const refCount = withReference.filter((event) => event.lapIndex === traces.length).length;
        reference = { gap: comparison.estimatedReferenceTime - fastest.lap.lapTime, microPerLap: refCount || null };
      }
    }
  }

  const sectorResult = session?.garage61_event_id && race.car_id && race.track_id
    ? await buildSectorReport(driverId, race.car_id, race.track_id, session.garage61_event_id).catch(() => null)
    : null;
  const sectorReport = sectorResult?.report ?? null;
  // Pior setor pelo mesmo critério relativo (desvio ÷ média) do relatório de setores, para a frase de
  // melhoria e o rodapé do painel apontarem o MESMO setor.
  const worstSector = sectorReport ? sectorReport.sectors.find((sector) => sector.sector === sectorReport.worstSector) ?? null : null;

  const sections = self?.sections ?? [];
  const telemetryLaps = traces.length;
  let selfNote: string | null = null;
  if (!session) selfNote = "Não achei a sessão desta corrida no Garage61, então não há voltas nem telemetria para comparar você com você mesmo.";
  else if (telemetryLaps < 3) selfNote = `${telemetryLaps === 0 ? "Nenhuma volta limpa desta corrida tem" : telemetryLaps === 1 ? "Só 1 volta limpa desta corrida tem" : `Só ${telemetryLaps} voltas limpas desta corrida têm`} telemetria armazenada. Preciso de pelo menos 3 para comparar você com você mesmo.${lapsWithoutTelemetry ? ` ${lapsWithoutTelemetry} voltas limpas ainda estão sem telemetria no Storage.` : ""}`;
  else if (!self || !sections.length) selfNote = "Não consegui separar os trechos de curva desta pista com a telemetria disponível.";
  else if (!self.canCompareFastSlow) selfNote = `Com ${telemetryLaps} voltas com telemetria dá para medir quanto você varia, mas ainda não para separar as voltas rápidas das lentas (preciso de 5).`;
  else if (lapsWithoutTelemetry) selfNote = `${telemetryLaps} voltas com telemetria analisadas; ${lapsWithoutTelemetry} voltas limpas ainda estão sem telemetria armazenada.`;

  const boxes = rightAndWrong(sections);
  return {
    version: CACHE_VERSION,
    laps: { bestFromLaps, cleanAverage, cleanLaps: clean.length, paceTrend },
    referenceGap: reference ? Number(reference.gap.toFixed(3)) : null,
    micro: micro ? { perLap: micro.perLap, laps: micro.laps, reference: reference?.microPerLap ?? null } : null,
    sample: { telemetryLaps, lapsWithoutTelemetry, robust: telemetryLaps >= 10 },
    brakeRepeatShare: self ? brakeRepeatShare(sections, self.trackLengthMeters) : null,
    worstSector: worstSector ? { label: `S${worstSector.sector}`, spread: worstSector.stddev } : null,
    right: boxes.right, wrong: boxes.wrong,
    selfNote,
    sections: sections.map((section, index) => ({
      id: section.id, label: section.label, isSequence: section.isSequence, laps: section.laps, corners: section.corners,
      variation: section.variation, lever: section.lever, gainIfRepeat: section.gainIfRepeat,
      talk: describeSelfSection(section, index, self?.canCompareFastSlow ?? false),
    })),
    // Melhor passagem (mapa local + freio/acelerador) nos trechos com mais ganho (auditoria B7).
    // A curva da referência (auditoria, 27/09/2026: "linha contínua a sua, pontilhada a da referência,
    // mesmas cores para os dois") só entra quando a comparação de ritmo (compareLaps) já validou a
    // referência para esta corrida -- reaproveita a mesma volta decimada, sem ler o Storage de novo.
    bestPasses: buildBestPasses(sections, traces.map((item) => ({ lapNumber: item.lap.lapNumber, trace: item.trace })), referenceTrace),
    sectors: sectorReport
      ? {
        lapsAnalyzed: sectorReport.lapsAnalyzed, idealLap: sectorReport.idealLapSeconds, bestLap: sectorReport.actualBestLapSeconds, gap: sectorReport.gapToIdealSeconds, worstSector: sectorReport.worstSector,
        rows: sectorReport.sectors.map((sector) => ({ sector: sector.sector, best: sector.best, stddev: sector.stddev, mean: sector.mean, consistency: sector.consistency, ratio: Number(sectorSpreadRatio(sector.stddev, sector.mean).toFixed(5)) })),
      }
      : null,
    sectorsMessage: sectorReport ? null : sectorResult?.message ?? (session ? "Sem tempos de setor registrados para esta corrida." : "Sem a sessão do Garage61 não há tempos de setor."),
    discarded: classified.discarded,
  };
}

type Analysis = Awaited<ReturnType<typeof buildAnalysis>> & { lapSetKey?: string };

/** Junta a análise (em cache) com os dados de race_results/iRating lidos agora. */
async function composeDebrief(race: RaceRow, analysis: Analysis) {
  const { data: rating } = await supabaseAdmin.from("v_race_results_irating").select("irating_before,irating_after").eq("id", race.id).maybeSingle();
  const officialBest = parseLapTimeText(race.fastest_lap_time);
  const bestLap = officialBest ?? analysis.laps.bestFromLaps;
  const winner = raceWinnerGap(race.fastest_lap_time, race.winner_fastest_lap_time);
  const { strengths, improvements } = strengthsAndImprovements({
    gridPosition: race.grid_position, finishPosition: race.finish_position, incidents: race.incidents, laps: race.laps,
    bestLap, cleanAverage: analysis.laps.cleanAverage, paceTrend: analysis.laps.paceTrend,
    microPerLap: analysis.micro?.perLap ?? null, referenceMicroPerLap: analysis.micro?.reference ?? null,
    brakeRepeatShare: analysis.brakeRepeatShare, worstSector: analysis.worstSector, sections: analysis.sections,
  });
  return {
    race: {
      id: race.id, racedAt: race.raced_at, label: raceLabel(race), series: race.series_name,
      car: race.car_name, track: race.track_name, carId: race.car_id, trackId: race.track_id, category: race.category,
      grid: race.grid_position, finish: race.finish_position, incidents: race.incidents, laps: race.laps,
      iratingDelta: race.irating_delta, iratingBefore: rating?.irating_before ?? null, iratingAfter: rating?.irating_after ?? null,
    },
    pace: {
      bestLap, cleanAverage: analysis.laps.cleanAverage, cleanLaps: analysis.laps.cleanLaps,
      reference: analysis.referenceGap !== null ? { kind: "reference" as const, gap: analysis.referenceGap }
        : winner ? { kind: "winner" as const, gap: Number((-winner.seconds).toFixed(3)) } : null,
    },
    micro: analysis.micro,
    sample: analysis.sample,
    strengths, improvements, right: analysis.right, wrong: analysis.wrong,
    selfNote: analysis.selfNote,
    sections: analysis.sections,
    bestPasses: analysis.bestPasses,
    sectors: analysis.sectors,
    sectorsMessage: analysis.sectorsMessage,
    discarded: analysis.discarded,
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
    let analysis = (memoryCache.get(memoryKey) as Analysis | undefined) ?? null;
    if (!analysis) {
      const { data: cached } = await supabaseAdmin.from("race_debriefs").select("session_id,payload").eq("driver_id", driverId).eq("rating_category", key).maybeSingle();
      const payload = cached?.payload as Analysis | undefined;
      if (payload && payload.version === CACHE_VERSION && payload.lapSetKey === setKey && Number(cached?.session_id ?? 0) === Number(session?.id ?? 0)) analysis = payload;
    }
    if (!analysis) {
      const payload: Analysis = { ...(await buildAnalysis(driverId, selected, session, raceLaps)), lapSetKey: setKey };
      analysis = payload;
      if (process.env.NODE_ENV === "production" && session) {
        await supabaseAdmin.from("race_debriefs").upsert({ driver_id: driverId, rating_category: key, session_id: session.id, payload, computed_at: new Date().toISOString() }, { onConflict: "driver_id,rating_category" });
        const { data: rows } = await supabaseAdmin.from("race_debriefs").select("id").eq("driver_id", driverId).like("rating_category", `${CACHE_PREFIX}%`).order("computed_at", { ascending: false });
        const stale = (rows ?? []).slice(MAX_CACHED_RACES).map((row) => row.id);
        if (stale.length) await supabaseAdmin.from("race_debriefs").delete().in("id", stale);
      }
    }
    memoryCache.set(memoryKey, analysis);
    if (memoryCache.size > 40) memoryCache.delete(memoryCache.keys().next().value!);

    const debrief = await composeDebrief(selected, analysis);
    return NextResponse.json({ status: "ok", races: list, selectedId: selected.id, debrief });
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
