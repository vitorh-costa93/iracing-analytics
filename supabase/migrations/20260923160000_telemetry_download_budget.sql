-- Daily byte counter for telemetry downloads from Storage (lib/telemetry-storage.ts). Every
-- telemetry read goes through that module, which refuses to download once today's total reaches
-- TELEMETRY_DAILY_DOWNLOAD_BUDGET_BYTES. This is the hard guard-rail that keeps the org under the
-- free-tier "Cached Egress" quota after the second overage (23/09/2026): a second overage after the
-- grace period means immediate restriction, with no new grace period.
create table if not exists public.telemetry_download_usage (
  day date primary key,
  bytes bigint not null default 0,
  downloads integer not null default 0,
  blocked integer not null default 0
);

alter table public.telemetry_download_usage enable row level security;

create or replace function public.record_telemetry_download(p_bytes bigint, p_blocked boolean default false)
returns bigint
language sql
security definer
set search_path = public
as $$
  insert into public.telemetry_download_usage as u (day, bytes, downloads, blocked)
  values ((now() at time zone 'utc')::date, greatest(p_bytes, 0), case when p_blocked then 0 else 1 end, case when p_blocked then 1 else 0 end)
  on conflict (day) do update set
    bytes = u.bytes + excluded.bytes,
    downloads = u.downloads + excluded.downloads,
    blocked = u.blocked + excluded.blocked
  returning bytes;
$$;

revoke all on function public.record_telemetry_download(bigint, boolean) from public, anon, authenticated;
grant execute on function public.record_telemetry_download(bigint, boolean) to service_role;
