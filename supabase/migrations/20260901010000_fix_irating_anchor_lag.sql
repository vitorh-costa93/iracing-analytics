-- Real bug the driver caught live (01/09/2026), still wrong after the previous fix in this same
-- session (20260901000000_fix_irating_anchor_timing.sql): raced twice today (10:30 UTC +27, 11:30
-- UTC +36 per race_results/iRStats, both exact). Before racing, iRating was 4960. After race 1: 4987
-- (matches 4960+27). After race 2: driver confirms 5023 (4987+36) is correct -- but the dashboard
-- kept showing 4987, even after the previous fix and repeated manual syncs.
--
-- Root cause (confirmed by inspecting the raw ratings history): Garage61's OWN snapshot -- the
-- "anchor" this whole reconstruction is built on -- had NOT actually processed the 11:30 race yet,
-- despite being RE-FETCHED (recorded_at refreshed) well after that race happened. recorded_at only
-- proves WHEN we asked Garage61, not which races its answer actually reflects -- Garage61 can, and
-- did, hand back a snapshot that hasn't caught up to the newest race even when asked for "now".
-- 20260901000000's fix (aligning by anchor.recorded_at vs each race's raced_at) can't detect this
-- kind of lag: recorded_at genuinely was after both races, so both were (wrongly) treated as already
-- included in the anchor's number.
--
-- Fix: only trust an anchor snapshot's absolute VALUE once it's been independently confirmed stable
-- -- observed unchanged across at least 50 minutes (comfortably past the hourly sync cadence, well
-- past the few minutes apart repeated manual re-syncs land on the same still-stale number). A value
-- that only ever appears once, or repeats within a few minutes of itself, hasn't been confirmed and
-- is not used as the anchor -- the reconstruction instead walks forward from the last CONFIRMED value
-- using race_results' own exact deltas for every race after it, which is exactly what this driver
-- asked for: "tudo o que for relacionado a iRating vem da iRStats" -- Garage61 now only supplies a
-- periodically-confirmed checkpoint, iRStats supplies the live delta chain forward from it.

drop view if exists public.v_historical_performance;
drop view if exists public.v_season_weekly_irating;
drop view if exists public.v_race_results_irating;

create view public.v_race_results_irating as
with anchor_candidates as (
  select
    r.driver_id, r.category, r.rating, r.recorded_at,
    exists (
      select 1 from public.ratings r2
      where r2.driver_id = r.driver_id and r2.category = r.category
        and r2.rating_type = 'irating' and r2.rating = r.rating
        and r2.recorded_at <= r.recorded_at - interval '50 minutes'
    ) as confirmed_stable
  from public.ratings r
  where r.rating_type = 'irating' and r.rating is not null
),
-- Prefer the latest CONFIRMED value; if this driver+category has never had one repeat 50+ minutes
-- apart (e.g. a brand new category with too little history), fall back to the plain latest snapshot
-- rather than having no anchor at all.
anchor as (
  select distinct on (driver_id, category) driver_id, category, rating, recorded_at
  from (
    select *, 1 as pref from anchor_candidates where confirmed_stable
    union all
    select *, 2 as pref from anchor_candidates
  ) ranked
  order by driver_id, category, pref, recorded_at desc
),
cumulative as (
  select
    rr.*,
    sum(rr.irating_delta) over (
      partition by rr.driver_id, rr.category
      order by rr.raced_at
      rows between unbounded preceding and current row
    ) as cum_delta_through_race
  from public.race_results rr
),
anchor_position as (
  select
    a.driver_id,
    a.category,
    a.rating,
    coalesce(
      (
        select c.cum_delta_through_race
        from cumulative c
        where c.driver_id = a.driver_id and c.category = a.category and c.raced_at <= a.recorded_at
        order by c.raced_at desc
        limit 1
      ),
      0
    ) as cum_delta_through_anchor
  from anchor a
)
select
  c.*,
  (ap.rating + (c.cum_delta_through_race - ap.cum_delta_through_anchor)) as irating_after,
  (ap.rating + (c.cum_delta_through_race - ap.cum_delta_through_anchor)) - c.irating_delta as irating_before
from cumulative c
join anchor_position ap
  on ap.driver_id = c.driver_id
 and ap.category = c.category;

comment on view public.v_race_results_irating is
  'race_results decorated with exact reconstructed irating_before/irating_after per row. Anchored at the latest Garage61 ratings value CONFIRMED stable (observed unchanged 50+ minutes apart) rather than simply the most recently fetched one -- a freshly re-fetched snapshot can still be stale relative to the newest known race (Garage61 processing lag), so an unconfirmed value is never trusted; every race after the last confirmed checkpoint is added forward using race_results'' own exact delta instead. Never uses irstats'' own rounded display value.';

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
