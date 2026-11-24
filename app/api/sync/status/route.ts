import { CACHE_TAGS, cachedJson } from "@/lib/cache";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

type SyncRun = { sync_type: string; status: string; started_at: string; finished_at: string | null; error_message: string | null };
const latest = (runs: SyncRun[], types: string[], completed = false) => runs.find((run) => types.includes(run.sync_type) && (!completed || run.status === "completed")) ?? null;

export async function GET() {
  try {
    const todayUtc = new Date().toISOString().slice(0, 10);
    const [runsResult, resultsResult, lapsResult, setupsResult, driverResult, agentDeviceResult, agentUsageResult] = await Promise.all([
      supabaseAdmin.from("sync_runs").select("sync_type,status,started_at,finished_at,error_message").order("started_at", { ascending: false }).limit(50),
      supabaseAdmin.from("race_results").select("imported_at").order("imported_at", { ascending: false }).limit(1).maybeSingle(),
      supabaseAdmin.from("laps").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabaseAdmin.from("setup_files").select("created_at").in("source", ["ibt_setup", "manual_commercial", "garage61"]).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabaseAdmin.from("drivers").select("name, platform_driver_id").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
      supabaseAdmin.from("agent_devices").select("last_seen_at,enabled").eq("enabled", true).order("last_seen_at", { ascending: false }).limit(1).maybeSingle(),
      supabaseAdmin.from("agent_usage").select("requests,bytes").eq("day", todayUtc).maybeSingle(),
    ]);
    if (runsResult.error) throw runsResult.error;
    if (resultsResult.error) throw resultsResult.error;
    if (lapsResult.error) throw lapsResult.error;
    if (setupsResult.error) throw setupsResult.error;

    const types = ["full", "catalog", "laps_incremental", "incremental", "garage61_laps_bookmarklet", "telemetry"];
    const runs = (runsResult.data ?? []) as SyncRun[];
    const attempt = latest(runs, types);
    const success = latest(runs, types, true);
    const recentFailure = runs.find((run) =>
      types.includes(run.sync_type) &&
      run.status === "error" &&
      new Date(run.started_at).getTime() >= Date.now() - 24 * 60 * 60_000
    ) ?? null;

    const latestLapAt = lapsResult.data?.created_at ?? null;
    const latestRunAt = success?.finished_at ?? null;
    const lastTelemetryAt = latestLapAt && latestRunAt
      ? (latestLapAt > latestRunAt ? latestLapAt : latestRunAt)
      : (latestLapAt ?? latestRunAt);

    const driver = driverResult.error || !driverResult.data ? null : { name: driverResult.data.name as string, iracingId: driverResult.data.platform_driver_id == null ? null : String(driverResult.data.platform_driver_id) };
    const agentLastSeenAt = !agentDeviceResult.error && agentDeviceResult.data ? (agentDeviceResult.data.last_seen_at as string | null) : null;
    const agentToday = !agentUsageResult.error && agentUsageResult.data ? agentUsageResult.data : null;

    return cachedJson({ status: "ok", driver, sources: {
      telemetry: { lastSuccessAt: lastTelemetryAt },
      results: { lastImportAt: resultsResult.data?.imported_at ?? null },
      agent: {
        lastSeenAt: agentLastSeenAt,
        todayRequests: Number(agentToday?.requests ?? 0),
        todayBytes: Number(agentToday?.bytes ?? 0),
        dailyByteLimit: 25 * 1024 * 1024,
      },
      garage61: {
        lastSuccessAt: lastTelemetryAt,
        latestStatus: attempt?.status ?? "unknown",
        latestError: attempt?.status === "error" ? attempt.error_message : null,
        recentError: recentFailure ? { at: recentFailure.started_at, message: recentFailure.error_message } : null,
      },
      irstats: { lastImportAt: resultsResult.data?.imported_at ?? null },
      setups: { lastImportAt: setupsResult.data?.created_at ?? null },
    } }, { sMaxAge: 30, swr: 60, tags: [CACHE_TAGS.syncStatus] });
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
