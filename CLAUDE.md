# Claude handoff - Racing Analytics

Read this file first for continuity, then read `AGENTS.md` and `PROJECT_CONTEXT.md` before changing code, SQL, sync behavior, or business rules. The repository is a personal, single-user iRacing analytics application deployed on Vercel.

## Current baseline

- Branch: `main`, synchronized with `origin/main` at `6ba7677` (03/09/2026).
- Stack: Next.js 15 / React 19 / TypeScript / Supabase PostgreSQL + Storage / Vercel.
- Production: `https://iracing-analytics.vercel.app`.
- Main source of truth for race results, season activity, and iRating: iRStats imports in `race_results` and `v_race_results_irating`.
- Garage61 remains the source of catalog, driving sessions, laps, sectors, setups, and telemetry. Its API token remains server-side only.
- The current checkout may contain a user-owned change in `.impeccable/config.json`. Preserve it unless the requested work explicitly includes it.

## Non-negotiable rules

1. Metrics about iRating/race activity use only `session_type = 3`. Never let Practice or Qualifying leak into race counts, cars, tracks, or explanatory tooltips.
2. A rating change may match only one race. Match by rating category and temporal proximity; leave ambiguous cases unmatched.
3. `GT3`, `GTP`, and `LMP2` are classes, not series. IMSA must be identified independently. Dallara P217 is `sports_car` / LMP2.
4. Recurring syncs are incremental and idempotent. Do not turn normal syncs into backfills or delete/reimport existing data without explicit permission.
5. Do not expose secrets, tokens, OAuth credentials, cookies, Storage paths containing private content, or setup files. Garage61 and iRacing credentials stay server-side.
6. GitHub, Supabase, and Vercel operations are performed through their CLIs. The user has authorized routine production publication after validation.
7. Keep Supabase and Vercel on their free tiers permanently. Never remove, loosen, or bypass a cost/quota guard-rail (telemetry Storage byte budget, backfill batch size, report/overview response cache TTLs, Vercel Hobby's once-daily cron limit, per-file size caps) without the user's explicit request. These exist because the project already hit a real quota incident once (Supabase "Cached Egress", 08/09/2026, ~8.3GB/5GB — fixed in `app/api/dashboard/report/route.ts`'s in-memory cache). When adding a new recurring job, a new heavy query, or a new Storage write path, add a guard-rail of the same kind before shipping it, not after a quota alert.

## Product areas and main files

| Area | Frontend | Server/data |
|---|---|---|
| Overview | `app/page.tsx`, `components/KpiCard.tsx`, `SeasonChart.tsx`, `RaceTable.tsx`, `PerformanceRanking.tsx` | `app/api/dashboard/overview/route.ts`; `race_results`, `v_race_results_irating`, season views |
| Telemetry Lab | `app/telemetry/page.tsx`, `ActiveWeekTelemetry.tsx`, `SectorConsistency.tsx`, `RaceDebrief.tsx`, `CarComparison.tsx`, `TrackMap.tsx` | `app/api/telemetry/*`; Garage61 session/lap data synchronized to Supabase |
| Setup Lab | `app/setup/page.tsx`, `SetupLab.tsx` | `app/api/setup/*`, `setup_files`, private Storage |
| Sync | bookmarklet UI in the app and `public/garage61-import.js`, `public/irstats-import.js` | `app/api/sync/*`, `app/api/setup/garage61-import/*`, `sync_runs` |

Useful shared modules: `lib/irstats.ts`, `lib/garage61.ts`, `lib/supabase-admin.ts`, `lib/corner-detection.ts`, `lib/track-map.ts`, `lib/track-boundaries.ts`, `lib/useMapZoomPan.ts`, `lib/track-corners.ts`.

## Current data flow

```text
iRStats in the user's browser
  -> incremental bookmarklet -> /api/sync/irstats/ingest
  -> race_results -> v_race_results_irating -> Overview/KPIs/context ranking

Garage61 in the user's browser
  -> incremental setup bookmarklet -> pending/import routes -> setup_files
  -> server-side recurring sync -> catalogs, sessions, laps, sectors, ratings
  -> Supabase -> active-week telemetry, debrief, car comparison

Reference CSV/IBT
  -> browser normalizes the best full lap -> private Storage + telemetry_references
  -> comparison UI
```

The browser cannot execute Analytics-origin JavaScript inside Garage61 or iRStats. The supported cross-origin bridge is the bookmarklet copied/dragged from the UI. Do not describe it as a server-side scrape or depend on a Chrome extension; the extension was intentionally removed as a requirement to support mobile and all browsers.

## Sync and result decisions

- iRStats has Cloudflare protection. Do not call it from Vercel, GitHub Actions, or server-side code. The browser bookmarklet is required for result import.
- iRStats import is incremental: it recognizes existing IDs, stops after pages with no new results, and reports zero-new-result runs. Historical full scans are explicit audits only.
- `road` results are stored and contribute to Performance by Context, but do not contribute to Formula/Sports KPI totals or their rating matching.
- Garage61 setup import searches practice as well as race events. It skips only events already checked/imported according to the durable check/event identity; re-runs must not count unchanged setups as new.
- Telemetry reads are Supabase-first in the UI. Garage61 should be reached by the recurring sync / explicit synchronization path, not by a fresh per-page UI refetch.
- Vercel Hobby allows the scheduled sync once daily (09:00 UTC); do not claim hourly Vercel Cron is active.
- Telemetry and Setup Lab expose source freshness through `/api/sync/status`. It reports the last successful Garage61 sync and latest iRStats/setup imports; a recent Garage61 error is informational and never replaces the last valid data.
- Garage61 requests retry exactly once after a bounded `Retry-After` cooldown on HTTP 429. Incremental runs also close abandoned `laps_incremental` rows after 15 minutes so operations do not remain permanently marked as running.
- Overview links active-week contexts to Telemetry Lab; representative-lap eligibility is explicit in the UI. Race Debrief is intentionally progressive: summary/actions first, detailed evidence in disclosures, with a robust-sample label only at 10+ analyzed laps.
- Le Mans Historic (`track_id=195`) intentionally aliases the validated complete Sarthe geometry (`track_id=95`). Map renderers split GPS discontinuities instead of drawing a false diagonal across the circuit.

## Telemetry and map rules

- Track maps use GPS/real OSM boundaries from `public/track-boundaries.json` where available. The library covers 46 of 47 raced tracks. Preserve aspect ratio and connected-layout selection; never stretch X/Y to fill a card.
- All Analysis maps support wheel zoom at cursor and drag pan. Reset stale camera state when changing track.
- Map semantics: thick boundary/base line; own and reference traces remain visibly distinct thin lines. Hover/corner cards show the relevant local region, not the full circuit.
- GPS traces must have credible coverage. Reject broken/partial laps by GPS path coverage, not only by reported `lap_time` or `clean` flag.
- Corner detection prefers GPS heading change and uses lateral acceleration only as fallback. Do not invent names: use verified names in `lib/track-corners.ts`; otherwise use numbered corners.
- SF23 reference handling: reject active P2P/Overtake laps. `P2P_Count` is session cumulative, so it alone is not a per-lap P2P signal. Garage61 CSVs may not include P2P; remove only conservative obvious pace outliers when a direct channel is absent.
- The debrief race selection uses completed race laps/results, not a raw session duration. Cached payloads are versioned; bump the version for a material detection/shape contract change.

## iRating anchor behavior

- The Overview no longer uses a Garage61 fallback for KPI values. It uses iRStats-derived results and `v_race_results_irating`.
- `irating_after` is anchored to a confirmed stable Garage61 snapshot at that snapshot's own `recorded_at`; recent lag correction is bounded to two days. A running `MAX()` is incorrect because it hides real losses.
- The Overview route applies the bounded recency correction in application code; migrations ending in `01040000` and `01050000` record the investigation and final simple-view decision. Do not reintroduce a broad SQL anchor heuristic without inspecting real snapshots.
- Carry forward last known weekly iRating instead of rendering a blank week. The chart hover marker must be visually smaller than its hit target.

## Setup constraints

- `.sto` binary rewriting is not supported. Do not claim the app writes an iRacing-compatible setup.
- Compare parameters already decoded/captured by Garage61. Keep commercial setup files private; no third-party decoder or upload of original commercial files.
- A Data Packs `setup.sto` endpoint was identified, but it requires `team_datapacks_read` scope approval. It is not an available integration until that scope is granted.

## Database/schema reference

`docs/DATA_ARCHITECTURE.md` contains the current complete table/view inventory, column contracts, sample-query commands, source ownership, and frontend consumers. Significant tables include:

- source/catalog: `drivers`, `cars`, `tracks`, `car_groups`, `car_group_members`, `car_rating_categories`;
- driving data: `sessions`, `driving_sessions`, `laps`, `lap_sectors`, `daily_statistics`;
- iRating/results: `ratings`, `rating_history`, `race_results`, `race_rating_matches`, `official_series_results`;
- artifacts/operations: `setup_files`, `telemetry_references`, `race_debriefs`, `sync_runs`;
- analytical views: `v_historical_performance`, `v_race_irating_candidates`, `v_race_results_irating`, `v_season_calendar`, `v_season_category_summary`, `v_season_summary`, `v_season_weekly_irating`.

Always inspect migrations, the live schema, and view consumers before changing database contracts. Use `npx supabase db query --linked` for read-only validation and migrations for mutations.

## History through 03/09/2026

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

## Validation and publication

Before commit: review `git diff`, run `npm test`, `npx tsc --noEmit`, and `npm run build`. For schema/data changes, validate schema and representative results through the Supabase CLI and re-run the relevant incremental sync to prove idempotency.

The user prefers production publishing after validation. Commit/push with Git CLI and deploy through Vercel CLI. Do not publish if validation fails without explaining the failure and obtaining explicit approval.
