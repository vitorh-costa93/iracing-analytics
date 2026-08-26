-- ROAD is an iRStats wallet, not a third headline iRating KPI.  Keep it so results from the
-- same GT3/IMSA/SF23 series can contribute to context performance without corrupting Formula or
-- Sports wallet histories.  Historical context uses the exact per-race delta supplied by iRStats;
-- it therefore does not require an anchor row in ratings (which ROAD intentionally lacks).
alter table public.race_results drop constraint if exists race_results_category_check;
alter table public.race_results
  add constraint race_results_category_check
  check (category in ('formula_car', 'sports_car', 'road'));

drop view if exists public.v_historical_performance;

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
    rr.irating_delta as delta_irating
  from public.race_results rr
)
select rating_category, car_class, car, track,
  count(*) as races,
  sum(delta_irating) as delta_irating,
  avg(delta_irating) as avg_delta_irating
from classified
group by rating_category, car_class, car, track;

grant all on table public.v_historical_performance to anon, authenticated, service_role;
