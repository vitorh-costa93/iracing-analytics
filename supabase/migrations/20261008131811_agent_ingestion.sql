-- Native agent: additive, private credentials and transactional admission limits.
create table public.agent_devices (
 id uuid primary key default gen_random_uuid(), driver_id uuid not null references public.drivers(id),
 customer_id bigint not null check(customer_id>0), token_hash text not null unique check(token_hash~'^[a-f0-9]{64}$'),
 enabled boolean not null default true, created_at timestamptz not null default now(), last_seen_at timestamptz
);
create table public.agent_usage (
 day date primary key, requests integer not null default 0, bytes bigint not null default 0,
 minute timestamptz not null default date_trunc('minute',now()), minute_requests integer not null default 0
);
create table public.agent_receipts (
 device_id uuid not null references public.agent_devices(id), key text not null,
 body_hash text not null, state text not null check(state in ('pending','done')),
 lease uuid not null, locked_until timestamptz not null, bytes integer not null,
 created_at timestamptz not null default now(), primary key(device_id,key)
);
create index agent_receipts_expiry on public.agent_receipts(created_at);
alter table public.agent_devices enable row level security;
alter table public.agent_usage enable row level security;
alter table public.agent_receipts enable row level security;
revoke all on public.agent_devices,public.agent_usage,public.agent_receipts from anon,authenticated;
grant all on public.agent_devices,public.agent_usage,public.agent_receipts to service_role;
alter table public.laps add column data_source text not null default 'garage61';
alter table public.driving_sessions add column data_source text not null default 'garage61';
alter table public.race_results add column result_source text not null default 'irstats',
 add column class_finish_position integer, add column official_irating_before integer,
 add column official_irating_after integer;

create function public.agent_reserve(p_device uuid,p_key text,p_hash text,p_bytes integer)
returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare r agent_receipts; u agent_usage; storage_bytes bigint; ticket uuid:=gen_random_uuid();
begin
 if p_bytes<0 or p_bytes>131072 or length(p_key)>160 or p_hash!~'^[a-f0-9]{64}$' then raise exception 'invalid admission'; end if;
 perform pg_advisory_xact_lock(81620261008);
 if not exists(select 1 from agent_devices where id=p_device and enabled) then return jsonb_build_object('status','unauthorized'); end if;
 delete from agent_receipts where state='done' and created_at<now()-interval '90 days';
 delete from agent_usage where day<current_date-90;
 select * into r from agent_receipts where device_id=p_device and key=p_key;
 if found then
   if r.body_hash<>p_hash then return jsonb_build_object('status','conflict'); end if;
   if r.state='done' then return jsonb_build_object('status','duplicate'); end if;
   if r.locked_until>now() then return jsonb_build_object('status','busy'); end if;
 end if;
 insert into agent_usage(day) values(current_date) on conflict do nothing;
 select * into u from agent_usage where day=current_date for update;
 if u.minute<>date_trunc('minute',now()) then u.minute_requests:=0; end if;
 if u.requests>=128 or u.bytes+p_bytes>10485760 or u.minute_requests>=10 then return jsonb_build_object('status','budget'); end if;
 select coalesce(sum(coalesce((metadata->>'size')::bigint,0)),0) into storage_bytes from storage.objects where bucket_id='telemetry';
 if storage_bytes+coalesce((select sum(bytes) from agent_receipts where state='pending'),0)+p_bytes>734003200 then return jsonb_build_object('status','storage'); end if;
 update agent_usage set requests=requests+1,bytes=bytes+p_bytes,minute=date_trunc('minute',now()),minute_requests=u.minute_requests+1 where day=current_date;
 insert into agent_receipts(device_id,key,body_hash,state,lease,locked_until,bytes)
 values(p_device,p_key,p_hash,'pending',ticket,now()+interval '2 minutes',p_bytes)
 on conflict(device_id,key) do update set lease=ticket,locked_until=excluded.locked_until;
 update agent_devices set last_seen_at=now() where id=p_device;
 return jsonb_build_object('status','accepted','lease',ticket);
end $$;

-- All native writes and completion share one transaction. No privileged public endpoint.
create function public.agent_commit(p_device uuid,p_key text,p_lease uuid,p_kind text,p_row jsonb,p_session jsonb default null)
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
create function public.protect_native_result() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if old.result_source='iracing_agent' and current_setting('app.agent_write',true) is distinct from '1' then return old; end if;
 return new;
end $$;
create trigger protect_native_result before update on public.race_results for each row execute function public.protect_native_result();
revoke all on function public.agent_reserve(uuid,text,text,integer),public.agent_commit(uuid,text,uuid,text,jsonb,jsonb),public.protect_native_result() from public,anon,authenticated;
grant execute on function public.agent_reserve(uuid,text,text,integer),public.agent_commit(uuid,text,uuid,text,jsonb,jsonb) to service_role;

create or replace view public.v_race_results_irating as
with anchor as (
 select distinct on(driver_id,category) driver_id,category,rating,recorded_at
 from public.ratings where rating_type='irating' and rating is not null
 order by driver_id,category,recorded_at desc
)
select rr.id,rr.irstats_race_id,rr.driver_id,rr.raced_at,rr.series_name,rr.track_name,rr.car_name,rr.car_id,rr.track_id,rr.category,rr.season_week,
 rr.license_class,rr.safety_rating,rr.irating_display,rr.irating_delta,rr.grid_position,rr.finish_position,rr.position_change,rr.laps,rr.laps_led,
 rr.fastest_lap_time,rr.incidents,rr.points,rr.sof,rr.imported_at,rr.race_fastest_lap_time,
 coalesce(rr.official_irating_after::bigint,r.rating-coalesce(sum(rr.irating_delta)over(partition by rr.driver_id,rr.category order by rr.raced_at desc rows between unbounded preceding and 1 preceding),0)) as irating_after,
 coalesce(rr.official_irating_before::bigint,r.rating-coalesce(sum(rr.irating_delta)over(partition by rr.driver_id,rr.category order by rr.raced_at desc rows between unbounded preceding and 1 preceding),0)-rr.irating_delta) as irating_before,
 rr.class_finish_position,rr.result_source
from public.race_results rr left join anchor r on r.driver_id=rr.driver_id and r.category=rr.category;
