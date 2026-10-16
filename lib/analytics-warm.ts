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

/** Coalesced after writes: at most 8 known stale variants, 2 at once, once per 5 min.
 * Each refresh also consumes the DB's global 128/day refresh budget. No extra cron.
 */
export async function warmAnalytics() {
  const secret = process.env.IMPORT_KEY || process.env.CRON_SECRET;
  if (!secret || process.env.VERCEL_ENV !== "production") return;
  const { data: allowed, error } = await supabaseAdmin.rpc("claim_analytics_cache_warm");
  if (error || !allowed) return;
  const { data: rows, error: readError } = await supabaseAdmin.from("analytics_response_cache")
    .select("route").lt("refresh_after", new Date().toISOString()).order("refresh_after").limit(8);
  if (readError) return;
  const routes = [...new Set((rows ?? []).map(row => String(row.route)))].filter(route => ALLOWED.test(route));
  for (let index = 0; index < routes.length; index += 2) {
    await Promise.allSettled(routes.slice(index, index + 2).map(async route => {
      const response = await fetch(ORIGIN + route, {
        headers: { "x-analytics-warm": secret }, cache: "no-store", signal: AbortSignal.timeout(90_000),
      });
      await response.arrayBuffer();
      if (!response.ok) console.warn("analytics warm failed", response.status);
    }));
  }
}
