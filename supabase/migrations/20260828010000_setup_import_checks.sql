-- The Garage61 setup-import bookmarklet (chrome-extension/garage61-import.js) revisits EVERY race
-- event in the lookback window that has no imported setup yet -- including events that genuinely
-- have no capturable setup (qualifying-only, a car mode the interceptor doesn't recognize, or the
-- event page simply not exposing one within the fixed wait). Those got retried on literally every
-- click of "Atualizar Dados" forever, since nothing ever marked them "checked, nothing there" --
-- each retry is a full hidden-iframe visit to a Garage61 event page (~5s, several of Garage61's own
-- API calls), a real contributor to hitting their rate limit. This table lets a checked-but-empty
-- event be skipped for a while instead of revisited on every run.

create table if not exists public.setup_import_checks (
  driver_id uuid not null references public.drivers(id) on delete cascade,
  garage61_event_id text not null,
  car_id integer,
  track_id integer,
  found boolean not null default false,
  checked_at timestamptz not null default now(),
  primary key (driver_id, garage61_event_id)
);

alter table public.setup_import_checks enable row level security;
grant all on table public.setup_import_checks to service_role;

comment on table public.setup_import_checks is
  'Tracks every Garage61 race event the setup-import bookmarklet has visited, whether or not a setup was captured -- lets app/api/setup/garage61-import/pending skip recently-checked events instead of revisiting them (and their several Garage61 API calls) on every "Atualizar Dados" click.';
