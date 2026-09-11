import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// 11/09/2026: extracted from sync/incremental's own telemetry-download block, which used to run
// AFTER that route's rate-limited car/track-pair discovery loop -- meaning the "Atualizar Dados"
// button paid the full cost of discovering sessions/laps (the actual bottleneck; see
// public/garage61-import.js's own comment) just to get to a handful of CSV downloads. Sessions/laps/
// sectors now come from the browser bookmarklet instead (no rate limit, see app/api/sync/garage61-laps),
// so this route only needs to read the `laps` this driver already has (from either the bookmarklet or
// the daily cron's sync/incremental fallback) and fill in missing telemetry -- no discovery, no
// pagination, so no rate-limit exposure worth pacing for beyond the existing per-download safety.
export const maxDuration = 300;

const TELEMETRY_DOWNLOAD_CAP = 40;
const TIME_BUDGET_MS = 250_000; // no discovery cost to share this budget with anymore -- more headroom than sync/incremental's own 180s

export async function POST() {
  const startedAt = new Date().toISOString();
  const { data: syncRun } = await supabaseAdmin
    .from("sync_runs")
    .insert({ sync_type: "telemetry", status: "running", started_at: startedAt })
    .select("id")
    .single();

  try {
    const token = process.env.GARAGE61_API_TOKEN;
    if (!token) throw new Error("GARAGE61_API_TOKEN não configurado");

    // Most recently synced first -- a driver who just ran the bookmarklet after driving wants THAT
    // session's telemetry filled in before an older backlog gets its turn.
    const { data: candidates, error: candidatesError } = await supabaseAdmin
      .from("laps")
      .select("id,track_id")
      .eq("can_view_telemetry", true)
      .is("telemetry_path", null)
      .order("synced_at", { ascending: false })
      .limit(500);
    if (candidatesError) throw candidatesError;

    const runStartedAtMs = Date.now();
    let telemetryDownloaded = 0;
    let telemetryFailed = 0;

    for (const row of candidates ?? []) {
      if (Date.now() - runStartedAtMs > TIME_BUDGET_MS) break;
      if (telemetryDownloaded >= TELEMETRY_DOWNLOAD_CAP) break;
      try {
        const response = await fetch(`https://garage61.net/api/v1/laps/${encodeURIComponent(row.id)}/csv`, {
          headers: { Authorization: `Bearer ${token}`, Accept: "text/csv" }, cache: "no-store",
        });
        if (!response.ok) { telemetryFailed += 1; continue; }
        const csv = await response.text();
        const path = `laps/${row.track_id}/${row.id}.csv`;
        const { error: uploadError } = await supabaseAdmin.storage.from("telemetry")
          .upload(path, csv, { contentType: "text/csv; charset=utf-8", upsert: true });
        if (uploadError) { telemetryFailed += 1; continue; }
        const { error: updateError } = await supabaseAdmin.from("laps").update({ telemetry_path: path }).eq("id", row.id);
        if (updateError) { telemetryFailed += 1; continue; }
        telemetryDownloaded += 1;
      } catch {
        telemetryFailed += 1;
      }
    }

    if (syncRun?.id) {
      await supabaseAdmin.from("sync_runs").update({
        status: "completed", finished_at: new Date().toISOString(),
        records_found: candidates?.length ?? 0, records_inserted: telemetryDownloaded,
      }).eq("id", syncRun.id);
    }

    return NextResponse.json({
      status: "ok", candidatesFound: candidates?.length ?? 0, telemetryDownloaded, telemetryFailed,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (syncRun?.id) {
      await supabaseAdmin.from("sync_runs").update({ status: "error", finished_at: new Date().toISOString(), error_message: message }).eq("id", syncRun.id);
    }
    return NextResponse.json({ status: "error", message }, { status: 500 });
  }
}
