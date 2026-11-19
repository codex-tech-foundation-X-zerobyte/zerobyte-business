-- Platform revenue monitoring.
--
-- Nothing in this repo records collected subscription payments yet: the
-- payment provider (Paystack) is not connected, so there is no data source
-- for "revenue". Rather than invent numbers, this migration adds:
--
--   1. subscription_payments -- the ledger a Paystack webhook (running with
--      the service role) will write to. Empty until then. Named to avoid
--      confusion with customer_payments, which is a business's own
--      customers paying off store credit and is unrelated to platform billing.
--   2. admin_get_revenue_overview() -- one platform-admin-only RPC returning
--      everything the admin Revenue screen shows. Payment figures come only
--      from subscription_payments; subscription figures come only from the
--      real subscriptions/plan_price_versions tables.
--
-- Revenue counts status = 'successful' payments only. Refund/reversal
-- accounting is intentionally NOT netted out here -- that belongs to the
-- finance-ledger phase, and quietly guessing at it would misstate revenue.

create table if not exists public.subscription_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan_id uuid references public.plans(id),
  price_version_id uuid references public.plan_price_versions(id),
  provider text not null,
  provider_reference text not null,
  amount numeric(12,2) not null check (amount >= 0),
  currency text not null default 'NGN',
  status text not null default 'pending' check (status in ('pending', 'processing', 'successful', 'failed', 'canceled', 'refunded', 'reversed', 'partially_refunded')),
  paid_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_reference)
);
create index if not exists subscription_payments_status_paid_idx on public.subscription_payments (status, paid_at desc);
create index if not exists subscription_payments_org_idx on public.subscription_payments (organization_id, created_at desc);

alter table public.subscription_payments enable row level security;
-- Read-only from the browser: admins see everything, an organization's
-- owner sees only their own. There are deliberately NO insert/update
-- policies -- a browser must never be able to create or alter a payment
-- record. The webhook writes with the service role, which bypasses RLS.
drop policy if exists subscription_payments_read on public.subscription_payments;
create policy subscription_payments_read on public.subscription_payments
  for select using (public.is_platform_admin() or public.is_org_owner(organization_id));
grant select on public.subscription_payments to authenticated;

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
  if not public.is_platform_admin() then
    raise exception 'UNAUTHORIZED: platform admin access required';
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
    -- What active paid subscriptions WOULD bill per month at their recorded
    -- price version. This is a subscription-record figure, not money
    -- collected; the UI labels it that way.
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

revoke all on function public.admin_get_revenue_overview(integer) from public, anon;
grant execute on function public.admin_get_revenue_overview(integer) to authenticated;

-- Explicit EXECUTE grants for the admin RPCs added by earlier migrations
-- (they relied on Supabase's default privileges). Each is gated by
-- is_platform_admin() in its body, so this grants reachability only.
grant execute on function public.admin_update_conversation_meta(uuid, text, text, uuid, boolean) to authenticated;
grant execute on function public.admin_review_promoter_application(uuid, text, text) to authenticated;
grant execute on function public.admin_set_promoter_status(uuid, text) to authenticated;
grant execute on function public.admin_list_promoters() to authenticated;
grant execute on function public.admin_update_feedback(uuid, text, text) to authenticated;
grant execute on function public.admin_list_feedback() to authenticated;

notify pgrst, 'reload schema';
