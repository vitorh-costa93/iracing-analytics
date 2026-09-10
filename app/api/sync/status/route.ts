import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

type SyncRun = { sync_type: string; status: string; started_at: string; finished_at: string | null; error_message: string | null };
const latest = (runs: SyncRun[], types: string[], completed = false) => runs.find((run) => types.includes(run.sync_type) && (!completed || run.status === "completed")) ?? null;

export async function GET() {
  try {
    const [runsResult, resultsResult, setupsResult] = await Promise.all([
      supabaseAdmin.from("sync_runs").select("sync_type,status,started_at,finished_at,error_message").order("started_at", { ascending: false }).limit(100),
      supabaseAdmin.from("race_results").select("imported_at").order("imported_at", { ascending: false }).limit(1).maybeSingle(),
      supabaseAdmin.from("setup_files").select("created_at").eq("source", "garage61").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (runsResult.error) throw runsResult.error;
    if (resultsResult.error) throw resultsResult.error;
    if (setupsResult.error) throw setupsResult.error;
    const types = ["full", "catalog", "laps_incremental", "incremental"];
    const runs = (runsResult.data ?? []) as SyncRun[];
    const attempt = latest(runs, types);
    const success = latest(runs, types, true);
    const recentFailure = runs.find((run) =>
      types.includes(run.sync_type) &&
      run.status === "error" &&
      new Date(run.started_at).getTime() >= Date.now() - 24 * 60 * 60_000
    ) ?? null;
    return NextResponse.json({ status: "ok", sources: {
      garage61: {
        lastSuccessAt: success?.finished_at ?? null,
        latestStatus: attempt?.status ?? "unknown",
        latestError: attempt?.status === "error" ? attempt.error_message : null,
        recentError: recentFailure ? { at: recentFailure.started_at, message: recentFailure.error_message } : null,
      },
      irstats: { lastImportAt: resultsResult.data?.imported_at ?? null },
      setups: { lastImportAt: setupsResult.data?.created_at ?? null },
    } });
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
