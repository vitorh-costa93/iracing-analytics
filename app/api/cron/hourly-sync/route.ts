import { NextRequest, NextResponse } from "next/server";
import { POST as syncCatalogAndStatistics } from "@/app/api/sync/all/route";
import { POST as syncIncrementalSessions } from "@/app/api/sync/incremental/route";

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
// anchor v_race_results_irating chains irstats' per-race deltas from) and driving_sessions
// (sync/incremental -- still read by RaceDebrief/Setup Lab to locate telemetry/setup context).
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ status: "error", message: "Unauthorized" }, { status: 401 });
  }

  try {
    const catalog = await readStep("catalog", await syncCatalogAndStatistics());
    const sessions = await readStep("sessions", await syncIncrementalSessions());
    return NextResponse.json({ status: "ok", catalog, sessions });
  } catch (error) {
    return NextResponse.json(
      { status: "error", message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
