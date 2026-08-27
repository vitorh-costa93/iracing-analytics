import { NextResponse } from "next/server";
import { garage61Get } from "@/lib/garage61";
import { supabaseAdmin } from "@/lib/supabase-admin";

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

async function runIncrementalSessionSync() {
  const startedAt = new Date().toISOString();
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
    const lapRows: Record<string, unknown>[] = [];
    const sectorRows: { lap_id: string; sector_number: number; sector_time: number | null; incomplete: boolean }[] = [];
    let lapsReceived = 0;
    let recentLaps = 0;

    for (const pair of recentPairs) {
      // Paginação completa: alguns pares carro+pista já passam de 250 voltas na season, e
      // buscar só offset=0 descartava silenciosamente as voltas mais antigas (ou mais novas,
      // dependendo da ordenação) — inclusive sessões de corrida inteiras.
      const laps: Garage61Lap[] = [];
      for (let offset = 0; ; offset += PAGE_SIZE) {
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
          garage61_payload: lap, synced_at: new Date().toISOString(),
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
      lapsReceived,
      recentLaps,
      sessionsUpserted: rows.length,
      lapsUpserted: lapRows.length,
      sectorsUpserted: sectorRows.length,
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
