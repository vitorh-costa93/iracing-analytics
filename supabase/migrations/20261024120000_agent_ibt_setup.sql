-- Agent IBT setups (24/10/2026): the agent sends the CarSetup section of the driver's own .ibt as
-- `kind: "ibt_setup"` (agent/README.md). The server stores it in setup_files with source 'ibt_setup',
-- decoded_params in the same normalized format the Garage61 import writes, and NO Storage object:
-- storage_path is a virtual unique id ('ibt_setup/...'), never downloaded. Additive only.
alter table public.setup_files drop constraint if exists setup_files_source_check;
alter table public.setup_files add constraint setup_files_source_check
  check (source in ('manual_commercial', 'manual_upload', 'garage61', 'ibt_setup'));

-- Commits an admitted ibt_setup receipt (same lease protocol as agent_commit / agent_commit_reference).
-- Upsert by the vault identity; only rows the agent wrote itself are ever updated.
create or replace function public.agent_commit_setup(p_device uuid,p_key text,p_lease uuid,p_row jsonb)
returns void language plpgsql set search_path=public,pg_temp as $$
declare d agent_devices; r setup_files;
begin
 select * into d from agent_devices where id=p_device and enabled;
 if not found then raise exception 'disabled device'; end if;
 perform 1 from agent_receipts where device_id=p_device and key=p_key and lease=p_lease and state='pending' for update;
 if not found then raise exception 'invalid lease'; end if;
 r:=jsonb_populate_record(null::setup_files,p_row);
 if r.driver_id<>d.driver_id then raise exception 'identity mismatch'; end if;
 if r.source<>'ibt_setup' or r.setup_kind not in ('fixed','unknown') or r.storage_path not like 'ibt_setup/%'
    or jsonb_typeof(r.decoded_params)<>'array' or jsonb_array_length(r.decoded_params) not between 1 and 800 then raise exception 'invalid setup'; end if;
 insert into setup_files(driver_id,season_id,car_id,track_id,source,setup_kind,filename,storage_path,file_size,decoded_car_name,decoded_params,decoded_at,decoder,updated_at)
 values(d.driver_id,r.season_id,r.car_id,r.track_id,'ibt_setup',r.setup_kind,r.filename,r.storage_path,r.file_size,r.decoded_car_name,r.decoded_params,now(),'iracing_ibt',now())
 on conflict(driver_id,season_id,car_id,track_id,filename) do update set setup_kind=excluded.setup_kind,decoded_params=excluded.decoded_params,
  file_size=excluded.file_size,decoded_at=now(),updated_at=now()
  where setup_files.source='ibt_setup';
 update agent_receipts set state='done' where device_id=p_device and key=p_key and lease=p_lease;
end $$;
revoke all on function public.agent_commit_setup(uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.agent_commit_setup(uuid,text,uuid,jsonb) to service_role;
