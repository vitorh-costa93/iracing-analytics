-- Agent reference laps (13/10/2026): the agent reads another driver's reference .ibt from the local setups folder and
-- sends only its fastest clean lap as CSV. One reference per driver/car/track (upsert, no Storage growth). A reference
-- uploaded manually in the UI is never overwritten: only rows the agent wrote itself ('agent:' filename) are replaced.
create or replace function public.agent_commit_reference(p_device uuid,p_key text,p_lease uuid,p_row jsonb)
returns void language plpgsql set search_path=public,pg_temp as $$
declare d agent_devices; r telemetry_references;
begin
 select * into d from agent_devices where id=p_device and enabled;
 if not found then raise exception 'disabled device'; end if;
 perform 1 from agent_receipts where device_id=p_device and key=p_key and lease=p_lease and state='pending' for update;
 if not found then raise exception 'invalid lease'; end if;
 r:=jsonb_populate_record(null::telemetry_references,p_row);
 if r.driver_id<>d.driver_id then raise exception 'identity mismatch'; end if;
 if r.original_filename not like 'agent:%' then raise exception 'invalid reference'; end if;
 insert into telemetry_references(driver_id,car_id,track_id,storage_path,original_filename,file_size,channels,sample_count,uploaded_at)
 values(d.driver_id,r.car_id,r.track_id,r.storage_path,r.original_filename,r.file_size,r.channels,r.sample_count,now())
 on conflict(driver_id,car_id,track_id) do update set storage_path=excluded.storage_path,original_filename=excluded.original_filename,
  file_size=excluded.file_size,channels=excluded.channels,sample_count=excluded.sample_count,uploaded_at=now()
  where telemetry_references.original_filename like 'agent:%';
 update agent_receipts set state='done' where device_id=p_device and key=p_key and lease=p_lease;
end $$;
revoke all on function public.agent_commit_reference(uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.agent_commit_reference(uuid,text,uuid,jsonb) to service_role;
