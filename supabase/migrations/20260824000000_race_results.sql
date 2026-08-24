create table if not exists public.race_results (
  id uuid primary key default gen_random_uuid(),
  irstats_race_id bigint not null unique,
  driver_id uuid not null references public.drivers(id) on delete cascade,
  raced_at timestamptz not null,
  series_name text not null,
  track_name text not null,
  car_name text not null,
  car_id integer references public.cars(id),
  track_id integer references public.tracks(id),
  category text not null check (category in ('formula_car', 'sports_car')),
  season_week integer,
  license_class text not null,
  safety_rating numeric not null,
  irating_display text not null,
  irating_delta integer not null,
  grid_position integer,
  finish_position integer not null,
  position_change integer,
  laps integer,
  laps_led integer,
  fastest_lap_time text,
  incidents integer,
  points integer,
  sof integer,
  imported_at timestamptz not null default now()
);

create index if not exists idx_race_results_driver_raced_at
  on public.race_results (driver_id, raced_at desc);

create index if not exists idx_race_results_driver_category
  on public.race_results (driver_id, category);

alter table public.race_results enable row level security;
grant all on table public.race_results to service_role;

comment on table public.race_results is
  'Official race results scraped from irstats.com (public, no API). irating_delta is exact; irating_display is the rounded value irstats shows and must never be used for calculation — see v_race_results_irating for exact reconstructed iRating via delta-chaining from the Garage61 ratings anchor.';
