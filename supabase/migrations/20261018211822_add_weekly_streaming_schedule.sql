create table if not exists nossa_proxima_serie.weekly_arrivals (
 show_id bigint primary key,
 name text not null,
 service text not null,
 premiere_date date not null,
 episode_name text,
 poster_url text,
 tvmaze_url text,
 updated_at timestamptz not null default now()
);
create index if not exists weekly_arrivals_date_idx on nossa_proxima_serie.weekly_arrivals(premiere_date desc);
alter table nossa_proxima_serie.weekly_arrivals enable row level security;
revoke all on nossa_proxima_serie.weekly_arrivals from public,anon,authenticated;
grant all on nossa_proxima_serie.weekly_arrivals to service_role;
comment on table nossa_proxima_serie.weekly_arrivals is 'TVmaze streaming episode schedule; NOT verified Brazilian catalog additions.';
