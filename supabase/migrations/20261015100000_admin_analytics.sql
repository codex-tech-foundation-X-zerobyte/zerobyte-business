-- Admin analytics: visitors, active users, growth, funnel, top businesses, and (role-gated) revenue and security.
--
-- Privacy by design:
--  * Visits are counted WITHOUT cookies and WITHOUT IP addresses or user agents. The browser sends a random id kept on the
--    device; the database stores only md5(id || date). The same person therefore looks like a different visitor each
--    day, so visits cannot be linked across days or to an account. Only the route, the referring host, a promoter
--    code and a coarse device class are stored.
--  * Signed-in activity records only "this account opened the app today" (one row per account per day).

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.site_visits (
  id bigint generated always as identity primary key,
  day date not null,
  visitor_hash text not null,
  path text not null,
  referrer_host text,
  ref_code text,
  device text not null default 'other' check (device in ('mobile', 'tablet', 'desktop', 'other')),
  created_at timestamptz not null default now()
);
create index if not exists idx_site_visits_day on public.site_visits (day, visitor_hash);
create index if not exists idx_site_visits_created on public.site_visits (created_at);
alter table public.site_visits enable row level security;
revoke all on public.site_visits from public, anon, authenticated;

create table if not exists public.user_activity_daily (
  day date not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  opens integer not null default 1,
  primary key (day, user_id)
);
create index if not exists idx_user_activity_user on public.user_activity_daily (user_id, day desc);
alter table public.user_activity_daily enable row level security;
revoke all on public.user_activity_daily from public, anon, authenticated;

create index if not exists idx_organizations_created_at on public.organizations (created_at);
create index if not exists idx_sales_created_at on public.sales (created_at);

-- ---------------------------------------------------------------------------
-- Collection (callable from the browser, but they can only append a sanitised row)
-- ---------------------------------------------------------------------------
create or replace function public.track_visit(p_visitor text, p_path text, p_referrer text default null, p_ref text default null, p_device text default 'other')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'Africa/Lagos')::date;
  clean_path text;
  hash text;
  host text;
begin
  if p_visitor is null or p_visitor !~ '^[A-Za-z0-9_-]{16,64}$' then return; end if;
  -- only known public routes are recorded; anything else is dropped rather than stored
  clean_path := case
    when p_path in ('/', '/auth', '/promoters', '/guide', '/privacy', '/terms') then p_path
    when p_path like '/promoter-setup%' then '/promoter-setup'
    else null end;
  if clean_path is null then return; end if;
  hash := md5(p_visitor || ':' || today::text);
  -- one visitor cannot flood the table, and neither can a swarm of invented ids
  if (select count(*) from public.site_visits where day = today and visitor_hash = hash) >= 60 then return; end if;
  if (select count(*) from public.site_visits where created_at > now() - interval '1 minute') >= 600 then return; end if;
  host := lower(substring(coalesce(p_referrer, '') from '^https?://([^/:?#]+)'));
  insert into public.site_visits (day, visitor_hash, path, referrer_host, ref_code, device)
  values (today, hash, clean_path, left(host, 80), case when p_ref ~ '^[A-Za-z0-9_-]{3,24}$' then p_ref end,
          case when p_device in ('mobile', 'tablet', 'desktop') then p_device else 'other' end);
end;
$$;
revoke all on function public.track_visit(text, text, text, text, text) from public;
grant execute on function public.track_visit(text, text, text, text, text) to anon, authenticated;

create or replace function public.record_activity(p_org uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  today date := (now() at time zone 'Africa/Lagos')::date;
  org uuid := null;
begin
  if uid is null then return; end if;
  if p_org is not null and exists (select 1 from public.organization_members m where m.organization_id = p_org and m.user_id = uid) then org := p_org; end if;
  insert into public.user_activity_daily (day, user_id, organization_id) values (today, uid, org)
  on conflict (day, user_id) do update set opens = public.user_activity_daily.opens + 1, organization_id = coalesce(excluded.organization_id, public.user_activity_daily.organization_id);
end;
$$;
revoke all on function public.record_activity(uuid) from public, anon;
grant execute on function public.record_activity(uuid) to authenticated;

-- Housekeeping: raw visits older than 180 days are not needed (daily numbers are what the dashboard shows).
create or replace function public.prune_analytics()
returns void language sql security definer set search_path = public as $$
  delete from public.site_visits where day < (now() at time zone 'Africa/Lagos')::date - 180;
$$;
revoke all on function public.prune_analytics() from public, anon, authenticated;
grant execute on function public.prune_analytics() to service_role;

-- ---------------------------------------------------------------------------
-- The dashboard read
-- ---------------------------------------------------------------------------
create or replace function public.admin_get_analytics(period_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  span integer := least(greatest(coalesce(period_days, 30), 7), 180);
  tz constant text := 'Africa/Lagos';
  today date := (now() at time zone tz)::date;
  p_start date := today - (span - 1);
  p_start_ts timestamptz := p_start::timestamp at time zone tz;
  r jsonb;
  fin jsonb := null;
  sec jsonb := null;
begin
  if not public.is_platform_admin() then raise exception 'Platform administrator access required'; end if;

  select jsonb_build_object(
    'generated_at', now(), 'period_days', span,
    'visitors', jsonb_build_object(
      'today', (select count(distinct visitor_hash) from public.site_visits where day = today),
      'yesterday', (select count(distinct visitor_hash) from public.site_visits where day = today - 1),
      'page_views_today', (select count(*) from public.site_visits where day = today),
      'period_visitor_days', (select coalesce(sum(c), 0) from (select count(distinct visitor_hash) c from public.site_visits where day >= p_start group by day) x),
      'period_page_views', (select count(*) from public.site_visits where day >= p_start),
      'series', coalesce((select jsonb_agg(jsonb_build_object('day', d.day, 'visitors', coalesce(v.visitors, 0), 'page_views', coalesce(v.views, 0)) order by d.day)
        from (select p_start + g as day from generate_series(0, span - 1) g) d
        left join (select day, count(distinct visitor_hash) visitors, count(*) views from public.site_visits where day >= p_start group by day) v on v.day = d.day), '[]'::jsonb),
      'top_pages', coalesce((select jsonb_agg(t) from (select path, count(*) views, count(distinct (day, visitor_hash)) visitors from public.site_visits where day >= p_start group by path order by views desc limit 8) t), '[]'::jsonb),
      'top_referrers', coalesce((select jsonb_agg(t) from (select coalesce(nullif(referrer_host, ''), 'Direct or unknown') host, count(distinct (day, visitor_hash)) visitors from public.site_visits where day >= p_start group by 1 order by visitors desc limit 8) t), '[]'::jsonb),
      'devices', coalesce((select jsonb_agg(t) from (select device, count(distinct (day, visitor_hash)) visitors from public.site_visits where day >= p_start group by device order by visitors desc) t), '[]'::jsonb),
      'promoter_codes', coalesce((select jsonb_agg(t) from (select ref_code, count(distinct (day, visitor_hash)) visitors from public.site_visits where day >= p_start and ref_code is not null group by ref_code order by visitors desc limit 8) t), '[]'::jsonb)
    ),
    'users', jsonb_build_object(
      'total', (select count(*) from auth.users),
      'new_today', (select count(*) from auth.users where created_at >= today::timestamp at time zone tz),
      'new_7d', (select count(*) from auth.users where created_at >= (today - 6)::timestamp at time zone tz),
      'new_30d', (select count(*) from auth.users where created_at >= (today - 29)::timestamp at time zone tz),
      'dau', (select count(*) from public.user_activity_daily where day = today),
      'wau', (select count(distinct user_id) from public.user_activity_daily where day >= today - 6),
      'mau', (select count(distinct user_id) from public.user_activity_daily where day >= today - 29),
      -- of the people who joined 8 to 14 days ago, how many opened the app in the last 7 days
      'retention_week1', (select case when count(*) = 0 then null else round(100.0 * count(*) filter (where exists (select 1 from public.user_activity_daily a where a.user_id = u.id and a.day >= today - 6)) / count(*), 1) end
        from auth.users u where u.created_at >= (today - 13)::timestamp at time zone tz and u.created_at < (today - 6)::timestamp at time zone tz),
      'series', coalesce((select jsonb_agg(jsonb_build_object('day', d.day, 'signups', coalesce(s.n, 0), 'active', coalesce(a.n, 0)) order by d.day)
        from (select p_start + g as day from generate_series(0, span - 1) g) d
        left join (select (created_at at time zone tz)::date as day, count(*) n from auth.users where created_at >= p_start_ts group by 1) s on s.day = d.day
        left join (select day, count(*) n from public.user_activity_daily where day >= p_start group by day) a on a.day = d.day), '[]'::jsonb)
    ),
    'businesses', jsonb_build_object(
      'total', (select count(*) from public.organizations),
      'new_7d', (select count(*) from public.organizations where created_at >= (today - 6)::timestamp at time zone tz),
      'new_30d', (select count(*) from public.organizations where created_at >= (today - 29)::timestamp at time zone tz),
      'active_7d', (select count(distinct organization_id) from public.sales where created_at >= (today - 6)::timestamp at time zone tz),
      'active_30d', (select count(distinct organization_id) from public.sales where created_at >= (today - 29)::timestamp at time zone tz),
      'with_first_sale', (select count(*) from public.organizations o where exists (select 1 from public.sales s where s.organization_id = o.id)),
      'series', coalesce((select jsonb_agg(jsonb_build_object('day', d.day, 'businesses', coalesce(o.n, 0)) order by d.day)
        from (select p_start + g as day from generate_series(0, span - 1) g) d
        left join (select (created_at at time zone tz)::date as day, count(*) n from public.organizations where created_at >= p_start_ts group by 1) o on o.day = d.day), '[]'::jsonb)
    ),
    'sales', jsonb_build_object(
      'count_today', (select count(*) from public.sales where created_at >= today::timestamp at time zone tz),
      'volume_today', (select coalesce(sum(total), 0) from public.sales where created_at >= today::timestamp at time zone tz),
      'count_period', (select count(*) from public.sales where created_at >= p_start_ts),
      'volume_period', (select coalesce(sum(total), 0) from public.sales where created_at >= p_start_ts),
      'series', coalesce((select jsonb_agg(jsonb_build_object('day', d.day, 'sales', coalesce(s.n, 0), 'volume', coalesce(s.v, 0)) order by d.day)
        from (select p_start + g as day from generate_series(0, span - 1) g) d
        left join (select (created_at at time zone tz)::date as day, count(*) n, sum(total) v from public.sales where created_at >= p_start_ts group by 1) s on s.day = d.day), '[]'::jsonb),
      'top_businesses', coalesce((select jsonb_agg(t) from (select o.name, count(*) sales, sum(s.total) volume from public.sales s join public.organizations o on o.id = s.organization_id where s.created_at >= p_start_ts group by o.id, o.name order by volume desc limit 10) t), '[]'::jsonb)
    ),
    'funnel', jsonb_build_object(
      'visitors', (select coalesce(sum(c), 0) from (select count(distinct visitor_hash) c from public.site_visits where day >= p_start group by day) x),
      'signups', (select count(*) from auth.users where created_at >= p_start_ts),
      'businesses', (select count(*) from public.organizations where created_at >= p_start_ts),
      'first_sale', (select count(*) from public.organizations o where o.created_at >= p_start_ts and exists (select 1 from public.sales s where s.organization_id = o.id)),
      'paid', (select count(distinct organization_id) from public.payments where status = 'success' and coalesce(paid_at, created_at) >= p_start_ts)
    ),
    'plans', coalesce((select jsonb_agg(t) from (select p.name plan, count(*) businesses from public.subscriptions s join public.plans p on p.id = s.plan_id where s.status in ('active', 'trialing') group by p.name, p.sort_order order by p.sort_order) t), '[]'::jsonb)
  ) into r;

  if public.can_view_financial_admin_data() then
    select jsonb_build_object(
      'collected_period', coalesce((select sum(amount_kobo) / 100.0 from public.payments where status = 'success' and coalesce(paid_at, created_at) >= p_start_ts), 0),
      'collected_month', coalesce((select sum(amount_kobo) / 100.0 from public.payments where status = 'success' and coalesce(paid_at, created_at) >= date_trunc('month', now() at time zone tz) at time zone tz), 0),
      'contracted_monthly', coalesce((select sum(pv.amount) from public.subscriptions s join public.plan_price_versions pv on pv.id = s.price_version_id where s.status = 'active' and (s.current_period_end is null or s.current_period_end > now()) and pv.billing_interval = 'monthly'), 0),
      'paying_businesses', (select count(distinct s.organization_id) from public.subscriptions s where s.status = 'active' and s.provider = 'paystack' and s.current_period_end > now()),
      'needs_review', (select count(*) from public.payments where status = 'mismatch'),
      'failed_period', (select count(*) from public.payments where status = 'failed' and created_at >= p_start_ts),
      'series', coalesce((select jsonb_agg(jsonb_build_object('day', d.day, 'amount', coalesce(x.v, 0)) order by d.day)
        from (select p_start + g as day from generate_series(0, span - 1) g) d
        left join (select (coalesce(paid_at, created_at) at time zone tz)::date as day, sum(amount_kobo) / 100.0 v from public.payments where status = 'success' and coalesce(paid_at, created_at) >= p_start_ts group by 1) x on x.day = d.day), '[]'::jsonb)
    ) into fin;
    r := r || jsonb_build_object('revenue', fin);
  end if;

  if public.is_super_admin() then
    select jsonb_build_object(
      'admins_active', (select count(distinct user_id) from public.platform_admin_access where status = 'active'),
      'admins_suspended', (select count(distinct user_id) from public.platform_admin_access where status in ('suspended', 'revoked')),
      'by_role', coalesce((select jsonb_agg(t) from (select role::text role, count(*) n from public.platform_admin_access where status = 'active' group by role order by n desc) t), '[]'::jsonb),
      'admin_actions_24h', (select count(*) from public.admin_audit_logs where created_at > now() - interval '24 hours'),
      'recent_actions', coalesce((select jsonb_agg(t) from (select a.action, a.target_type, a.actor_role, a.created_at from public.admin_audit_logs a order by a.created_at desc limit 6) t), '[]'::jsonb),
      'blocked_logins_24h', (select count(*) from public.auth_throttle where created_at > now() - interval '24 hours'),
      'unverified_payments', (select count(*) from public.payments where status = 'pending' and created_at < now() - interval '1 day')
    ) into sec;
    r := r || jsonb_build_object('security', sec);
  end if;
  return r;
end;
$$;
revoke all on function public.admin_get_analytics(integer) from public, anon;
grant execute on function public.admin_get_analytics(integer) to authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'prune-analytics';
    perform cron.schedule('prune-analytics', '17 3 * * *', 'select public.prune_analytics()');
  end if;
exception when others then raise notice 'pg_cron not scheduled (%): run select public.prune_analytics() now and then.', sqlerrm;
end $$;

notify pgrst, 'reload schema';
