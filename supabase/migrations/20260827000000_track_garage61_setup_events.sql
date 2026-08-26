-- The browser-side Garage61 importer used to revisit every recent event even after its setup had
-- been persisted. Retain the originating event ID so the recurring path can skip completed work.
alter table public.setup_files
  add column if not exists garage61_event_id text;

create index if not exists setup_files_driver_garage61_event_idx
  on public.setup_files (driver_id, garage61_event_id)
  where garage61_event_id is not null;

comment on column public.setup_files.garage61_event_id is
  'Garage61 event captured by the browser importer; used only as an incremental-sync checkpoint.';
