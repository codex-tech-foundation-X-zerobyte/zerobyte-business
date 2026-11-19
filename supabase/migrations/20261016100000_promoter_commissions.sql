-- Promoter programme: editable commission terms, an automatic commission ledger, and the views around them.
--
-- Rules (defaults; a Super or Finance admin can change them in the admin area):
--   * the FIRST successful payment of a referred business earns the promoter 10% of the plan price paid,
--   * each later successful payment earns 5%,
--   * but only for 18 months (1 year 6 months) counted from that first payment.
-- A referral keeps the terms in force when its first payment happened, so changing the terms only affects NEW referrals
-- (a promoter's deal does not shift under them). Commission is a percentage of the plan price (payments.amount_kobo),
-- not of any Paystack fee a customer paid on top. Suspended promoters earn nothing on new payments. Commissions are
-- recorded as 'pending' and an admin marks them 'paid' after paying the promoter; nothing is paid out automatically.

create table if not exists public.promoter_program_terms (
  id boolean primary key default true check (id),
  first_payment_percent numeric(5, 2) not null default 10 check (first_payment_percent between 0 and 50),
  recurring_percent numeric(5, 2) not null default 5 check (recurring_percent between 0 and 50),
  duration_months integer not null default 18 check (duration_months between 1 and 60),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
insert into public.promoter_program_terms (id) values (true) on conflict do nothing;
alter table public.promoter_program_terms enable row level security;
revoke all on public.promoter_program_terms from public, anon, authenticated;

alter table public.referrals add column if not exists first_paid_at timestamptz;
alter table public.referrals add column if not exists commission_first_percent numeric(5, 2);
alter table public.referrals add column if not exists commission_recurring_percent numeric(5, 2);
alter table public.referrals add column if not exists commission_months integer;
alter table public.referrals add column if not exists commission_ends_at timestamptz;

create table if not exists public.promoter_commissions (
  id uuid primary key default gen_random_uuid(),
  promoter_id uuid not null references public.promoters(id) on delete restrict,
  referral_id uuid not null references public.referrals(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  payment_id uuid not null unique references public.payments(id) on delete restrict,
  kind text not null check (kind in ('first', 'recurring')),
  payment_amount_kobo bigint not null check (payment_amount_kobo > 0),
  percent numeric(5, 2) not null,
  commission_kobo bigint not null check (commission_kobo >= 0),
  status text not null default 'pending' check (status in ('pending', 'paid', 'void')),
  paid_at timestamptz,
  paid_by uuid references auth.users(id),
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now()
);
create index if not exists idx_promoter_commissions_promoter on public.promoter_commissions (promoter_id, created_at desc);
create index if not exists idx_promoter_commissions_status on public.promoter_commissions (status, created_at desc);
alter table public.promoter_commissions enable row level security;
revoke all on public.promoter_commissions from public, anon, authenticated;
drop policy if exists promoter_commissions_read on public.promoter_commissions;
create policy promoter_commissions_read on public.promoter_commissions for select to authenticated
  using (exists (select 1 from public.promoters p where p.id = promoter_id and p.user_id = auth.uid()) or public.can_view_financial_admin_data());
grant select on public.promoter_commissions to authenticated;

-- What the public landing page and the promoter pages show.
create or replace function public.get_public_promoter_terms()
returns table (first_payment_percent numeric, recurring_percent numeric, duration_months integer)
language sql stable security definer set search_path = public as $$
  select t.first_payment_percent, t.recurring_percent, t.duration_months from public.promoter_program_terms t where t.id;
$$;
revoke all on function public.get_public_promoter_terms() from public;
grant execute on function public.get_public_promoter_terms() to anon, authenticated;

-- Super and Finance admins only.
create or replace function public.admin_set_promoter_terms(p_first numeric, p_recurring numeric, p_months integer)
returns void language plpgsql security definer set search_path = public as $$
declare
  before_terms jsonb;
begin
  if not public.can_view_financial_admin_data() then raise exception 'UNAUTHORIZED: super admin or finance admin access required'; end if;
  if p_first is null or p_first < 0 or p_first > 50 then raise exception 'VALIDATION_ERROR: first payment percentage must be between 0 and 50'; end if;
  if p_recurring is null or p_recurring < 0 or p_recurring > 50 then raise exception 'VALIDATION_ERROR: recurring percentage must be between 0 and 50'; end if;
  if p_months is null or p_months < 1 or p_months > 60 then raise exception 'VALIDATION_ERROR: duration must be between 1 and 60 months'; end if;
  select to_jsonb(t) - 'updated_by' - 'updated_at' into before_terms from public.promoter_program_terms t where t.id;
  update public.promoter_program_terms set first_payment_percent = round(p_first, 2), recurring_percent = round(p_recurring, 2), duration_months = p_months, updated_by = auth.uid(), updated_at = now() where id;
  insert into public.admin_audit_logs (actor_id, actor_role, action, target_type, metadata)
    values (auth.uid(), (select a.role from public.platform_admin_access a where a.user_id = auth.uid() and a.status = 'active' order by case a.role when 'SUPER_ADMIN' then 0 when 'FINANCE_ADMIN' then 1 else 2 end limit 1),
            'update_promoter_terms', 'promoter_program_terms', jsonb_build_object('before', before_terms, 'after', jsonb_build_object('first_payment_percent', round(p_first, 2), 'recurring_percent', round(p_recurring, 2), 'duration_months', p_months)));
end;
$$;
revoke all on function public.admin_set_promoter_terms(numeric, numeric, integer) from public, anon;
grant execute on function public.admin_set_promoter_terms(numeric, numeric, integer) to authenticated;

-- Internal: called from settle_paystack_payment (service role path); not callable from the browser.
create or replace function public.accrue_promoter_commission(p_payment uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  pay public.payments%rowtype;
  ref public.referrals%rowtype;
  promoter_state text;
  terms public.promoter_program_terms%rowtype;
  paid_when timestamptz;
  commission_kind text;
  pct numeric(5, 2);
begin
  select * into pay from public.payments where id = p_payment and status = 'success';
  if pay.id is null then return; end if;
  select r.* into ref from public.referrals r join public.promoters p on p.id = r.promoter_id
    where r.organization_id = pay.organization_id order by r.signed_up_at asc limit 1 for update of r;
  if ref.id is null or ref.status = 'expired' then return; end if;
  select p.status into promoter_state from public.promoters p where p.id = ref.promoter_id;
  if promoter_state is distinct from 'active' then return; end if;
  paid_when := coalesce(pay.paid_at, now());

  if ref.first_paid_at is null then
    select * into terms from public.promoter_program_terms where id;
    update public.referrals set first_paid_at = paid_when, commission_first_percent = terms.first_payment_percent,
      commission_recurring_percent = terms.recurring_percent, commission_months = terms.duration_months,
      commission_ends_at = paid_when + make_interval(months => terms.duration_months),
      status = case when status in ('paid') then status else 'commissionable' end,
      qualified_at = coalesce(qualified_at, paid_when)
      where id = ref.id returning * into ref;
    commission_kind := 'first'; pct := ref.commission_first_percent;
  elsif paid_when < ref.commission_ends_at then
    commission_kind := 'recurring'; pct := ref.commission_recurring_percent;
  else
    return; -- the commission window for this referral has ended
  end if;
  if coalesce(pct, 0) <= 0 then return; end if;

  insert into public.promoter_commissions (promoter_id, referral_id, organization_id, payment_id, kind, payment_amount_kobo, percent, commission_kobo)
    values (ref.promoter_id, ref.id, pay.organization_id, pay.id, commission_kind, pay.amount_kobo, pct, floor(pay.amount_kobo * pct / 100))
    on conflict (payment_id) do nothing;
end;
$$;
revoke all on function public.accrue_promoter_commission(uuid) from public, anon, authenticated;
grant execute on function public.accrue_promoter_commission(uuid) to service_role;

-- A promoter's own earnings.
create or replace function public.get_promoter_earnings()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare pid uuid; result jsonb;
begin
  select id into pid from public.promoters where user_id = auth.uid() limit 1;
  if pid is null then return jsonb_build_object('pending_kobo', 0, 'paid_kobo', 0, 'recent', '[]'::jsonb); end if;
  select jsonb_build_object(
    'pending_kobo', coalesce(sum(commission_kobo) filter (where status = 'pending'), 0),
    'paid_kobo', coalesce(sum(commission_kobo) filter (where status = 'paid'), 0),
    'recent', coalesce((select jsonb_agg(t order by t.created_at desc) from (select c.kind, c.percent, c.commission_kobo, c.status, c.created_at, o.name as business from public.promoter_commissions c join public.organizations o on o.id = c.organization_id where c.promoter_id = pid order by c.created_at desc limit 30) t), '[]'::jsonb))
  into result from public.promoter_commissions where promoter_id = pid;
  return result;
end;
$$;
revoke all on function public.get_promoter_earnings() from public, anon;
grant execute on function public.get_promoter_earnings() to authenticated;

-- Admin: ledger and marking commissions paid (Super / Finance only).
create or replace function public.admin_list_commissions(p_status text default null, p_limit integer default 100)
returns table (id uuid, promoter_name text, promoter_code text, business text, kind text, percent numeric, payment_kobo bigint, commission_kobo bigint, status text, created_at timestamptz, paid_at timestamptz, note text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_view_financial_admin_data() then raise exception 'UNAUTHORIZED: super admin or finance admin access required'; end if;
  return query select c.id, p.full_name, p.referral_code, o.name, c.kind, c.percent, c.payment_amount_kobo, c.commission_kobo, c.status, c.created_at, c.paid_at, c.note
    from public.promoter_commissions c join public.promoters p on p.id = c.promoter_id join public.organizations o on o.id = c.organization_id
    where p_status is null or c.status = p_status order by c.created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;
revoke all on function public.admin_list_commissions(text, integer) from public, anon;
grant execute on function public.admin_list_commissions(text, integer) to authenticated;

create or replace function public.admin_set_commission_status(p_id uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_view_financial_admin_data() then raise exception 'UNAUTHORIZED: super admin or finance admin access required'; end if;
  if p_status not in ('paid', 'void', 'pending') then raise exception 'VALIDATION_ERROR: status must be paid, void or pending'; end if;
  update public.promoter_commissions set status = p_status, note = left(p_note, 500),
    paid_at = case when p_status = 'paid' then now() else null end, paid_by = case when p_status = 'paid' then auth.uid() else null end where id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  insert into public.admin_audit_logs (actor_id, actor_role, action, target_type, target_id, metadata)
    values (auth.uid(), (select a.role from public.platform_admin_access a where a.user_id = auth.uid() and a.status = 'active' order by case a.role when 'SUPER_ADMIN' then 0 when 'FINANCE_ADMIN' then 1 else 2 end limit 1), 'set_commission_status', 'promoter_commission', p_id, jsonb_build_object('status', p_status));
end;
$$;
revoke all on function public.admin_set_commission_status(uuid, text, text) from public, anon;
grant execute on function public.admin_set_commission_status(uuid, text, text) to authenticated;

-- settle_paystack_payment: unchanged except that it now also records the promoter's commission (safely).
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

  -- Commission for the promoter who referred this business. It must never block or undo a plan activation.
  begin
    perform public.accrue_promoter_commission(pay.id);
  exception when others then
    raise warning 'promoter commission accrual failed for payment %: %', pay.id, sqlerrm;
  end;

  return 'activated';
end;
$$;
revoke all on function public.settle_paystack_payment(text, text, bigint, text, text, text, timestamptz, bigint, bigint) from public, anon, authenticated;
grant execute on function public.settle_paystack_payment(text, text, bigint, text, text, text, timestamptz, bigint, bigint) to service_role;

notify pgrst, 'reload schema';
