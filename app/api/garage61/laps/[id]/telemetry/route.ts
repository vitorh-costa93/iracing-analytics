import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

const BASE_URL = "https://garage61.net/api/v1";

/**
 * Storage-first: the recurring sync (app/api/sync/incremental) is meant to be the ONLY place that
 * fetches lap telemetry CSV from Garage61 -- every page view of the Telemetry tab used to call this
 * route, which called Garage61 live, EVERY time, for every viewer. Now this checks
 * laps.telemetry_path (Supabase Storage) first, and only falls back to a live Garage61 fetch (then
 * stores it, so the NEXT view is already fast) for a lap the sync hasn't reached yet -- a very
 * recent lap, or one outside the sync's current lookback window.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const { data: lapRow } = await supabaseAdmin.from("laps").select("track_id,telemetry_path").eq("id", id).maybeSingle();
    if (lapRow?.telemetry_path) {
      const { data: file, error: downloadError } = await supabaseAdmin.storage.from("telemetry").download(lapRow.telemetry_path);
      if (!downloadError && file) {
        return new NextResponse(await file.text(), { status: 200, headers: { "Content-Type": "text/csv; charset=utf-8", "X-Telemetry-Source": "storage" } });
      }
      // Fall through to live fetch if the Storage object is somehow missing despite the DB path.
    }

    const token = process.env.GARAGE61_API_TOKEN;
    if (!token) {
      return NextResponse.json({ status: "error", message: "GARAGE61_API_TOKEN não configurado" }, { status: 500 });
    }

    const response = await fetch(`${BASE_URL}/laps/${encodeURIComponent(id)}/csv`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "text/csv" },
      cache: "no-store",
    });
    const data = await response.text();
    if (!response.ok) {
      return NextResponse.json({ status: "error", httpStatus: response.status, message: data }, { status: response.status });
    }

    // Opportunistic store: the sync will re-download this same lap again later if this fails, so
    // errors here are silently ignored -- the important thing is the CSV still reaches the viewer now.
    if (lapRow?.track_id) {
      const path = `laps/${lapRow.track_id}/${id}.csv`;
      const { error: uploadError } = await supabaseAdmin.storage.from("telemetry").upload(path, data, { contentType: "text/csv; charset=utf-8", upsert: true });
      if (!uploadError) await supabaseAdmin.from("laps").update({ telemetry_path: path }).eq("id", id);
    }

    return new NextResponse(data, { status: 200, headers: { "Content-Type": "text/csv; charset=utf-8", "X-Telemetry-Source": "live" } });
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
