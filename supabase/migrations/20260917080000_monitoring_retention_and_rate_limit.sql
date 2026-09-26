-- Two items explicitly called out as missing from the monitoring work:
-- a retention/cleanup strategy (the measurements table would otherwise grow
-- unbounded), and rate limiting on the write path so a stuck browser tab or
-- a misbehaving script can't hammer it.

-- Deletes measurements older than the retention window. Platform-admin only,
-- callable manually or from a scheduled job (pg_cron, if enabled on the
-- project) -- this migration does not assume pg_cron is available, so it
-- only defines the function; scheduling it is an infra choice left to the
-- operator (see README).
create or replace function public.cleanup_platform_monitoring_measurements(retain_days integer default 30)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  if not public.is_platform_admin() then
    raise exception 'Platform administrator access required';
  end if;
  if retain_days < 1 or retain_days > 365 then
    raise exception 'retain_days must be between 1 and 365';
  end if;

  delete from public.platform_monitoring_measurements
  where checked_at < now() - make_interval(days => retain_days);

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

grant execute on function public.cleanup_platform_monitoring_measurements(integer) to authenticated;

-- Rate limiting: a signed-in admin can only persist one measurement batch
-- every 5 seconds. The browser's own overlap guard and 60s auto-refresh
-- already keep normal usage well under this, so the limit is only ever hit
-- by something misbehaving (a stuck retry loop, a second tab racing the
-- first, or a modified client calling the RPC directly).
create or replace function public.record_platform_monitoring_measurements(measurements jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer;
  last_batch_at timestamptz;
begin
  if not public.is_platform_admin() then
    raise exception 'Platform administrator access required';
  end if;
  if jsonb_typeof(measurements) <> 'array' or jsonb_array_length(measurements) > 20 then
    raise exception 'A bounded array of up to 20 measurements is required';
  end if;

  select max(checked_at) into last_batch_at
  from public.platform_monitoring_measurements
  where created_by = auth.uid() and checked_at > now() - interval '5 seconds';
  if last_batch_at is not null then
    raise exception 'Monitoring checks are rate limited to once every 5 seconds per admin';
  end if;

  insert into public.platform_monitoring_measurements
    (service, source, status, latency_ms, http_status, detail, check_type, environment, error_code, checked_at, created_by, metadata)
  select
    item->>'service',
    coalesce(nullif(item->>'source', ''), 'admin-browser'),
    item->>'status',
    case when item ? 'latency_ms' and item->>'latency_ms' <> '' then (item->>'latency_ms')::integer end,
    case when item ? 'http_status' and item->>'http_status' <> '' then (item->>'http_status')::integer end,
    left(coalesce(item->>'detail', 'No detail provided'), 500),
    nullif(item->>'check_type', ''),
    coalesce(nullif(item->>'environment', ''), 'production'),
    nullif(item->>'error_code', ''),
    coalesce((item->>'checked_at')::timestamptz, now()),
    auth.uid(),
    case when jsonb_typeof(item->'metadata') = 'object' then item->'metadata' else '{}'::jsonb end
  from jsonb_array_elements(measurements) as rows(item);

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

grant execute on function public.record_platform_monitoring_measurements(jsonb) to authenticated;
