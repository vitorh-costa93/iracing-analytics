-- Advance the last good snapshot during a stream of writes without calling it fresh.
create or replace function public.store_analytics_cache(p_key text,p_route text,p_tags text[],p_payload jsonb,p_version text,p_started_at timestamptz,p_ttl_seconds integer)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare invalidation timestamptz; total_bytes bigint; row_count integer; fresh boolean;
begin
  perform 1 from public.analytics_cache_control where id for update;
  select max(value::timestamptz) into invalidation from public.analytics_cache_control,
    lateral jsonb_each_text(invalidations) where id and key=any(p_tags);
  if octet_length(p_payload::text)>1572864 then return false; end if;
  if exists(select 1 from public.analytics_response_cache where key=p_key and generated_at>p_started_at) then return false; end if;
  fresh := invalidation is null or invalidation<=p_started_at;
  delete from public.analytics_response_cache where generated_at<now()-interval '14 days';
  select count(*),coalesce(sum(octet_length(payload::text)),0) into row_count,total_bytes
    from public.analytics_response_cache where key<>p_key;
  if row_count>=512 or total_bytes+octet_length(p_payload::text)>67108864 then return false; end if;
  insert into public.analytics_response_cache(key,route,tags,payload,version,generated_at,refresh_after,invalidated_at)
    values(p_key,p_route,p_tags,p_payload,p_version,p_started_at,
      case when fresh then p_started_at+make_interval(secs=>greatest(p_ttl_seconds,120)) else invalidation end,
      coalesce(invalidation,'epoch'))
    on conflict(key) do update set route=excluded.route,tags=excluded.tags,payload=excluded.payload,
      version=excluded.version,generated_at=excluded.generated_at,refresh_after=excluded.refresh_after,
      invalidated_at=excluded.invalidated_at,lease_until=null;
  -- False keeps the live response no-store; the saved copy is explicitly STALE.
  return fresh;
end $$;
