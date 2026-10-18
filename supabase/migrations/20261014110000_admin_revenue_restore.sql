-- Restore the admin Revenue Tracking page.
--
-- Why it disappeared (two separate faults):
--   1. Role gating. The console hides Revenue / Plans / Subscriptions unless get_my_admin_profile() says the admin is
--      SUPER_ADMIN or FINANCE_ADMIN. The role-aware-admin migration added that gate but never promoted the existing
--      first admin, so an admin whose row is PLATFORM_ADMIN lost those pages with no message. In addition,
--      get_my_admin_profile() used "limit 1" with no ordering, so an admin holding several role rows got an arbitrary one.
--   2. No data. The page read subscription_payments, which nothing writes to; real Paystack payments are recorded in
--      payments. Even when visible it would have shown zero.
--
-- This migration: (a) makes get_my_admin_profile() pick the strongest role, (b) guarantees the platform always has at
-- least one SUPER_ADMIN, (c) points the revenue overview at the real payment ledger.

-- (a) strongest role wins; flags are computed across all of an admin's active rows
create or replace function public.get_my_admin_profile()
returns table (role public.platform_admin_role, status text, is_super boolean, can_view_financials boolean, full_name text, email text)
language sql
stable
security definer
set search_path = public
as $$
  select best.role, 'active'::text,
         bool_or(a.role = 'SUPER_ADMIN') over (),
         bool_or(a.role in ('SUPER_ADMIN', 'FINANCE_ADMIN')) over (),
         coalesce(nullif(p.full_name, ''), split_part(u.email, '@', 1)), u.email
  from (
    select a2.role from public.platform_admin_access a2
    where a2.user_id = auth.uid() and a2.status = 'active'
    order by case a2.role when 'SUPER_ADMIN' then 0 when 'FINANCE_ADMIN' then 1 when 'PLATFORM_ADMIN' then 2 else 3 end
    limit 1
  ) best
  join public.platform_admin_access a on a.user_id = auth.uid() and a.status = 'active'
  join auth.users u on u.id = auth.uid()
  left join public.profiles p on p.id = auth.uid()
  limit 1;
$$;
grant execute on function public.get_my_admin_profile() to authenticated;

-- (b) never leave the platform without a super admin: if there is none, the earliest-granted active admin becomes one.
do $$
declare
  founder uuid;
begin
  if not exists (select 1 from public.platform_admin_access where role = 'SUPER_ADMIN' and status = 'active') then
    select user_id into founder from public.platform_admin_access where status = 'active' order by granted_at asc limit 1;
    if founder is not null then
      insert into public.platform_admin_access (user_id, role, status, granted_by) values (founder, 'SUPER_ADMIN', 'active', founder) on conflict (user_id, role) do update set status = 'active';
      raise notice 'No active SUPER_ADMIN existed; promoted admin user % (the earliest active admin).', founder;
    end if;
  end if;
end $$;

-- (c) one ledger for the revenue screen: Paystack payments from payments (the real record) plus any manually
-- recorded non-Paystack rows from subscription_payments. Paystack rows exist only in payments, so nothing is counted twice.
create or replace view public.platform_payment_ledger as
  select p.id, p.organization_id, p.plan_id,
         (p.amount_kobo / 100.0)::numeric(14, 2) as amount, p.currency,
         case
           when p.status = 'success' then 'successful'
           when p.status = 'mismatch' then 'needs_review'
           when p.status = 'pending' and p.created_at < now() - interval '1 day' then 'abandoned'
           else p.status
         end as status,
         p.paid_at, p.created_at, 'paystack'::text as provider, p.reference as provider_reference
  from public.payments p
  union all
  select sp.id, sp.organization_id, sp.plan_id, sp.amount, sp.currency, sp.status, sp.paid_at, sp.created_at, sp.provider, sp.provider_reference
  from public.subscription_payments sp
  where sp.provider <> 'paystack';
revoke all on public.platform_payment_ledger from public, anon, authenticated;

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
    raise exception 'UNAUTHORIZED: financial admin access required';
  end if;

  select jsonb_build_object(
    'currency', 'NGN',
    'period_days', span_days,
    'generated_at', now(),
    'payments_recorded', (select count(*) from public.platform_payment_ledger),
    -- Money actually collected: successful payments only. Refunds are not tracked yet, so none are netted off.
    'revenue', jsonb_build_object(
      'total', coalesce((select sum(amount) from public.platform_payment_ledger where status = 'successful'), 0),
      'today', coalesce((select sum(amount) from public.platform_payment_ledger where status = 'successful' and coalesce(paid_at, created_at) >= today_start), 0),
      'week', coalesce((select sum(amount) from public.platform_payment_ledger where status = 'successful' and coalesce(paid_at, created_at) >= week_start), 0),
      'month', coalesce((select sum(amount) from public.platform_payment_ledger where status = 'successful' and coalesce(paid_at, created_at) >= month_start), 0)
    ),
    'payment_counts', jsonb_build_object(
      'successful', (select count(*) from public.platform_payment_ledger where status = 'successful'),
      'pending', (select count(*) from public.platform_payment_ledger where status in ('pending', 'processing')),
      'failed', (select count(*) from public.platform_payment_ledger where status in ('failed', 'canceled')),
      'abandoned', (select count(*) from public.platform_payment_ledger where status = 'abandoned'),
      'needs_review', (select count(*) from public.platform_payment_ledger where status in ('needs_review', 'refunded', 'reversed', 'partially_refunded'))
    ),
    'subscriptions', jsonb_build_object(
      'active_paid', (select count(*) from public.subscriptions s left join public.plan_price_versions pv on pv.id = s.price_version_id
                       where s.status = 'active' and (s.current_period_end is null or s.current_period_end > now()) and coalesce(pv.amount, 0) > 0),
      'active_free', (select count(*) from public.subscriptions s left join public.plan_price_versions pv on pv.id = s.price_version_id
                       where s.status = 'active' and coalesce(pv.amount, 0) = 0),
      'trialing', (select count(*) from public.subscriptions where status = 'trialing' and (current_period_end is null or current_period_end > now())),
      'past_due', (select count(*) from public.subscriptions where status = 'past_due'),
      'canceled', (select count(*) from public.subscriptions where status = 'canceled'),
      'expired', (select count(*) from public.subscriptions where status = 'expired'),
      'new_in_period', (select count(*) from public.subscriptions where created_at >= period_start),
      'ended_in_period', (select count(*) from public.subscription_events where event_type in ('canceled', 'expired', 'trial_ended') and created_at >= period_start)
    ),
    -- What active paid subscriptions WOULD bill per month at their recorded price. A subscription-record figure,
    -- not money collected; the screen labels it that way.
    'contracted_monthly_value', coalesce((select sum(pv.amount) from public.subscriptions s join public.plan_price_versions pv on pv.id = s.price_version_id
                                          where s.status = 'active' and (s.current_period_end is null or s.current_period_end > now()) and pv.billing_interval = 'monthly'), 0),
    'revenue_by_plan', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.revenue desc) from (
        select coalesce(p.code, 'unassigned') as plan_code, coalesce(p.name, 'Unassigned') as plan_name, sum(l.amount) as revenue, count(*) as payments
        from public.platform_payment_ledger l left join public.plans p on p.id = l.plan_id
        where l.status = 'successful'
        group by p.code, p.name
      ) t), '[]'::jsonb),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'revenue', coalesce(x.revenue, 0), 'payments', coalesce(x.payments, 0)) order by d.day)
      from (select (period_start at time zone tz)::date + g as day from generate_series(0, span_days - 1) g) d
      left join (
        select (coalesce(paid_at, created_at) at time zone tz)::date as day, sum(amount) as revenue, count(*) as payments
        from public.platform_payment_ledger
        where status = 'successful' and coalesce(paid_at, created_at) >= period_start
        group by 1
      ) x on x.day = d.day
    ), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(to_jsonb(r)) from (
        select l.id, o.name as organization_name, p.name as plan_name, l.amount, l.currency, l.status,
               l.provider, l.provider_reference, coalesce(l.paid_at, l.created_at) as occurred_at
        from public.platform_payment_ledger l
        join public.organizations o on o.id = l.organization_id
        left join public.plans p on p.id = l.plan_id
        order by coalesce(l.paid_at, l.created_at) desc
        limit 25
      ) r), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;
revoke all on function public.admin_get_revenue_overview(integer) from public, anon;
grant execute on function public.admin_get_revenue_overview(integer) to authenticated;

notify pgrst, 'reload schema';
