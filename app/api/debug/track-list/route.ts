import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// TEMPORARY debug route -- lists every track this driver has ever raced, to drive a one-time OSM
// boundary-fetch pass (29/08/2026). Delete once the full track-boundaries.json is built.
export async function GET() {
  try {
    const { data: driver } = await supabaseAdmin.from("drivers").select("id").order("updated_at", { ascending: false }).limit(1).single();
    const { data: results, error } = await supabaseAdmin.from("race_results").select("track_id").eq("driver_id", driver?.id);
    if (error) throw error;
    const trackIds = [...new Set((results ?? []).map((r) => r.track_id).filter((id): id is number => typeof id === "number"))];
    const { data: tracks, error: tracksError } = await supabaseAdmin.from("tracks").select("id,name,variant").in("id", trackIds);
    if (tracksError) throw tracksError;
    const sorted = (tracks ?? []).slice().sort((a, b) => a.id - b.id);
    return NextResponse.json({ status: "ok", count: sorted.length, tracks: sorted });
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
