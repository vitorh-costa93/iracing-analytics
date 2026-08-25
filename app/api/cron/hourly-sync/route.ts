import { NextRequest, NextResponse } from "next/server";
import { POST as syncCatalogAndStatistics } from "@/app/api/sync/all/route";
import { POST as syncRatingHistory } from "@/app/api/sync/rating-history/route";
import { POST as syncIncrementalSessions } from "@/app/api/sync/incremental/route";
import { GET as syncIrstatsIncremental } from "@/app/api/sync/irstats/route";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { recomputeRatingMatches } from "@/lib/rating-match";

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
    // Garage61-sourced steps: reliable, automatic. iRating/season views were reverted to this
    // source on 2026-08-25 because irstats.com (below) is Cloudflare-blocked for server-side
    // requests and can't be trusted as the automatic path.
    const catalog = await readStep("catalog", await syncCatalogAndStatistics());
    const sessions = await readStep("sessions", await syncIncrementalSessions());
    const ratings = await readStep("rating-history", await syncRatingHistory());
    const { data: driver } = await supabaseAdmin.from("drivers").select("id").order("updated_at", { ascending: false }).limit(1).single();
    const ratingMatches = driver ? await recomputeRatingMatches(driver.id) : { totalMatched: 0 };

    // irstats.com is Cloudflare-blocked for datacenter IPs (confirmed 403 "Just a moment..."
    // challenge from this same Vercel deployment), so this will fail every run until/unless that
    // changes. Attempted anyway (harmless, cheap) but never allowed to fail the whole cron —
    // race_results is populated via the browser-based bookmarklet (public/irstats-import.js)
    // instead, not this automatic path.
    let irstats: unknown;
    try {
      irstats = await readStep("irstats", await syncIrstatsIncremental(request));
    } catch (error) {
      irstats = { status: "error", message: error instanceof Error ? error.message : String(error) };
    }

    return NextResponse.json({ status: "ok", catalog, sessions, ratings, ratingMatches, irstats });
  } catch (error) {
    return NextResponse.json(
      { status: "error", message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
