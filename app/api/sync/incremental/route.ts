import { NextResponse } from "next/server";
import { garage61Get } from "@/lib/garage61";
import { supabaseAdmin } from "@/lib/supabase-admin";

// This is the slowest of the three "Atualizar dados" calls -- measured 67s live (29/08/2026), mostly
// spent paginating Garage61's /laps per recent car/track pair plus up to TELEMETRY_DOWNLOAD_CAP
// telemetry downloads. Without an explicit maxDuration, Vercel kills the function at its platform
// default (10s on Hobby) well before that finishes -- the button then just hangs client-side with no
// error, which is exactly the "não carregou as corridas mais recentes" symptom reported. 300s is the
// ceiling Vercel allows; harmless to request even on a plan whose own cap is lower.
export const maxDuration = 300;

const OVERLAP_HOURS = 7 * 24;
const INITIAL_LOOKBACK_DAYS = 14;
const PAGE_SIZE = 250;

type Garage61Lap = {
  id: string;
  event?: string;
  eventType?: number;
  session?: number;
  sessionType?: number;
  startTime?: string;
  lapNumber?: number;
  lapTime?: number;
  season?: { id?: string; name?: string };
  car?: { id?: number };
  track?: { id?: number };
  clean?: boolean; joker?: boolean; discontinuity?: boolean; missing?: boolean; incomplete?: boolean; offtrack?: boolean;
  pitlane?: boolean; pitIn?: boolean; pitOut?: boolean;
  driverRating?: number; fuelLevel?: number; fuelUsed?: number; fuelAdded?: number;
  weightPenalty?: number; powerAdjust?: number; tireCompound?: number;
  canViewTelemetry?: boolean; canViewSetup?: boolean;
  sectors?: { sectorTime?: number; incomplete?: boolean }[];
};

/** The lap's own end time (start + duration), not just its start — a session's real end is the
 * end of its LAST lap, otherwise a 1-lap race (early DNF) always looks like it lasted 0 minutes. */
function lapEndTime(lap: Garage61Lap): string {
  if (!lap.startTime) return lap.startTime as unknown as string;
  if (!Number.isFinite(lap.lapTime) || Number(lap.lapTime) <= 0) return lap.startTime;
  return new Date(new Date(lap.startTime).getTime() + Number(lap.lapTime) * 1000).toISOString();
}

type Garage61LapsResponse = { items?: Garage61Lap[]; total?: number };

type SessionRow = {
  driver_id: string;
  garage61_event_id: string;
  garage61_session_id: string;
  car_id: number;
  track_id: number;
  season_id: string | null;
  season_name: string | null;
  session_type: number | null;
  event_type: number | null;
  started_at: string;
  ended_at: string;
  lap_count: number;
};

// 11/09/2026: a pausa proativa em garage61.ts (ver comentário lá) resolve o 429, mas junto com a
// paginação por par carro+pista isso pode empurrar o job inteiro para além do teto de 300s da
// Vercel -- a função é encerrada no meio, sem nunca cair no catch, e a linha em sync_runs fica
// "running" para sempre (só é fechada pela varredura de 15min no topo desta função). Em vez de só
// reagir a isso, o loop abaixo checa o próprio orçamento de tempo e para de pegar PARES NOVOS (ou
// PÁGINAS novas dentro de um par) antes do teto, salvando o que já coletou. Como esta sync já é
// incremental com sobreposição de 7 dias, um par que ficou de fora nesta execução é reprocessado
// (com overlap) na próxima -- não perde dado, só adia.
const TIME_BUDGET_MS = 250_000; // deixa ~50s de folga para upserts/telemetria depois do loop

async function runIncrementalSessionSync() {
  const runStartedAtMs = Date.now();
  const startedAt = new Date().toISOString();
  // Serverless termination can skip the catch block below, leaving a permanent "running" entry.
  // This route has a five-minute ceiling, so anything still running after fifteen minutes is stale,
  // not a concurrent healthy execution. Keep the row for diagnosis rather than deleting it.
  await supabaseAdmin
    .from("sync_runs")
    .update({ status: "error", finished_at: startedAt, error_message: "Execução encerrada sem status final (timeout ou interrupção)." })
    .eq("sync_type", "laps_incremental")
    .eq("status", "running")
    .lt("started_at", new Date(Date.now() - 15 * 60_000).toISOString());
  const { data: syncRun } = await supabaseAdmin
    .from("sync_runs")
    .insert({ sync_type: "laps_incremental", status: "running", started_at: startedAt })
    .select("id")
    .single();

  try {
    const accounts = await garage61Get<{ items: { platform: string; id: string }[] }>(
      "/me/accounts"
    );
    const account = accounts.items.find((item) => item.platform === "iracing");
    if (!account) throw new Error("Conta iRacing não encontrada");

    const { data: driver, error: driverError } = await supabaseAdmin
      .from("drivers")
      .select("id")
      .eq("platform_driver_id", account.id)
      .single();
    if (driverError || !driver) throw new Error("Driver não encontrado no Supabase");

    const { data: latest, error: latestError } = await supabaseAdmin
      .from("driving_sessions")
      .select("started_at")
      .eq("driver_id", driver.id)
      .not("started_at", "is", null)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestError) throw latestError;

    const initialCutoff = Date.now() - INITIAL_LOOKBACK_DAYS * 86_400_000;
    const overlapCutoff = latest?.started_at
      ? new Date(latest.started_at).getTime() - OVERLAP_HOURS * 3_600_000
      : initialCutoff;
    const cutoff = new Date(Math.max(initialCutoff, overlapCutoff));
    const cutoffIso = cutoff.toISOString();

    const { data: stats, error: statsError } = await supabaseAdmin
      .from("daily_statistics")
      .select("car_id, track_id")
      .eq("driver_id", driver.id)
      .gte("statistic_date", cutoffIso.slice(0, 10))
      .not("track_id", "is", null);
    if (statsError) throw statsError;

    const recentPairs = Array.from(
      new Map(
        (stats ?? [])
          .filter(
            (row): row is { car_id: number; track_id: number } =>
              typeof row.car_id === "number" && typeof row.track_id === "number"
          )
          .map((row) => [`${row.car_id}:${row.track_id}`, row])
      ).values()
    );

    const sessions = new Map<string, SessionRow>();
    // Feeds the `laps`/`lap_sectors` tables from the exact same /laps response already being
    // fetched here for session boundaries — no extra Garage61 calls. This is the ONLY recurring
    // sync those two tables had: the original app/api/sync/laps (single hardcoded track, no
    // pagination, no cutoff) was a one-off manual/debug tool never wired to cron or a button, so
    // any car/track pair raced for the first time after that manual run (e.g. a one-off Algarve
    // race) silently had zero rows in `laps` forever — breaking the sector-consistency sub-tab
    // for that pair specifically, while race debrief kept working because it reads Garage61 live.
    type LapRow = { id: string; car_id: number; track_id: number; can_view_telemetry: boolean; telemetry_path: string | null } & Record<string, unknown>;
    const lapRows: LapRow[] = [];
    const sectorRows: { lap_id: string; sector_number: number; sector_time: number | null; incomplete: boolean }[] = [];
    let lapsReceived = 0;
    let recentLaps = 0;
    let pairsSkippedByBudget = 0;

    for (const pair of recentPairs) {
      if (Date.now() - runStartedAtMs > TIME_BUDGET_MS) {
        pairsSkippedByBudget += 1;
        continue;
      }
      // Paginação completa (não só offset=0): alguns pares carro+pista já passam de 250 voltas na
      // season, e parar cedo demais descartava silenciosamente voltas — inclusive sessões de
      // corrida inteiras. MAS paginar até o fim do histórico inteiro do par a cada execução, só
      // para descartar 99% como "antigo demais" depois, é o oposto do problema: é a razão real de
      // "Atualizar Dados" bater rate limit e demorar mais que o necessário, mesmo sendo chamado de
      // hora em hora. A API retorna as voltas mais recentes primeiro (mesmo padrão já usado em
      // fetchWeekLaps, active-week/route.ts) — parar assim que uma página inteira já ficou mais
      // antiga que o cutoff é seguro (nada A PARTIR do cutoff pode estar em páginas posteriores)
      // e transforma isso de "sempre a temporada inteira" em de fato incremental.
      const laps: Garage61Lap[] = [];
      for (let offset = 0; ; offset += PAGE_SIZE) {
        if (Date.now() - runStartedAtMs > TIME_BUDGET_MS) break;
        const response = await garage61Get<Garage61LapsResponse>("/laps", {
          cars: pair.car_id,
          tracks: pair.track_id,
          drivers: "me",
          group: "none",
          unclean: "true",
          lapTypes: "1,2,3,4",
          limit: PAGE_SIZE,
          offset,
        });
        const batch = response.items ?? [];
        laps.push(...batch);
        if (batch.length < PAGE_SIZE) break;
        const oldestInBatch = batch.reduce<Date | null>((value, lap) => {
          const date = lap.startTime ? new Date(lap.startTime) : null;
          return date && Number.isFinite(date.getTime()) && (!value || date < value) ? date : value;
        }, null);
        if (oldestInBatch && oldestInBatch < cutoff) break;
      }
      lapsReceived += laps.length;

      for (const lap of laps) {
        if (!lap.car?.id || !lap.track?.id || !lap.startTime) continue;
        if (new Date(lap.startTime) < cutoff) continue;
        recentLaps++;

        const eventId = lap.event ?? "";
        const sessionId = lap.session === undefined ? "" : String(lap.session);
        const key = `${eventId}:${sessionId}:${lap.car.id}:${lap.track.id}`;
        const existing = sessions.get(key);

        const lapEnd = lapEndTime(lap);
        if (existing) {
          existing.lap_count += 1;
          if (lap.startTime < existing.started_at) existing.started_at = lap.startTime;
          if (lapEnd > existing.ended_at) existing.ended_at = lapEnd;
        } else {
          sessions.set(key, {
            driver_id: driver.id,
            garage61_event_id: eventId,
            garage61_session_id: sessionId,
            car_id: lap.car.id,
            track_id: lap.track.id,
            season_id: lap.season?.id ?? null,
            season_name: lap.season?.name ?? null,
            session_type: lap.sessionType ?? null,
            event_type: lap.eventType ?? null,
            started_at: lap.startTime,
            ended_at: lapEnd,
            lap_count: 1,
          });
        }

        lapRows.push({
          id: lap.id, driver_id: driver.id, car_id: lap.car.id, track_id: lap.track.id,
          lap_number: lap.lapNumber ?? null, lap_time: lap.lapTime ?? null,
          clean: lap.clean ?? null, joker: lap.joker ?? null, discontinuity: lap.discontinuity ?? null,
          missing: lap.missing ?? null, incomplete: lap.incomplete ?? null, off_track: lap.offtrack ?? null,
          // The Garage61 API field is "pitlane" (lowercase), not "pitLane" — the old manual sync tool
          // had this mismatched and silently stored pit_lane as always null. Fixed here.
          pit_lane: lap.pitlane ?? null, pit_in: lap.pitIn ?? null, pit_out: lap.pitOut ?? null,
          driver_rating: lap.driverRating ?? null, fuel_level: lap.fuelLevel ?? null, fuel_used: lap.fuelUsed ?? null,
          fuel_added: lap.fuelAdded ?? null, weight_penalty: lap.weightPenalty ?? null, power_adjust: lap.powerAdjust ?? null,
          tire_compound: lap.tireCompound ?? null, can_view_telemetry: lap.canViewTelemetry ?? false, can_view_setup: lap.canViewSetup ?? false,
          garage61_payload: lap, synced_at: new Date().toISOString(), telemetry_path: null,
        });
        if (Array.isArray(lap.sectors)) {
          lap.sectors.forEach((sector, index) => sectorRows.push({ lap_id: lap.id, sector_number: index + 1, sector_time: sector.sectorTime ?? null, incomplete: sector.incomplete ?? false }));
        }
      }
    }

    const rows = Array.from(sessions.values());
    if (rows.length > 0) {
      const { error: upsertError } = await supabaseAdmin.from("driving_sessions").upsert(rows, {
        onConflict: "driver_id,garage61_event_id,garage61_session_id,car_id,track_id",
      });
      if (upsertError) throw upsertError;
    }

    // Stores lap telemetry CSV in Supabase Storage as part of this same recurring sync -- this is
    // meant to be the ONLY place telemetry is ever fetched from Garage61. Every reading path (the
    // telemetry viewer, race debrief, sector consistency) should read laps.telemetry_path from
    // Storage, not call Garage61 on a page view. Capped per run (gradual backfill, not a burst --
    // Garage61 is already rate-limited as of this writing) and skips laps that already have a
    // stored path, which covers most laps here since the 168h overlap window reprocesses them.
    const TELEMETRY_DOWNLOAD_CAP = 40;
    let telemetryDownloaded = 0;
    const telemetryCandidates = lapRows.filter((row) => row.can_view_telemetry);
    if (telemetryCandidates.length) {
      const { data: existingPaths, error: existingError } = await supabaseAdmin
        .from("laps").select("id,telemetry_path").in("id", telemetryCandidates.map((row) => row.id));
      if (existingError) throw existingError;
      const alreadyStored = new Set((existingPaths ?? []).filter((row) => row.telemetry_path).map((row) => row.id as string));
      const token = process.env.GARAGE61_API_TOKEN;
      if (token) {
        for (const row of telemetryCandidates) {
          if (alreadyStored.has(row.id) || telemetryDownloaded >= TELEMETRY_DOWNLOAD_CAP) continue;
          try {
            const response = await fetch(`https://garage61.net/api/v1/laps/${encodeURIComponent(row.id)}/csv`, {
              headers: { Authorization: `Bearer ${token}`, Accept: "text/csv" }, cache: "no-store",
            });
            if (!response.ok) continue;
            const csv = await response.text();
            const path = `laps/${row.track_id}/${row.id}.csv`;
            const { error: uploadError } = await supabaseAdmin.storage.from("telemetry")
              .upload(path, csv, { contentType: "text/csv; charset=utf-8", upsert: true });
            if (uploadError) continue;
            row.telemetry_path = path;
            telemetryDownloaded += 1;
          } catch {
            // One lap's telemetry failing (network blip, malformed response) must not abort the sync.
          }
        }
      }
    }

    // Chunked: Supabase/PostgREST has a payload-size ceiling and a busy week can produce thousands
    // of rows across all recent car/track pairs combined.
    const CHUNK = 500;
    for (let index = 0; index < lapRows.length; index += CHUNK) {
      const { error: lapsUpsertError } = await supabaseAdmin.from("laps").upsert(lapRows.slice(index, index + CHUNK), { onConflict: "id" });
      if (lapsUpsertError) throw lapsUpsertError;
    }
    for (let index = 0; index < sectorRows.length; index += CHUNK) {
      const { error: sectorsUpsertError } = await supabaseAdmin.from("lap_sectors").upsert(sectorRows.slice(index, index + CHUNK), { onConflict: "lap_id,sector_number" });
      if (sectorsUpsertError) throw sectorsUpsertError;
    }

    if (syncRun?.id) {
      await supabaseAdmin
        .from("sync_runs")
        .update({
          status: "completed",
          finished_at: new Date().toISOString(),
          records_found: recentLaps,
          records_inserted: rows.length,
        })
        .eq("id", syncRun.id);
    }

    return {
      status: "ok" as const,
      cutoff: cutoffIso,
      overlapHours: OVERLAP_HOURS,
      carTrackPairsChecked: recentPairs.length,
      pairsSkippedByBudget,
      lapsReceived,
      recentLaps,
      sessionsUpserted: rows.length,
      lapsUpserted: lapRows.length,
      sectorsUpserted: sectorRows.length,
      telemetryDownloaded,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (syncRun?.id) {
      await supabaseAdmin
        .from("sync_runs")
        .update({ status: "error", finished_at: new Date().toISOString(), error_message: message })
        .eq("id", syncRun.id);
    }
    throw error;
  }
}

export async function POST() {
  try {
    return NextResponse.json(await runIncrementalSessionSync());
  } catch (error) {
    return NextResponse.json(
      { status: "error", message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
