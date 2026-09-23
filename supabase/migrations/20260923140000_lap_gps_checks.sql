-- Cache of the per-lap GPS verification used by the car-comparison track picker
-- (listSeasonsAndTracks). A lap's telemetry never changes once stored, so the check only needs to
-- run once per lap. Without this cache, every picker load re-downloaded several telemetry files per
-- car per track, which pushed the org's Supabase "Cached Egress" to 183% of the free-tier quota
-- (23/09/2026). Server-only table: RLS on and no policies, so only the service role reads/writes it.
create table if not exists public.lap_gps_checks (
  lap_id text primary key references public.laps(id) on delete cascade,
  coverage_pct double precision not null,
  gps_distance_m double precision not null,
  checked_at timestamptz not null default now()
);

alter table public.lap_gps_checks enable row level security;
