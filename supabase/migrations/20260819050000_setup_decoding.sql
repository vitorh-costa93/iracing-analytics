alter table public.setup_files
  add column if not exists decoded_car_name text,
  add column if not exists decoded_params jsonb,
  add column if not exists decoded_at timestamptz,
  add column if not exists decoder text,
  add column if not exists external_decode_consent_at timestamptz;

alter table public.setup_files drop constraint if exists setup_files_source_check;
alter table public.setup_files add constraint setup_files_source_check
  check (source in ('manual_commercial', 'manual_upload', 'garage61'));

comment on column public.setup_files.external_decode_consent_at is
  'Timestamp of explicit consent to transmit this file to the external decoder.';
