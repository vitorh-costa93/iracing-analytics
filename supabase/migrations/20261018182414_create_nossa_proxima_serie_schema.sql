create schema if not exists nossa_proxima_serie;
create table if not exists nossa_proxima_serie.titles (
 id text primary key,
 name text not null,
 original_name text,
 category text not null check(category in ('suspense','comedia','fantasia','drama')),
 streaming text not null check(streaming in ('netflix','prime','apple','max')),
 synopsis text not null default '',
 reason text not null default '',
 seasons integer,
 poster_url text,
 created_at timestamptz not null default now()
);
create table if not exists nossa_proxima_serie.reviews (
 title_id text not null references nossa_proxima_serie.titles(id) on delete cascade,
 person text not null check(person in ('eu','esposa')),
 status text not null check(status in ('gostei','nao_gostei','assistindo','quero_assistir')),
 rating smallint check(rating between 1 and 5),
 updated_at timestamptz not null default now(),
 primary key(title_id,person)
);
create table if not exists nossa_proxima_serie.settings (
 key text primary key,
 value jsonb not null,
 updated_at timestamptz not null default now()
);
create index if not exists titles_category_streaming_idx on nossa_proxima_serie.titles(category,streaming);
alter table nossa_proxima_serie.titles enable row level security;
alter table nossa_proxima_serie.reviews enable row level security;
alter table nossa_proxima_serie.settings enable row level security;
revoke all on schema nossa_proxima_serie from public, anon, authenticated;
revoke all on all tables in schema nossa_proxima_serie from public, anon, authenticated;
grant usage on schema nossa_proxima_serie to service_role;
grant all on all tables in schema nossa_proxima_serie to service_role;
comment on schema nossa_proxima_serie is 'Isolated shared household series recommender. Server-side access only; no public Data API exposure.';
