import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// TEMPORARY debug route -- traces why Garage61 setup import never reaches Algarve/SF23 (car 159,
// track 425). Delete once the real bug is found and fixed (29/08/2026 investigation).

export async function GET() {
  try {
    const { data: driver } = await supabaseAdmin.from("drivers").select("id").order("updated_at", { ascending: false }).limit(1).single();
    const driverId = driver?.id;

    const [stats, sessions, laps, checks, setups] = await Promise.all([
      supabaseAdmin.from("daily_statistics").select("statistic_date,car_id,track_id").eq("driver_id", driverId).eq("track_id", 425).order("statistic_date", { ascending: false }).limit(10),
      supabaseAdmin.from("driving_sessions").select("garage61_event_id,car_id,track_id,session_type,started_at,lap_count").eq("driver_id", driverId).eq("track_id", 425).order("started_at", { ascending: false }).limit(10),
      supabaseAdmin.from("laps").select("id,car_id,track_id,can_view_setup,garage61_payload").eq("driver_id", driverId).eq("track_id", 425).limit(10),
      supabaseAdmin.from("setup_import_checks").select("garage61_event_id,checked_at").eq("driver_id", driverId).order("checked_at", { ascending: false }).limit(10),
      supabaseAdmin.from("setup_files").select("id,car_id,track_id,source,setup_kind,created_at").eq("driver_id", driverId).eq("track_id", 425),
    ]);

    const maxStatDate = await supabaseAdmin.from("daily_statistics").select("statistic_date").eq("driver_id", driverId).order("statistic_date", { ascending: false }).limit(1).maybeSingle();

    return NextResponse.json({
      status: "ok",
      driverId,
      dailyStatisticsForAlgarve: { data: stats.data, error: stats.error },
      mostRecentStatisticDateAnyTrack: maxStatDate.data,
      drivingSessionsForAlgarve: { data: sessions.data, error: sessions.error },
      lapsForAlgarve: { data: laps.data, error: laps.error },
      recentSetupImportChecks: { data: checks.data, error: checks.error },
      setupFilesForAlgarve: { data: setups.data, error: setups.error },
    });
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
