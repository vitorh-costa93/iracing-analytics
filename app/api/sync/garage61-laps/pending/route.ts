import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { computeIncrementalCutoff } from "@/lib/garage61-sync-cutoff";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://garage61.net",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-import-key",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

// 11/09/2026: tells the browser bookmarklet (public/garage61-import.js) how far back it needs to look
// before it starts walking Garage61's own internal API for sessions/laps/sectors -- same cutoff the
// server-side fallback (sync/incremental) uses, so a driver who runs the bookmarklet right after
// driving and later lets the daily cron catch up gets the same "still worth checking" window either way.
export async function GET(request: NextRequest) {
  try {
    const secret = process.env.GARAGE61_IMPORT_SECRET;
    if (!secret || request.headers.get("x-import-key") !== secret) {
      return NextResponse.json({ status: "error", message: "Chave de importação inválida" }, { status: 401, headers: CORS_HEADERS });
    }

    const { data: driver, error: driverError } = await supabaseAdmin.from("drivers").select("id").order("updated_at", { ascending: false }).limit(1).single();
    if (driverError || !driver) throw new Error("Piloto não encontrado");

    const cutoff = await computeIncrementalCutoff(driver.id);
    return NextResponse.json({ status: "ok", cutoff: cutoff.toISOString() }, { headers: CORS_HEADERS });
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 400, headers: CORS_HEADERS });
  }
}
