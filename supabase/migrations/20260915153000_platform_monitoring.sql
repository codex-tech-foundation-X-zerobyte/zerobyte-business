create table if not exists public.platform_monitoring_measurements (
  id uuid primary key default gen_random_uuid(),
  service text not null check (service in ('API', 'Database', 'Auth', 'Storage', 'Realtime', 'Edge Functions', 'Frontend', 'GitHub', 'Vercel')),
  source text not null default 'admin-browser',
  status text not null check (status in ('healthy', 'failed', 'unavailable', 'configuration')),
  latency_ms integer check (latency_ms is null or latency_ms between 0 and 120000),
  http_status integer check (http_status is null or http_status between 100 and 599),
  detail text not null,
  checked_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete cascade,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_platform_monitoring_checked_at
  on public.platform_monitoring_measurements (checked_at desc);
create index if not exists idx_platform_monitoring_service_checked_at
  on public.platform_monitoring_measurements (service, checked_at desc);

alter table public.platform_monitoring_measurements enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'platform_monitoring_measurements'
  ) then
    alter publication supabase_realtime add table public.platform_monitoring_measurements;
  end if;
end;
$$;

create policy "platform admins can read monitoring measurements"
on public.platform_monitoring_measurements for select
using (public.is_platform_admin());

create policy "platform admins can insert monitoring measurements"
on public.platform_monitoring_measurements for insert
with check (public.is_platform_admin() and created_by = auth.uid());

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
    (service, source, status, latency_ms, http_status, detail, checked_at, created_by, metadata)
  select
    item->>'service',
    coalesce(nullif(item->>'source', ''), 'admin-browser'),
    item->>'status',
    case when item ? 'latency_ms' and item->>'latency_ms' <> '' then (item->>'latency_ms')::integer end,
    case when item ? 'http_status' and item->>'http_status' <> '' then (item->>'http_status')::integer end,
    left(coalesce(item->>'detail', 'No detail provided'), 500),
    coalesce((item->>'checked_at')::timestamptz, now()),
    auth.uid(),
    case when jsonb_typeof(item->'metadata') = 'object' then item->'metadata' else '{}'::jsonb end
  from jsonb_array_elements(measurements) as rows(item);

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

create or replace function public.get_platform_monitoring(period_key text default '24h')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  start_at timestamptz := case
    when period_key = '7d' then now() - interval '7 days'
    when period_key = '30d' then now() - interval '30 days'
    else now() - interval '24 hours'
  end;
  measurements jsonb;
  summary jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'Platform administrator access required';
  end if;

  select coalesce(jsonb_agg(to_jsonb(item) order by item.checked_at desc), '[]'::jsonb)
  into measurements
  from (
    select id, service, source, status, latency_ms, http_status, detail, checked_at
    from public.platform_monitoring_measurements
    where checked_at >= start_at
    order by checked_at desc
    limit 1000
  ) item;

  select coalesce(jsonb_agg(to_jsonb(item) order by item.service), '[]'::jsonb)
  into summary
  from (
    select
      service,
      count(*) as checks,
      count(*) filter (where status = 'healthy') as healthy,
      count(*) filter (where status = 'failed') as failed,
      count(*) filter (where status = 'unavailable') as unavailable,
      count(*) filter (where status = 'configuration') as configuration,
      round((count(*) filter (where status = 'healthy'))::numeric / nullif(count(*) filter (where status in ('healthy', 'failed')), 0) * 100, 2) as uptime_percent,
      round(avg(latency_ms) filter (where latency_ms is not null), 0) as average_latency_ms
    from public.platform_monitoring_measurements
    where checked_at >= start_at
    group by service
  ) item;

  return jsonb_build_object('period', period_key, 'start_at', start_at, 'measurements', measurements, 'summary', summary);
end;
$$;

grant execute on function public.record_platform_monitoring_measurements(jsonb) to authenticated;
grant execute on function public.get_platform_monitoring(text) to authenticated;
