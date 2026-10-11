-- Backfill histórico (11/10/2026): o resultado oficial do agente sobrescreve a corrida vinda do iRStats
-- (mesma chave irstats_race_id = subsession_id), mas sem apagar com NULL campos que só o iRStats tinha.
-- Guard-rails inalterados; assinatura idêntica à anterior.
create or replace function public.agent_commit(p_device uuid,p_key text,p_lease uuid,p_kind text,p_row jsonb,p_session jsonb default null)
returns void language plpgsql set search_path=public,pg_temp as $$
declare d agent_devices; l laps; s driving_sessions; rr race_results; ev race_field_events;
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
   car_id=coalesce(excluded.car_id,race_results.car_id),track_id=coalesce(excluded.track_id,race_results.track_id),category=excluded.category,season_week=coalesce(excluded.season_week,race_results.season_week),
   license_class=excluded.license_class,safety_rating=excluded.safety_rating,irating_display=excluded.irating_display,
   irating_delta=excluded.irating_delta,grid_position=excluded.grid_position,finish_position=excluded.finish_position,
   class_finish_position=excluded.class_finish_position,position_change=excluded.position_change,laps=excluded.laps,laps_led=excluded.laps_led,
   fastest_lap_time=coalesce(excluded.fastest_lap_time,race_results.fastest_lap_time),race_fastest_lap_time=coalesce(excluded.race_fastest_lap_time,race_results.race_fastest_lap_time),
   winner_fastest_lap_time=coalesce(excluded.winner_fastest_lap_time,race_results.winner_fastest_lap_time),class_fastest_lap_time=coalesce(excluded.class_fastest_lap_time,race_results.class_fastest_lap_time),
   incidents=excluded.incidents,points=coalesce(excluded.points,race_results.points),sof=coalesce(excluded.sof,race_results.sof),result_source='iracing_agent',
   official_irating_before=excluded.official_irating_before,official_irating_after=excluded.official_irating_after,imported_at=now()
   where race_results.driver_id=d.driver_id;
  if p_session is not null and p_session ? 'event' then
   ev:=jsonb_populate_record(null::race_field_events,p_session->'event');
   if ev.subsession_id is distinct from rr.irstats_race_id then raise exception 'field identity mismatch'; end if;
   if jsonb_typeof(p_session->'field')<>'array' or jsonb_array_length(p_session->'field')>384 then raise exception 'invalid field'; end if;
   insert into race_field_events(subsession_id,my_cust_id,series_id,series_name,season_year,season_quarter,race_week,track_id,track_name,track_config,start_time,license_category,sof,num_drivers,num_cautions,num_caution_laps,num_lead_changes,event_average_lap,event_best_lap_time,weather,track_state,session_splits)
   values(ev.subsession_id,d.customer_id,ev.series_id,ev.series_name,ev.season_year,ev.season_quarter,ev.race_week,ev.track_id,ev.track_name,ev.track_config,ev.start_time,ev.license_category,ev.sof,ev.num_drivers,ev.num_cautions,ev.num_caution_laps,ev.num_lead_changes,ev.event_average_lap,ev.event_best_lap_time,coalesce(ev.weather,'{}'::jsonb),coalesce(ev.track_state,'{}'::jsonb),coalesce(ev.session_splits,'[]'::jsonb))
   on conflict(subsession_id) do update set
    series_id=excluded.series_id,series_name=excluded.series_name,season_year=excluded.season_year,season_quarter=excluded.season_quarter,
    race_week=excluded.race_week,track_id=excluded.track_id,track_name=excluded.track_name,track_config=excluded.track_config,
    start_time=excluded.start_time,license_category=excluded.license_category,sof=excluded.sof,num_drivers=excluded.num_drivers,
    num_cautions=excluded.num_cautions,num_caution_laps=excluded.num_caution_laps,num_lead_changes=excluded.num_lead_changes,
    event_average_lap=excluded.event_average_lap,event_best_lap_time=excluded.event_best_lap_time,weather=excluded.weather,
    track_state=excluded.track_state,session_splits=excluded.session_splits,imported_at=now()
   where race_field_events.my_cust_id=d.customer_id;
   if not found then raise exception 'field identity mismatch'; end if;
   insert into race_field_results(subsession_id,sim_session_type,cust_id,display_name,country_code,car_class_id,car_class_name,car_id,car_name,starting_position,starting_position_in_class,finish_position,finish_position_in_class,interval,class_interval,laps_complete,laps_lead,incidents,best_lap_time,average_lap,qual_lap_time,oldi_rating,newi_rating,old_license_level,new_license_level,old_sub_level,new_sub_level,reason_out,division,is_me)
   select ev.subsession_id,f.sim_session_type,f.cust_id,f.display_name,f.country_code,f.car_class_id,f.car_class_name,f.car_id,f.car_name,f.starting_position,f.starting_position_in_class,f.finish_position,f.finish_position_in_class,f.interval,f.class_interval,f.laps_complete,f.laps_lead,f.incidents,f.best_lap_time,f.average_lap,f.qual_lap_time,f.oldi_rating,f.newi_rating,f.old_license_level,f.new_license_level,f.old_sub_level,f.new_sub_level,f.reason_out,f.division,(f.cust_id=d.customer_id)
   from jsonb_populate_recordset(null::race_field_results,p_session->'field') f
   on conflict(subsession_id,sim_session_type,cust_id) do update set
    display_name=excluded.display_name,country_code=excluded.country_code,car_class_id=excluded.car_class_id,car_class_name=excluded.car_class_name,
    car_id=excluded.car_id,car_name=excluded.car_name,starting_position=excluded.starting_position,starting_position_in_class=excluded.starting_position_in_class,
    finish_position=excluded.finish_position,finish_position_in_class=excluded.finish_position_in_class,interval=excluded.interval,class_interval=excluded.class_interval,
    laps_complete=excluded.laps_complete,laps_lead=excluded.laps_lead,incidents=excluded.incidents,best_lap_time=excluded.best_lap_time,
    average_lap=excluded.average_lap,qual_lap_time=excluded.qual_lap_time,oldi_rating=excluded.oldi_rating,newi_rating=excluded.newi_rating,
    old_license_level=excluded.old_license_level,new_license_level=excluded.new_license_level,old_sub_level=excluded.old_sub_level,
    new_sub_level=excluded.new_sub_level,reason_out=excluded.reason_out,division=excluded.division,is_me=excluded.is_me;
  end if;
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
revoke all on function public.agent_commit(uuid,text,uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.agent_commit(uuid,text,uuid,text,jsonb,jsonb) to service_role;
