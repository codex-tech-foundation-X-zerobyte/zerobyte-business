-- Payment diagnostics + a more precise settlement result.
--
-- 1. payment_events: one safe row for every time the server checked a payment with Paystack (browser return or
--    webhook): what Paystack said, what the database decided, and any error. No keys, no card or customer details.
--    This is how "I paid but my plan did not change" is answered with evidence instead of guesses:
--      select * from payment_events where reference = 'zb_...' order by created_at;
-- 2. settle_paystack_payment: Paystack's "abandoned" (customer opened checkout but has not paid) is no longer
--    recorded as a permanent failure; the payment stays open in case the customer finishes it.

create table if not exists public.payment_events (
  id bigint generated always as identity primary key,
  reference text not null,
  source text not null check (source in ('return', 'webhook', 'reconcile')),
  paystack_status text,
  amount_kobo bigint,
  currency text,
  outcome text,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists payment_events_reference_idx on public.payment_events (reference, created_at desc);
alter table public.payment_events enable row level security;
drop policy if exists payment_events_admin_read on public.payment_events;
create policy payment_events_admin_read on public.payment_events for select to authenticated using (public.is_platform_admin());
revoke all on public.payment_events from public, anon, authenticated;
grant select on public.payment_events to authenticated;
grant select, insert on public.payment_events to service_role;

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
    if p_status in ('failed', 'reversed') then
      update public.payments set status = 'failed', failure_reason = left(p_status, 80), updated_at = now() where id = pay.id;
      return 'failed';
    end if;
    if p_status = 'abandoned' then return 'abandoned'; end if; -- not paid (yet); leave the payment open
    return 'pending'; -- still ongoing at Paystack
  end if;

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
