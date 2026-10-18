-- Role-aware admin access.
--
-- platform_admin_access already had a proper role enum (SUPER_ADMIN,
-- PLATFORM_ADMIN, SUPPORT_ADMIN, FINANCE_ADMIN, MODERATION_ADMIN) and a
-- status column -- but is_platform_admin() treated every active role
-- identically, so a support agent had the same access as a super admin.
-- This migration adds the actual role differentiation:
--   * only a SUPER_ADMIN can grant or revoke admin access for anyone
--   * financial sections (Revenue, Plans & pricing, Subscriptions) are
--     restricted to SUPER_ADMIN and FINANCE_ADMIN, matching "support
--     agents must not automatically receive unrestricted financial data"
--   * every admin can see their own role so the frontend can hide
--     sections they can't use rather than showing them and failing

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.platform_admin_access
    where user_id = auth.uid() and status = 'active' and role = 'SUPER_ADMIN'
  );
$$;

create or replace function public.can_view_financial_admin_data()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.platform_admin_access
    where user_id = auth.uid() and status = 'active' and role in ('SUPER_ADMIN', 'FINANCE_ADMIN')
  );
$$;

-- What the signed-in admin can actually do, for the frontend to gate
-- navigation on. Never raises for a non-admin -- just returns nulls/false,
-- since this is read by the console shell before it knows who's asking.
create or replace function public.get_my_admin_profile()
returns table (role public.platform_admin_role, status text, is_super boolean, can_view_financials boolean, full_name text, email text)
language sql
stable
security definer
set search_path = public
as $$
  select a.role, a.status, a.role = 'SUPER_ADMIN', a.role in ('SUPER_ADMIN', 'FINANCE_ADMIN'),
         coalesce(nullif(p.full_name, ''), split_part(u.email, '@', 1)), u.email
  from public.platform_admin_access a
  join auth.users u on u.id = a.user_id
  left join public.profiles p on p.id = a.user_id
  where a.user_id = auth.uid() and a.status = 'active'
  limit 1;
$$;
grant execute on function public.get_my_admin_profile() to authenticated;

create or replace function public.admin_list_admin_accounts()
returns table (id uuid, user_id uuid, full_name text, email text, role public.platform_admin_role, status text, granted_by_name text, granted_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.user_id, coalesce(nullif(p.full_name, ''), split_part(u.email, '@', 1)), u.email, a.role, a.status,
         coalesce(nullif(gp.full_name, ''), split_part(gu.email, '@', 1)), a.granted_at
  from public.platform_admin_access a
  join auth.users u on u.id = a.user_id
  left join public.profiles p on p.id = a.user_id
  left join auth.users gu on gu.id = a.granted_by
  left join public.profiles gp on gp.id = a.granted_by
  where public.is_super_admin()
  order by a.granted_at desc;
$$;
revoke all on function public.admin_list_admin_accounts() from public, anon;

-- Grants admin access to an EXISTING account, found by email -- this does
-- not create a new Auth user. The person must already have signed up
-- (as a business owner or otherwise) before a super admin can promote
-- them; inventing accounts out of an email address is out of scope and
-- would need its own invite-email flow.
create or replace function public.admin_grant_admin_access(target_email text, new_role public.platform_admin_role)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_user_id uuid;
  new_id uuid;
begin
  if not public.is_super_admin() then
    raise exception using message = '{"code":"UNAUTHORIZED","message":"Only a super admin can grant admin access"}';
  end if;
  select id into target_user_id from auth.users where lower(email) = lower(trim(target_email));
  if target_user_id is null then
    raise exception using message = '{"code":"USER_NOT_FOUND","message":"No account exists with that email yet. They need to sign up first."}';
  end if;
  insert into public.platform_admin_access (user_id, role, status, granted_by)
    values (target_user_id, new_role, 'active', auth.uid())
  on conflict (user_id, role) do update set status = 'active', granted_by = auth.uid(), granted_at = now()
  returning id into new_id;
  insert into public.admin_audit_logs (actor_id, actor_role, action, target_type, target_id, metadata)
    values (auth.uid(), 'SUPER_ADMIN', 'admin_access.granted', 'platform_admin_access', new_id, jsonb_build_object('target_user', target_user_id, 'role', new_role));
  return new_id;
end;
$$;
revoke all on function public.admin_grant_admin_access(text, public.platform_admin_role) from public, anon;

create or replace function public.admin_set_admin_access_status(target_id uuid, new_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_user uuid;
begin
  if not public.is_super_admin() then
    raise exception using message = '{"code":"UNAUTHORIZED","message":"Only a super admin can change admin access"}';
  end if;
  if new_status not in ('active', 'suspended', 'revoked') then
    raise exception using message = '{"code":"VALIDATION_ERROR","message":"Unrecognized status"}';
  end if;
  select user_id into target_user from public.platform_admin_access where id = target_id;
  if target_user = auth.uid() and new_status <> 'active' then
    raise exception using message = '{"code":"VALIDATION_ERROR","message":"You cannot revoke your own super admin access"}';
  end if;
  update public.platform_admin_access set status = new_status where id = target_id;
  insert into public.admin_audit_logs (actor_id, actor_role, action, target_type, target_id, metadata)
    values (auth.uid(), 'SUPER_ADMIN', 'admin_access.' || new_status, 'platform_admin_access', target_id, '{}'::jsonb);
end;
$$;
revoke all on function public.admin_set_admin_access_status(uuid, text) from public, anon;

-- Tighten the three financial RPCs/views added earlier this build to the
-- finance-capable roles, not every admin. (admin_get_plans/admin_get_
-- revenue_overview/admin_list_promoters stay on is_platform_admin() for
-- promoters since referral tracking isn't financial data in the same
-- sense -- only money-facing screens are restricted here.)
create or replace function public.admin_get_revenue_overview(period_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  span_days integer := least(greatest(coalesce(period_days, 30), 1), 365);
  tz constant text := 'Africa/Lagos';
  today_start timestamptz := date_trunc('day', now() at time zone tz) at time zone tz;
  week_start timestamptz := date_trunc('week', now() at time zone tz) at time zone tz;
  month_start timestamptz := date_trunc('month', now() at time zone tz) at time zone tz;
  period_start timestamptz := (date_trunc('day', now() at time zone tz) - make_interval(days => span_days - 1)) at time zone tz;
  result jsonb;
begin
  if not public.can_view_financial_admin_data() then
    raise exception using message = '{"code":"UNAUTHORIZED","message":"Financial admin access required"}';
  end if;

  select jsonb_build_object(
    'currency', 'NGN',
    'period_days', span_days,
    'generated_at', now(),
    'payments_recorded', (select count(*) from public.subscription_payments),
    'revenue', jsonb_build_object(
      'total', coalesce((select sum(amount) from public.subscription_payments where status = 'successful'), 0),
      'today', coalesce((select sum(amount) from public.subscription_payments where status = 'successful' and coalesce(paid_at, created_at) >= today_start), 0),
      'week', coalesce((select sum(amount) from public.subscription_payments where status = 'successful' and coalesce(paid_at, created_at) >= week_start), 0),
      'month', coalesce((select sum(amount) from public.subscription_payments where status = 'successful' and coalesce(paid_at, created_at) >= month_start), 0)
    ),
    'payment_counts', jsonb_build_object(
      'successful', (select count(*) from public.subscription_payments where status = 'successful'),
      'pending', (select count(*) from public.subscription_payments where status in ('pending', 'processing')),
      'failed', (select count(*) from public.subscription_payments where status in ('failed', 'canceled'))
    ),
    'subscriptions', jsonb_build_object(
      'active_paid', (select count(*) from public.subscriptions s left join public.plan_price_versions pv on pv.id = s.price_version_id
                       where s.status = 'active' and coalesce(pv.amount, 0) > 0),
      'active_free', (select count(*) from public.subscriptions s left join public.plan_price_versions pv on pv.id = s.price_version_id
                       where s.status = 'active' and coalesce(pv.amount, 0) = 0),
      'trialing', (select count(*) from public.subscriptions where status = 'trialing'),
      'past_due', (select count(*) from public.subscriptions where status = 'past_due'),
      'canceled', (select count(*) from public.subscriptions where status = 'canceled'),
      'expired', (select count(*) from public.subscriptions where status = 'expired'),
      'new_in_period', (select count(*) from public.subscriptions where created_at >= period_start),
      'ended_in_period', (select count(*) from public.subscription_events where event_type in ('canceled', 'expired') and created_at >= period_start)
    ),
    'contracted_monthly_value', coalesce((select sum(pv.amount) from public.subscriptions s join public.plan_price_versions pv on pv.id = s.price_version_id
                                          where s.status = 'active' and pv.billing_interval = 'monthly'), 0),
    'revenue_by_plan', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.revenue desc) from (
        select coalesce(p.code, 'unassigned') as plan_code, coalesce(p.name, 'Unassigned') as plan_name,
               sum(sp.amount) as revenue, count(*) as payments
        from public.subscription_payments sp left join public.plans p on p.id = sp.plan_id
        where sp.status = 'successful'
        group by p.code, p.name
      ) t), '[]'::jsonb),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'revenue', coalesce(x.revenue, 0), 'payments', coalesce(x.payments, 0)) order by d.day)
      from (select (period_start at time zone tz)::date + g as day from generate_series(0, span_days - 1) g) d
      left join (
        select (coalesce(paid_at, created_at) at time zone tz)::date as day, sum(amount) as revenue, count(*) as payments
        from public.subscription_payments
        where status = 'successful' and coalesce(paid_at, created_at) >= period_start
        group by 1
      ) x on x.day = d.day
    ), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(to_jsonb(r)) from (
        select sp.id, o.name as organization_name, p.name as plan_name, sp.amount, sp.currency, sp.status,
               sp.provider, sp.provider_reference, coalesce(sp.paid_at, sp.created_at) as occurred_at
        from public.subscription_payments sp
        join public.organizations o on o.id = sp.organization_id
        left join public.plans p on p.id = sp.plan_id
        order by coalesce(sp.paid_at, sp.created_at) desc
        limit 25
      ) r), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

create or replace function public.admin_get_plans()
returns table (
  plan_id uuid, code text, name text, description text, active boolean, sort_order integer, trial_days integer,
  monthly_amount numeric, monthly_price_version_id uuid, currency text, limits jsonb, subscriber_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id, p.code, p.name, p.description, p.active, p.sort_order, p.trial_days,
    pv.amount, pv.id, coalesce(pv.currency, 'NGN'),
    coalesce((select jsonb_object_agg(pl.resource, pl.limit_value) from public.plan_limits pl where pl.plan_id = p.id), '{}'::jsonb),
    (select count(*) from public.subscriptions s where s.plan_id = p.id and s.status in ('trialing', 'active'))
  from public.plans p
  left join public.plan_price_versions pv on pv.plan_id = p.id and pv.status = 'active' and pv.billing_interval = 'monthly'
  where public.can_view_financial_admin_data()
  order by p.sort_order;
$$;

revoke all on function public.admin_get_revenue_overview(integer) from public, anon;
revoke all on function public.admin_get_plans() from public, anon;
grant execute on function public.admin_get_revenue_overview(integer) to authenticated;
grant execute on function public.admin_get_plans() to authenticated;

notify pgrst, 'reload schema';
