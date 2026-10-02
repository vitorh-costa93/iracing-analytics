-- Best lap of the driver's own class in the race (any driver, from the iRStats results table).
-- Reference for the Overview "gap" indicator: the race winner is not always the fastest driver
-- (e.g. a duel that ends in contact), so winner_fastest_lap_time misleads. Filled by the iRStats
-- ingest; older rows are filled by a one-time bookmarklet backfill.
alter table public.race_results
  add column if not exists class_fastest_lap_time text;

comment on column public.race_results.class_fastest_lap_time is
  'Fastest lap among all finishers of this driver''s own class (whole field when single-class), from the iRStats results table.';
