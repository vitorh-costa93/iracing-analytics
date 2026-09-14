-- Official iRacing 2026 Season 4 begins at 2026-09-15 00:00 UTC.
-- This is Monday 21:00 in America/Sao_Paulo, the product's week-change reference.
-- The existing weekly views consume v_season_calendar, so adding this row creates the zero-activity
-- S4 week grid before the driver has completed the first race.
create or replace view public.v_season_calendar as
select '31'::text as season_id, '2025 Season 4'::text as season_name, '2025-09-16 00:00:00+00'::timestamptz as season_start
union all
select '32', '2026 Season 1', '2025-12-16 00:00:00+00'::timestamptz
union all
select '33', '2026 Season 2', '2026-03-17 00:00:00+00'::timestamptz
union all
select '34', '2026 Season 3', '2026-06-16 00:00:00+00'::timestamptz
union all
select '35', '2026 Season 4', '2026-09-15 00:00:00+00'::timestamptz;

comment on view public.v_season_calendar is
  'Season id/name/start-date calendar shared by analytical views. Season 4 2026 was validated against the official schedule supplied on 14/09/2026.';
