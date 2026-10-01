# Project history

Moved out of CLAUDE.md to keep per-session context small. Read on demand only.

## Through 03/09/2026

### Foundation - 19 to 27 August

- Supabase project was linked safely and baseline schema exported. Garage61 incremental session sync, seven-day overlap, idempotency, and sync observability were established.
- Results moved from inferred Garage61 data to iRStats browser import. `race_results`, iRating reconstruction views, Road context support, Setup event identity, and data architecture documentation were added.
- Active-week telemetry, reference uploads, detailed comparison, debrief, sector consistency, and setup comparison were implemented. The original Chrome extension bridge was replaced by portable bookmarklets.

### Telemetry/data hardening - 28 to 31 August

- Fixed gaps in live data sync for laps, sectors, and rating history; adopted Supabase-first telemetry UI and iRStats-only KPI source.
- Added line-distance/track-usage analysis, synchronized gear/steering widget, corner ideal line, race-survival fallback pace, P2P upload correction, and touch/mobile telemetry improvements.
- Replaced synthetic track ribbons with real OSM boundaries, expanded the boundary library, discarded disconnected alternate layouts, and verified full-lap GPS coverage before analysis.
- Corrected Algarve corner names/counts, switched detection toward GPS heading, rebuilt Car Comparison around season -> track -> class/car selection, plausible lap-time clustering, real per-corner maps/charts, and GTP/GT3 separation.

### UI and reliability - 1 to 3 September

- Added drag-to-pan and cursor-centered scroll zoom across maps; improved focused widgets, minimap sizing, light/dark mode, Safety Rating badge, mobile navigation, comparison table Delta Bar, and chart/popup legibility.
- Fixed the missing Vercel schedule root cause, then adjusted it to the Vercel Hobby daily limit. Added sync route time limits to avoid silent hangs.
- Reworked iRating anchoring after diagnostic validation: confirmed stable snapshot, its true timestamp, bounded two-day recency correction, and no `MAX()` shortcut.
- Fixed pagination limits in comparison queries, broken/partial Garage61 laps, Le Mans boundary length, setup imports from Practice, Laboratory car-name resolution, week-card matching by class instead of exact car, and opportunity cards to display real corner geometry instead of a generic 5% bin.

