-- 08/09/2026: substitui o hardcode em lib/race-retirement-events.ts que marcava UMA corrida
-- específica (Silverstone, SF23, 04/09/2026) como "tow confirmado pelo piloto" comparando a data
-- literal no código-fonte. O piloto pediu explicitamente pra generalizar isso -- "usei pra orientar
-- e entender o que é tow, e aí replicar isso para outros registros" -- então vira uma tabela de
-- verdade em vez de uma constante. Casa a corrida do mesmo jeito que o hardcode fazia (carro + pista
-- + janela de tempo), só que a partir de uma linha aqui em vez de uma data escrita no código.
create table if not exists public.confirmed_race_events (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers(id) on delete cascade,
  raced_at timestamptz not null,
  car_name text not null,
  track_name text not null,
  type text not null default 'tow',
  note text,
  created_at timestamptz not null default now()
);

create index if not exists confirmed_race_events_driver_idx
  on public.confirmed_race_events(driver_id, raced_at);

comment on table public.confirmed_race_events is
  'Eventos que o próprio piloto confirmou fora da telemetria (ex.: abandono/tow, contato, falha mecânica). Casado com race_results/v_race_results_irating por carro+pista+horário aproximado em lib/race-retirement-events.ts. Para registrar um novo evento: insert into public.confirmed_race_events (driver_id, raced_at, car_name, track_name, type, note) values (''<driver_id>'', ''<timestamptz da corrida>'', ''<car_name exato de v_race_results_irating>'', ''<track_name exato>'', ''tow'', ''nota opcional'');';

-- Migra o único registro que estava hardcoded, preservando o fato (o abandono realmente aconteceu),
-- só que agora como dado em vez de código.
insert into public.confirmed_race_events (driver_id, raced_at, car_name, track_name, type, note)
values (
  'ffe1f80f-27c4-44a9-afa2-6574d196908a',
  '2026-09-04T18:30:00.000Z',
  'Super Formula SF23 - Honda',
  'Silverstone Circuit',
  'tow',
  'Migrado do hardcode em lib/race-retirement-events.ts (removido em 08/09/2026).'
)
on conflict do nothing;
