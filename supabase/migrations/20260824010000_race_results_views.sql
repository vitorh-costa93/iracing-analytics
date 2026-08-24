-- Centralizes the season calendar (previously duplicated in v_season_weekly_irating and the
-- remote_schema views) so race_results-based views share one source of truth.
create or replace view public.v_season_calendar as
select '31'::text as season_id, '2025 Season 4'::text as season_name, '2025-09-16 00:00:00+00'::timestamptz as season_start
union all
select '32', '2026 Season 1', '2025-12-16 00:00:00+00'::timestamptz
union all
select '33', '2026 Season 2', '2026-03-17 00:00:00+00'::timestamptz
union all
select '34', '2026 Season 3', '2026-06-16 00:00:00+00'::timestamptz;

comment on view public.v_season_calendar is
  'Season id/name/start-date calendar shared by all race_results-based views. Add a row here when a new iRacing season starts.';

-- Exact iRating reconstruction: irstats only shows a rounded iRating per race, so we chain the
-- exact irating_delta of every race back from the current exact ratings snapshot (the Garage61
-- anchor). irating_after(race) = anchor - sum(delta of every race for the same driver+category
-- strictly more recent than this one). irating_before(race) = irating_after(race) - delta.
create or replace view public.v_race_results_irating as
select
  rr.*,
  (r.rating - coalesce(
    sum(rr.irating_delta) over (
      partition by rr.driver_id, rr.category
      order by rr.raced_at desc
      rows between unbounded preceding and 1 preceding
    ), 0
  )) as irating_after,
  (r.rating - coalesce(
    sum(rr.irating_delta) over (
      partition by rr.driver_id, rr.category
      order by rr.raced_at desc
      rows between unbounded preceding and 1 preceding
    ), 0
  )) - rr.irating_delta as irating_before
from public.race_results rr
join public.ratings r
  on r.driver_id = rr.driver_id
 and r.category = rr.category
 and r.rating_type = 'irating';

comment on view public.v_race_results_irating is
  'race_results decorated with exact reconstructed irating_before/irating_after per row, derived by chaining irating_delta backward from the current exact ratings snapshot (never from irstats own rounded display value).';

-- The pre-existing v_season_summary/v_season_category_summary/v_season_weekly_irating/
-- v_historical_performance views (from driving_sessions/rating_history) had columns not present
-- in the race_results-based rewrites below. Postgres disallows CREATE OR REPLACE VIEW from
-- dropping columns, so the old views are dropped first; grants are re-applied afterward to match
-- what the previous migration (20260819000000_remote_schema.sql) granted.
drop view if exists public.v_season_summary;
drop view if exists public.v_season_category_summary;
drop view if exists public.v_season_weekly_irating;
drop view if exists public.v_historical_performance;

create or replace view public.v_season_summary as
with season_races as (
  select
    sc.season_id,
    sc.season_name,
    count(*) as race_sessions,
    sum(coalesce(rr.laps, 0)) as total_laps
  from public.v_season_calendar sc
  join public.race_results rr
    on rr.raced_at >= sc.season_start
   and rr.raced_at < sc.season_start + interval '84 days'
  group by sc.season_id, sc.season_name
)
select season_id, season_name, race_sessions, total_laps
from season_races;

create or replace view public.v_season_category_summary as
with season_races as (
  select
    sc.season_id,
    sc.season_name,
    rr.category as rating_category,
    rr.irating_delta as delta_irating
  from public.v_season_calendar sc
  join public.race_results rr
    on rr.raced_at >= sc.season_start
   and rr.raced_at < sc.season_start + interval '84 days'
)
select
  season_id,
  season_name,
  rating_category,
  count(*) as corridas,
  sum(delta_irating) as delta_irating,
  avg(delta_irating) as delta_medio,
  percentile_cont(0.5) within group (order by delta_irating) as mediana,
  100.0 * count(*) filter (where delta_irating > 0) / nullif(count(*), 0) as pct_positivas
from season_races
group by season_id, season_name, rating_category;

create or replace view public.v_season_weekly_irating as
with weeks as (
  select
    sc.season_id,
    sc.season_name,
    sc.season_start,
    gs as week_number,
    sc.season_start + ((gs - 1) * interval '7 days') as week_start,
    sc.season_start + (gs * interval '7 days') as week_end
  from public.v_season_calendar sc
  cross join generate_series(1, 12) gs
),
categories as (
  select 'formula_car'::text as rating_category
  union all
  select 'sports_car'
),
grid as (
  select w.season_id, w.season_name, w.week_number, w.week_start, w.week_end, c.rating_category
  from weeks w
  cross join categories c
),
week_races as (
  select
    sc.season_id,
    rr.category as rating_category,
    coalesce(rr.season_week, floor(extract(epoch from (rr.raced_at - sc.season_start)) / 604800)::int + 1) as week_number,
    rr.raced_at,
    rr.car_name,
    rr.track_name,
    rr.irating_delta,
    v.irating_after,
    v.irating_before
  from public.v_season_calendar sc
  join public.race_results rr
    on rr.raced_at >= sc.season_start
   and rr.raced_at < sc.season_start + interval '84 days'
  join public.v_race_results_irating v
    on v.id = rr.id
),
week_agg as (
  select
    season_id,
    rating_category,
    week_number,
    count(*) as races,
    array_agg(distinct car_name) as cars,
    array_agg(distinct track_name) as tracks,
    (array_agg(irating_before order by raced_at))[1] as irating_first_before,
    (array_agg(irating_after order by raced_at desc))[1] as irating_last_after,
    min(irating_after) as irating_min,
    max(irating_after) as irating_max,
    count(*) as rating_changes
  from week_races
  where week_number between 1 and 12
  group by season_id, rating_category, week_number
)
select
  g.season_id,
  g.season_name,
  g.rating_category,
  g.week_number,
  g.week_start,
  g.week_end,
  wa.irating_first_before as irating_before_week,
  wa.irating_first_before as irating_first,
  coalesce(wa.irating_last_after, wa.irating_first_before) as irating_end_of_week,
  case when wa.irating_last_after is not null and wa.irating_first_before is not null
    then wa.irating_last_after - wa.irating_first_before
    else 0
  end as weekly_delta,
  wa.irating_min,
  wa.irating_max,
  coalesce(wa.rating_changes, 0) as rating_changes,
  coalesce(wa.races, 0) as races,
  coalesce(wa.cars, array[]::text[]) as cars,
  coalesce(wa.tracks, array[]::text[]) as tracks
from grid g
left join week_agg wa
  on wa.season_id = g.season_id
 and wa.rating_category = g.rating_category
 and wa.week_number = g.week_number;

comment on view public.v_season_weekly_irating is
  'Weekly iRating and race activity, sourced from race_results (irstats.com) instead of driving_sessions/rating_history. iRating values are exact (reconstructed via v_race_results_irating), not the rounded irstats display value.';

create or replace view public.v_historical_performance as
with classified as (
  select
    rr.category as rating_category,
    case when rr.car_name = 'Dallara P217' then 'LMP2' else cg.name end as car_class,
    rr.car_name as car,
    rr.track_name as track,
    v.irating_after - v.irating_before as delta_irating
  from public.race_results rr
  join public.v_race_results_irating v on v.id = rr.id
  left join public.car_group_members cgm on cgm.car_id = rr.car_id
  left join public.car_groups cg on cg.id = cgm.car_group_id
)
select
  rating_category,
  car_class,
  car,
  track,
  count(*) as races,
  sum(delta_irating) as delta_irating,
  avg(delta_irating) as avg_delta_irating
from classified
group by rating_category, car_class, car, track;

-- Re-apply the grants the dropped views previously carried (matching
-- 20260819000000_remote_schema.sql), plus grants for the two new views.
grant all on table public.v_season_calendar to anon, authenticated, service_role;
grant all on table public.v_race_results_irating to anon, authenticated, service_role;
grant all on table public.v_season_summary to anon, authenticated, service_role;
grant all on table public.v_season_category_summary to anon, authenticated, service_role;
grant all on table public.v_season_weekly_irating to anon, authenticated, service_role;
grant all on table public.v_historical_performance to anon, authenticated, service_role;
