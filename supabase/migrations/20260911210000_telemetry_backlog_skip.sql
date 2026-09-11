-- 11/09/2026: "zere esse backlog de telemetrias para só começar a puxar as novas daqui pra frente" --
-- lib/telemetry-backfill.ts already excludes laps outside the current/previous-season retention
-- window, but that still left thousands of in-window laps (2026 Season 2/3) queued up from BEFORE this
-- driver asked to stop backfilling old history, competing with genuinely new laps for the same small
-- per-run batch (BATCH=24). telemetry_skip marks a lap as intentionally excluded from the backfill --
-- non-destructive (no rows deleted, no existing telemetry removed), and reversible by flipping it back
-- to false for any lap that turns out to matter after all.
alter table laps add column if not exists telemetry_skip boolean not null default false;

update laps
set telemetry_skip = true
where can_view_telemetry = true
  and telemetry_path is null;
