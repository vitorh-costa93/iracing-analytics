-- Content-aware invalidation: a write route only dirties cached analytics when the source data
-- really changed (fingerprint differs from the last one that invalidated). A sync that finds
-- nothing new leaves every cached response valid and consumes no refresh budget.
alter table public.analytics_cache_control add column if not exists fingerprints jsonb not null default '{}';

create or replace function public.analytics_source_fingerprint()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'results', md5(concat_ws('|',
      (select concat_ws(',',count(*),coalesce(sum(irating_delta),0),coalesce(sum(finish_position),0),count(class_finish_position),
        count(official_irating_before),count(official_irating_after),coalesce(sum(laps),0),count(race_fastest_lap_time),count(winner_fastest_lap_time)) from public.race_results),
      (select concat_ws(',',count(*),coalesce(sum(rating),0),max(recorded_at)) from public.rating_history),
      (select concat_ws(',',count(*),coalesce(sum(rating),0),max(recorded_at)) from public.ratings),
      (select concat_ws(',',count(*),count(decoded_at),coalesce(sum(file_size),0)) from public.setup_files),
      (select count(*) from public.season_calendars), (select count(*) from public.season_week_contexts),
      (select count(*) from public.confirmed_race_events),
      (select count(*) from public.cars), (select count(*) from public.tracks), (select count(*) from public.car_groups),
      (select count(*) from public.car_group_members), (select count(*) from public.car_rating_categories))),
    'laps', md5(concat_ws('|',
      (select concat_ws(',',count(*),count(telemetry_path),count(garage61_payload),coalesce(sum(lap_time),0),
        count(*) filter (where clean),count(*) filter (where telemetry_skip)) from public.laps),
      (select count(*) from public.lap_sectors),
      (select concat_ws(',',count(*),coalesce(sum(lap_count),0),max(ended_at)) from public.driving_sessions),
      (select count(*) from public.race_field_events), (select count(*) from public.race_field_results),
      (select count(*) from public.daily_statistics))),
    'telemetry-ref', md5((select concat_ws(',',count(*),coalesce(sum(file_size),0),max(uploaded_at)) from public.telemetry_references))
  )
$$;

-- Returns the tags that were actually invalidated (changed fingerprint). Tags without a
-- fingerprint (e.g. sync-status) always invalidate.
create or replace function public.invalidate_analytics_cache_if_changed(p_tags text[])
returns text[] language plpgsql security invoker set search_path = '' as $$
declare fp jsonb; stored jsonb; changed text[];
begin
  perform 1 from public.analytics_cache_control where id for update;
  fp := public.analytics_source_fingerprint();
  select fingerprints into stored from public.analytics_cache_control where id;
  select coalesce(array_agg(tag),'{}') into changed from unnest(p_tags) tag
    where not (fp ? tag) or (stored->>tag) is distinct from (fp->>tag);
  if cardinality(changed)=0 then return changed; end if;
  perform public.invalidate_analytics_cache(changed);
  update public.analytics_cache_control set fingerprints = fingerprints ||
    (select coalesce(jsonb_object_agg(tag,fp->tag),'{}') from unnest(changed) tag where fp ? tag) where id;
  return changed;
end $$;

revoke all on function public.analytics_source_fingerprint(), public.invalidate_analytics_cache_if_changed(text[]) from public,anon,authenticated;
grant execute on function public.analytics_source_fingerprint(), public.invalidate_analytics_cache_if_changed(text[]) to service_role;
