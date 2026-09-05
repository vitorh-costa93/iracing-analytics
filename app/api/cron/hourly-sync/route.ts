import { NextRequest, NextResponse } from "next/server";
import { POST as syncCatalogAndStatistics } from "@/app/api/sync/all/route";
import { POST as syncIncrementalSessions } from "@/app/api/sync/incremental/route";
import { POST as syncRatingHistory } from "@/app/api/sync/rating-history/route";
import { runTelemetryBackfill } from "@/app/api/sync/telemetry-backfill/route";

async function readStep(name: string, response: Response) {
  const result = await response.json();
  if (!response.ok) throw new Error(`${name}: ${result.message ?? response.statusText}`);
  return result;
}

// iRating/season/wins now come from race_results (irstats.com), imported via the browser-based
// bookmarklet (public/irstats-import.js) since irstats.com is Cloudflare-blocked for server-side
// requests -- confirmed 403 "Just a moment..." challenge from this same Vercel deployment, so an
// automatic hourly attempt here would only ever fail. This cron keeps Garage61 in its remaining
// role: the catalog/ratings-anchor sync (sync/all -- the "ratings" snapshot is still the exact
// anchor v_race_results_irating chains irstats' per-race deltas from), driving_sessions + laps +
// lap_sectors (sync/incremental -- read by RaceDebrief/Setup Lab/sector-consistency to locate
// telemetry/setup context), and rating_history (Safety Rating history on the Overview page --
// unrelated to the iRating migration; SR still has no iRStats equivalent, so Garage61 stays its
// only source). rating_history had silently gone stale before this: nothing in this cron called
// it, and it turned out nothing else did either.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ status: "error", message: "Unauthorized" }, { status: 401 });
  }

  try {
    const catalog = await readStep("catalog", await syncCatalogAndStatistics());
    const sessions = await readStep("sessions", await syncIncrementalSessions());
    const ratingHistory = await readStep("ratingHistory", await syncRatingHistory());
    const telemetryBackfill = await runTelemetryBackfill();
    return NextResponse.json({ status: "ok", catalog, sessions, ratingHistory, telemetryBackfill });
  } catch (error) {
    return NextResponse.json(
      { status: "error", message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
