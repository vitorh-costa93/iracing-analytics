-- Private setup inventory and storage for all raced car/track contexts.
create table if not exists public.setup_files (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers(id) on delete cascade,
  season_id text not null,
  car_id bigint not null references public.cars(id),
  track_id bigint not null references public.tracks(id),
  source text not null check (source in ('manual_commercial', 'garage61')),
  setup_kind text not null check (setup_kind in ('commercial', 'fixed', 'open', 'unknown')),
  filename text not null,
  storage_path text not null unique,
  garage61_lap_id text,
  file_size bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (driver_id, season_id, car_id, track_id, filename)
);

create index if not exists idx_setup_files_context
  on public.setup_files (driver_id, season_id, car_id, track_id);

alter table public.setup_files enable row level security;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'private-setups',
  'private-setups',
  false,
  5242880,
  array['application/octet-stream']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

comment on table public.setup_files is
  'Private single-user setup vault. Access is server-side only through the service role.';
