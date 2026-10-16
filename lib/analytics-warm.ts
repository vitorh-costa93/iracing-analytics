import { supabaseAdmin } from "@/lib/supabase-admin";

// Never use a request Host/Origin to send the server secret.
const ORIGIN = "https://iracing-analytics.vercel.app";
const ALLOWED = /^\/api\/(?:dashboard\/(?:overview|report)|telemetry\/(?:active-week|plan|race-debrief|race-field|car-comparison|reference)|setup\/(?:inventory|library))(?:\?|$)/;
export const ANALYTICS_SEEDS = [
  "/api/dashboard/overview", "/api/telemetry/active-week", "/api/telemetry/plan",
  "/api/telemetry/race-debrief",
  ...["week", "season"].flatMap(scope => ["formula", "gt3", "imsa"].map(segment => `/api/dashboard/report?scope=${scope}&segment=${segment}`)),
  ...["gt3", "gtp"].map(category => `/api/telemetry/car-comparison?category=${category}`),
];

/** Dispatch into its own 300s function; ingest itself has only a 30s lifetime. */
export async function scheduleAnalyticsWarm() {
  const secret = process.env.IMPORT_KEY || process.env.CRON_SECRET;
  if (!secret || process.env.VERCEL_ENV !== "production") return;
  const response = await fetch(ORIGIN + "/api/analytics/prepare", {
    method: "POST", headers: { "x-analytics-warm": secret }, signal: AbortSignal.timeout(5_000),
  });
  await response.arrayBuffer();
}

/** Coalesced after writes: at most 8 known stale variants, 2 at once, once per 5 min.
 * Each refresh also consumes the DB's global 128/day refresh budget. No extra cron.
 */
export async function warmAnalytics() {
  const secret = process.env.IMPORT_KEY || process.env.CRON_SECRET;
  if (!secret || process.env.VERCEL_ENV !== "production") return;
  const { data: allowed, error } = await supabaseAdmin.rpc("claim_analytics_cache_warm");
  if (error || !allowed) return;
  const { data: rows, error: readError } = await supabaseAdmin.from("analytics_response_cache")
    .select("route").lt("refresh_after", new Date().toISOString()).order("generated_at").limit(8);
  if (readError) return;
  const routes = [...new Set([
    "/api/telemetry/car-comparison?category=gt3", "/api/telemetry/car-comparison?category=gtp",
    "/api/telemetry/active-week", "/api/telemetry/race-debrief",
    ...(rows ?? []).map(row => String(row.route)),
  ])].filter(route => ALLOWED.test(route));
  const deadline = Date.now() + 220_000;
  for (let index = 0; index < 8 && index < routes.length && Date.now() < deadline; index += 2) {
    await Promise.allSettled(routes.slice(index, index + 2).map(async route => {
      const response = await fetch(ORIGIN + route, {
        headers: { "x-analytics-warm": secret }, cache: "no-store", signal: AbortSignal.timeout(Math.min(50_000, deadline - Date.now())),
      });
      const body = await response.text();
      // Prepare the initial comparison for a newly discovered track, before a visitor opens it.
      if (route.startsWith("/api/telemetry/car-comparison?") && !route.includes("trackId=")) {
        try {
          const payload = JSON.parse(body);
          const trackId = payload.tracks?.[0]?.trackId;
          const category = new URL(route, ORIGIN).searchParams.get("category");
          if (payload.status === "ok" && Number.isSafeInteger(trackId) && category) {
            const child = `/api/telemetry/car-comparison?category=${category}&compact=1&season=${encodeURIComponent(payload.selectedSeasonId ?? "all")}&trackId=${trackId}`;
            if (!routes.includes(child)) routes.splice(index + 2, 0, child);
          }
        } catch { /* Invalid responses never expand the queue. */ }
      }
      if (!response.ok) console.warn("analytics warm failed", response.status);
    }));
  }
}
