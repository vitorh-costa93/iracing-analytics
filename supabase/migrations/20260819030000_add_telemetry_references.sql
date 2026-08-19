create table if not exists public.telemetry_references (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers(id) on delete cascade,
  car_id integer not null references public.cars(id),
  track_id integer not null references public.tracks(id),
  storage_path text not null,
  original_filename text not null,
  file_size integer not null check (file_size > 0 and file_size <= 10485760),
  channels text[] not null default '{}',
  sample_count integer not null default 0,
  uploaded_at timestamptz not null default now(),
  unique (driver_id, car_id, track_id)
);

alter table public.telemetry_references enable row level security;
revoke all on table public.telemetry_references from anon, authenticated;
grant all on table public.telemetry_references to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('telemetry-references', 'telemetry-references', false, 10485760, array['text/csv', 'application/csv', 'application/vnd.ms-excel', 'text/plain'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

comment on table public.telemetry_references is
  'Uma referência CSV privada e ativa por driver, carro e pista; acessada apenas por rotas server-side.';
