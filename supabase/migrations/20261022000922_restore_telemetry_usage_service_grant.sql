-- Restore the server-only usage recorder; public roles remain unable to invoke it.
revoke execute on function public.record_telemetry_download(bigint,boolean) from public,anon,authenticated;
grant execute on function public.record_telemetry_download(bigint,boolean) to service_role;
