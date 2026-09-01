-- Previous fix in this session (20260901020000, running max of a CAREER-WIDE 0-baseline delta chain)
-- overshot badly (5165 instead of the confirmed 5023) once tested against the real data. Diagnosed
-- via a temp debug view (20260901030000, dropped below): a 0-baseline delta chain summed across this
-- driver's entire race_results history (1330+ races, back to their very first iRacing season) hits
-- multiple real gaps/inconsistencies far in the past (one anchor from 2026-08-27 alone implied an
-- offset of 3248 -- an obvious artifact, not a real "hidden race" jump like the genuine Aug 28->30
-- one). A single bad historical anchor anywhere in a 1330-race career permanently polluted the
-- running max for every value computed after it.
--
-- Fix: ground the reconstruction at a baseline anchor B = the oldest Garage61 snapshot within the
-- last 7 days (comfortably covers the observed ~36h Aug28->30 gap while staying far short of
-- career-spanning drift). For ANY race R (before or after B, same formula either direction, exactly
-- like the ORIGINAL subtract-from-anchor approach this view always used):
--   irating_after(R) = B.rating + (cum_delta_through(R) - cum_delta_through(at-or-before B)) + running_max_offset(R.raced_at)
-- running_max_offset is the running maximum of (a LATER anchor's rating minus what this same formula
-- would predict for it, floored at 0) -- a lagging snapshot can't beat 0 (its rating hasn't grown by
-- the missing race's delta yet, so its own implied offset comes out negative or zero), while a
-- genuine unexplained jump (like the Aug28->30 gap) still ratchets the floor up correctly. No UNION
-- or separate "old race" branch needed -- the anchor-relative difference term is symmetric whether R
-- is before or after B, and running_max_offset is naturally 0 for anything before B (no qualifying
-- anchors exist yet at that point).

drop view if exists public.v_debug_irating_offsets;
drop view if exists public.v_historical_performance;
drop view if exists public.v_season_weekly_irating;
drop view if exists public.v_race_results_irating;

create view public.v_race_results_irating as
with anchors as (
  select driver_id, category, rating, recorded_at
  from public.ratings
  where rating_type = 'irating' and rating is not null
),
baseline as (
  -- Prefer the oldest snapshot within the last 7 days; fall back to the plain latest snapshot for a
  -- driver+category with no recent sync at all (matches this view's original pre-session behavior
  -- for that edge case). Each candidate row only has ONE of the two case expressions non-null (the
  -- one matching its own pref), so the other never affects ordering within that pref's own group.
  select distinct on (driver_id, category) driver_id, category, rating, recorded_at
  from (
    select driver_id, category, rating, recorded_at, 1 as pref
    from anchors where recorded_at >= now() - interval '7 days'
    union all
    select driver_id, category, rating, recorded_at, 2 as pref
    from anchors
  ) candidates
  order by driver_id, category, pref, case when pref = 1 then recorded_at end asc, case when pref = 2 then recorded_at end desc
),
races_cum as (
  select
    rr.*,
    sum(rr.irating_delta) over (
      partition by rr.driver_id, rr.category
      order by rr.raced_at
      rows between unbounded preceding and current row
    ) as running_delta
  from public.race_results rr
),
baseline_delta as (
  select
    b.driver_id, b.category,
    coalesce(
      (
        select rc.running_delta
        from races_cum rc
        where rc.driver_id = b.driver_id and rc.category = b.category and rc.raced_at <= b.recorded_at
        order by rc.raced_at desc
        limit 1
      ),
      0
    ) as delta_through_baseline
  from baseline b
),
predicted as (
  -- What the (not-yet-offset-corrected) grounded chain predicts for every race, used both as the
  -- final answer's base term and as the reference each anchor's implied offset is measured against.
  select
    rc.driver_id, rc.category, rc.raced_at, rc.id,
    b.rating + (rc.running_delta - bd.delta_through_baseline) as predicted_value
  from races_cum rc
  join baseline b on b.driver_id = rc.driver_id and b.category = rc.category
  join baseline_delta bd on bd.driver_id = rc.driver_id and bd.category = rc.category
),
anchor_offsets as (
  select
    a.driver_id, a.category, a.recorded_at,
    greatest(
      0,
      a.rating - coalesce(
        (
          select p.predicted_value
          from predicted p
          where p.driver_id = a.driver_id and p.category = a.category and p.raced_at <= a.recorded_at
          order by p.raced_at desc
          limit 1
        ),
        b.rating
      )
    ) as implied_offset
  from anchors a
  join baseline b on b.driver_id = a.driver_id and b.category = a.category
  where a.recorded_at >= b.recorded_at
),
anchor_running_max as (
  select
    driver_id, category, recorded_at,
    max(implied_offset) over (
      partition by driver_id, category
      order by recorded_at
      rows between unbounded preceding and current row
    ) as best_offset_so_far
  from anchor_offsets
)
select
  rc.*,
  (
    p.predicted_value + coalesce(
      (
        select arm.best_offset_so_far
        from anchor_running_max arm
        where arm.driver_id = rc.driver_id and arm.category = rc.category and arm.recorded_at <= rc.raced_at
        order by arm.recorded_at desc
        limit 1
      ),
      0
    )
  ) as irating_after,
  (
    p.predicted_value + coalesce(
      (
        select arm.best_offset_so_far
        from anchor_running_max arm
        where arm.driver_id = rc.driver_id and arm.category = rc.category and arm.recorded_at <= rc.raced_at
        order by arm.recorded_at desc
        limit 1
      ),
      0
    )
  ) - rc.irating_delta as irating_before
from races_cum rc
join predicted p on p.id = rc.id;

comment on view public.v_race_results_irating is
  'race_results decorated with exact reconstructed irating_before/irating_after per row. Grounded at a baseline anchor (the oldest Garage61 snapshot in the last 7 days, or the plain latest one if none), corrected by the running max of any later snapshot''s offset against that same grounded chain, floored at 0 -- a lagging snapshot can never beat 0 and is ignored automatically; a genuine unexplained jump still ratchets the floor up. Never uses irstats'' own rounded display value.';

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
