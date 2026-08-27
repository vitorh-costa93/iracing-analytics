-- Removes two tables confirmed orphaned by a full-codebase reference check (2026-08-27):
--   - race_rating_matches: the heuristic race<->rating-change matcher this migration's own
--     ancestor built, superseded by race_results.irating_delta (exact, from iRStats) and
--     v_race_results_irating (exact reconstruction). Nothing reads or writes it any more --
--     lib/rating-match.ts (its only consumer) was dead code and has been deleted alongside this.
--   - official_series_results: an 11-row manual snapshot from before the iRStats backfill, meant
--     to cover the gap iRStats now fills completely and automatically. Only a write path existed
--     (app/api/results/official/import, deleted alongside this) and nothing ever read it back --
--     components/OfficialResultsPanel.tsx, its only UI, was never mounted anywhere in the app.
--
-- rating_history is NOT touched here: despite being grouped with these as "legacy" in an earlier
-- pass, it still powers the Safety Rating history on the Overview page (Garage61 has no iRStats
-- equivalent for SR) -- it was reconnected to the hourly cron in this same change, not removed.

-- Depends on race_rating_matches and is itself unread by any app route -- drop before the table.
drop view if exists public.v_race_irating_candidates;

drop table if exists public.race_rating_matches;
drop table if exists public.official_series_results;
