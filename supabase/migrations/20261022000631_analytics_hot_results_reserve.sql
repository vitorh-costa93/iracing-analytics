-- Historical selector preparation must not spend the reserve for current results.
create or replace function public.claim_analytics_cache_refresh(p_key text,p_lease_seconds integer)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare claimed text; priority boolean; use_reserved boolean;
begin
  perform 1 from public.analytics_cache_control where id for update;
  update public.analytics_cache_control set day=current_date,refreshes=0,dirty_refreshes=0 where id and day<>current_date;
  select exists (
    select 1 from public.analytics_response_cache r, public.analytics_cache_control c,
      lateral unnest(array['results','telemetry-ref']) tag
    where r.key=p_key and c.id and tag=any(r.tags)
      and (c.invalidations->>tag)::timestamptz>r.generated_at
      and (tag='telemetry-ref' or r.route in (
        '/api/dashboard/overview','/api/telemetry/active-week','/api/telemetry/race-debrief',
        '/api/telemetry/plan','/api/setup/inventory','/api/setup/library')
        or r.route ~ '^/api/dashboard/report\?scope=(week|season)&segment=(formula|gt3|imsa)$')
  ) into priority;
  select priority and dirty_refreshes<64 into use_reserved from public.analytics_cache_control where id;
  if not use_reserved and (select refreshes>=128 from public.analytics_cache_control where id) then return false; end if;
  update public.analytics_response_cache set lease_until=now()+make_interval(secs=>least(greatest(p_lease_seconds,1),300))
    where key=p_key and (lease_until is null or lease_until<now()) returning key into claimed;
  if claimed is null then return false; end if;
  update public.analytics_cache_control set refreshes=refreshes+case when use_reserved then 0 else 1 end,
    dirty_refreshes=dirty_refreshes+case when use_reserved then 1 else 0 end where id;
  return true;
end $$;
