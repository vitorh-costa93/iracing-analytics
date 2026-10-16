import { NextResponse } from "next/server";
import { withDurableCache } from "@/lib/durable-cache";
import { analyticsValidUntil, nextAnalyticsBoundary } from "@/lib/analytics-validity";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { CACHE_TAGS, cachedJson } from "@/lib/cache";
import { normalizeRaceClass } from "@/lib/winner-gap";
import { shortCarName } from "@/lib/car-short-name";
import {
  KIND_LABEL, biggestExitLeak, buildTrainingPlan, carMatchesKind, classReferenceLap, earlyExitBySubsession, gapEvolution, gapPercent,
  idealLap, recommend, summarizeHistory, trackMatches,
  type ContextKind, type CleanLap, type FieldRow, type RaceRow, type SeasonInfo,
} from "@/lib/telemetry-plan";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// PERMANENT GUARD-RAIL (CLAUDE.md "Non-negotiable rules" #7) -- não remover nem aumentar o TTL sem
// pedido explícito. Esta rota cruza resultados da carreira, campo das corridas, sessões da season,
// setups e voltas/setores; sem cache, cada abertura/troca da subaba "Plano e volta" repetiria todas
// essas consultas ao Supabase, o mesmo padrão que estourou a cota gratuita de "Cached Egress" em
// 08-09/09/2026 (ver app/api/dashboard/report/route.ts). Cache em memória por instância, 120 s,
// como no /api/dashboard/report. Consultas só com as colunas necessárias, paginadas de 1000 em 1000,
// sem Storage e sem chamar Garage61/iRStats (só lê o que os syncs já gravaram).
const CACHE_TTL_MS = 120_000;
let cache: { expiresAt: number; payload: unknown } | null = null;
function resetPlanCache() { cache = null; }
const PAGE = 1000;
const WEEK_MS = 7 * 86_400_000;
const MAX_ACTIVE_CONTEXTS = 6;
/** Voltas candidatas lidas por contexto (as mais rápidas marcadas como limpas); só 24 vão para os setores. */
const LAP_CANDIDATES = 60;
const SECTOR_LAPS = 24;

type Row = Record<string, unknown>;

function fail(source: string, error: unknown): never {
  const value = error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  throw new Error(source + ": " + (typeof value.message === "string" ? value.message : String(error)));
}

/** Lê todas as páginas de 1000 em 1000; `build` recebe o intervalo e devolve a consulta já ordenada. */
async function paged<T>(source: string, build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) fail(source, error);
    all.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) return all;
  }
}

const isOffline = (name: unknown) => typeof name === "string" && name.trim().toLowerCase().startsWith("offline");

type Session = { car_id: number | null; track_id: number | null; session_type: number | null; garage61_event_id: string | null; event_name: string | null; lap_count: number | null; started_at: string };
type Catalog = { id: number; name: string; variant?: string | null };
type ContextRow = { week_number: number; context_key: ContextKind; series_name: string; track_name: string; track_match_terms: string[] };

async function handleGet() {
  resetPlanCache();
  try {
    if (cache && cache.expiresAt > Date.now()) {
      return cachedJson(cache.payload, { sMaxAge: 120, swr: 300, tags: [CACHE_TAGS.laps, CACHE_TAGS.results] });
    }
    const payload = await build();
    cache = { expiresAt: Date.now() + CACHE_TTL_MS, payload };
    return cachedJson(payload, { sMaxAge: 120, swr: 300, tags: [CACHE_TAGS.laps, CACHE_TAGS.results] });
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export const GET = withDurableCache(handleGet, { version: "plan-v1", tags: [CACHE_TAGS.laps, CACHE_TAGS.results], ttlSeconds: 120, validUntil: analyticsValidUntil });

async function build() {
  const { data: driver, error: driverError } = await supabaseAdmin.from("drivers").select("id").order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (driverError) fail("drivers", driverError);
  if (!driver) throw new Error("Nenhum piloto encontrado no Supabase.");
  const driverId = driver.id as string;

  const { data: calendarRows, error: calendarError } = await supabaseAdmin.from("season_calendars").select("season_id,season_name,season_start,source_file_name,source_uploaded_at");
  if (calendarError) fail("season_calendars", calendarError);
  const calendars = (calendarRows ?? []) as { season_id: string; season_name: string; season_start: string; source_file_name: string | null; source_uploaded_at: string | null }[];
  const seasons: SeasonInfo[] = calendars.map((row) => ({ id: String(row.season_id), name: row.season_name, start: row.season_start }))
    .sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime());
  const now = Date.now();
  const current = seasons.find((season) => now >= new Date(season.start).getTime() && now < new Date(season.start).getTime() + 12 * WEEK_MS) ?? null;
  if (!current) return { status: "ok", generatedAt: new Date().toISOString(), season: null };
  const currentWeek = Math.floor((now - new Date(current.start).getTime()) / WEEK_MS) + 1;
  const weekStart = new Date(new Date(current.start).getTime() + (currentWeek - 1) * WEEK_MS);
  const weekEnd = new Date(weekStart.getTime() + WEEK_MS);
  const calendar = calendars.find((row) => String(row.season_id) === current.id)!;

  const [races, fieldRows, sessions, setups, contextRows, cars, tracks, groupRows] = await Promise.all([
    // race_results só guarda corridas (session_type = 3).
    paged<RaceRow>("race_results", (from, to) => supabaseAdmin.from("race_results")
      .select("irstats_race_id,raced_at,series_name,track_name,car_name,car_id,track_id,season_week,irating_delta,fastest_lap_time,race_fastest_lap_time,class_fastest_lap_time")
      .eq("driver_id", driverId).order("raced_at", { ascending: true }).order("irstats_race_id", { ascending: true }).range(from, to)),
    // Só a linha do piloto e o líder de cada classe (≈2 linhas por corrida), não o campo inteiro.
    paged<FieldRow>("race_field_results", (from, to) => supabaseAdmin.from("race_field_results")
      .select("subsession_id,car_class_id,laps_complete,finish_position_in_class,is_me")
      .eq("sim_session_type", "race").or("is_me.eq.true,finish_position_in_class.eq.0")
      .order("subsession_id", { ascending: true }).order("cust_id", { ascending: true }).range(from, to)),
    paged<Session>("driving_sessions", (from, to) => supabaseAdmin.from("driving_sessions")
      .select("car_id,track_id,session_type,garage61_event_id,event_name,lap_count,started_at")
      .eq("driver_id", driverId).eq("season_id", current.id).in("session_type", [1, 2, 3])
      .order("started_at", { ascending: true }).order("id", { ascending: true }).range(from, to)),
    paged<{ car_id: number; track_id: number }>("setup_files", (from, to) => supabaseAdmin.from("setup_files")
      .select("car_id,track_id").eq("driver_id", driverId).order("id", { ascending: true }).range(from, to)),
    supabaseAdmin.from("season_week_contexts").select("week_number,context_key,series_name,track_name,track_match_terms").eq("season_id", current.id)
      .order("week_number", { ascending: true }).order("context_key", { ascending: true }),
    supabaseAdmin.from("cars").select("id,name"),
    supabaseAdmin.from("tracks").select("id,name,variant"),
    supabaseAdmin.from("car_groups").select("id,name").in("name", ["GTP", "LMP2", "GT3"]),
  ]);
  for (const [source, result] of [["season_week_contexts", contextRows], ["cars", cars], ["tracks", tracks], ["car_groups", groupRows]] as const) if (result.error) fail(source, result.error);
  const weekContexts = (contextRows.data ?? []) as ContextRow[];
  const carCatalog = (cars.data ?? []) as Catalog[], trackCatalog = (tracks.data ?? []) as Catalog[];
  const groups = (groupRows.data ?? []) as { id: number; name: string }[];
  const membersResult = groups.length ? await supabaseAdmin.from("car_group_members").select("car_group_id,car_id").in("car_group_id", groups.map((group) => group.id)) : { data: [], error: null };
  if (membersResult.error) fail("car_group_members", membersResult.error);

  // Classe do carro (GT3/GTP/LMP2) só por grupo + P217; nunca pela série.
  const groupName = new Map(groups.map((group) => [group.id, group.name]));
  const groupsByCar = new Map<number, string[]>();
  for (const member of (membersResult.data ?? []) as { car_group_id: number; car_id: number }[]) {
    const name = groupName.get(member.car_group_id);
    if (name) groupsByCar.set(member.car_id, [...(groupsByCar.get(member.car_id) ?? []), name]);
  }
  const carName = new Map(carCatalog.map((car) => [car.id, car.name]));
  const carIdByName = new Map(carCatalog.map((car) => [car.name, car.id]));
  const trackName = new Map(trackCatalog.map((track) => [track.id, track.name]));
  const trackLabel = (id: number) => { const track = trackCatalog.find((item) => item.id === id); return track ? track.name + (track.variant ? " (" + track.variant + ")" : "") : "Pista " + id; };
  const classOfId = (carId: number | null, fallbackName?: string) => {
    const id = carId ?? (fallbackName ? carIdByName.get(fallbackName) ?? null : null);
    const name = (id !== null ? carName.get(id) : null) ?? fallbackName ?? "";
    return normalizeRaceClass(name, id !== null ? groupsByCar.get(id) ?? [] : []);
  };
  const raceClass = (race: RaceRow) => classOfId(race.car_id, race.car_name);

  const exits = earlyExitBySubsession(fieldRows);

  // ---- contextos ativos da semana (sessões online da semana oficial, como a Semana ativa) -------
  const offlineEvents = new Set(sessions.filter((session) => isOffline(session.event_name) && session.garage61_event_id).map((session) => session.garage61_event_id as string));
  const online = sessions.filter((session) => !isOffline(session.event_name));
  // Contextos com atividade na season, a semana atual primeiro (depois o uso mais recente): a volta
  // ideal precisa de voltas limpas suficientes, que no começo da semana ainda podem não existir.
  const activeMap = new Map<string, { carId: number; trackId: number; laps: number; weekLaps: number; last: number }>();
  for (const session of online) {
    if (session.car_id === null || session.track_id === null) continue;
    const started = new Date(session.started_at).getTime();
    const key = session.car_id + ":" + session.track_id;
    const entry = activeMap.get(key) ?? { carId: session.car_id, trackId: session.track_id, laps: 0, weekLaps: 0, last: 0 };
    entry.laps += session.lap_count ?? 0;
    if (started >= weekStart.getTime() && started < weekEnd.getTime()) entry.weekLaps += session.lap_count ?? 0;
    entry.last = Math.max(entry.last, started);
    activeMap.set(key, entry);
  }
  const active = [...activeMap.values()].sort((a, b) => Number(b.weekLaps > 0) - Number(a.weekLaps > 0) || b.last - a.last).slice(0, MAX_ACTIVE_CONTEXTS);

  const idealContexts = [];
  for (const pair of active) {
    const { data: lapRows, error: lapsError } = await supabaseAdmin.from("laps")
      .select("id,lap_time,lap_number,joker,discontinuity,missing,incomplete,off_track,pit_lane,pit_in,pit_out,ev:garage61_payload->>event,st:garage61_payload->>startTime")
      .eq("driver_id", driverId).eq("car_id", pair.carId).eq("track_id", pair.trackId).eq("clean", true)
      .gte("garage61_payload->>startTime", current.start).gt("lap_time", 0)
      .order("lap_time", { ascending: true }).limit(LAP_CANDIDATES);
    if (lapsError) fail("laps", lapsError);
    const candidates = ((lapRows ?? []) as unknown as Row[])
      .filter((lap) => !(lap.joker || lap.discontinuity || lap.missing || lap.incomplete || lap.off_track || lap.pit_lane || lap.pit_in || lap.pit_out)
        && !(typeof lap.ev === "string" && offlineEvents.has(lap.ev)))
      .slice(0, SECTOR_LAPS);
    let ideal = null;
    if (candidates.length) {
      const { data: sectorRows, error: sectorError } = await supabaseAdmin.from("lap_sectors").select("lap_id,sector_number,sector_time,incomplete").in("lap_id", candidates.map((lap) => lap.id as string));
      if (sectorError) fail("lap_sectors", sectorError);
      const byLap = new Map<string, { n: number; t: number | null; bad: boolean }[]>();
      for (const sector of (sectorRows ?? []) as { lap_id: string; sector_number: number; sector_time: number | null; incomplete: boolean | null }[]) {
        byLap.set(sector.lap_id, [...(byLap.get(sector.lap_id) ?? []), { n: sector.sector_number, t: sector.sector_time, bad: Boolean(sector.incomplete) || sector.sector_time === null }]);
      }
      const laps: CleanLap[] = candidates.flatMap((lap) => {
        const sectors = (byLap.get(lap.id as string) ?? []).sort((a, b) => a.n - b.n);
        return sectors.length && !sectors.some((sector) => sector.bad) ? [{ id: lap.id as string, lapTime: Number(lap.lap_time), sectors: sectors.map((sector) => sector.t as number) }] : [];
      });
      ideal = idealLap(laps);
    }
    const leaderRace = races.filter((race) => race.car_id === pair.carId && race.track_id === pair.trackId && classReferenceLap(race) !== null).at(-1);
    idealContexts.push({
      key: pair.carId + ":" + pair.trackId,
      carId: pair.carId, car: carName.get(pair.carId) ?? "Carro " + pair.carId, carClass: classOfId(pair.carId),
      track: trackLabel(pair.trackId), trackName: trackName.get(pair.trackId) ?? "Pista " + pair.trackId, laps: pair.laps, weekLaps: pair.weekLaps, cleanLapsFound: candidates.length,
      classLeaderLap: leaderRace ? gapPercent(leaderRace.fastest_lap_time, classReferenceLap(leaderRace))?.classBest ?? null : null,
      ideal,
    });
  }
  const primary = idealContexts.find((context) => context.ideal) ?? null;

  // ---- calendário: semanas restantes da season atual ------------------------------------------
  const setupList = setups;
  const calendarRowsOut = weekContexts.filter((context) => context.week_number >= currentWeek).map((context) => {
    const trackIds = trackCatalog.filter((track) => trackMatches(track.name, context.track_match_terms)).map((track) => track.id);
    const trackSet = new Set(trackIds);
    const carOk = (carId: number | null) => carId !== null && carMatchesKind(context.context_key, carName.get(carId) ?? "", classOfId(carId));
    const practiceLaps = online.filter((session) => session.session_type === 1 && session.track_id !== null && trackSet.has(session.track_id) && carOk(session.car_id)).reduce((sum, session) => sum + (session.lap_count ?? 0), 0);
    const setupCount = setupList.filter((setup) => trackSet.has(setup.track_id) && carOk(setup.car_id)).length;
    const history = races.filter((race) => trackMatches(race.track_name, context.track_match_terms) && carMatchesKind(context.context_key, race.car_name, raceClass(race)));
    const summary = summarizeHistory(history, exits);
    const latestGap = [...history].reverse().map((race) => ({ race, gap: gapPercent(race.fastest_lap_time, classReferenceLap(race)) })).find((item) => item.gap !== null);
    return {
      week: context.week_number, kind: context.context_key, kindLabel: KIND_LABEL[context.context_key], series: context.series_name, track: context.track_name,
      current: context.week_number === currentWeek,
      practiceLaps, setups: setupCount, history: summary,
      gap: latestGap && latestGap.gap ? { pct: latestGap.gap.pct, date: latestGap.race.raced_at, old: new Date(latestGap.race.raced_at) < new Date(current.start) } : null,
      recommendation: recommend(summary, practiceLaps, setupCount),
    };
  });

  // ---- meta de volta: contextos agendados da semana atual -------------------------------------
  const target = weekContexts.filter((context) => context.week_number === currentWeek).map((context) => {
    const history = races.filter((race) => trackMatches(race.track_name, context.track_match_terms) && carMatchesKind(context.context_key, race.car_name, raceClass(race)));
    const evolution = gapEvolution(history);
    const latest = evolution.at(-1) ?? null;
    return {
      kind: context.context_key, kindLabel: KIND_LABEL[context.context_key], track: context.track_name,
      latest: latest ? { ...latest, old: new Date(latest.date) < new Date(current.start) } : null,
      evolution,
    };
  });

  // ---- plano de treino -------------------------------------------------------------------------
  const leak = biggestExitLeak(races, exits, seasons, current.id, currentWeek);
  const leakKind = leak ? (["sf23", "imsa", "gt3"] as ContextKind[]).find((kind) => carMatchesKind(kind, leak.carName, classOfId(leak.carId, leak.carName))) : undefined;
  const weekTrack = leak ? weekContexts.find((context) => context.week_number === currentWeek && context.context_key === leakKind)?.track_name ?? null : null;
  const exercises = buildTrainingPlan({
    leak, shortCar: leak ? shortCarName(leak.carName) : "", weekTrack,
    contextLabel: primary ? primary.trackName + " (" + shortCarName(primary.car) + ")" : null,
    ideal: primary?.ideal ?? null, classLeaderLap: primary?.classLeaderLap ?? null,
  });

  return {
    status: "ok",
    generatedAt: new Date().toISOString(),
    cacheValidUntil: nextAnalyticsBoundary([current.start]),
    season: { id: current.id, name: current.name, week: currentWeek, source: calendar.source_file_name, importedAt: calendar.source_uploaded_at },
    plan: { exercises, leak: leak ? { car: leak.carName, leakIrating: leak.leakIrating, races: leak.races, exits: leak.exits } : null, fieldRaces: exits.size },
    calendar: { rows: calendarRowsOut },
    ideal: { contexts: idealContexts, primaryKey: primary?.key ?? idealContexts[0]?.key ?? null },
    target,
  };
}
