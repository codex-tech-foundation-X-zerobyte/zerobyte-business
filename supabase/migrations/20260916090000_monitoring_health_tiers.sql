-- Widens platform monitoring from a binary healthy/failed signal to
-- latency-aware health tiers, and adds the columns/queries needed to answer
-- "how fast is each service responding, and which ones need attention" --
-- not just "did the last request come back with a 2xx".

alter table public.platform_monitoring_measurements
  drop constraint if exists platform_monitoring_measurements_status_check;

alter table public.platform_monitoring_measurements
  add constraint platform_monitoring_measurements_status_check
  check (status in ('healthy', 'degraded', 'slow', 'critical', 'unhealthy', 'failed', 'unavailable', 'configuration'));

alter table public.platform_monitoring_measurements
  add column if not exists check_type text,
  add column if not exists environment text not null default 'production',
  add column if not exists error_code text;

comment on column public.platform_monitoring_measurements.status is
  'healthy/degraded/slow/critical describe a successful response by latency tier. failed/unhealthy describe a definite error (4xx/5xx). unavailable means the probe itself could not complete (timeout, network). configuration means the service has not been set up.';
comment on column public.platform_monitoring_measurements.check_type is
  'What the probe actually measured, e.g. "Authenticated REST request", "Protected RPC call", "Session read (no network)", so a passing check is never read as more than it tested.';

create index if not exists idx_platform_monitoring_service_status_checked_at
  on public.platform_monitoring_measurements (service, status, checked_at desc);

create or replace function public.record_platform_monitoring_measurements(measurements jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer;
begin
  if not public.is_platform_admin() then
    raise exception 'Platform administrator access required';
  end if;
  if jsonb_typeof(measurements) <> 'array' or jsonb_array_length(measurements) > 20 then
    raise exception 'A bounded array of up to 20 measurements is required';
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

-- The following migration in this series (20260917080000) replaces this
-- function again to add rate limiting -- both keep the same one-argument
-- signature, so `create or replace` there correctly updates this function
-- in place rather than creating an overload.
grant execute on function public.record_platform_monitoring_measurements(jsonb) to authenticated;

-- get_platform_monitoring is changing from one argument to three (adding an
-- optional custom date range). `create or replace` only replaces a function
-- with the SAME argument list; a different one creates a second, ambiguous
-- overload instead. This migration has not shipped yet, so drop the old
-- one-argument signature explicitly before creating the new one.
drop function if exists public.get_platform_monitoring(text);

-- Adds 15m/1h periods, latency percentiles, min/max, a definite-error vs
-- probe-unavailable breakdown, a simple "how many checks in a row have
-- failed right now" signal per service, and an optional explicit
-- start/end window for a custom date range (when both are supplied they
-- override period_key entirely).
create or replace function public.get_platform_monitoring(period_key text default '24h', custom_start timestamptz default null, custom_end timestamptz default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  start_at timestamptz;
  end_at timestamptz := coalesce(custom_end, now());
  measurements jsonb;
  summary jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'Platform administrator access required';
  end if;
  if custom_start is not null and custom_end is not null then
    if custom_end <= custom_start then
      raise exception 'custom_end must be after custom_start';
    end if;
    if custom_end - custom_start > interval '90 days' then
      raise exception 'Custom range cannot exceed 90 days';
    end if;
    start_at := custom_start;
  else
    start_at := case
      when period_key = '15m' then now() - interval '15 minutes'
      when period_key = '1h' then now() - interval '1 hour'
      when period_key = '7d' then now() - interval '7 days'
      when period_key = '30d' then now() - interval '30 days'
      else now() - interval '24 hours'
    end;
  end if;

  select coalesce(jsonb_agg(to_jsonb(item) order by item.checked_at desc), '[]'::jsonb)
  into measurements
  from (
    select id, service, source, status, latency_ms, http_status, detail, check_type, environment, error_code, checked_at
    from public.platform_monitoring_measurements
    where checked_at >= start_at and checked_at <= end_at
    order by checked_at desc
    limit 1000
  ) item;

  -- Consecutive-failure streak per service: walk the most recent checks
  -- (regardless of the selected time window -- a streak is "right now", not
  -- scoped to whatever range the operator happens to be viewing) and count
  -- how many in a row, from the most recent, are a definite failure.
  with recent as (
    select service, status, checked_at,
      row_number() over (partition by service order by checked_at desc) as rn
    from public.platform_monitoring_measurements
  ),
  first_healthy as (
    select service, min(rn) as first_healthy_rn
    from recent
    where status in ('healthy', 'degraded', 'slow')
    group by service
  ),
  streaks as (
    select r.service, count(*) as consecutive_failures
    from recent r
    left join first_healthy h on h.service = r.service
    where r.status in ('critical', 'unhealthy', 'failed', 'unavailable')
      and r.rn < coalesce(h.first_healthy_rn, 2147483647)
    group by r.service
  ),
  windowed as (
    select
      service,
      count(*) as checks,
      count(*) filter (where status in ('healthy', 'degraded', 'slow')) as healthy,
      count(*) filter (where status in ('critical', 'unhealthy', 'failed')) as failed,
      count(*) filter (where status = 'unavailable') as unavailable,
      count(*) filter (where status = 'configuration') as configuration,
      count(*) filter (where http_status between 400 and 499) as http_4xx_count,
      count(*) filter (where http_status between 500 and 599) as http_5xx_count,
      count(*) filter (where status = 'unavailable') as timeout_count,
      round((count(*) filter (where status in ('healthy', 'degraded', 'slow')))::numeric
        / nullif(count(*) filter (where status in ('healthy', 'degraded', 'slow', 'critical', 'unhealthy', 'failed')), 0) * 100, 2) as uptime_percent,
      round(avg(latency_ms) filter (where latency_ms is not null), 0) as average_latency_ms,
      min(latency_ms) filter (where latency_ms is not null) as min_latency_ms,
      max(latency_ms) filter (where latency_ms is not null) as max_latency_ms,
      round((percentile_cont(0.5) within group (order by latency_ms) filter (where latency_ms is not null))::numeric) as p50_latency_ms,
      round((percentile_cont(0.95) within group (order by latency_ms) filter (where latency_ms is not null))::numeric) as p95_latency_ms,
      round((percentile_cont(0.99) within group (order by latency_ms) filter (where latency_ms is not null))::numeric) as p99_latency_ms,
      max(checked_at) filter (where status in ('healthy', 'degraded', 'slow')) as last_success_at,
      max(checked_at) filter (where status in ('critical', 'unhealthy', 'failed', 'unavailable')) as last_failure_at
    from public.platform_monitoring_measurements
    where checked_at >= start_at and checked_at <= end_at
    group by service
  )
  select coalesce(jsonb_agg(to_jsonb(w) || jsonb_build_object('consecutive_failures', coalesce(s.consecutive_failures, 0)) order by w.service), '[]'::jsonb)
  into summary
  from windowed w
  left join streaks s on s.service = w.service;

  return jsonb_build_object('period', period_key, 'start_at', start_at, 'end_at', end_at, 'measurements', measurements, 'summary', summary);
end;
$$;

grant execute on function public.get_platform_monitoring(text, timestamptz, timestamptz) to authenticated;
