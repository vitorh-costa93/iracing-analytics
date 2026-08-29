import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// TEMPORARY: clears setup_import_checks rows from the last few hours so events the previous
// (buggy, pre-adaptive-wait) bookmarklet run marked "checked, empty, skip for 7 days" get
// re-offered immediately instead of waiting out the grace window (29/08/2026). Delete after use.
export async function POST() {
  try {
    const { data: driver } = await supabaseAdmin.from("drivers").select("id").order("updated_at", { ascending: false }).limit(1).single();
    const cutoff = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabaseAdmin
      .from("setup_import_checks")
      .delete()
      .eq("driver_id", driver?.id)
      .gte("checked_at", cutoff)
      .select("garage61_event_id");
    if (error) throw error;
    return NextResponse.json({ status: "ok", cleared: data?.length ?? 0, eventIds: data?.map((r) => r.garage61_event_id) });
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
