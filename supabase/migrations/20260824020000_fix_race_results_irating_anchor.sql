-- Fixes two bugs found in whole-branch code review of 20260824010000_race_results_views.sql:
--
-- CRITICAL: v_race_results_irating joined public.ratings as if it were a one-row-per-driver+category
-- snapshot. It is not — ratings is an append-only history table (no unique constraint on
-- driver_id+category; both app/api/sync/all/route.ts and app/api/sync/profile/route.ts insert a
-- fresh row every sync run). Joining directly fanned out every race_results row once per matching
-- ratings row, corrupting the sum(irating_delta) window function and making irating_after/
-- irating_before garbage, and made `id` non-unique in the view — breaking the `v.id = rr.id` joins
-- in v_season_weekly_irating and v_historical_performance (race counts/deltas got multiplied).
-- Fix: resolve to exactly one row per driver+category (the most recent, via `distinct on`) before
-- joining, guarding against null rating.
--
-- IMPORTANT: v_historical_performance used `left join car_group_members ... left join car_groups`
-- to resolve car_class. car_group_members' PK is (car_group_id, car_id), so a car belonging to more
-- than one group fans out the race row once per membership, double-counting races/deltas. The OLD
-- view (20260819000000_remote_schema.sql) avoided this with a scalar subquery capped at one row.
-- Restoring that pattern here.

create or replace view public.v_race_results_irating as
with anchor as (
  select distinct on (driver_id, category) driver_id, category, rating
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
  'race_results decorated with exact reconstructed irating_before/irating_after per row, derived by chaining irating_delta backward from the current exact ratings snapshot (never from irstats own rounded display value). The ratings anchor is resolved to the single most-recent row per driver+category via distinct on, since ratings is an append-only history table, not a one-row snapshot.';

create or replace view public.v_historical_performance as
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
