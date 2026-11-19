-- 1. Each admin role sees only the sections it needs. This one function is the single source of truth: the admin screen
--    reads it to build the menu, and the server functions below call it, so hiding a menu item is never the only protection.
create or replace function public.admin_role_sections(p_role public.platform_admin_role)
returns text[]
language sql
immutable
as $$
  select case p_role::text
    when 'SUPER_ADMIN' then array['Overview','Analytics','Users','Organizations','Subscriptions','Plans','Promoters','Payouts','Revenue','Admins',
                                  'Branches','Inventory','Sales','Notifications','Messages','Feedback','Roadmap','Audit log','Monitoring','Profile','Settings']
    when 'PLATFORM_ADMIN' then array['Overview','Analytics','Users','Organizations','Subscriptions','Promoters',
                                     'Branches','Inventory','Sales','Notifications','Feedback','Roadmap','Audit log','Monitoring','Profile','Settings']
    when 'SUPPORT_ADMIN' then array['Messages','Feedback','Notifications','Profile','Settings']
    when 'FINANCE_ADMIN' then array['Overview','Subscriptions','Plans','Payouts','Revenue','Profile','Settings']
    when 'MODERATION_ADMIN' then array['Users','Organizations','Feedback','Audit log','Profile','Settings']
    else array[]::text[]
  end;
$$;

create or replace function public.get_my_admin_sections()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select public.admin_role_sections(a.role) from public.platform_admin_access a
     where a.user_id = auth.uid() and a.status = 'active'
     order by case a.role::text when 'SUPER_ADMIN' then 0 else 1 end limit 1
  ), array[]::text[]);
$$;
revoke all on function public.get_my_admin_sections() from public, anon;
grant execute on function public.get_my_admin_sections() to authenticated;

create or replace function public.admin_can_access(section text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select section = any(public.get_my_admin_sections());
$$;
revoke all on function public.admin_can_access(text) from public, anon;
grant execute on function public.admin_can_access(text) to authenticated;

-- 2. Put the section check in front of the data functions that did not have one. The original becomes *_core (not callable
--    by users); the public name checks the role and then calls it.
do $$ begin
  if exists (select 1 from pg_proc where proname = 'get_platform_overview' and pronamespace = 'public'::regnamespace)
     and not exists (select 1 from pg_proc where proname = 'get_platform_overview_core') then
    alter function public.get_platform_overview() rename to get_platform_overview_core;
    revoke all on function public.get_platform_overview_core() from public, anon, authenticated;
  end if;
  if not exists (select 1 from pg_proc where proname = 'get_platform_analytics_core') then
    alter function public.get_platform_analytics(text) rename to get_platform_analytics_core;
    revoke all on function public.get_platform_analytics_core(text) from public, anon, authenticated;
  end if;
  if not exists (select 1 from pg_proc where proname = 'admin_get_analytics_core') then
    alter function public.admin_get_analytics(integer) rename to admin_get_analytics_core;
    revoke all on function public.admin_get_analytics_core(integer) from public, anon, authenticated;
  end if;
  if not exists (select 1 from pg_proc where proname = 'admin_get_traffic_snapshot_core') then
    alter function public.admin_get_traffic_snapshot(integer) rename to admin_get_traffic_snapshot_core;
    revoke all on function public.admin_get_traffic_snapshot_core(integer) from public, anon, authenticated;
  end if;
  if not exists (select 1 from pg_proc where proname = 'admin_get_backend_latency_overview_core') then
    alter function public.admin_get_backend_latency_overview(integer) rename to admin_get_backend_latency_overview_core;
    revoke all on function public.admin_get_backend_latency_overview_core(integer) from public, anon, authenticated;
  end if;
end $$;

create or replace function public.get_platform_overview() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.admin_can_access('Overview') then raise exception 'UNAUTHORIZED: your admin role does not include this section'; end if;
  return public.get_platform_overview_core();
end $$;
create or replace function public.get_platform_analytics(period_key text default '30d') returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.admin_can_access('Analytics') or public.admin_can_access('Overview')) then raise exception 'UNAUTHORIZED: your admin role does not include this section'; end if;
  return public.get_platform_analytics_core(period_key);
end $$;
create or replace function public.admin_get_analytics(period_days integer default 30) returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.admin_can_access('Analytics') then raise exception 'UNAUTHORIZED: your admin role does not include this section'; end if;
  return public.admin_get_analytics_core(period_days);
end $$;
create or replace function public.admin_get_traffic_snapshot(window_minutes integer default 60) returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.admin_can_access('Analytics') or public.admin_can_access('Overview')) then return '{}'::jsonb; end if;
  return public.admin_get_traffic_snapshot_core(window_minutes);
end $$;
create or replace function public.admin_get_backend_latency_overview(period_days integer default 7) returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.admin_can_access('Monitoring') then raise exception 'UNAUTHORIZED: your admin role does not include this section'; end if;
  return public.admin_get_backend_latency_overview_core(period_days);
end $$;
do $$ declare f text; begin
  foreach f in array array['get_platform_overview()','get_platform_analytics(text)','admin_get_analytics(integer)','admin_get_traffic_snapshot(integer)','admin_get_backend_latency_overview(integer)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- 3. Payout minimum: the program's agreed starting point is ₦2,000.
alter table public.promoter_program_terms alter column minimum_payout_kobo set default 200000;
update public.promoter_program_terms set minimum_payout_kobo = 200000;
create or replace function public.admin_get_payout_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_view_financial_admin_data() then raise exception 'UNAUTHORIZED: super admin or finance admin access required'; end if;
  return jsonb_build_object(
    'minimum_payout_kobo', coalesce((select minimum_payout_kobo from public.promoter_program_terms limit 1), 200000),
    'can_change', public.is_super_admin()
  );
end;
$$;

notify pgrst, 'reload schema';
