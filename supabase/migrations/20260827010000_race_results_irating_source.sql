-- Completes the switch to irstats.com as the source of truth for iRating/season history, now that
-- the full historical backfill is done (race_results holds the driver's complete career, 1330+
-- races back to their first season — Garage61's own rating_history only goes back ~10 months).
-- 20260825000000_revert_irating_history_to_garage61.sql was a deliberate stopgap while the backfill
-- was incomplete; this migration reverts that stopgap now that the tradeoff no longer applies.
-- Garage61 remains the source for telemetry, lap sectors, and setups (driving_sessions/laps/
-- lap_sectors/setup_files) -- this migration only touches the season/iRating summary views.

drop view if exists public.v_season_summary;
drop view if exists public.v_season_category_summary;
drop view if exists public.v_season_weekly_irating;

create view public.v_season_summary as
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

create view public.v_season_category_summary as
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
  -- 'road' is an iRStats wallet used for historical context (v_historical_performance), not a
  -- headline iRating KPI wallet -- excluded here the same way DATA_ARCHITECTURE.md documents.
  where rr.category in ('formula_car', 'sports_car')
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

create view public.v_season_weekly_irating as
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
  'Weekly iRating and race activity, sourced from race_results (irstats.com), which holds the complete career history -- Garage61 rating_history only covers roughly the last 10 months. iRating values are exact (reconstructed via v_race_results_irating), not the rounded irstats display value.';

grant all on table public.v_season_summary to anon, authenticated, service_role;
grant all on table public.v_season_category_summary to anon, authenticated, service_role;
grant all on table public.v_season_weekly_irating to anon, authenticated, service_role;
