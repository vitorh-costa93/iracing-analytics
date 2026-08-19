create or replace view public.v_season_weekly_irating as
with season_dates as (
    select
        '31'::text as season_id,
        '2025 Season 4'::text as season_name,
        '2025-09-16 00:00:00+00'::timestamptz as season_start
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
        floor(
            extract(epoch from (ds.started_at - sd.season_start)) / 604800
        )::int + 1 as week_number,
        crc.rating_category,
        c.name as car,
        t.name as track
    from public.driving_sessions ds
    join season_dates sd
        on sd.season_id = ds.season_id
    join public.car_rating_categories crc
        on crc.car_id = ds.car_id
    left join public.cars c
        on c.id = ds.car_id
    left join public.tracks t
        on t.id = ds.track_id
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
        floor(
            extract(epoch from (rh.recorded_at - sd.season_start)) / 604800
        )::int + 1 as week_number,
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

comment on view public.v_season_weekly_irating is
    'Weekly iRating and Race-only activity; cars, tracks, and races exclude Practice and Qualifying.';
