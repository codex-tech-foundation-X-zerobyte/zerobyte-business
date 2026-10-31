-- Paystack subscription payments.
--
-- The rule this whole design follows: the browser never decides what is owed and never decides that a payment
-- happened. It only says "this organization wants this plan". The server then
--   1. looks the price up in plan_price_versions (the browser sends no amount),
--   2. stores the expected amount against a server-generated reference,
--   3. and only activates the plan after Paystack itself confirms that exact reference was paid for that exact
--      amount (checked in settle_paystack_payment below, called from Edge Functions with the service role).
--
-- Nothing in this file can be called by a signed-in browser user except reading their own payment history.

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan_id uuid not null references public.plans(id),
  price_version_id uuid not null references public.plan_price_versions(id),
  billing_interval text not null check (billing_interval in ('monthly', 'yearly')),
  -- What we expect Paystack to collect, in kobo. Set by the server from the price table, never by the client.
  amount_kobo bigint not null check (amount_kobo > 0),
  currency text not null default 'NGN',
  status text not null default 'pending' check (status in ('pending', 'success', 'failed', 'mismatch')),
  initiated_by uuid not null references auth.users(id),
  provider text not null default 'paystack',
  provider_transaction_id text,
  channel text,
  paid_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists payments_org_created_idx on public.payments (organization_id, created_at desc);
create index if not exists payments_status_idx on public.payments (status);

alter table public.payments enable row level security;

-- Owners see their own business's payment history; platform admins see everything. Nobody can write from the
-- browser: there are deliberately no insert/update/delete policies and no write grants.
drop policy if exists payments_owner_read on public.payments;
create policy payments_owner_read on public.payments for select to authenticated
using (
  public.is_platform_admin()
  or exists (
    select 1 from public.organization_members m
    where m.organization_id = payments.organization_id and m.user_id = auth.uid() and m.role = 'owner'
  )
);
revoke all on public.payments from public, anon, authenticated;
grant select on public.payments to authenticated;

-- Settle one payment, exactly once, in one transaction. Called only by the Edge Functions, and only with values
-- that Paystack's own verify endpoint returned (the functions never pass anything the browser sent).
--
-- Outcomes: 'activated', 'already_settled', 'pending', 'failed', 'mismatch', 'not_found'.
create or replace function public.settle_paystack_payment(
  p_reference text,
  p_status text,
  p_amount_kobo bigint,
  p_currency text,
  p_transaction_id text,
  p_channel text,
  p_paid_at timestamptz
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  pay public.payments%rowtype;
  sub public.subscriptions%rowtype;
  period_start timestamptz;
  period_end timestamptz;
begin
  select * into pay from public.payments where reference = p_reference for update;
  if pay.id is null then return 'not_found'; end if;
  if pay.status = 'success' then return 'already_settled'; end if;

  if p_status <> 'success' then
    if p_status in ('failed', 'reversed', 'abandoned') then
      update public.payments set status = 'failed', failure_reason = left(p_status, 80), updated_at = now() where id = pay.id;
      return 'failed';
    end if;
    return 'pending'; -- still ongoing at Paystack; leave the row alone
  end if;

  -- The amount and currency Paystack actually collected must equal what the server expected. A mismatch never
  -- activates anything; it is recorded for an admin to look at.
  if p_amount_kobo is distinct from pay.amount_kobo or upper(coalesce(p_currency, '')) <> upper(pay.currency) then
    update public.payments
      set status = 'mismatch', failure_reason = format('expected %s %s kobo, Paystack reported %s %s', pay.currency, pay.amount_kobo, coalesce(p_currency, '?'), coalesce(p_amount_kobo::text, '?')), updated_at = now()
      where id = pay.id;
    return 'mismatch';
  end if;

  update public.payments
    set status = 'success', provider_transaction_id = p_transaction_id, channel = p_channel, paid_at = coalesce(p_paid_at, now()), failure_reason = null, updated_at = now()
    where id = pay.id;

  select * into sub from public.subscriptions where organization_id = pay.organization_id for update;
  if sub.id is null then
    insert into public.subscriptions (organization_id, plan_id, status, current_period_start)
      values (pay.organization_id, pay.plan_id, 'active', now())
      returning * into sub;
  end if;

  -- Renewing the same plan while it still has time left stacks the new period on the end of the old one, so
  -- paying early never throws days away. Anything else (new plan, trial, expired) starts from now.
  if sub.status = 'active' and sub.plan_id = pay.plan_id and sub.provider = 'paystack' and sub.current_period_end is not null and sub.current_period_end > now() then
    period_start := sub.current_period_end;
  else
    period_start := now();
  end if;
  period_end := period_start + case when pay.billing_interval = 'yearly' then interval '1 year' else interval '1 month' end;

  update public.subscriptions set
    plan_id = pay.plan_id,
    price_version_id = pay.price_version_id,
    status = 'active',
    trial_end = null,
    current_period_start = period_start,
    current_period_end = period_end,
    canceled_at = null,
    provider = 'paystack',
    provider_subscription_id = pay.reference,
    updated_at = now()
    where id = sub.id;

  insert into public.subscription_events (subscription_id, organization_id, event_type, from_plan_id, to_plan_id, actor_id, note)
    values (sub.id, pay.organization_id, 'activated', sub.plan_id, pay.plan_id, pay.initiated_by, 'Paid online via Paystack (reference ' || pay.reference || ')');

  return 'activated';
end;
$$;
revoke all on function public.settle_paystack_payment(text, text, bigint, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.settle_paystack_payment(text, text, bigint, text, text, text, timestamptz) to service_role;

notify pgrst, 'reload schema';
