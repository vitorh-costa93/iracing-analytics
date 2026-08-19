create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create or replace function public.invoke_hourly_incremental_sync()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  sync_secret text;
begin
  select decrypted_secret
    into sync_secret
    from vault.decrypted_secrets
   where name = 'hourly_sync_secret'
   order by created_at desc
   limit 1;

  if sync_secret is null then
    raise warning 'Supabase Vault secret hourly_sync_secret is not configured';
    return;
  end if;

  perform net.http_get(
    url := 'https://iracing-analytics.vercel.app/api/cron/hourly-sync',
    headers := jsonb_build_object('Authorization', 'Bearer ' || sync_secret),
    timeout_milliseconds := 110000
  );
end;
$$;

revoke all on function public.invoke_hourly_incremental_sync() from public, anon, authenticated;
grant execute on function public.invoke_hourly_incremental_sync() to postgres, service_role;

do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job
    from cron.job
   where jobname = 'hourly-garage61-incremental-sync';

  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;

  perform cron.schedule(
    'hourly-garage61-incremental-sync',
    '7 * * * *',
    'select public.invoke_hourly_incremental_sync()'
  );
end;
$$;

comment on function public.invoke_hourly_incremental_sync() is
  'Invokes the protected Vercel endpoint for an hourly Garage61 incremental sync.';
