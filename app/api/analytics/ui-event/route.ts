import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

const EVENT_NAMES = new Set([
  "overview_week_context_opened", "telemetry_tab_selected", "telemetry_context_selected",
  "telemetry_opportunity_opened", "debrief_category_selected", "debrief_evidence_opened",
  "setup_comparison_completed", "setup_engineer_prompt_selected", "setup_engineer_recommendation_requested",
]);
const CONTEXT_KEYS = new Set(["carId", "trackId", "category", "selectionReason", "group", "tab", "series"]);
const attempts = new Map<string, number[]>();

function permitted(request: NextRequest) {
  const origin = request.headers.get("origin");
  return !origin || origin === request.nextUrl.origin;
}

function withinRateLimit(request: NextRequest) {
  const key = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const now = Date.now();
  const recent = (attempts.get(key) ?? []).filter((time) => now - time < 5 * 60_000);
  if (recent.length >= 30) return false;
  recent.push(now); attempts.set(key, recent);
  return true;
}

function safeContext(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key, item]) => CONTEXT_KEYS.has(key) && (typeof item === "string" || typeof item === "number" || typeof item === "boolean"))
    .slice(0, 7)
    .map(([key, item]) => [key, typeof item === "string" ? item.slice(0, 80) : item]);
  return Object.fromEntries(entries);
}

export async function POST(request: NextRequest) {
  if (!permitted(request) || !withinRateLimit(request)) return new NextResponse(null, { status: 204 });
  try {
    const body = await request.json() as { eventName?: unknown; context?: unknown };
    if (typeof body.eventName !== "string" || !EVENT_NAMES.has(body.eventName)) return new NextResponse(null, { status: 204 });
    const { data: driver } = await supabaseAdmin.from("drivers").select("id").order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (!driver) return new NextResponse(null, { status: 204 });
    await supabaseAdmin.from("ui_interaction_events").insert({ driver_id: driver.id, event_name: body.eventName, context: safeContext(body.context) });
  } catch {
    // This endpoint is deliberately best-effort and cannot make the UI fail.
  }
  return new NextResponse(null, { status: 204 });
}
