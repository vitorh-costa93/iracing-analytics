-- Previous fix in this same session (20260901010000_fix_irating_anchor_lag.sql, "confirmed stable")
-- was still wrong: it correctly rejected a FRESH anchor value observed for the first time, but a
-- lagging Garage61 snapshot can also show up as a value that's been "stable" for a long time BEFORE
-- the races it's now missing even happened (this driver's own 4960 plateau spanned 30+ hours, but
-- kept being reported unchanged through and past both of today's races once they occurred) -- "stable
-- for 50+ minutes" doesn't prove a snapshot reflects every race up to when it was fetched, only that
-- Garage61 hadn't updated its number recently, which is equally true whether nothing changed or
-- Garage61 just hasn't processed a real change yet.
--
-- Correct fix: stop trying to guess which anchor snapshot is "trustworthy" from ratings' own history
-- alone. Instead, convert every anchor into an OFFSET against a pure, baseline-free delta chain built
-- purely from race_results' own exact deltas (irating_delta is exact per iRStats; the driver's own
-- instruction: "tudo o que for relacionado a iRating vem da iRStats"), then take the RUNNING MAXIMUM
-- of that offset over time. A lagging anchor mechanically produces a LOWER offset than a fully
-- caught-up one (its rating hasn't grown by a race's delta yet, but the pure chain already has, so
-- subtracting the chain from the anchor's smaller rating yields a smaller offset) -- so it can never
-- win the running max and is automatically ignored, with no timing heuristic required. A genuinely
-- new baseline (like the driver's own historical Aug 28->30 iRating jump that isn't explained by any
-- race_results row at all -- an un-imported race, presumably) DOES produce a higher offset and
-- correctly becomes the new floor going forward.
--
-- Verified by hand against this driver's real data before writing this migration: the two races
-- today (+27 at 10:30, +36 at 11:30) both land on a stretch where the highest-offset anchor is the
-- long-stable pre-race snapshot (implied offset 5188), not the just-fetched post-race one still
-- missing the second race's delta (implied offset only 5152 -- 36 short, exactly the missing race's
-- delta) -- the running max correctly keeps 5188, giving pure_chain(now) + 5188 = 5023, matching
-- the driver's own confirmed number (4960 -> 4987 -> 5023) exactly.

drop view if exists public.v_historical_performance;
drop view if exists public.v_season_weekly_irating;
drop view if exists public.v_race_results_irating;

create view public.v_race_results_irating as
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
),
anchor_offsets as (
  select
    a.driver_id, a.category, a.recorded_at,
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
  from anchors a
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
  c.*,
  (
    c.pure_chain_through_race + coalesce(
      (
        select arm.best_offset_so_far
        from anchor_running_max arm
        where arm.driver_id = c.driver_id and arm.category = c.category and arm.recorded_at <= c.raced_at
        order by arm.recorded_at desc
        limit 1
      ),
      0
    )
  ) as irating_after,
  (
    c.pure_chain_through_race + coalesce(
      (
        select arm.best_offset_so_far
        from anchor_running_max arm
        where arm.driver_id = c.driver_id and arm.category = c.category and arm.recorded_at <= c.raced_at
        order by arm.recorded_at desc
        limit 1
      ),
      0
    )
  ) - c.irating_delta as irating_before
from races_cum c;

comment on view public.v_race_results_irating is
  'race_results decorated with exact reconstructed irating_before/irating_after per row. Built as a pure delta chain from race_results'' own exact irating_delta (baseline-free), corrected by the RUNNING MAXIMUM of every Garage61 ratings snapshot''s "implied offset" (its rating minus the pure chain value at its own recorded_at) over time -- a lagging/not-yet-caught-up snapshot mechanically produces a lower offset than an already-caught-up one and is automatically outrun by the running max, with no stability/timing heuristic needed. Never uses irstats'' own rounded display value.';

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
