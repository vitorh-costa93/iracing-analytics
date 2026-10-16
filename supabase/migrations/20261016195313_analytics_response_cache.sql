-- Derived responses only; source data and existing telemetry quotas are untouched.
create table public.analytics_response_cache (
  key text primary key,
  route text not null check (length(route) <= 1024 and route like '/api/%'),
  tags text[] not null,
  payload jsonb not null check (octet_length(payload::text) <= 1572864),
  generated_at timestamptz not null default now(),
  refresh_after timestamptz not null,
  invalidated_at timestamptz not null default 'epoch',
  lease_until timestamptz,
  version text not null
);
alter table public.analytics_response_cache enable row level security;
revoke all on public.analytics_response_cache from anon, authenticated;
grant all on public.analytics_response_cache to service_role;
create index analytics_cache_refresh on public.analytics_response_cache(refresh_after);

-- A singleton serializes admission and bounds stored JSON to 64 MiB / 512 variants.
create table public.analytics_cache_control (
  id boolean primary key default true check (id),
  day date not null default current_date,
  refreshes integer not null default 0,
  warm_until timestamptz
);
insert into public.analytics_cache_control(id) values(true);
alter table public.analytics_cache_control enable row level security;
revoke all on public.analytics_cache_control from anon, authenticated;
grant all on public.analytics_cache_control to service_role;

create function public.claim_analytics_cache_refresh(p_key text, p_lease_seconds integer)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare claimed text;
begin
  perform 1 from public.analytics_cache_control where id for update;
  update public.analytics_cache_control set day=current_date, refreshes=0 where id and day<>current_date;
  if (select refreshes >= 128 from public.analytics_cache_control where id) then return false; end if;
  update public.analytics_response_cache set lease_until=now()+make_interval(secs=>least(greatest(p_lease_seconds,1),300))
    where key=p_key and (lease_until is null or lease_until<now()) returning key into claimed;
  if claimed is null then return false; end if;
  update public.analytics_cache_control set refreshes=refreshes+1 where id;
  return true;
end $$;

create function public.store_analytics_cache(p_key text,p_route text,p_tags text[],p_payload jsonb,p_version text,p_started_at timestamptz,p_ttl_seconds integer)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare invalidation timestamptz; total_bytes bigint; row_count integer;
begin
  perform 1 from public.analytics_cache_control where id for update;
  if octet_length(p_payload::text)>1572864 then return false; end if;
  -- Bounded retention; this deletes only derived cache, never source records.
  delete from public.analytics_response_cache where generated_at<now()-interval '14 days';
  select invalidated_at into invalidation from public.analytics_response_cache where key=p_key for update;
  select count(*),coalesce(sum(octet_length(payload::text)),0) into row_count,total_bytes
    from public.analytics_response_cache where key<>p_key;
  if row_count>=512 or total_bytes+octet_length(p_payload::text)>67108864 then return false; end if;
  insert into public.analytics_response_cache(key,route,tags,payload,version,generated_at,refresh_after,invalidated_at)
    values(p_key,p_route,p_tags,p_payload,p_version,p_started_at,
      case when invalidation>p_started_at then invalidation else p_started_at+make_interval(secs=>greatest(p_ttl_seconds,120)) end,
      coalesce(invalidation,'epoch'))
    on conflict(key) do update set route=excluded.route,tags=excluded.tags,payload=excluded.payload,
      version=excluded.version,generated_at=excluded.generated_at,refresh_after=excluded.refresh_after,lease_until=null;
  return true;
end $$;

create function public.invalidate_analytics_cache(p_tags text[])
returns void language sql security invoker set search_path = '' as $$
  update public.analytics_response_cache set refresh_after=now(), invalidated_at=now()
    where tags && p_tags;
$$;

create function public.claim_analytics_cache_warm()
returns boolean language plpgsql security invoker set search_path = '' as $$
declare claimed boolean;
begin
  update public.analytics_cache_control set warm_until=now()+interval '5 minutes'
    where id and (warm_until is null or warm_until<now()) returning id into claimed;
  return coalesce(claimed,false);
end $$;
revoke all on function public.claim_analytics_cache_refresh(text,integer), public.store_analytics_cache(text,text,text[],jsonb,text,timestamptz,integer), public.invalidate_analytics_cache(text[]), public.claim_analytics_cache_warm() from public,anon,authenticated;
grant execute on function public.claim_analytics_cache_refresh(text,integer), public.store_analytics_cache(text,text,text[],jsonb,text,timestamptz,integer), public.invalidate_analytics_cache(text[]), public.claim_analytics_cache_warm() to service_role;
