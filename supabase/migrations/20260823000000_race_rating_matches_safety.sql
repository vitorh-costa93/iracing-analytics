alter table public.race_rating_matches
  add column if not exists previous_safety_rating integer,
  add column if not exists new_safety_rating integer,
  add column if not exists delta_safety_rating integer;

comment on column public.race_rating_matches.delta_safety_rating is
  'Safety Rating change that occurred at the same rating_at timestamp as the matched iRating change, looked up via same-timestamp Garage61 rating_history snapshots (irating and safety_rating are synced together) rather than a separate greedy match. Null when no same-timestamp Safety Rating snapshot pair was found.';
