import { NextResponse } from "next/server";
import { garage61Get } from "@/lib/garage61";
import { supabaseAdmin } from "@/lib/supabase-admin";

const OVERLAP_HOURS = 48;
const INITIAL_LOOKBACK_DAYS = 14;
// One request per recently active track prevents a busy track from consuming
// the whole page and hiding another track in the same batch.
const TRACK_BATCH_SIZE = 1;
const PAGE_SIZE = 250;

type Garage61Lap = {
  id: string;
  event?: string;
  eventType?: number;
  session?: number;
  sessionType?: number;
  startTime?: string;
  season?: { id?: string; name?: string };
  car?: { id?: number };
  track?: { id?: number };
};

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

function chunks<T>(items: T[], size: number) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size)
  );
}

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
      .select("track_id")
      .eq("driver_id", driver.id)
      .gte("statistic_date", cutoffIso.slice(0, 10))
      .not("track_id", "is", null);
    if (statsError) throw statsError;

    const trackIds = Array.from(
      new Set(
        (stats ?? [])
          .map((row) => row.track_id)
          .filter((id): id is number => typeof id === "number")
      )
    );

    const sessions = new Map<string, SessionRow>();
    let lapsReceived = 0;
    let recentLaps = 0;

    for (const batch of chunks(trackIds, TRACK_BATCH_SIZE)) {
      const response = await garage61Get<Garage61LapsResponse>("/laps", {
        tracks: batch.join(","),
        drivers: "me",
        group: "none",
        unclean: "true",
        lapTypes: "1,2,3,4",
        limit: PAGE_SIZE,
        offset: 0,
      });

      const laps = response.items ?? [];
      lapsReceived += laps.length;

      for (const lap of laps) {
        if (!lap.car?.id || !lap.track?.id || !lap.startTime) continue;
        if (new Date(lap.startTime) < cutoff) continue;
        recentLaps++;

        const eventId = lap.event ?? "";
        const sessionId = lap.session === undefined ? "" : String(lap.session);
        const key = `${eventId}:${sessionId}:${lap.car.id}:${lap.track.id}`;
        const existing = sessions.get(key);

        if (existing) {
          existing.lap_count += 1;
          if (lap.startTime < existing.started_at) existing.started_at = lap.startTime;
          if (lap.startTime > existing.ended_at) existing.ended_at = lap.startTime;
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
            ended_at: lap.startTime,
            lap_count: 1,
          });
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
      tracksChecked: trackIds.length,
      lapsReceived,
      recentLaps,
      sessionsUpserted: rows.length,
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
