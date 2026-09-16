-- A durable, user-maintained season calendar replaces the static UNION view. The application
-- imports an official iRacing PDF locally, validates its three selected schedules, and then calls
-- import_season_calendar atomically with the structured result. No PDF is stored in Supabase.
create table if not exists public.season_calendars (
  season_id text primary key,
  season_name text not null,
  season_start timestamptz not null,
  source_file_name text,
  source_sha256 text,
  source_uploaded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint season_calendars_name_format check (season_name ~ '^20[0-9]{2} Season [1-4]$'),
  constraint season_calendars_source_hash check (source_sha256 is null or source_sha256 ~ '^[0-9a-f]{64}$')
);

create table if not exists public.season_week_contexts (
  season_id text not null references public.season_calendars(season_id) on delete cascade,
  week_number integer not null check (week_number between 1 and 12),
  context_key text not null check (context_key in ('sf23', 'imsa', 'gt3')),
  series_name text not null,
  track_name text not null,
  track_match_terms text[] not null check (cardinality(track_match_terms) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (season_id, week_number, context_key)
);

create index if not exists season_week_contexts_season_week_idx on public.season_week_contexts (season_id, week_number);

insert into public.season_calendars (season_id, season_name, season_start, source_file_name, source_uploaded_at)
values
  ('31', '2025 Season 4', '2025-09-16 00:00:00+00', 'historical-calendar', now()),
  ('32', '2026 Season 1', '2025-12-16 00:00:00+00', 'historical-calendar', now()),
  ('33', '2026 Season 2', '2026-03-17 00:00:00+00', 'historical-calendar', now()),
  ('34', '2026 Season 3', '2026-06-16 00:00:00+00', 'historical-calendar', now()),
  ('35', '2026 Season 4', '2026-09-15 00:00:00+00', '2026s4.pdf', now())
on conflict (season_id) do nothing;

-- Existing Season 4 contexts are seeded before the UI starts reading this table. They are the
-- same official open SF23 / open IMSA / official GT3 Challenge schedule previously hardcoded in
-- lib/season-calendar.ts. Layout suffixes are intentionally omitted for historical matching.
insert into public.season_week_contexts (season_id, week_number, context_key, series_name, track_name, track_match_terms)
values
('35',1,'sf23','Super Formula 23','Autódromo José Carlos Pace',array['Autódromo José Carlos Pace','Interlagos']),
('35',1,'imsa','IMSA','Indianapolis Motor Speedway',array['Indianapolis Motor Speedway']),
('35',1,'gt3','GT3 Challenge','Silverstone Circuit',array['Silverstone Circuit']),
('35',2,'sf23','Super Formula 23','Miami International Autodrome',array['Miami International Autodrome']),
('35',2,'imsa','IMSA','Road Atlanta',array['Road Atlanta']),
('35',2,'gt3','GT3 Challenge','Road Atlanta',array['Road Atlanta']),
('35',3,'sf23','Super Formula 23','Red Bull Ring',array['Red Bull Ring']),
('35',3,'imsa','IMSA','Fuji International Speedway',array['Fuji International Speedway']),
('35',3,'gt3','GT3 Challenge','Circuit Zandvoort',array['Circuit Zandvoort']),
('35',4,'sf23','Super Formula 23','Sebring International Raceway',array['Sebring International Raceway']),
('35',4,'imsa','IMSA','Red Bull Ring',array['Red Bull Ring']),
('35',4,'gt3','GT3 Challenge','Mobility Resort Motegi',array['Mobility Resort Motegi']),
('35',5,'sf23','Super Formula 23','Autodromo Internazionale Enzo e Dino Ferrari',array['Autodromo Internazionale Enzo e Dino Ferrari','Imola']),
('35',5,'imsa','IMSA','Long Beach Street Circuit',array['Long Beach Street Circuit']),
('35',5,'gt3','GT3 Challenge','Indianapolis Motor Speedway',array['Indianapolis Motor Speedway']),
('35',6,'sf23','Super Formula 23','Circuit de Spa-Francorchamps',array['Circuit de Spa-Francorchamps','Spa']),
('35',6,'imsa','IMSA','Circuit Gilles Villeneuve',array['Circuit Gilles Villeneuve','Montreal']),
('35',6,'gt3','GT3 Challenge','Shell V-Power Motorsport Park at The Bend',array['Shell V-Power Motorsport Park at The Bend','The Bend']),
('35',7,'sf23','Super Formula 23','Road Atlanta',array['Road Atlanta']),
('35',7,'imsa','IMSA','Circuit des 24 Heures du Mans',array['Circuit des 24 Heures du Mans','Le Mans']),
('35',7,'gt3','GT3 Challenge','Circuit of the Americas',array['Circuit of the Americas','COTA']),
('35',8,'sf23','Super Formula 23','Hockenheimring Baden-Württemberg',array['Hockenheimring Baden-Württemberg']),
('35',8,'imsa','IMSA','Autódromo Hermanos Rodríguez',array['Autódromo Hermanos Rodríguez','Mexico']),
('35',8,'gt3','GT3 Challenge','Circuit de Spa-Francorchamps',array['Circuit de Spa-Francorchamps','Spa']),
('35',9,'sf23','Super Formula 23','Fuji International Speedway',array['Fuji International Speedway']),
('35',9,'imsa','IMSA','Suzuka International Racing Course',array['Suzuka International Racing Course']),
('35',9,'gt3','GT3 Challenge','Fuji International Speedway',array['Fuji International Speedway']),
('35',10,'sf23','Super Formula 23','Watkins Glen International',array['Watkins Glen International']),
('35',10,'imsa','IMSA','Silverstone Circuit',array['Silverstone Circuit']),
('35',10,'gt3','GT3 Challenge','Misano World Circuit Marco Simoncelli',array['Misano World Circuit Marco Simoncelli']),
('35',11,'sf23','Super Formula 23','Circuit Gilles Villeneuve',array['Circuit Gilles Villeneuve','Montreal']),
('35',11,'imsa','IMSA','Sebring International Raceway',array['Sebring International Raceway']),
('35',11,'gt3','GT3 Challenge','Sebring International Raceway',array['Sebring International Raceway']),
('35',12,'sf23','Super Formula 23','Suzuka International Racing Course',array['Suzuka International Racing Course']),
('35',12,'imsa','IMSA','Autodromo Nazionale Monza',array['Autodromo Nazionale Monza','Monza']),
('35',12,'gt3','GT3 Challenge','Suzuka International Racing Course',array['Suzuka International Racing Course'])
on conflict (season_id, week_number, context_key) do nothing;

create or replace view public.v_season_calendar as
select season_id, season_name, season_start
from public.season_calendars;

comment on view public.v_season_calendar is
  'Season id/name/start-date calendar shared by analytical views. Rows are managed through season_calendars, including official PDF imports.';

create or replace function public.import_season_calendar(
  p_season_id text,
  p_season_name text,
  p_season_start timestamptz,
  p_source_file_name text,
  p_source_sha256 text,
  p_contexts jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  context_count integer;
  distinct_context_count integer;
begin
  if p_season_id !~ '^\d+$' or p_season_name !~ '^20[0-9]{2} Season [1-4]$' then
    raise exception 'Invalid season identity';
  end if;
  if p_source_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid calendar source hash';
  end if;
  if jsonb_typeof(p_contexts) <> 'array' or jsonb_array_length(p_contexts) <> 36 then
    raise exception 'A calendar import requires 36 contexts';
  end if;

  select count(*), count(distinct (week_number, context_key))
  into context_count, distinct_context_count
  from jsonb_to_recordset(p_contexts) as item(
    week_number integer,
    context_key text,
    series_name text,
    track_name text,
    track_match_terms jsonb
  );
  if context_count <> 36 or distinct_context_count <> 36 then
    raise exception 'Calendar contexts are incomplete or duplicated';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_contexts) as item(week_number integer, context_key text, series_name text, track_name text, track_match_terms jsonb)
    where week_number not between 1 and 12
      or context_key not in ('sf23', 'imsa', 'gt3')
      or coalesce(trim(series_name), '') = ''
      or coalesce(trim(track_name), '') = ''
      or jsonb_typeof(track_match_terms) <> 'array'
      or jsonb_array_length(track_match_terms) = 0
  ) then
    raise exception 'Calendar contains an invalid context';
  end if;

  insert into public.season_calendars (season_id, season_name, season_start, source_file_name, source_sha256, source_uploaded_at, updated_at)
  values (p_season_id, p_season_name, p_season_start, p_source_file_name, p_source_sha256, now(), now())
  on conflict (season_id) do update set
    season_name = excluded.season_name,
    season_start = excluded.season_start,
    source_file_name = excluded.source_file_name,
    source_sha256 = excluded.source_sha256,
    source_uploaded_at = excluded.source_uploaded_at,
    updated_at = now();

  delete from public.season_week_contexts where season_id = p_season_id;
  insert into public.season_week_contexts (season_id, week_number, context_key, series_name, track_name, track_match_terms, updated_at)
  select p_season_id, item.week_number, item.context_key, trim(item.series_name), trim(item.track_name),
    array(select jsonb_array_elements_text(item.track_match_terms)), now()
  from jsonb_to_recordset(p_contexts) as item(week_number integer, context_key text, series_name text, track_name text, track_match_terms jsonb);
end;
$$;

revoke all on function public.import_season_calendar(text, text, timestamptz, text, text, jsonb) from public;
grant execute on function public.import_season_calendar(text, text, timestamptz, text, text, jsonb) to service_role;
