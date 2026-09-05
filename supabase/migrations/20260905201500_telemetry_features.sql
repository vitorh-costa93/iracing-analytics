create table if not exists public.telemetry_features (
  lap_id uuid primary key references public.laps(id) on delete cascade,
  samples integer not null default 0,
  throttle_mean double precision,
  throttle_stddev double precision,
  brake_mean double precision,
  brake_stddev double precision,
  steering_mean double precision,
  steering_stddev double precision,
  throttle_smoothness double precision,
  brake_smoothness double precision,
  steering_smoothness double precision,
  speed_mean double precision,
  available_columns text[] not null default '{}',
  parser_version text not null default 'v1',
  created_at timestamptz not null default now()
);
create index if not exists telemetry_features_created_at_idx on public.telemetry_features(created_at);
