-- Postgres freezes a view's column list (including a `rr.*` wildcard's expansion) at CREATE/
-- REPLACE time — it does NOT automatically pick up columns added to the underlying table later.
-- 20260825010000_add_race_fastest_lap_time.sql added race_results.race_fastest_lap_time, but
-- v_race_results_irating (which selects `rr.*`) kept its old, pre-existing column list, so any
-- query selecting race_fastest_lap_time through the view failed with "column ... does not exist"
-- even though the underlying table has it.
--
-- CREATE OR REPLACE VIEW only allows appending a column at the very end — but rr.*'s new column
-- lands ahead of this view's own two computed columns (irating_after/irating_before), which
-- Postgres reads as renaming irating_after, not appending. Drop-and-recreate is required (same
-- situation Task 8 and the Garage61-revert migration both already hit). v_historical_performance
-- depends on this view (`join public.v_race_results_irating`), so it must be dropped first and
-- recreated after.

drop view if exists public.v_historical_performance;
drop view if exists public.v_race_results_irating;

create view public.v_race_results_irating as
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

-- DROP VIEW removed grants on both views; restore them.
grant all on table public.v_race_results_irating to anon, authenticated, service_role;
grant all on table public.v_historical_performance to anon, authenticated, service_role;
