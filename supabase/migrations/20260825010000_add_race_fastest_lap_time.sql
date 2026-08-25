-- Race-wide fastest lap (any driver, not this driver's own), used as a fixed per-race pace
-- reference to estimate race duration (laps completed × race's fastest lap) — needed because a
-- driver who DNFs before setting any timed lap of their own has laps=0 and no personal reference
-- pace, but 0 laps × any pace still correctly yields ~0 minutes, showing up as an early exit
-- instead of being silently excluded from the Race Survival chart.
alter table public.race_results
  add column if not exists race_fastest_lap_time text;

comment on column public.race_results.race_fastest_lap_time is
  'The overall fastest lap of the race (any driver), from irstats'' "Fastest Lap" stat — distinct from fastest_lap_time, which is this driver''s own best lap.';
