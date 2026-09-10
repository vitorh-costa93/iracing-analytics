"use client";

/**
 * Minimal, private product instrumentation.  It intentionally records only named decisions made
 * in the interface and a small, allow-listed context; it never sends telemetry, setup contents,
 * filenames or free-form engineer feedback.
 */
export type UiEventName =
  | "overview_week_context_opened"
  | "telemetry_tab_selected"
  | "telemetry_context_selected"
  | "telemetry_opportunity_opened"
  | "debrief_category_selected"
  | "debrief_evidence_opened"
  | "setup_comparison_completed"
  | "setup_engineer_prompt_selected"
  | "setup_engineer_recommendation_requested";

type UiEventContext = Record<string, string | number | boolean | null | undefined>;

const ALLOWED_CONTEXT = new Set(["carId", "trackId", "category", "selectionReason", "group", "tab", "series"]);

export function trackUiEvent(eventName: UiEventName, context: UiEventContext = {}) {
  if (typeof window === "undefined") return;
  const safeContext = Object.fromEntries(
    Object.entries(context)
      .filter(([key, value]) => ALLOWED_CONTEXT.has(key) && value !== undefined && value !== null)
      .slice(0, 7)
      .map(([key, value]) => [key, typeof value === "string" ? value.slice(0, 80) : value]),
  );
  const body = JSON.stringify({ eventName, context: safeContext });
  const url = "/api/analytics/ui-event";
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
      return;
    }
    void fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true });
  } catch {
    // Product analytics must never interrupt a driving-analysis workflow.
  }
}
