-- A week with no races (e.g. a driver skipping Sports Car one week while still racing Formula)
-- left irating_end_of_week/irating_first/irating_before_week NULL for that week's row, since they
-- came straight from a LEFT JOIN with nothing to join to. The weekly iRating chart on the Overview
-- then dropped a point instead of holding flat -- but iRating genuinely doesn't change when you
-- don't race, so the correct value for a skipped week is whatever it already was: last observation
-- carried forward from the most recent week (within the same season+category) that did have a race.
--
-- Standard Postgres "gaps and islands" LOCF: count(col) over (order by week) only increments on a
-- non-null value, so every NULL week shares the group id of the most recent non-null week before
-- it; first_value() within that group then reads back the carried value. Column set/order is
-- unchanged from the previous definition, so CREATE OR REPLACE is safe here (no DROP needed).

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
),
joined as (
  select
    g.season_id,
    g.season_name,
    g.rating_category,
    g.week_number,
    g.week_start,
    g.week_end,
    wa.irating_first_before,
    wa.irating_last_after,
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
   and wa.week_number = g.week_number
),
filled as (
  select
    j.*,
    count(irating_last_after) over (partition by season_id, rating_category order by week_number) as end_group,
    count(irating_first_before) over (partition by season_id, rating_category order by week_number) as before_group
  from joined j
)
select
  season_id,
  season_name,
  rating_category,
  week_number,
  week_start,
  week_end,
  first_value(irating_first_before) over (partition by season_id, rating_category, before_group order by week_number) as irating_before_week,
  first_value(irating_first_before) over (partition by season_id, rating_category, before_group order by week_number) as irating_first,
  coalesce(
    first_value(irating_last_after) over (partition by season_id, rating_category, end_group order by week_number),
    first_value(irating_first_before) over (partition by season_id, rating_category, before_group order by week_number)
  ) as irating_end_of_week,
  case when irating_last_after is not null and irating_first_before is not null
    then irating_last_after - irating_first_before
    else 0
  end as weekly_delta,
  irating_min,
  irating_max,
  rating_changes,
  races,
  cars,
  tracks
from filled;

comment on view public.v_season_weekly_irating is
  'Weekly iRating and race activity, sourced from race_results (irstats.com), which holds the complete career history -- Garage61 rating_history only covers roughly the last 10 months. iRating values are exact (reconstructed via v_race_results_irating), not the rounded irstats display value. A week with no races carries forward the iRating from the most recent raced week in the same season+category (LOCF) -- iRating does not change when you do not race, so the chart should hold flat, not drop the point.';

grant select on public.v_season_weekly_irating to anon, authenticated, service_role;
