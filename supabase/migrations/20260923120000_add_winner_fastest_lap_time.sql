-- Best lap of the winner of the driver's own class (overall winner in single-class races; first
-- finisher of the same GTP/LMP2/GT3/... class in multiclass races). Distinct from
-- race_fastest_lap_time, the outright fastest lap, which can belong to a non-winner or another
-- class. Filled going forward only by app/api/sync/irstats/route.ts; older rows stay null unless
-- the user explicitly requests a historical re-scan.
alter table public.race_results
  add column if not exists winner_fastest_lap_time text;
