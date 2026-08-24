// app/api/sync/irstats/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { fetchIrstatsPage, parseRaceDetailPage, parseRaceListPage } from "@/lib/irstats";

const IRSTATS_DRIVER_ID = "958741";
const REQUEST_DELAY_MS = 3000;
const MAX_BACKFILL_PAGES = 30;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveCarTrackIds() {
  const [carsResult, tracksResult] = await Promise.all([
    supabaseAdmin.from("cars").select("id, name"),
    supabaseAdmin.from("tracks").select("id, name"),
  ]);
  if (carsResult.error) throw carsResult.error;
  if (tracksResult.error) throw tracksResult.error;

  const carByName = new Map<string, number>();
  for (const row of carsResult.data ?? []) carByName.set(String(row.name).trim().toLowerCase(), row.id as number);
  const trackByName = new Map<string, number>();
  for (const row of tracksResult.data ?? []) trackByName.set(String(row.name).trim().toLowerCase(), row.id as number);
  return { carByName, trackByName };
}

async function importRace(
  raceId: number,
  driverId: string,
  driverName: string,
  carByName: Map<string, number>,
  trackByName: Map<string, number>
) {
  const html = await fetchIrstatsPage(`/race/${raceId}`, { retryDelayMs: REQUEST_DELAY_MS });
  const parsed = parseRaceDetailPage(html, driverName);
  const row = {
    irstats_race_id: raceId,
    driver_id: driverId,
    raced_at: parsed.racedAt,
    series_name: parsed.seriesName,
    track_name: parsed.trackName,
    car_name: parsed.carName,
    car_id: carByName.get(parsed.carName.trim().toLowerCase()) ?? null,
    track_id: trackByName.get(parsed.trackName.trim().toLowerCase()) ?? null,
    category: parsed.category,
    season_week: parsed.seasonWeek,
    license_class: parsed.licenseClass,
    safety_rating: parsed.safetyRating,
    irating_display: parsed.iratingDisplay,
    irating_delta: parsed.iratingDelta,
    grid_position: parsed.gridPosition,
    finish_position: parsed.finishPosition,
    position_change: parsed.positionChange,
    laps: parsed.laps,
    laps_led: parsed.lapsLed,
    fastest_lap_time: parsed.fastestLapTime,
    incidents: parsed.incidents,
    points: parsed.points,
    sof: parsed.sof,
  };
  const { error } = await supabaseAdmin.from("race_results").upsert(row, { onConflict: "irstats_race_id" });
  if (error) throw error;
}

async function runSync(mode: "incremental" | "backfill") {
  const startedAt = new Date().toISOString();
  const { data: syncRun } = await supabaseAdmin
    .from("sync_runs")
    .insert({ sync_type: `irstats_${mode}`, status: "running", started_at: startedAt })
    .select("id")
    .single();

  try {
    const { data: driver, error: driverError } = await supabaseAdmin
      .from("drivers")
      .select("id, name")
      .order("updated_at", { ascending: false })
      .limit(1)
      .single();
    if (driverError || !driver) throw new Error("Piloto não encontrado no Supabase");

    const { data: existingIds, error: existingError } = await supabaseAdmin
      .from("race_results")
      .select("irstats_race_id")
      .eq("driver_id", driver.id);
    if (existingError) throw existingError;
    const known = new Set((existingIds ?? []).map((row) => row.irstats_race_id as number));

    const { carByName, trackByName } = await resolveCarTrackIds();

    let imported = 0;
    let skipped = 0;
    const maxPages = mode === "backfill" ? MAX_BACKFILL_PAGES : 1;

    for (let page = 0; page < maxPages; page += 1) {
      await sleep(REQUEST_DELAY_MS);
      const listHtml = await fetchIrstatsPage(`/driver/${IRSTATS_DRIVER_ID}/races?page=${page}`, {
        retryDelayMs: REQUEST_DELAY_MS,
      });
      const entries = parseRaceListPage(listHtml);
      if (entries.length === 0) break;

      let hitKnownId = false;
      for (const entry of entries) {
        if (known.has(entry.irstatsRaceId)) {
          skipped += 1;
          if (mode === "incremental") {
            hitKnownId = true;
            break;
          }
          continue;
        }
        await sleep(REQUEST_DELAY_MS);
        await importRace(entry.irstatsRaceId, driver.id, driver.name, carByName, trackByName);
        known.add(entry.irstatsRaceId);
        imported += 1;
      }
      if (mode === "incremental" && hitKnownId) break;
    }

    if (syncRun) {
      await supabaseAdmin
        .from("sync_runs")
        .update({ status: "success", finished_at: new Date().toISOString() })
        .eq("id", syncRun.id);
    }

    return { status: "ok" as const, imported, skipped };
  } catch (error) {
    if (syncRun) {
      await supabaseAdmin
        .from("sync_runs")
        .update({
          status: "error",
          finished_at: new Date().toISOString(),
          error_message: error instanceof Error ? error.message : String(error),
        })
        .eq("id", syncRun.id);
    }
    throw error;
  }
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ status: "error", message: "Unauthorized" }, { status: 401 });
  }

  const mode = request.nextUrl.searchParams.get("mode") === "backfill" ? "backfill" : "incremental";

  try {
    const result = await runSync(mode);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { status: "error", message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
