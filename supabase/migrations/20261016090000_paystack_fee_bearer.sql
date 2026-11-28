-- Fix: payments were rejected as "amount did not match" when Paystack is set to make the CUSTOMER pay its fees.
--
-- In that mode Paystack charges the plan price PLUS its fee, and the verify response reports the total in `amount`,
-- the original request in `requested_amount`, and the fee in `fees`. The old check demanded amount = plan price, so a
-- correct payment (e.g. 500,000 kobo + 7,500 fee = 507,500) was flagged as a mismatch and the plan never activated.
--
-- New rule (all numbers come from Paystack's own verify response, never from the browser):
--   accept when  amount = expected                                         (merchant bears fees), or
--   accept when  amount > expected AND requested_amount (if given) = expected AND 0 < amount - expected <= fees
--   anything else is still a mismatch: underpayment, an unexplained overpayment, or a changed requested amount.
-- The plan price we are owed (payments.amount_kobo) is unchanged, so revenue figures stay the plan price, not fees.

alter table public.payments add column if not exists paid_amount_kobo bigint;
alter table public.payments add column if not exists fees_kobo bigint;
alter table public.payment_events add column if not exists requested_amount_kobo bigint;
alter table public.payment_events add column if not exists fees_kobo bigint;

drop function if exists public.settle_paystack_payment(text, text, bigint, text, text, text, timestamptz);
create or replace function public.settle_paystack_payment(
  p_reference text,
  p_status text,
  p_amount_kobo bigint,
  p_currency text,
  p_transaction_id text,
  p_channel text,
  p_paid_at timestamptz,
  p_requested_amount_kobo bigint default null,
  p_fees_kobo bigint default null
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
  amount_ok boolean := false;
begin
  select * into pay from public.payments where reference = p_reference for update;
  if pay.id is null then return 'not_found'; end if;
  if pay.status = 'success' then return 'already_settled'; end if;

  if p_status <> 'success' then
    if p_status in ('failed', 'reversed') then
      update public.payments set status = 'failed', failure_reason = left(p_status, 80), updated_at = now() where id = pay.id;
      return 'failed';
    end if;
    if p_status = 'abandoned' then return 'abandoned'; end if;
    return 'pending';
  end if;

  if p_amount_kobo = pay.amount_kobo then
    amount_ok := (p_requested_amount_kobo is null or p_requested_amount_kobo = pay.amount_kobo);
  elsif p_amount_kobo > pay.amount_kobo and coalesce(p_fees_kobo, 0) > 0
        and (p_requested_amount_kobo is null or p_requested_amount_kobo = pay.amount_kobo)
        and (p_amount_kobo - pay.amount_kobo) <= p_fees_kobo then
    amount_ok := true; -- the customer paid the plan price plus Paystack's own fee
  end if;

  if not amount_ok or upper(coalesce(p_currency, '')) <> upper(pay.currency) then
    update public.payments
      set status = 'mismatch',
          failure_reason = format('expected %s %s kobo; Paystack reported %s %s (requested %s, fees %s)', pay.currency, pay.amount_kobo, coalesce(p_currency, '?'), coalesce(p_amount_kobo::text, '?'), coalesce(p_requested_amount_kobo::text, 'n/a'), coalesce(p_fees_kobo::text, 'n/a')),
          paid_amount_kobo = p_amount_kobo, fees_kobo = p_fees_kobo, updated_at = now()
      where id = pay.id;
    return 'mismatch';
  end if;

  update public.payments
    set status = 'success', provider_transaction_id = p_transaction_id, channel = p_channel, paid_at = coalesce(p_paid_at, now()),
        failure_reason = null, paid_amount_kobo = p_amount_kobo, fees_kobo = p_fees_kobo, updated_at = now()
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
    plan_id = pay.plan_id, price_version_id = pay.price_version_id, status = 'active', trial_end = null,
    current_period_start = period_start, current_period_end = period_end, canceled_at = null,
    provider = 'paystack', provider_subscription_id = pay.reference, updated_at = now()
    where id = sub.id;

  insert into public.subscription_events (subscription_id, organization_id, event_type, from_plan_id, to_plan_id, actor_id, note)
    values (sub.id, pay.organization_id, 'activated', sub.plan_id, pay.plan_id, pay.initiated_by, 'Paid online via Paystack (reference ' || pay.reference || ')');

  return 'activated';
end;
$$;
revoke all on function public.settle_paystack_payment(text, text, bigint, text, text, text, timestamptz, bigint, bigint) from public, anon, authenticated;
grant execute on function public.settle_paystack_payment(text, text, bigint, text, text, text, timestamptz, bigint, bigint) to service_role;

notify pgrst, 'reload schema';
