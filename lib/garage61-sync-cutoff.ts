import { supabaseAdmin } from "@/lib/supabase-admin";

// 11/09/2026: shared between app/api/sync/incremental/route.ts (the server-side, rate-limited fallback
// that the daily cron still runs unattended -- the bookmarklet below needs the driver's own live
// browser session, so it can never replace that automatic path) and the new
// app/api/sync/garage61-laps/* routes (the on-demand, no-rate-limit path via the browser bookmarklet,
// same "usar o mesmo botão" flow already used for setups). Both need the exact same "how far back is
// still worth checking" answer so a driver who runs the bookmarklet right after driving and then lets
// the cron catch up later doesn't get inconsistent overlap windows between the two paths.
export const OVERLAP_HOURS = 7 * 24;
export const INITIAL_LOOKBACK_DAYS = 14;

export async function computeIncrementalCutoff(driverId: string): Promise<Date> {
  const { data: latest, error } = await supabaseAdmin
    .from("driving_sessions")
    .select("started_at")
    .eq("driver_id", driverId)
    .not("started_at", "is", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;

  const initialCutoff = Date.now() - INITIAL_LOOKBACK_DAYS * 86_400_000;
  const overlapCutoff = latest?.started_at
    ? new Date(latest.started_at).getTime() - OVERLAP_HOURS * 3_600_000
    : initialCutoff;
  return new Date(Math.max(initialCutoff, overlapCutoff));
}
