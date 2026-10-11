-- Indexes for the UI (race field by track / by license category, newest first).
create index if not exists race_field_events_track_start on public.race_field_events(track_id,start_time desc);
create index if not exists race_field_events_category_start on public.race_field_events(license_category,start_time desc);
