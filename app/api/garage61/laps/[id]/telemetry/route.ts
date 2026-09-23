import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { readTelemetryText, storeTelemetryCsv } from "@/lib/telemetry-storage";

const BASE_URL = "https://garage61.net/api/v1";

/**
 * Storage-first: the recurring sync (app/api/sync/incremental) is meant to be the ONLY place that
 * fetches lap telemetry CSV from Garage61 -- every page view of the Telemetry tab used to call this
 * route, which called Garage61 live, EVERY time, for every viewer. Now this checks
 * laps.telemetry_path (Supabase Storage) first, and only falls back to a live Garage61 fetch (then
 * stores it, so the NEXT view is already fast) for a lap the sync hasn't reached yet -- a very
 * recent lap, or one outside the sync's current lookback window.
 *
 * Reads go through lib/telemetry-storage.ts (gunzips .csv.gz -- this route used to hand the browser
 * raw gzip bytes -- and enforces the daily Storage download budget). When a stored lap can't be read
 * (e.g. budget reached), the live Garage61 fetch is served WITHOUT re-storing it, so it never
 * overwrites the compressed copy.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const { data: lapRow } = await supabaseAdmin.from("laps").select("track_id,telemetry_path").eq("id", id).maybeSingle();
    if (lapRow?.telemetry_path) {
      const text = await readTelemetryText(lapRow.telemetry_path);
      if (text) {
        return new NextResponse(text, { status: 200, headers: { "Content-Type": "text/csv; charset=utf-8", "X-Telemetry-Source": "storage" } });
      }
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

    if (lapRow?.track_id && !lapRow.telemetry_path) await storeTelemetryCsv(lapRow.track_id, id, data);

    return new NextResponse(data, { status: 200, headers: { "Content-Type": "text/csv; charset=utf-8", "X-Telemetry-Source": "live" } });
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
