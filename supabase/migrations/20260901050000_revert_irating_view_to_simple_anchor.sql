-- Reverts v_race_results_irating to the simple, original pre-session formula (single latest anchor,
-- backward-subtraction only). This session's last three attempts at a cleverer "running max offset"
-- reconstruction (20260901000000, 20260901010000, 20260901020000, 20260901040000) all failed once
-- tested against this driver's real data -- each either missed the lag (still showed 4987 instead of
-- the confirmed 5023) or overshot into historical artifacts elsewhere in this 1330+ race career
-- (5165). Chasing a fully general SQL-only fix for "which Garage61 snapshot has genuinely caught up
-- to which race" turned out to need actual verification against live data at every step, which isn't
-- practical through blind migrations. The "is the CURRENT value missing a recent race" correction
-- moves to application code instead (app/api/dashboard/overview/route.ts), where it can be verified
-- directly against live data before being trusted -- this view goes back to being a plain,
-- predictable building block.

drop view if exists public.v_historical_performance;
drop view if exists public.v_season_weekly_irating;
drop view if exists public.v_race_results_irating;

create view public.v_race_results_irating as
with anchor as (
  select distinct on (driver_id, category) driver_id, category, rating, recorded_at
  from public.ratings
  where rating_type = 'irating' and rating is not null
  order by driver_id, category, recorded_at desc
)
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
join anchor r
  on r.driver_id = rr.driver_id
 and r.category = rr.category;

comment on view public.v_race_results_irating is
  'race_results decorated with exact reconstructed irating_before/irating_after per row, derived by chaining irating_delta backward from the current exact ratings snapshot (never from irstats own rounded display value). The ratings anchor is resolved to the single most-recent row per driver+category via distinct on, since ratings is an append-only history table, not a one-row snapshot. Does NOT correct for the anchor snapshot lagging behind the newest race -- that correction lives in application code (app/api/dashboard/overview/route.ts) instead, verified directly against live data.';

create view public.v_historical_performance as
with classified as (
  select
    rr.category as rating_category,
    case
      when rr.car_name = 'Dallara P217' then 'LMP2'
      else (
        select cg.name
        from public.car_group_members cgm
        join public.car_groups cg on cg.id = cgm.car_group_id
        where cgm.car_id = rr.car_id
        limit 1
      )
    end as car_class,
    rr.car_name as car,
    rr.track_name as track,
    v.irating_after - v.irating_before as delta_irating
  from public.race_results rr
  join public.v_race_results_irating v on v.id = rr.id
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

grant all on table public.v_race_results_irating to anon, authenticated, service_role;
grant all on table public.v_historical_performance to anon, authenticated, service_role;
grant select on public.v_season_weekly_irating to anon, authenticated, service_role;
