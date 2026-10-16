-- Fence even a first computation which has not inserted a response row yet.
alter table public.analytics_cache_control add column invalidations jsonb not null default '{}';
alter table public.analytics_cache_control add column dirty_refreshes integer not null default 0;

create or replace function public.invalidate_analytics_cache(p_tags text[])
returns void language plpgsql security invoker set search_path = '' as $$
begin
  update public.analytics_cache_control set invalidations=invalidations ||
    (select coalesce(jsonb_object_agg(tag,to_jsonb(clock_timestamp())),'{}') from unnest(p_tags) tag) where id;
  update public.analytics_response_cache set refresh_after=now(),invalidated_at=now() where tags && p_tags;
end $$;

create or replace function public.store_analytics_cache(p_key text,p_route text,p_tags text[],p_payload jsonb,p_version text,p_started_at timestamptz,p_ttl_seconds integer)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare invalidation timestamptz; total_bytes bigint; row_count integer;
begin
  perform 1 from public.analytics_cache_control where id for update;
  select max(value::text::timestamptz) into invalidation from public.analytics_cache_control,
    lateral jsonb_each_text(invalidations) where id and key=any(p_tags);
  if invalidation>p_started_at or octet_length(p_payload::text)>1572864 then return false; end if;
  delete from public.analytics_response_cache where generated_at<now()-interval '14 days';
  select count(*),coalesce(sum(octet_length(payload::text)),0) into row_count,total_bytes
    from public.analytics_response_cache where key<>p_key;
  if row_count>=512 or total_bytes+octet_length(p_payload::text)>67108864 then return false; end if;
  insert into public.analytics_response_cache(key,route,tags,payload,version,generated_at,refresh_after,invalidated_at)
    values(p_key,p_route,p_tags,p_payload,p_version,p_started_at,p_started_at+make_interval(secs=>greatest(p_ttl_seconds,120)),coalesce(invalidation,'epoch'))
    on conflict(key) do update set route=excluded.route,tags=excluded.tags,payload=excluded.payload,
      version=excluded.version,generated_at=excluded.generated_at,refresh_after=excluded.refresh_after,
      invalidated_at=excluded.invalidated_at,lease_until=null;
  return true;
end $$;

-- Reserve capacity for changed source data; browsing cannot consume this allowance.
create or replace function public.claim_analytics_cache_refresh(p_key text,p_lease_seconds integer)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare claimed text; dirty boolean;
begin
  perform 1 from public.analytics_cache_control where id for update;
  update public.analytics_cache_control set day=current_date,refreshes=0,dirty_refreshes=0 where id and day<>current_date;
  select invalidated_at>generated_at into dirty from public.analytics_response_cache where key=p_key;
  if coalesce(dirty,false) then
    if (select dirty_refreshes>=64 from public.analytics_cache_control where id) then return false; end if;
  elsif (select refreshes>=128 from public.analytics_cache_control where id) then return false;
  end if;
  update public.analytics_response_cache set lease_until=now()+make_interval(secs=>least(greatest(p_lease_seconds,1),300))
    where key=p_key and (lease_until is null or lease_until<now()) returning key into claimed;
  if claimed is null then return false; end if;
  update public.analytics_cache_control set refreshes=refreshes+case when dirty then 0 else 1 end,
    dirty_refreshes=dirty_refreshes+case when dirty then 1 else 0 end where id;
  return true;
end $$;
