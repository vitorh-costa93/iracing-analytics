create schema if not exists nossa_proxima_serie;
grant usage on schema nossa_proxima_serie to authenticated, service_role;
-- All application objects are prefixed. No changes to other projects/tables.
create table nossa_proxima_serie.nps_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null default 'Vocês' check (char_length(name) between 1 and 60),
  providers integer[] not null default '{}',
  onboarding_done boolean not null default false,
  updated_at timestamptz not null default now()
);
create table nossa_proxima_serie.nps_shows (
  id integer primary key check (id > 0),
  summary jsonb not null,
  updated_at timestamptz not null default now()
);
create table nossa_proxima_serie.nps_reactions (
  user_id uuid not null references auth.users(id) on delete cascade,
  show_id integer not null references nossa_proxima_serie.nps_shows(id),
  state text not null check (state in ('interested','dismissed','watched')),
  rating smallint,
  watched_season smallint not null default 0 check (watched_season between 0 and 100),
  updated_at timestamptz not null default now(),
  primary key (user_id,show_id),
  check ((state = 'watched' and rating between 1 and 5 and rating is not null) or (state <> 'watched' and rating is null))
);
create index nps_reactions_show_id_idx on nossa_proxima_serie.nps_reactions(show_id);
create table nossa_proxima_serie.nps_cache (
  key text primary key,
  value jsonb not null,
  expires_at timestamptz not null,
  stale_until timestamptz not null,
  updated_at timestamptz not null default now()
);
create index nps_cache_expiry_idx on nossa_proxima_serie.nps_cache(stale_until);
create table nossa_proxima_serie.nps_cache_locks (key text primary key,owner uuid not null,expires_at timestamptz not null);
create table nossa_proxima_serie.nps_quotas (bucket text primary key,requests integer not null default 0,updated_at timestamptz not null default now());
create table nossa_proxima_serie.nps_sync_runs (id bigint generated always as identity primary key,started_at timestamptz not null default now(),finished_at timestamptz,status text not null check(status in ('running','success','failed')),summary jsonb);

alter table nossa_proxima_serie.nps_profiles enable row level security;
alter table nossa_proxima_serie.nps_shows enable row level security;
alter table nossa_proxima_serie.nps_reactions enable row level security;
alter table nossa_proxima_serie.nps_cache enable row level security;
alter table nossa_proxima_serie.nps_cache_locks enable row level security;
alter table nossa_proxima_serie.nps_quotas enable row level security;
alter table nossa_proxima_serie.nps_sync_runs enable row level security;
revoke all on nossa_proxima_serie.nps_profiles,nossa_proxima_serie.nps_shows,nossa_proxima_serie.nps_reactions,nossa_proxima_serie.nps_cache,nossa_proxima_serie.nps_cache_locks,nossa_proxima_serie.nps_quotas,nossa_proxima_serie.nps_sync_runs from anon,authenticated;
grant select,insert,update,delete on nossa_proxima_serie.nps_profiles,nossa_proxima_serie.nps_reactions to authenticated;
grant select on nossa_proxima_serie.nps_shows to authenticated;
grant all on nossa_proxima_serie.nps_profiles,nossa_proxima_serie.nps_shows,nossa_proxima_serie.nps_reactions,nossa_proxima_serie.nps_cache,nossa_proxima_serie.nps_cache_locks,nossa_proxima_serie.nps_quotas,nossa_proxima_serie.nps_sync_runs to service_role;
grant usage,select on sequence nossa_proxima_serie.nps_sync_runs_id_seq to service_role;
create policy nps_profile_select on nossa_proxima_serie.nps_profiles for select to authenticated using ((select auth.uid())=user_id);
create policy nps_profile_insert on nossa_proxima_serie.nps_profiles for insert to authenticated with check ((select auth.uid())=user_id);
create policy nps_profile_update on nossa_proxima_serie.nps_profiles for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy nps_profile_delete on nossa_proxima_serie.nps_profiles for delete to authenticated using ((select auth.uid())=user_id);
create policy nps_reaction_select on nossa_proxima_serie.nps_reactions for select to authenticated using ((select auth.uid())=user_id);
create policy nps_reaction_insert on nossa_proxima_serie.nps_reactions for insert to authenticated with check ((select auth.uid())=user_id);
create policy nps_reaction_update on nossa_proxima_serie.nps_reactions for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy nps_reaction_delete on nossa_proxima_serie.nps_reactions for delete to authenticated using ((select auth.uid())=user_id);
create policy nps_show_select on nossa_proxima_serie.nps_shows for select to authenticated using (true);

-- Invoker functions can be called only by the backend role. Atomic leases work across devices/instances.
create function nossa_proxima_serie.nps_claim_cache(cache_key text,lock_owner uuid) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare claimed integer;
begin
  insert into nossa_proxima_serie.nps_cache_locks(key,owner,expires_at) values(cache_key,lock_owner,now()+interval '45 seconds')
  on conflict(key) do update set owner=excluded.owner,expires_at=excluded.expires_at where nossa_proxima_serie.nps_cache_locks.expires_at < now();
  get diagnostics claimed = row_count;
  return claimed > 0;
end;
$$;
create function nossa_proxima_serie.nps_consume_quota(bucket_name text,max_requests integer) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare consumed integer;
begin
  if max_requests < 1 then return false; end if;
  insert into nossa_proxima_serie.nps_quotas(bucket,requests) values(bucket_name,1)
  on conflict(bucket) do update set requests=nossa_proxima_serie.nps_quotas.requests+1,updated_at=now()
  where nossa_proxima_serie.nps_quotas.requests < max_requests;
  get diagnostics consumed = row_count;
  return consumed > 0;
end;
$$;
revoke all on function nossa_proxima_serie.nps_claim_cache(text,uuid) from public,anon,authenticated;
revoke all on function nossa_proxima_serie.nps_consume_quota(text,integer) from public,anon,authenticated;
grant execute on function nossa_proxima_serie.nps_claim_cache(text,uuid),nossa_proxima_serie.nps_consume_quota(text,integer) to service_role;

