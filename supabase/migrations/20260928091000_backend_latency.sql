-- Backend-recorded latency.
--
-- The existing platform_monitoring_measurements table (and the Monitoring
-- page's browser probes) only measure what one admin's browser experiences
-- when they happen to click "Run checks" -- that's useful for "is this
-- admin's connection to Supabase healthy", but it is not "general"
-- latency, since it depends on that admin's own location/network and only
-- samples occasionally.
--
-- backend_request_latency is written by the Edge Functions themselves, at
-- the end of every real invocation, from every caller -- business owners,
-- workers, the admin console, everyone. It measures server-side execution
-- time only (from the moment the function starts handling the request to
-- the moment it finishes), which is what "general latency" actually means
-- for a backend: independent of whoever is asking and how far away they are.

create table if not exists public.backend_request_latency (
  id bigint generated always as identity primary key,
  function_name text not null,
  duration_ms integer not null check (duration_ms >= 0),
  status_code integer not null,
  recorded_at timestamptz not null default now()
);
create index if not exists backend_request_latency_function_time_idx on public.backend_request_latency (function_name, recorded_at desc);
-- Bounded retention: nobody needs per-request latency rows from six months
-- ago, and an unbounded table would eventually slow down the very
-- aggregate query the monitoring page runs. Each insert has a small chance
-- of trimming anything older than 14 days, which keeps the table bounded
-- without needing a scheduled job.
create or replace function public.trim_backend_request_latency()
returns trigger
language plpgsql
as $$
begin
  if random() < 0.01 then
    delete from public.backend_request_latency where recorded_at < now() - interval '14 days';
  end if;
  return new;
end;
$$;
drop trigger if exists backend_request_latency_trim on public.backend_request_latency;
create trigger backend_request_latency_trim after insert on public.backend_request_latency
  for each row execute function public.trim_backend_request_latency();

alter table public.backend_request_latency enable row level security;
-- Admin-readable only. There is deliberately no insert/update policy for
-- any role -- Edge Functions write with the service role, which bypasses
-- RLS entirely, so the browser can never forge a latency sample.
create policy backend_request_latency_admin_read on public.backend_request_latency
  for select using (public.is_platform_admin());
grant select on public.backend_request_latency to authenticated;

create or replace function public.admin_get_backend_latency_overview(period_days integer default 7)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when not public.is_platform_admin() then '{}'::jsonb else coalesce((
    select jsonb_build_object(
      'period_days', least(greatest(coalesce(period_days, 7), 1), 90),
      'sample_count', count(*),
      'by_function', coalesce((
        select jsonb_agg(to_jsonb(t) order by t.avg_ms desc) from (
          select function_name,
                 count(*) as requests,
                 round(avg(duration_ms)) as avg_ms,
                 percentile_disc(0.5) within group (order by duration_ms) as p50_ms,
                 percentile_disc(0.95) within group (order by duration_ms) as p95_ms,
                 percentile_disc(0.99) within group (order by duration_ms) as p99_ms,
                 count(*) filter (where status_code >= 500) as server_errors,
                 count(*) filter (where status_code >= 400 and status_code < 500) as client_errors
          from public.backend_request_latency
          where recorded_at >= now() - make_interval(days => least(greatest(coalesce(period_days, 7), 1), 90))
          group by function_name
        ) t
      ), '[]'::jsonb),
      'daily_avg', coalesce((
        select jsonb_agg(to_jsonb(d) order by d.day) from (
          select (recorded_at at time zone 'Africa/Lagos')::date as day, round(avg(duration_ms)) as avg_ms, count(*) as requests
          from public.backend_request_latency
          where recorded_at >= now() - make_interval(days => least(greatest(coalesce(period_days, 7), 1), 90))
          group by 1
        ) d
      ), '[]'::jsonb)
    )
    from public.backend_request_latency
    where recorded_at >= now() - make_interval(days => least(greatest(coalesce(period_days, 7), 1), 90))
  ), jsonb_build_object('period_days', period_days, 'sample_count', 0, 'by_function', '[]'::jsonb, 'daily_avg', '[]'::jsonb)) end;
$$;
revoke all on function public.admin_get_backend_latency_overview(integer) from public, anon;
grant execute on function public.admin_get_backend_latency_overview(integer) to authenticated;

notify pgrst, 'reload schema';
