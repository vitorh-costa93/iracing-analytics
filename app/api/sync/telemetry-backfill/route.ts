import { NextRequest, NextResponse } from "next/server";
import { runTelemetryBackfill } from "@/lib/telemetry-backfill";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ status: "error", message: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await runTelemetryBackfill());
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
