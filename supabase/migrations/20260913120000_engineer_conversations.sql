-- Persisted multi-turn conversation with the OpenAI-backed setup engineer, one row per
-- driver+season+car+track (same scoping convention setup_files already uses). A single JSONB
-- array, not a child table -- this is a single-user app, thread sizes are small, and "read/write
-- the whole conversation" is the only access pattern that ever happens.
create table if not exists public.engineer_conversations (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers(id) on delete cascade,
  season_id text not null,
  car_id bigint not null references public.cars(id),
  track_id bigint not null references public.tracks(id),
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (driver_id, season_id, car_id, track_id)
);

create index if not exists idx_engineer_conversations_context
  on public.engineer_conversations (driver_id, season_id, car_id, track_id);

alter table public.engineer_conversations enable row level security;

comment on table public.engineer_conversations is
  'Private single-user chat history with the OpenAI-backed setup engineer. Access is server-side only through the service role.';
