create table if not exists public.official_series_results (
  id bigint generated always as identity primary key,
  driver_id uuid not null references public.drivers(id) on delete cascade,
  season_id integer not null,
  season_name text not null,
  rating_category text not null check (rating_category in ('formula_car', 'sports_car')),
  series_name text not null,
  starts integer not null default 0 check (starts >= 0),
  wins integer not null default 0 check (wins >= 0 and wins <= starts),
  source text not null default 'iracing_results_archive',
  captured_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (driver_id, season_id, series_name)
);

create index if not exists idx_official_series_results_driver_season_category
  on public.official_series_results (driver_id, season_id, rating_category);

alter table public.official_series_results enable row level security;

grant all on table public.official_series_results to service_role;
grant all on sequence public.official_series_results_id_seq to service_role;

with selected_driver as (
  select id
  from public.drivers
  order by updated_at desc
  limit 1
), seed(season_id, season_name, rating_category, series_name, starts, wins) as (
  values
    (34, '2026 Season 3', 'formula_car', 'Formula B - Super Formula Series', 22, 12),
    (34, '2026 Season 3', 'formula_car', 'Formula B - Super Formula Series - Fixed', 19, 8),
    (33, '2026 Season 2', 'formula_car', 'Formula B - Super Formula Series', 17, 5),
    (33, '2026 Season 2', 'formula_car', 'Formula B - Super Formula Series - Fixed', 19, 10),
    (33, '2026 Season 2', 'formula_car', 'Formula C - Super Formula Lights - Fixed', 2, 1),
    (34, '2026 Season 3', 'sports_car', 'GT3 Challenge Fixed by Fanatec', 15, 1),
    (33, '2026 Season 2', 'sports_car', 'GT3 Challenge Fixed by Fanatec', 11, 0),
    (34, '2026 Season 3', 'sports_car', 'GT Sprint Series by Simucube', 5, 0),
    (34, '2026 Season 3', 'sports_car', 'IMSA iRacing Series', 16, 0),
    (34, '2026 Season 3', 'sports_car', 'IMSA iRacing Series - Fixed', 12, 1),
    (33, '2026 Season 2', 'sports_car', 'IMSA iRacing Series - Fixed', 6, 1)
)
insert into public.official_series_results (
  driver_id, season_id, season_name, rating_category, series_name, starts, wins
)
select d.id, s.season_id, s.season_name, s.rating_category, s.series_name, s.starts, s.wins
from selected_driver d
cross join seed s
on conflict (driver_id, season_id, series_name) do update set
  season_name = excluded.season_name,
  rating_category = excluded.rating_category,
  starts = excluded.starts,
  wins = excluded.wins,
  source = excluded.source,
  captured_at = now(),
  updated_at = now();
