-- Repair native compatibility metadata without replacing raw telemetry or legacy rows.
with calendar(id,name,start_at,end_at) as (values
 ('31','2025 Season 4','2025-09-16'::timestamptz,'2025-12-09'::timestamptz),
 ('32','2026 Season 1','2025-12-16'::timestamptz,'2026-03-10'::timestamptz),
 ('33','2026 Season 2','2026-03-17'::timestamptz,'2026-06-09'::timestamptz),
 ('34','2026 Season 3','2026-06-16'::timestamptz,'2026-09-08'::timestamptz),
 ('35','2026 Season 4','2026-09-15'::timestamptz,'2026-12-08'::timestamptz))
update public.laps l set garage61_payload=coalesce(l.garage61_payload,'{}'::jsonb)||jsonb_build_object(
 'id',l.id,'lapTime',l.lap_time,'clean',l.clean,'canViewTelemetry',l.telemetry_path is not null,
 'season',jsonb_build_object('id',c.id::integer,'name',c.name))
from calendar c where l.data_source='iracing_agent' and l.created_at>=c.start_at and l.created_at<c.end_at;

-- Preserve the full current result/field function. Change only the native lap conflict branch.
do $$
declare definition text; old_clause text := 'on conflict(id) do nothing;';
begin
 definition:=pg_get_functiondef('public.agent_commit(uuid,text,uuid,text,jsonb,jsonb)'::regprocedure);
 if position(old_clause in definition)=0 then
  if position('native_identity_repair' in definition)>0 then return; end if;
  raise exception 'Unexpected agent_commit contract';
 end if;
 definition:=replace(definition,old_clause,'on conflict(id) do update set
 telemetry_path=excluded.telemetry_path,garage61_payload=excluded.garage61_payload,
 can_view_telemetry=true,synced_at=now()
 where laps.data_source=''iracing_agent'' and laps.driver_id=excluded.driver_id
 and laps.car_id=excluded.car_id and laps.track_id=excluded.track_id; -- native_identity_repair');
 execute definition;
end $$;
