-- TEMPORARY debug view to diagnose why the running-max offset formula overshoots (5165 instead of the
-- confirmed 5023). Will be dropped in a follow-up migration once diagnosed.
create view public.v_debug_irating_offsets as
with anchors as (
  select driver_id, category, rating, recorded_at
  from public.ratings
  where rating_type = 'irating' and rating is not null
),
races_cum as (
  select
    rr.*,
    sum(rr.irating_delta) over (
      partition by rr.driver_id, rr.category
      order by rr.raced_at
      rows between unbounded preceding and current row
    ) as pure_chain_through_race
  from public.race_results rr
)
select
  a.driver_id, a.category, a.rating, a.recorded_at,
  a.rating - coalesce(
    (
      select rc.pure_chain_through_race
      from races_cum rc
      where rc.driver_id = a.driver_id and rc.category = a.category and rc.raced_at <= a.recorded_at
      order by rc.raced_at desc
      limit 1
    ),
    0
  ) as implied_offset
from anchors a;

grant select on public.v_debug_irating_offsets to anon, authenticated, service_role;
