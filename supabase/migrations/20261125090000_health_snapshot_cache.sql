-- Health center cache: the heavy scan runs at most once per 5 minutes, however many admins have the page open.
--
-- Before: every open Health center ran the full scan (around 40 queries) every 60 seconds.
-- After:  the first request after 5 minutes runs it and saves the answer in one row; everyone else reads that row.
--         The Refresh button can force a new scan, but not more than once every 20 seconds.
-- The alert sender reads the same snapshot (4 minutes old at most), so it adds no extra scans.
-- Optional: keep the snapshot warm so nobody ever waits (needs pg_cron):
--   select cron.schedule('health-snapshot', '*/5 * * * *', $$select public.platform_health_snapshot_get(interval '0 seconds', true)$$);

create table if not exists public.platform_health_snapshot (
  id integer primary key check (id = 1),
  taken_at timestamptz not null,
  data jsonb not null
);
alter table public.platform_health_snapshot enable row level security;
revoke all on public.platform_health_snapshot from public, anon, authenticated;
grant select, insert, update on public.platform_health_snapshot to service_role;

create or replace function public.platform_health_snapshot_get(p_max_age interval default interval '5 minutes', p_force boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  snap record;
  fresh jsonb;
begin
  select * into snap from public.platform_health_snapshot where id = 1;
  if found and not p_force and snap.taken_at > now() - p_max_age then return snap.data; end if;
  -- A forced refresh still respects a short minimum gap, so a button cannot be used to hammer the database.
  if found and p_force and snap.taken_at > now() - interval '20 seconds' then return snap.data; end if;
  -- Only one request recomputes at a time; the others are served the previous snapshot instead of piling on.
  if pg_try_advisory_xact_lock(hashtext('platform_health_snapshot')) then
    fresh := public.platform_health_signals();
    insert into public.platform_health_snapshot (id, taken_at, data) values (1, now(), fresh)
    on conflict (id) do update set taken_at = excluded.taken_at, data = excluded.data;
    return fresh;
  end if;
  if found then return snap.data; end if;
  return public.platform_health_signals();
end;
$$;
revoke all on function public.platform_health_snapshot_get(interval, boolean) from public, anon, authenticated;
grant execute on function public.platform_health_snapshot_get(interval, boolean) to service_role;

-- The console call now reads the snapshot (a parameter with a default replaces the old no-argument version).
drop function if exists public.admin_get_health_center();
create or replace function public.admin_get_health_center(p_force boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  s jsonb;
  financial boolean := public.can_view_financial_admin_data();
begin
  if not public.admin_can_access('Health center') then
    raise exception 'UNAUTHORIZED: Health center access required';
  end if;
  s := public.platform_health_snapshot_get(interval '5 minutes', p_force);
  if not financial then
    s := (s - 'payments' - 'subscriptions') || jsonb_build_object('financial_hidden', true);
  end if;
  return s || jsonb_build_object('alerts', public.platform_health_alerts(s), 'alert_cooldown_hours', 6);
end;
$$;
revoke all on function public.admin_get_health_center(boolean) from public, anon;
grant execute on function public.admin_get_health_center(boolean) to authenticated;

-- The alert sender uses the snapshot too.
create or replace function public.platform_claim_alerts(p_cooldown_hours integer default 6)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  active jsonb := public.platform_health_alerts(public.platform_health_snapshot_get(interval '4 minutes', false));
  item jsonb; prior record;
  fire jsonb := '[]'::jsonb; resolved jsonb := '[]'::jsonb; gone record;
begin
  for item in select * from jsonb_array_elements(active) loop
    select * into prior from public.platform_alert_state where alert_key = item->>'key';
    if not found then
      insert into public.platform_alert_state (alert_key, severity) values (item->>'key', item->>'severity');
      fire := fire || jsonb_build_array(item);
    elsif prior.last_sent_at < now() - make_interval(hours => greatest(p_cooldown_hours, 1)) then
      update public.platform_alert_state set last_sent_at = now(), severity = item->>'severity' where alert_key = prior.alert_key;
      fire := fire || jsonb_build_array(item);
    end if;
  end loop;
  for gone in select alert_key from public.platform_alert_state
    where alert_key not in (select e->>'key' from jsonb_array_elements(active) e) loop
    resolved := resolved || jsonb_build_array(gone.alert_key);
    delete from public.platform_alert_state where alert_key = gone.alert_key;
  end loop;
  return jsonb_build_object('fire', fire, 'resolved', resolved, 'active_count', jsonb_array_length(active));
end;
$$;
revoke all on function public.platform_claim_alerts(integer) from public, anon, authenticated;
grant execute on function public.platform_claim_alerts(integer) to service_role;

notify pgrst, 'reload schema';
