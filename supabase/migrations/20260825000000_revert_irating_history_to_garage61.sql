-- irstats.com sits behind a Cloudflare bot challenge that blocks any non-browser request, so the
-- automatic hourly sync built for it cannot run — only a manually-triggered browser import can
-- feed race_results, and it isn't reliably populated yet (37/1327 races as of this migration).
-- Reverting the iRating history/season-summary views to their original Garage61-sourced
-- definitions (driving_sessions + rating_history + race_rating_matches, via
-- v_race_irating_candidates, which was never dropped) keeps the iRating chart and season KPIs
-- populated automatically regardless of irstats import status.
--
-- v_historical_performance stays on race_results/v_race_results_irating (car/track rankings,
-- GT3/IMSA breakdowns) — this is a deliberate choice: it's a secondary/enrichment view, not core
-- KPIs, and irstats data is strictly richer for per-car/per-track classification once populated.
-- v_season_calendar and v_race_results_irating are left in place — still used by
-- v_historical_performance and by the dashboard's race-list/wins queries.

-- CREATE OR REPLACE requires identical column positions; the column set/order here differs from
-- the Task-8 rewrite, so drop-and-recreate is required (same situation Task 8 itself hit).
drop view if exists public.v_season_summary;
drop view if exists public.v_season_category_summary;
drop view if exists public.v_season_weekly_irating;

create view public.v_season_summary as
with session_stats as (
  select
    driving_sessions.season_id,
    driving_sessions.season_name,
    min(driving_sessions.started_at) as started_at,
    max(driving_sessions.ended_at) as last_activity_at,
    count(*) as sessions,
    count(*) filter (where driving_sessions.session_type = 1) as practice_sessions,
    count(*) filter (where driving_sessions.session_type = 2) as qualifying_sessions,
    count(*) filter (where driving_sessions.session_type = 3) as race_sessions,
    coalesce(sum(driving_sessions.lap_count), 0::bigint) as total_laps,
    coalesce(sum(driving_sessions.lap_count) filter (where driving_sessions.session_type = 1), 0::bigint) as practice_laps,
    coalesce(sum(driving_sessions.lap_count) filter (where driving_sessions.session_type = 2), 0::bigint) as qualifying_laps,
    coalesce(sum(driving_sessions.lap_count) filter (where driving_sessions.session_type = 3), 0::bigint) as race_laps
  from public.driving_sessions
  where driving_sessions.season_id is not null
  group by driving_sessions.season_id, driving_sessions.season_name
),
rating_stats as (
  select
    ds.season_id,
    count(*) as races_with_irating,
    sum(v.delta_irating) as delta_irating,
    count(*) filter (where v.delta_irating > 0) as positive_races,
    count(*) filter (where v.delta_irating < 0) as negative_races,
    round(avg(v.delta_irating), 1) as avg_delta_irating
  from public.v_race_irating_candidates v
  join public.driving_sessions ds on ds.id = v.session_id
  where v.candidate_for_race = 1 and v.race_for_rating = 1
  group by ds.season_id
)
select
  s.season_id,
  s.season_name,
  s.started_at,
  s.last_activity_at,
  s.sessions,
  s.practice_sessions,
  s.qualifying_sessions,
  s.race_sessions,
  s.total_laps,
  s.practice_laps,
  s.qualifying_laps,
  s.race_laps,
  coalesce(r.races_with_irating, 0::bigint) as races_with_irating,
  coalesce(r.delta_irating, 0::bigint) as delta_irating,
  coalesce(r.positive_races, 0::bigint) as positive_races,
  coalesce(r.negative_races, 0::bigint) as negative_races,
  r.avg_delta_irating,
  case when coalesce(r.races_with_irating, 0) > 0
    then round((100.0 * coalesce(r.positive_races, 0)) / r.races_with_irating, 1)
    else null
  end as positive_pct
from session_stats s
left join rating_stats r on r.season_id = s.season_id;

create view public.v_season_category_summary as
with races as (
  select
    ds.season_id,
    ds.season_name,
    v.rating_category,
    v.session_id,
    v.delta_irating
  from public.v_race_irating_candidates v
  join public.driving_sessions ds on ds.id = v.session_id
  where v.candidate_for_race = 1 and v.race_for_rating = 1
)
select
  season_id,
  season_name,
  rating_category,
  count(*) as corridas,
  sum(delta_irating) as delta_irating,
  round(avg(delta_irating), 1) as delta_medio,
  round((percentile_cont(0.5) within group (order by delta_irating::double precision))::numeric, 1) as mediana,
  count(*) filter (where delta_irating > 0) as corridas_positivas,
  count(*) filter (where delta_irating < 0) as corridas_negativas,
  round((100.0 * count(*) filter (where delta_irating > 0)) / count(*), 1) as pct_positivas,
  max(delta_irating) as maior_ganho,
  min(delta_irating) as maior_perda
from races
group by season_id, season_name, rating_category;

create view public.v_season_weekly_irating as
with season_dates as (
  select '31'::text as season_id, '2025 Season 4'::text as season_name, '2025-09-16 00:00:00+00'::timestamptz as season_start
  union all
  select '32', '2026 Season 1', '2025-12-16 00:00:00+00'::timestamptz
  union all
  select '33', '2026 Season 2', '2026-03-17 00:00:00+00'::timestamptz
  union all
  select '34', '2026 Season 3', '2026-06-16 00:00:00+00'::timestamptz
),
weeks as (
  select
    s.season_id,
    s.season_name,
    s.season_start,
    gs as week_number,
    s.season_start + ((gs - 1) * interval '7 days') as week_start,
    s.season_start + (gs * interval '7 days') as week_end
  from season_dates s
  cross join generate_series(1, 12) gs
),
categories as (
  select 'formula_car'::text as rating_category
  union all
  select 'sports_car'
),
grid as (
  select
    w.season_id,
    w.season_name,
    w.week_number,
    w.week_start,
    w.week_end,
    c.rating_category
  from weeks w
  cross join categories c
),
session_base as (
  select
    ds.id,
    ds.season_id,
    floor(extract(epoch from (ds.started_at - sd.season_start)) / 604800)::int + 1 as week_number,
    crc.rating_category,
    c.name as car,
    t.name as track
  from public.driving_sessions ds
  join season_dates sd on sd.season_id = ds.season_id
  join public.car_rating_categories crc on crc.car_id = ds.car_id
  left join public.cars c on c.id = ds.car_id
  left join public.tracks t on t.id = ds.track_id
  where ds.session_type = 3
    and crc.rating_category in ('formula_car', 'sports_car')
),
activity as (
  select
    season_id,
    rating_category,
    week_number,
    count(*) as races,
    array_agg(distinct car) filter (where car is not null) as cars,
    array_agg(distinct track) filter (where track is not null) as tracks
  from session_base
  where week_number between 1 and 12
  group by season_id, rating_category, week_number
),
rating_base as (
  select
    sd.season_id,
    rh.category as rating_category,
    floor(extract(epoch from (rh.recorded_at - sd.season_start)) / 604800)::int + 1 as week_number,
    rh.recorded_at,
    rh.rating
  from public.rating_history rh
  join season_dates sd
    on rh.recorded_at >= sd.season_start
   and rh.recorded_at < sd.season_start + interval '84 days'
  where rh.rating_type = 'irating'
    and rh.category in ('formula_car', 'sports_car')
),
rating_week as (
  select
    season_id,
    rating_category,
    week_number,
    (array_agg(rating order by recorded_at))[1] as irating_first,
    (array_agg(rating order by recorded_at desc))[1] as irating_last,
    min(rating) as irating_min,
    max(rating) as irating_max,
    count(*) as rating_changes,
    min(recorded_at) as first_rating_at,
    max(recorded_at) as last_rating_at
  from rating_base
  where week_number between 1 and 12
  group by season_id, rating_category, week_number
),
final_base as (
  select
    g.season_id,
    g.season_name,
    g.rating_category,
    g.week_number,
    g.week_start,
    g.week_end,
    before_week.rating as irating_before_week,
    rw.irating_first,
    coalesce(rw.irating_last, before_week.rating) as irating_end_of_week,
    case
      when rw.irating_last is not null and before_week.rating is not null
        then rw.irating_last - before_week.rating
      else 0
    end as weekly_delta,
    rw.irating_min,
    rw.irating_max,
    coalesce(rw.rating_changes, 0) as rating_changes,
    rw.first_rating_at,
    rw.last_rating_at,
    coalesce(a.races, 0) as races,
    coalesce(a.cars, array[]::text[]) as cars,
    coalesce(a.tracks, array[]::text[]) as tracks
  from grid g
  left join activity a
    on a.season_id = g.season_id
   and a.rating_category = g.rating_category
   and a.week_number = g.week_number
  left join rating_week rw
    on rw.season_id = g.season_id
   and rw.rating_category = g.rating_category
   and rw.week_number = g.week_number
  left join lateral (
    select rh.rating
    from public.rating_history rh
    where rh.category = g.rating_category
      and rh.rating_type = 'irating'
      and rh.recorded_at < g.week_start
    order by rh.recorded_at desc
    limit 1
  ) before_week on true
)
select
  season_id,
  season_name,
  rating_category,
  week_number,
  week_start,
  week_end,
  irating_before_week,
  irating_first,
  irating_end_of_week,
  weekly_delta,
  irating_min,
  irating_max,
  rating_changes,
  first_rating_at,
  last_rating_at,
  races,
  cars,
  tracks
from final_base;

comment on view public.v_season_summary is
  'Reverted to Garage61 (driving_sessions/rating_history/race_rating_matches) sourcing on 2026-08-25: irstats.com is Cloudflare-blocked for automatic server-side sync, so this stays on the reliably-automatic source. See v_historical_performance for the race_results/irstats-sourced enrichment view.';
comment on view public.v_season_category_summary is
  'Reverted to Garage61 sourcing on 2026-08-25 — see v_season_summary comment.';
comment on view public.v_season_weekly_irating is
  'Reverted to Garage61 sourcing on 2026-08-25 — see v_season_summary comment. Weekly iRating and Race-only activity; cars, tracks, and races exclude Practice and Qualifying.';

-- DROP VIEW removed the original grants; restore them (same roles Task 8 restored for the other
-- rewritten views, matching what these three views had before Task 8 touched them).
grant all on table public.v_season_summary to anon, authenticated, service_role;
grant all on table public.v_season_category_summary to anon, authenticated, service_role;
grant all on table public.v_season_weekly_irating to anon, authenticated, service_role;
