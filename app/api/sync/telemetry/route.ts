import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { runTelemetryBackfill } from "@/lib/telemetry-backfill";

// 11/09/2026: extracted from sync/incremental's own telemetry-download block, which used to run
// AFTER that route's rate-limited car/track-pair discovery loop -- meaning the "Atualizar Dados"
// button paid the full cost of discovering sessions/laps (the actual bottleneck; see
// public/garage61-import.js's own comment) just to get to a handful of CSV downloads. Sessions/laps/
// sectors now come from the browser bookmarklet instead (no rate limit, see app/api/sync/garage61-laps),
// so this route only needs to fill in missing telemetry for laps this driver already has.
//
// 11/09/2026 correction, same day: the FIRST version of this route hand-rolled its own download loop
// straight to plain, uncompressed CSV uploads with no storage-budget check at all -- duplicating, and
// completely bypassing, lib/telemetry-backfill.ts's existing governance (a real 900MB
// TELEMETRY_STORAGE_BUDGET_BYTES guard-rail, gzip compaction, and a season-based retention window that
// deliberately does NOT backfill telemetry for laps outside the current/previous season). Confirmed
// live: 11,816 laps in this database lack stored telemetry, most from well outside that retention
// window -- a naive per-click downloader with no budget check would have silently blown well past the
// project's permanent free-tier Storage guard-rail (CLAUDE.md non-negotiable rule #7) the very next
// time this button was clicked. This route now just calls the SAME vetted backfill function the daily
// cron already runs, instead of a second, ungoverned copy of it.
export const maxDuration = 300;

export async function POST() {
  const startedAt = new Date().toISOString();
  const { data: syncRun } = await supabaseAdmin
    .from("sync_runs")
    .insert({ sync_type: "telemetry", status: "running", started_at: startedAt })
    .select("id")
    .single();

  try {
    const result = await runTelemetryBackfill();

    if (syncRun?.id) {
      await supabaseAdmin.from("sync_runs").update({
        status: "completed", finished_at: new Date().toISOString(),
        records_found: result.status === "ok" ? result.downloaded : 0,
        records_inserted: result.status === "ok" ? result.downloaded : 0,
      }).eq("id", syncRun.id);
    }

    return NextResponse.json({ status: "ok", telemetryDownloaded: result.status === "ok" ? result.downloaded : 0, backfill: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (syncRun?.id) {
      await supabaseAdmin.from("sync_runs").update({ status: "error", finished_at: new Date().toISOString(), error_message: message }).eq("id", syncRun.id);
    }
    return NextResponse.json({ status: "error", message }, { status: 500 });
  }
}
