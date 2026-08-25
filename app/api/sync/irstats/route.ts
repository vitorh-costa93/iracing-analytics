// app/api/sync/irstats/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { fetchIrstatsPage, parseRaceDetailPage, parseRaceListPage } from "@/lib/irstats";

// The rate-limited sequential fetch loop below can run well past a platform's default serverless
// timeout (commonly 10s). Give it real headroom and force dynamic rendering (no caching) since
// this is a mutating sync endpoint hit by cron/manual triggers, not a page.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const IRSTATS_DRIVER_ID = "958741";
const REQUEST_DELAY_MS = 3000;
const MAX_BACKFILL_PAGES = 30;
// Incremental mode only needs to recognize very recent races to know where to stop; 200 is a
// generous buffer against PostgREST's default max_rows (1000) which the unordered/unlimited
// version of this query could silently truncate below what a single incremental run needs.
const INCREMENTAL_KNOWN_ID_LIMIT = 200;
const MAX_FAILURE_DETAILS = 20;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Builds car/track name -> id lookup maps.
 *
 * irstats.com emits a single combined string per race (e.g. "Super Formula SF23 - Honda" for a
 * car, or "Autodromo Nazionale Monza" + a separately-captured "Grand Prix" config for a track),
 * while the cars/tracks catalog (synced from Garage61 via app/api/sync/all/route.ts) stores name
 * and variant as separate columns. A name-only match misses most cars/tracks with variants, and
 * for tracks with multiple layouts a bare-name match is nondeterministic (whichever row the map
 * loop wrote last wins).
 *
 * ASSUMPTION (undocumented without live DB access — verify once credentials are available): the
 * catalog's `variant` column text is assumed to line up with irstats' car-suffix / track-config
 * text closely enough that a lowercased `"${name} - ${variant}"` (cars) / `"${name}::${variant}"`
 * (tracks) key matches. If catalog variant text differs meaningfully from irstats' wording, this
 * combined match will simply miss and fall back to the bare-name match — never crash, but may
 * still leave a car/track unresolved. The unresolvedCarCount/unresolvedTrackCount in the sync
 * response are meant to make that visible instead of silent.
 */
async function resolveCarTrackIds() {
  const [carsResult, tracksResult] = await Promise.all([
    supabaseAdmin.from("cars").select("id, name, variant"),
    supabaseAdmin.from("tracks").select("id, name, variant"),
  ]);
  if (carsResult.error) throw carsResult.error;
  if (tracksResult.error) throw tracksResult.error;

  const carByCombined = new Map<string, number>();
  const carByName = new Map<string, number>();
  for (const row of carsResult.data ?? []) {
    const name = String(row.name).trim();
    const variant = row.variant ? String(row.variant).trim() : null;
    carByName.set(name.toLowerCase(), row.id as number);
    if (variant) carByCombined.set(`${name} - ${variant}`.toLowerCase(), row.id as number);
  }

  const trackByCombined = new Map<string, number>();
  const trackByName = new Map<string, number>();
  for (const row of tracksResult.data ?? []) {
    const name = String(row.name).trim();
    const variant = row.variant ? String(row.variant).trim() : null;
    trackByName.set(name.toLowerCase(), row.id as number);
    if (variant) trackByCombined.set(`${name}::${variant}`.toLowerCase(), row.id as number);
  }

  return { carByCombined, carByName, trackByCombined, trackByName };
}

function resolveCarId(carName: string, carByCombined: Map<string, number>, carByName: Map<string, number>) {
  const raw = carName.trim().toLowerCase();
  return carByCombined.get(raw) ?? carByName.get(raw) ?? null;
}

function resolveTrackId(
  trackName: string,
  trackConfig: string | null,
  trackByCombined: Map<string, number>,
  trackByName: Map<string, number>
) {
  const name = trackName.trim().toLowerCase();
  if (trackConfig) {
    const combined = trackByCombined.get(`${name}::${trackConfig.trim().toLowerCase()}`);
    if (combined !== undefined) return combined;
  }
  return trackByName.get(name) ?? null;
}

export type CatalogMaps = Awaited<ReturnType<typeof resolveCarTrackIds>>;

export { resolveCarTrackIds };

/** Parses already-fetched race detail HTML and upserts it — shared by the server-side fetch loop
 * (importRace, below) and the browser-ingest route, which receives HTML captured by a real
 * browser session (irstats.com sits behind a Cloudflare bot challenge that blocks server-side
 * fetches; only a real browser can load these pages, so ingestion of pre-fetched HTML from a
 * user's browser is the only way this data reaches the database in practice). */
export async function importRaceFromHtml(raceId: number, html: string, driverId: string, driverName: string, catalog: CatalogMaps) {
  const parsed = parseRaceDetailPage(html, driverName);
  const carId = resolveCarId(parsed.carName, catalog.carByCombined, catalog.carByName);
  const trackId = resolveTrackId(parsed.trackName, parsed.trackConfig, catalog.trackByCombined, catalog.trackByName);
  const row = {
    irstats_race_id: raceId,
    driver_id: driverId,
    raced_at: parsed.racedAt,
    series_name: parsed.seriesName,
    track_name: parsed.trackName,
    car_name: parsed.carName,
    car_id: carId,
    track_id: trackId,
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
    race_fastest_lap_time: parsed.raceFastestLapTime,
    incidents: parsed.incidents,
    points: parsed.points,
    sof: parsed.sof,
  };
  const { error } = await supabaseAdmin.from("race_results").upsert(row, { onConflict: "irstats_race_id" });
  if (error) throw error;
  return { carId, trackId };
}

async function importRace(raceId: number, driverId: string, driverName: string, catalog: CatalogMaps) {
  const html = await fetchIrstatsPage(`/race/${raceId}`, { retryDelayMs: REQUEST_DELAY_MS });
  return importRaceFromHtml(raceId, html, driverId, driverName, catalog);
}

export async function runSync(mode: "incremental" | "backfill") {
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

    // Backfill mode walks every historical page and must recognize every previously-imported race
    // to avoid re-fetching them, so it needs the full known-id set (paginated to stay under
    // PostgREST's max_rows). Incremental mode only ever needs to recognize whether the most recent
    // handful of races are already known, so it uses a small bounded/recent-only query instead.
    const known = new Set<number>();
    if (mode === "backfill") {
      const pageSize = 1000;
      for (let offset = 0; ; offset += pageSize) {
        const { data: idsPage, error: idsError } = await supabaseAdmin
          .from("race_results")
          .select("irstats_race_id")
          .eq("driver_id", driver.id)
          .order("raced_at", { ascending: false })
          .range(offset, offset + pageSize - 1);
        if (idsError) throw idsError;
        for (const row of idsPage ?? []) known.add(row.irstats_race_id as number);
        if (!idsPage || idsPage.length < pageSize) break;
      }
    } else {
      const { data: existingIds, error: existingError } = await supabaseAdmin
        .from("race_results")
        .select("irstats_race_id")
        .eq("driver_id", driver.id)
        .order("raced_at", { ascending: false })
        .limit(INCREMENTAL_KNOWN_ID_LIMIT);
      if (existingError) throw existingError;
      for (const row of existingIds ?? []) known.add(row.irstats_race_id as number);
    }

    const catalog = await resolveCarTrackIds();

    let imported = 0;
    let skipped = 0;
    let failed = 0;
    let unresolvedCarCount = 0;
    let unresolvedTrackCount = 0;
    const failures: Array<{ raceId: number; error: string }> = [];
    const maxPages = mode === "backfill" ? MAX_BACKFILL_PAGES : 1;

    for (let page = 0; page < maxPages; page += 1) {
      // Only the first request of a run pays no upfront delay — there's nothing to be polite about
      // yet. Every request after that (list pages and race detail pages alike) still waits.
      if (page > 0) await sleep(REQUEST_DELAY_MS);
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
        // One malformed race (unexpected markup, unrecognized field format, etc.) must not abort
        // the whole run — that race would never get marked "known" and would fail identically on
        // every future run, permanently blocking incremental sync from making progress past it.
        try {
          const { carId, trackId } = await importRace(entry.irstatsRaceId, driver.id, driver.name, catalog);
          if (carId === null) unresolvedCarCount += 1;
          if (trackId === null) unresolvedTrackCount += 1;
          known.add(entry.irstatsRaceId);
          imported += 1;
        } catch (raceError) {
          failed += 1;
          const message = raceError instanceof Error ? raceError.message : String(raceError);
          if (failures.length < MAX_FAILURE_DETAILS) failures.push({ raceId: entry.irstatsRaceId, error: message });
        }
      }
      if (mode === "incremental" && hitKnownId) break;
    }

    const status = failed > 0 ? "partial" : "success";
    if (syncRun) {
      await supabaseAdmin
        .from("sync_runs")
        .update({
          status,
          finished_at: new Date().toISOString(),
          records_found: imported + skipped + failed,
          records_inserted: imported,
          // sync_runs has no dedicated failure-count column; summarize into error_message so a
          // partial run is still visible in the sync_runs table, not just the JSON response.
          error_message:
            failed > 0 || unresolvedCarCount > 0 || unresolvedTrackCount > 0
              ? `failed=${failed} unresolvedCar=${unresolvedCarCount} unresolvedTrack=${unresolvedTrackCount}` +
                (failures.length ? ` | ${failures.map((f) => `#${f.raceId}: ${f.error}`).join("; ")}` : "")
              : null,
        })
        .eq("id", syncRun.id);
    }

    return {
      status: "ok" as const,
      imported,
      skipped,
      failed,
      unresolvedCarCount,
      unresolvedTrackCount,
      failures,
    };
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

// Browser-triggered manual sync ("Atualizar dados" button in app/page.tsx). GET above is
// CRON_SECRET-gated for the hourly cron job; the browser has no way to know that secret, so this
// unauthenticated POST runs the same incremental sync directly — mirroring the existing
// unauthenticated POST pattern used by app/api/sync/incremental/route.ts and
// app/api/sync/rating-history/route.ts for the same "manual button" use case.
export async function POST() {
  try {
    const result = await runSync("incremental");
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { status: "error", message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
