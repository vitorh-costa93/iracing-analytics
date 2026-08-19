import { NextRequest, NextResponse } from "next/server";
import { POST as syncCatalogAndStatistics } from "@/app/api/sync/all/route";
import { POST as syncRatingHistory } from "@/app/api/sync/rating-history/route";
import { POST as syncIncrementalSessions } from "@/app/api/sync/incremental/route";

async function readStep(name: string, response: Response) {
  const result = await response.json();
  if (!response.ok) throw new Error(`${name}: ${result.message ?? response.statusText}`);
  return result;
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ status: "error", message: "Unauthorized" }, { status: 401 });
  }

  try {
    const catalog = await readStep("catalog", await syncCatalogAndStatistics());
    const sessions = await readStep("sessions", await syncIncrementalSessions());
    const ratings = await readStep("rating-history", await syncRatingHistory());
    return NextResponse.json({ status: "ok", catalog, sessions, ratings });
  } catch (error) {
    return NextResponse.json(
      { status: "error", message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
