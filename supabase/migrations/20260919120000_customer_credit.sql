-- Customer running balance ("buy now, settle later"): a sale can be marked
-- 'credit' instead of being paid immediately, and payments received later
-- are recorded separately and matched against the customer's outstanding
-- total. This is deliberately not full accounts-receivable software --
-- there's no per-invoice matching, just a running total per customer,
-- which is what a small shop actually keeping a "who owes what" notebook
-- needs.

alter table public.sales drop constraint if exists sales_payment_method_check;
alter table public.sales add constraint sales_payment_method_check
  check (payment_method in ('cash', 'card', 'transfer', 'mobile_money', 'mixed', 'credit', 'other'));

create table if not exists public.customer_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_customer_payments_customer on public.customer_payments (customer_id, created_at desc);

alter table public.customer_payments enable row level security;
create policy "members view customer payments" on public.customer_payments for select using (public.is_org_member(organization_id));
-- Writes only through record_customer_payment below (security definer),
-- same reasoning as sales/purchase orders: a running balance is a trust-
-- sensitive figure, so it goes through one validated path rather than
-- a direct-insert policy.

-- Returns each customer's outstanding balance: what they've bought on
-- credit, minus what they've paid back. Read-only, so this is a plain
-- query function rather than needing a materialized/stored balance that
-- could drift out of sync with the underlying sales and payments.
create or replace function public.get_customer_balances(target_org uuid)
returns table (customer_id uuid, total_credit numeric, total_paid numeric, balance numeric)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id as customer_id,
    coalesce(s.credit_total, 0) as total_credit,
    coalesce(p.paid_total, 0) as total_paid,
    coalesce(s.credit_total, 0) - coalesce(p.paid_total, 0) as balance
  from public.customers c
  left join (
    select customer_id, sum(total + tax_amount) as credit_total
    from public.sales
    where organization_id = target_org and payment_method = 'credit' and customer_id is not null
    group by customer_id
  ) s on s.customer_id = c.id
  left join (
    select customer_id, sum(amount) as paid_total
    from public.customer_payments
    where organization_id = target_org
    group by customer_id
  ) p on p.customer_id = c.id
  where c.organization_id = target_org
    and public.is_org_member(target_org);
$$;

create or replace function public.record_customer_payment(
  target_org uuid,
  target_customer uuid,
  amount numeric,
  payment_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_payment_id uuid;
begin
  if not public.is_org_member(target_org) then
    raise exception using message = '{"code":"NOT_A_MEMBER","message":"Not a member of this organization"}';
  end if;
  if amount <= 0 then
    raise exception using message = '{"code":"VALIDATION_ERROR","message":"Payment amount must be greater than zero"}';
  end if;
  if not exists (select 1 from public.customers where id = target_customer and organization_id = target_org) then
    raise exception using message = '{"code":"CUSTOMER_NOT_FOUND","message":"Customer does not belong to this organization"}';
  end if;

  insert into public.customer_payments (organization_id, customer_id, amount, note, created_by)
  values (target_org, target_customer, amount, nullif(trim(coalesce(payment_note, '')), ''), auth.uid())
  returning id into new_payment_id;

  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'customer.payment_recorded', 'customer', target_customer, jsonb_build_object('amount', amount));

  return new_payment_id;
end;
$$;

grant execute on function public.get_customer_balances(uuid) to authenticated;
grant execute on function public.record_customer_payment(uuid, uuid, numeric, text) to authenticated;
revoke all on function public.get_customer_balances(uuid) from public, anon;
revoke all on function public.record_customer_payment(uuid, uuid, numeric, text) from public, anon;
