import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://garage61.net",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-import-key",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request: NextRequest) {
  try {
    const secret = process.env.GARAGE61_IMPORT_SECRET;
    if (!secret || request.headers.get("x-import-key") !== secret) {
      return NextResponse.json({ status: "error", message: "Chave de importação inválida" }, { status: 401, headers: CORS_HEADERS });
    }

    const days = Math.min(60, Math.max(1, Number(request.nextUrl.searchParams.get("days")) || 15));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const { data: driver, error: driverError } = await supabaseAdmin.from("drivers").select("id").order("updated_at", { ascending: false }).limit(1).single();
    if (driverError || !driver) throw new Error("Piloto não encontrado");

    const { data, error } = await supabaseAdmin
      .from("driving_sessions")
      .select("garage61_event_id,car_id,track_id,started_at")
      .eq("driver_id", driver.id)
      .eq("session_type", 3)
      .gte("started_at", since)
      .not("garage61_event_id", "is", null)
      .order("started_at", { ascending: false });
    if (error) throw error;

    const { data: importedSetups, error: importedError } = await supabaseAdmin
      .from("setup_files")
      .select("garage61_event_id")
      .eq("driver_id", driver.id)
      .eq("source", "garage61")
      .not("garage61_event_id", "is", null);
    if (importedError) throw importedError;
    const importedEvents = new Set((importedSetups ?? []).map((row) => row.garage61_event_id).filter((id): id is string => typeof id === "string"));

    // Events already visited recently (whether a setup was found or not) don't need a full
    // hidden-iframe revisit every run -- each one costs several Garage61 API calls. A checked-empty
    // event gets a week's grace before being retried, in case it was a transient failure.
    const RECHECK_AFTER_DAYS = 7;
    const recheckCutoff = new Date(Date.now() - RECHECK_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data: recentlyChecked, error: checkedError } = await supabaseAdmin
      .from("setup_import_checks")
      .select("garage61_event_id")
      .eq("driver_id", driver.id)
      .gte("checked_at", recheckCutoff);
    if (checkedError) throw checkedError;
    const skipEvents = new Set([...importedEvents, ...(recentlyChecked ?? []).map((row) => row.garage61_event_id)]);

    const seen = new Set<string>();
    const events = (data ?? []).filter((row) => {
      if (seen.has(row.garage61_event_id as string)) return false;
      seen.add(row.garage61_event_id as string);
      return !skipEvents.has(row.garage61_event_id as string);
    }).map((row) => ({ eventId: row.garage61_event_id, car: row.car_id, track: row.track_id, startedAt: row.started_at }));

    return NextResponse.json({ status: "ok", days, events, alreadyImported: importedEvents.size, recentlyChecked: (recentlyChecked ?? []).length }, { headers: CORS_HEADERS });
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 400, headers: CORS_HEADERS });
  }
}
