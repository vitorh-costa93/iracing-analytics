-- Fixes a real staleness bug the driver caught live (01/09/2026): raced twice today (10:30 and 11:30
-- UTC, +27 and +36 irating_delta respectively per race_results/iRStats). After a manual sync/all run,
-- the dashboard showed 4987 (anchor 4960 + 27, i.e. only the FIRST race's delta) instead of the
-- correct 4960 + 27 + 36 = 5023.
--
-- Root cause: the anchor-chaining formula (20260825020000_refresh_race_results_irating_columns.sql)
-- always treated `anchor` (public.ratings' latest row for this driver+category) as "the rating right
-- after the MOST RECENT race in race_results" -- irating_after(newest race) = anchor.rating, nothing
-- subtracted, since nothing is "more recent". That assumption breaks whenever Garage61's own ratings
-- snapshot (refreshed by sync/all, itself dependent on Garage61 having processed the race) lags
-- behind iRStats' race_results ingestion for the SAME race -- exactly what happened here: Garage61's
-- anchor had caught up to the 10:30 race but not yet the 11:30 one, even though race_results (via the
-- iRStats bookmarklet, which the driver DOES run manually) already had both.
--
-- Fix: anchor the reconstruction at the anchor row's own recorded_at timestamp instead of assuming
-- it's "after everything". For a race at or before anchor.recorded_at, subtract the deltas of every
-- race between it and the anchor (the old backward-chaining behavior, unchanged for the common case).
-- For a race AFTER anchor.recorded_at (Garage61 lagging, iRStats already has it), ADD the deltas of
-- every race between the anchor and it instead -- new behavior, and what actually fixes this bug.

drop view if exists public.v_historical_performance;
drop view if exists public.v_season_weekly_irating;
drop view if exists public.v_race_results_irating;

create view public.v_race_results_irating as
with anchor as (
  select distinct on (driver_id, category) driver_id, category, rating, recorded_at
  from public.ratings
  where rating_type = 'irating' and rating is not null
  order by driver_id, category, recorded_at desc
),
-- Cumulative delta ascending through EVERY race (oldest first) -- a running total that includes the
-- current row, used as a common ruler to measure both "how far is this race from the anchor" and
-- "how far is the anchor from this race", regardless of which one comes first chronologically.
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
-- Where the anchor itself sits on that same ruler: the cumulative delta through the most recent race
-- at or before the anchor's own recorded_at (0 if the anchor predates this driver+category's first
-- known race).
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
  'race_results decorated with exact reconstructed irating_before/irating_after per row. Anchored at the Garage61 ratings snapshot''s own recorded_at timestamp (not assumed to be "after everything") so a race that happened after the anchor was taken -- Garage61 lagging behind iRStats for the same race -- still gets that race''s own delta added forward instead of silently dropped. Never uses irstats'' own rounded display value.';

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

grant all on table public.v_race_results_irating to anon, authenticated, service_role;
grant all on table public.v_historical_performance to anon, authenticated, service_role;

-- Recreated unchanged (dropped above only because it depends on v_race_results_irating, which had to
-- be dropped to fix its own column computation) -- identical to
-- 20260828000000_carry_forward_weekly_irating.sql's own definition.
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

grant select on public.v_season_weekly_irating to anon, authenticated, service_role;
