---
target: toda a aplicação (Overview, Telemetria, Setup)
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 2
timestamp: 2026-08-23T13-25-10Z
slug: toda-a-aplica-o-overview-telemetria-setup
---
Method: dual-agent (A: ae9395cb570015fb9 · B: a7e928d4f2af44d7e, browser evidence collected directly)

Design Health Score: 27/40 (Acceptable)

Design Specificity Verdict: Authored, not generic. Domain-specific telemetry primitives, hand-rolled .ibt parser, coach-voice copy. Detector found 7 warnings in app/globals.css (5 side-tab accent border, 2 border-accent-on-rounded); 2 confirmed false positives (tab underline indicators, no border-radius present).

Priority Issues:
P0 - Insight popup has no keyboard exit or dialog semantics (ActiveWeekTelemetry.tsx:658-677)
P0 - Telemetry channel scrubbing is mouse-only, no fallback (ActiveWeekTelemetry.tsx:624-651)
P1 - Low-contrast text on data labels, confirmed 3.5:1 measured (globals.css, --soft usage)
P1 - Active/selected state is color-only, no ARIA exposure (all .active toggles)
P2 - Zero retry affordance on any error state (app/page.tsx, ActiveWeekTelemetry.tsx, SectorConsistency.tsx)
P2 - Small hit targets confirmed 53x26px (.segmented-control.small button)

Persona Red Flags: Alex (no keyboard shortcuts, no retry, undiscoverable /setup slash command), Sam (mouse-only flagship feature, inaccessible modal, color-only active states)

Minor: double-fetch on /api/dashboard/safety-rating confirmed live; flat-week KPI reads as positive; external CDN icons with no onError fallback; scatter not memoized; English section-kickers vs Portuguese body copy.

Verdict: Block (2 P0 findings remain)
