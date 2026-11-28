-- Live traffic numbers for the admin dashboard: requests per second, peak, error rate, latency, a per-minute
-- series for the chart, plus database size and open connections.
--
-- Source: backend_request_latency, which every Edge Function writes on every call (see _shared/latency.ts).
-- So "requests" here means Edge Function calls (sign-in lookups, worker/promoter tools, payments, platform
-- admin). Direct table reads made by the app go straight to Supabase's API and are not counted here; Supabase
-- Dashboard > Reports shows that traffic.

create or replace function public.admin_get_traffic_snapshot(window_minutes integer default 60)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  w integer := least(greatest(coalesce(window_minutes, 60), 5), 1440);
  result jsonb;
begin
  if not public.is_platform_admin() then return '{}'::jsonb; end if;

  select jsonb_build_object(
    'window_minutes', w,
    'requests_window', (select count(*) from public.backend_request_latency where recorded_at >= now() - make_interval(mins => w)),
    'rps_now', (select round(count(*) / 60.0, 2) from public.backend_request_latency where recorded_at >= now() - interval '60 seconds'),
    'rps_avg', (select round(count(*) / (w * 60.0), 3) from public.backend_request_latency where recorded_at >= now() - make_interval(mins => w)),
    'rps_peak', (select coalesce(max(c), 0) from (
        select count(*) as c from public.backend_request_latency
        where recorded_at >= now() - make_interval(mins => w) group by date_trunc('second', recorded_at)) s),
    'error_rate', (select case when count(*) = 0 then 0 else round(100.0 * count(*) filter (where status_code >= 500) / count(*), 2) end
        from public.backend_request_latency where recorded_at >= now() - make_interval(mins => w)),
    'avg_ms', (select coalesce(round(avg(duration_ms)), 0) from public.backend_request_latency where recorded_at >= now() - make_interval(mins => w)),
    'p95_ms', (select coalesce(percentile_disc(0.95) within group (order by duration_ms), 0) from public.backend_request_latency where recorded_at >= now() - make_interval(mins => w)),
    'series', coalesce((
      select jsonb_agg(jsonb_build_object('minute', m.minute, 'requests', coalesce(r.requests, 0), 'errors', coalesce(r.errors, 0)) order by m.minute)
      from generate_series(date_trunc('minute', now()) - make_interval(mins => w - 1), date_trunc('minute', now()), interval '1 minute') as m(minute)
      left join (
        select date_trunc('minute', recorded_at) as minute, count(*) as requests, count(*) filter (where status_code >= 500) as errors
        from public.backend_request_latency where recorded_at >= now() - make_interval(mins => w) group by 1
      ) r on r.minute = m.minute
    ), '[]'::jsonb),
    'db_connections', (select count(*) from pg_stat_activity where datname = current_database()),
    'db_size_mb', round(pg_database_size(current_database()) / 1048576.0)
  ) into result;
  return result;
end;
$$;
revoke all on function public.admin_get_traffic_snapshot(integer) from public, anon;
grant execute on function public.admin_get_traffic_snapshot(integer) to authenticated;

notify pgrst, 'reload schema';
