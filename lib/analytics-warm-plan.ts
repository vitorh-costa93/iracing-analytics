type Candidate = { route: string; generated_at: string; refresh_after: string };
const priority = (route: string) => route === "/api/dashboard/overview" ? 0
  : route === "/api/telemetry/active-week" ? 1
  : route === "/api/telemetry/race-debrief" ? 2
  : route.startsWith("/api/dashboard/report?") ? 3 : 4;

/** Filter freshness AFTER deduplicating versions: an obsolete row must not force a fresh route. */
export function analyticsWarmPlan(rows: Candidate[], now = Date.now()): string[] {
  const latest = new Map<string, Candidate>();
  for (const row of rows) if (!latest.has(row.route) || Date.parse(row.generated_at) > Date.parse(latest.get(row.route)!.generated_at)) latest.set(row.route, row);
  return [...latest.values()].filter(row => Date.parse(row.refresh_after) <= now)
    .sort((a, b) => priority(a.route) - priority(b.route) || Date.parse(a.generated_at) - Date.parse(b.generated_at))
    .slice(0, 8).map(row => row.route);
}
