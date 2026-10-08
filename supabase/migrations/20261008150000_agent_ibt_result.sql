-- Agent result extracted from iRacing SessionInfo (kind 'ibt_result', result_source 'iracing_ibt').
-- The iRating change of these rows is an ESTIMATE (Elo-like formula applied to the SessionInfo
-- grid); official_irating_* stay null. Precedence on race_results (one row per subsession):
--   iracing_agent (official JSON) > irstats (real deltas) > iracing_ibt (estimate)
--   * 'ibt_result' inserts only when no row exists, and may refresh only its own 'iracing_ibt' row;
--   * the official JSON ('result') keeps overwriting any row, including 'iracing_ibt';
--   * the iRStats upsert sets result_source='irstats' and so replaces an estimate; it still
--     cannot touch an 'iracing_agent' row (trigger below).
-- Same admission path (agent_reserve: daily/minute budget, 128 KiB cap), same signature.
create or replace function public.agent_commit(p_device uuid,p_key text,p_lease uuid,p_kind text,p_row jsonb,p_session jsonb default null)
returns void language plpgsql set search_path=public,pg_temp as $$
declare d agent_devices; l laps; s driving_sessions; rr race_results;
begin
 select * into d from agent_devices where id=p_device and enabled;
 if not found then raise exception 'disabled device'; end if;
 perform 1 from agent_receipts where device_id=p_device and key=p_key and lease=p_lease and state='pending' for update;
 if not found then raise exception 'invalid lease'; end if;
 perform set_config('app.agent_write','1',true);
 if p_kind='result' then
  rr:=jsonb_populate_record(null::race_results,p_row);
  if rr.driver_id<>d.driver_id then raise exception 'identity mismatch'; end if;
  insert into race_results(irstats_race_id,driver_id,raced_at,series_name,track_name,car_name,car_id,track_id,category,season_week,license_class,safety_rating,irating_display,irating_delta,grid_position,finish_position,class_finish_position,position_change,laps,laps_led,fastest_lap_time,race_fastest_lap_time,winner_fastest_lap_time,class_fastest_lap_time,incidents,points,sof,result_source,official_irating_before,official_irating_after)
  values(rr.irstats_race_id,d.driver_id,rr.raced_at,rr.series_name,rr.track_name,rr.car_name,rr.car_id,rr.track_id,rr.category,rr.season_week,rr.license_class,rr.safety_rating,rr.irating_display,rr.irating_delta,rr.grid_position,rr.finish_position,rr.class_finish_position,rr.position_change,rr.laps,rr.laps_led,rr.fastest_lap_time,rr.race_fastest_lap_time,rr.winner_fastest_lap_time,rr.class_fastest_lap_time,rr.incidents,rr.points,rr.sof,'iracing_agent',rr.official_irating_before,rr.official_irating_after)
  on conflict(irstats_race_id) do update set
   raced_at=excluded.raced_at,series_name=excluded.series_name,track_name=excluded.track_name,car_name=excluded.car_name,
   car_id=excluded.car_id,track_id=excluded.track_id,category=excluded.category,season_week=excluded.season_week,
   license_class=excluded.license_class,safety_rating=excluded.safety_rating,irating_display=excluded.irating_display,
   irating_delta=excluded.irating_delta,grid_position=excluded.grid_position,finish_position=excluded.finish_position,
   class_finish_position=excluded.class_finish_position,position_change=excluded.position_change,laps=excluded.laps,laps_led=excluded.laps_led,
   fastest_lap_time=excluded.fastest_lap_time,race_fastest_lap_time=excluded.race_fastest_lap_time,
   winner_fastest_lap_time=excluded.winner_fastest_lap_time,class_fastest_lap_time=excluded.class_fastest_lap_time,
   incidents=excluded.incidents,points=excluded.points,sof=excluded.sof,result_source='iracing_agent',
   official_irating_before=excluded.official_irating_before,official_irating_after=excluded.official_irating_after,imported_at=now()
   where race_results.driver_id=d.driver_id;
 elsif p_kind='ibt_result' then
  rr:=jsonb_populate_record(null::race_results,p_row);
  if rr.driver_id<>d.driver_id then raise exception 'identity mismatch'; end if;
  insert into race_results(irstats_race_id,driver_id,raced_at,series_name,track_name,car_name,car_id,track_id,category,season_week,license_class,safety_rating,irating_display,irating_delta,grid_position,finish_position,class_finish_position,position_change,laps,laps_led,fastest_lap_time,race_fastest_lap_time,winner_fastest_lap_time,class_fastest_lap_time,incidents,points,sof,result_source,official_irating_before,official_irating_after)
  values(rr.irstats_race_id,d.driver_id,rr.raced_at,rr.series_name,rr.track_name,rr.car_name,rr.car_id,rr.track_id,rr.category,rr.season_week,rr.license_class,rr.safety_rating,rr.irating_display,rr.irating_delta,rr.grid_position,rr.finish_position,rr.class_finish_position,rr.position_change,rr.laps,rr.laps_led,rr.fastest_lap_time,rr.race_fastest_lap_time,rr.winner_fastest_lap_time,rr.class_fastest_lap_time,rr.incidents,null,rr.sof,'iracing_ibt',null,null)
  on conflict(irstats_race_id) do update set
   raced_at=excluded.raced_at,series_name=excluded.series_name,track_name=excluded.track_name,car_name=excluded.car_name,
   car_id=excluded.car_id,track_id=excluded.track_id,category=excluded.category,season_week=excluded.season_week,
   license_class=excluded.license_class,safety_rating=excluded.safety_rating,irating_display=excluded.irating_display,
   irating_delta=excluded.irating_delta,grid_position=excluded.grid_position,finish_position=excluded.finish_position,
   class_finish_position=excluded.class_finish_position,position_change=excluded.position_change,laps=excluded.laps,laps_led=excluded.laps_led,
   fastest_lap_time=excluded.fastest_lap_time,race_fastest_lap_time=excluded.race_fastest_lap_time,
   winner_fastest_lap_time=excluded.winner_fastest_lap_time,class_fastest_lap_time=excluded.class_fastest_lap_time,
   incidents=excluded.incidents,sof=excluded.sof,imported_at=now()
   where race_results.driver_id=d.driver_id and race_results.result_source='iracing_ibt';
 elsif p_kind='telemetry' then
  l:=jsonb_populate_record(null::laps,p_row); s:=jsonb_populate_record(null::driving_sessions,p_session);
  if l.driver_id<>d.driver_id or s.driver_id<>d.driver_id then raise exception 'identity mismatch'; end if;
  insert into laps(id,driver_id,car_id,track_id,lap_number,lap_time,clean,fuel_level,fuel_used,can_view_telemetry,telemetry_path,garage61_payload,created_at,data_source)
  values(l.id,d.driver_id,l.car_id,l.track_id,l.lap_number,l.lap_time,l.clean,l.fuel_level,l.fuel_used,true,l.telemetry_path,l.garage61_payload,l.created_at,'iracing_agent') on conflict(id) do nothing;
  insert into driving_sessions(driver_id,garage61_event_id,garage61_session_id,car_id,track_id,season_id,season_name,session_type,started_at,ended_at,lap_count,data_source)
  values(d.driver_id,s.garage61_event_id,s.garage61_session_id,s.car_id,s.track_id,s.season_id,s.season_name,s.session_type,s.started_at,s.ended_at,1,'iracing_agent')
  on conflict(driver_id,garage61_event_id,garage61_session_id,car_id,track_id) do update set ended_at=greatest(driving_sessions.ended_at,excluded.ended_at),lap_count=(select count(*) from laps where driver_id=d.driver_id and garage61_payload->>'event'=s.garage61_event_id and garage61_payload->>'nativeSession'=s.garage61_session_id);
 else raise exception 'unknown kind'; end if;
 update agent_receipts set state='done' where device_id=p_device and key=p_key and lease=p_lease;
end $$;

-- Defense in depth: an official agent row is never downgraded to an estimate, even by a write
-- flagged as agent_write; non-agent writers still cannot change it at all.
create or replace function public.protect_native_result() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if old.result_source='iracing_agent' and new.result_source is distinct from 'iracing_agent' and current_setting('app.agent_write',true)='1' then return old; end if;
 if old.result_source='iracing_agent' and current_setting('app.agent_write',true) is distinct from '1' then return old; end if;
 return new;
end $$;
revoke all on function public.agent_commit(uuid,text,uuid,text,jsonb,jsonb),public.protect_native_result() from public,anon,authenticated;
grant execute on function public.agent_commit(uuid,text,uuid,text,jsonb,jsonb) to service_role;
