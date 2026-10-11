-- EXCEPCIONAL e TEMPORÁRIO (autorizado pelo usuário em 11/10/2026): backfill histórico único (~1.350 corridas).
-- O teto diário de requisições sobe de 128 para 3000 SÓ enquanto agent_devices.backfill_until > now();
-- sem esse valor (padrão NULL) ou após expirar, o comportamento é idêntico ao anterior. 10 req/min,
-- bytes/dia e teto de Storage de telemetria inalterados.
alter table public.agent_devices add column if not exists backfill_until timestamptz;
create or replace function public.agent_reserve(p_device uuid,p_key text,p_hash text,p_bytes integer)
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
 if u.requests>=(case when exists(select 1 from agent_devices where id=p_device and backfill_until>now()) then 3000 else 128 end) or u.bytes+p_bytes>10485760 or u.minute_requests>=10 then return jsonb_build_object('status','budget'); end if;
 select coalesce(sum(coalesce((metadata->>'size')::bigint,0)),0) into storage_bytes from storage.objects where bucket_id='telemetry';
 if storage_bytes+coalesce((select sum(bytes) from agent_receipts where state='pending'),0)+p_bytes>734003200 then return jsonb_build_object('status','storage'); end if;
 update agent_usage set requests=requests+1,bytes=bytes+p_bytes,minute=date_trunc('minute',now()),minute_requests=u.minute_requests+1 where day=current_date;
 insert into agent_receipts(device_id,key,body_hash,state,lease,locked_until,bytes)
 values(p_device,p_key,p_hash,'pending',ticket,now()+interval '2 minutes',p_bytes)
 on conflict(device_id,key) do update set lease=ticket,locked_until=excluded.locked_until;
 update agent_devices set last_seen_at=now() where id=p_device;
 return jsonb_build_object('status','accepted','lease',ticket);
end $$;
revoke all on function public.agent_reserve(uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.agent_reserve(uuid,text,text,integer) to service_role;
