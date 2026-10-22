import { expect, it } from "vitest";
import { analyticsWarmPlan } from "./analytics-warm-plan";
const row = (route: string, generated_at: string, refresh_after = "2026-10-19") => ({ route, generated_at, refresh_after });
it("does not spend budget on an obsolete version when the current route is fresh", () => {
  expect(analyticsWarmPlan([row("/api/test", "2026-10-17"),row("/api/test", "2026-10-21", "2026-10-23")], Date.parse("2026-10-22"))).toEqual([]);
});
it("prioritizes visible results, deduplicates and respects the eight-refresh bound", () => {
  const rows = Array.from({ length: 12 }, (_, i) => row(`/api/telemetry/car-comparison?trackId=${i}`, "2026-10-17"));
  rows.push(row("/api/dashboard/overview", "2026-10-20"),row("/api/telemetry/active-week", "2026-10-20"));
  const plan = analyticsWarmPlan(rows, Date.parse("2026-10-22"));
  expect(plan.slice(0,2)).toEqual(["/api/dashboard/overview","/api/telemetry/active-week"]);
  expect(plan).toHaveLength(8);
});
