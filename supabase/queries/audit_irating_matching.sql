with races as (
    select
        ds.id as session_id,
        crc.rating_category
    from public.driving_sessions ds
    join public.car_rating_categories crc
        on crc.car_id = ds.car_id
    where ds.session_type = 3
      and crc.rating_category in ('formula_car', 'sports_car')
),
candidate_stats as (
    select
        session_id,
        rating_category,
        count(*) as candidate_count,
        count(*) filter (
            where candidate_for_race = 1
              and race_for_rating = 1
        ) as accepted_count,
        min(minutes_after_race) filter (
            where candidate_for_race = 1
              and race_for_rating = 1
        ) as accepted_minutes,
        min(minutes_after_race) as closest_minutes,
        max(minutes_after_race) as furthest_minutes
    from public.v_race_irating_candidates
    group by session_id, rating_category
),
rating_stats as (
    select
        driver_id,
        rating_category,
        rating_at,
        count(*) as competing_races
    from public.v_race_irating_candidates
    group by driver_id, rating_category, rating_at
),
coverage as (
    select
        r.rating_category,
        count(*) as total_races,
        count(cs.session_id) as races_with_candidate,
        count(*) filter (where cs.accepted_count = 1) as accepted_matches,
        count(*) filter (where cs.candidate_count > 1) as races_with_multiple_candidates,
        count(*) filter (where cs.session_id is null) as races_without_candidate,
        count(*) filter (
            where cs.session_id is not null
              and cs.accepted_count = 0
        ) as races_rejected_by_conflict,
        round(avg(cs.closest_minutes)::numeric, 1) as avg_closest_minutes,
        round(max(cs.closest_minutes)::numeric, 1) as max_closest_minutes,
        count(*) filter (where cs.accepted_minutes <= 60) as accepted_within_60m,
        count(*) filter (
            where cs.accepted_minutes > 60
              and cs.accepted_minutes <= 120
        ) as accepted_60_to_120m,
        count(*) filter (
            where cs.accepted_minutes > 120
              and cs.accepted_minutes <= 180
        ) as accepted_120_to_180m,
        count(*) filter (where cs.accepted_minutes > 180) as accepted_over_180m,
        round(avg(cs.accepted_minutes)::numeric, 1) as avg_accepted_minutes,
        round(max(cs.accepted_minutes)::numeric, 1) as max_accepted_minutes
    from races r
    left join candidate_stats cs
        on cs.session_id = r.session_id
       and cs.rating_category = r.rating_category
    group by r.rating_category
),
rating_conflicts as (
    select
        rating_category,
        count(*) as rating_changes_with_candidates,
        count(*) filter (where competing_races > 1) as ratings_with_competing_races,
        max(competing_races) as max_races_for_one_rating
    from rating_stats
    group by rating_category
)
select
    c.rating_category,
    c.total_races,
    c.races_with_candidate,
    c.accepted_matches,
    c.races_with_multiple_candidates,
    c.races_without_candidate,
    c.races_rejected_by_conflict,
    round((100.0 * c.accepted_matches / nullif(c.total_races, 0))::numeric, 1) as coverage_pct,
    c.avg_closest_minutes,
    c.max_closest_minutes,
    c.accepted_within_60m,
    c.accepted_60_to_120m,
    c.accepted_120_to_180m,
    c.accepted_over_180m,
    c.avg_accepted_minutes,
    c.max_accepted_minutes,
    rc.rating_changes_with_candidates,
    rc.ratings_with_competing_races,
    rc.max_races_for_one_rating
from coverage c
left join rating_conflicts rc
    on rc.rating_category = c.rating_category
order by c.rating_category;
