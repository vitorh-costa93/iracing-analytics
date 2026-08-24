create table if not exists public.race_debriefs (
  id bigint generated always as identity primary key,
  driver_id uuid not null references public.drivers(id) on delete cascade,
  rating_category text not null,
  session_id bigint not null,
  payload jsonb not null,
  computed_at timestamptz not null default now(),
  unique (driver_id, rating_category)
);

alter table public.race_debriefs enable row level security;

grant all on table public.race_debriefs to service_role;
grant all on sequence public.race_debriefs_id_seq to service_role;

comment on table public.race_debriefs is
  'Cached per-category (formula_car/sports_car) consistency debrief for the most recent eligible race, recomputed only when a newer qualifying session appears.';
