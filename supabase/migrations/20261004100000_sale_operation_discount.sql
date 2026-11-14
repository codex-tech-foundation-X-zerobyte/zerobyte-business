-- Idempotent sale creation now carries the discount.
--
-- Before this change only the online `create_sale` RPC accepted a discount, so
-- a sale queued offline (or retried after a dropped connection) silently lost
-- it: the cashier collected the discounted amount while the books recorded
-- full price. The client now sends every sale through this wrapper with a
-- client-generated operation id, which also makes retries safe (the same
-- operation id always returns the same sale instead of creating a duplicate).
--
-- Adding a parameter creates a new overload, which PostgREST cannot
-- disambiguate when called by name, so the previous signature is dropped.
--
-- BUG FIX: the previous version of this function (and of
-- create_customer_with_operation) failed on EVERY call with
--   ERROR: column reference "operation_id" is ambiguous
-- because the parameter `operation_id` collides with the column named in
-- `ON CONFLICT (operation_id)`. That meant no queued offline sale or customer
-- could ever sync. `#variable_conflict use_column` resolves the ambiguity
-- (parameters are otherwise only referenced in plain expressions here).

drop function if exists public.create_sale_with_operation(uuid, uuid, jsonb, uuid, text, uuid);

create or replace function public.create_sale_with_operation(
  target_org uuid,
  target_customer uuid,
  items jsonb,
  target_branch uuid,
  target_payment_method text default 'cash',
  operation_id uuid default null,
  discount_amount numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  existing public.sale_sync_operations%rowtype;
  created_sale uuid;
  requested_operation_id uuid := operation_id;
begin
  if requested_operation_id is null then
    raise exception 'An operation id is required';
  end if;
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'Not authorized for organization';
  end if;

  insert into public.sale_sync_operations(operation_id, organization_id, actor_id)
  values (requested_operation_id, target_org, auth.uid())
  on conflict (operation_id) do nothing;

  select * into existing
  from public.sale_sync_operations
  where sale_sync_operations.operation_id = requested_operation_id
  for update;
  if existing.organization_id <> target_org or existing.actor_id <> auth.uid() then
    raise exception 'Operation id belongs to another account';
  end if;
  if existing.sale_id is not null then
    return existing.sale_id;
  end if;

  created_sale := public.create_sale(
    target_org, target_customer, items, target_branch, target_payment_method,
    coalesce(discount_amount, 0)
  );
  update public.sale_sync_operations
  set sale_id = created_sale
  where sale_sync_operations.operation_id = requested_operation_id;
  return created_sale;
end;
$$;

revoke all on function public.create_sale_with_operation(uuid, uuid, jsonb, uuid, text, uuid, numeric) from public, anon;
grant execute on function public.create_sale_with_operation(uuid, uuid, jsonb, uuid, text, uuid, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- Same ambiguity fix for the offline customer wrapper (signature unchanged)
-- ---------------------------------------------------------------------------
create or replace function public.create_customer_with_operation(
  target_org uuid,
  target_branch uuid,
  customer_name text,
  customer_email text default null,
  customer_phone text default null,
  operation_id uuid default null,
  client_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  existing public.customer_sync_operations%rowtype;
  created_customer uuid;
  requested_operation_id uuid := operation_id;
begin
  if requested_operation_id is null then
    raise exception 'An operation id is required';
  end if;
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'Not authorized for organization';
  end if;

  insert into public.customer_sync_operations(operation_id, organization_id, actor_id)
  values (requested_operation_id, target_org, auth.uid())
  on conflict (operation_id) do nothing;

  select * into existing
  from public.customer_sync_operations
  where customer_sync_operations.operation_id = requested_operation_id
  for update;
  if existing.organization_id <> target_org or existing.actor_id <> auth.uid() then
    raise exception 'Operation id belongs to another account';
  end if;
  if existing.customer_id is not null then
    return existing.customer_id;
  end if;

  created_customer := public.create_customer(target_org, target_branch, customer_name, customer_email, customer_phone);
  update public.customer_sync_operations
  set customer_id = created_customer
  where customer_sync_operations.operation_id = requested_operation_id;
  return created_customer;
end;
$$;

revoke all on function public.create_customer_with_operation(uuid, uuid, text, text, text, uuid, uuid) from public, anon;
grant execute on function public.create_customer_with_operation(uuid, uuid, text, text, text, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- BUG FIX: receipt integrity check ignored discounts
-- ---------------------------------------------------------------------------
-- assert_sale_receipt_total() (a deferred constraint trigger) required
-- sales.total = sum(sale_items.line_total). Since discounts were introduced
-- sales.total is stored NET of discount, so every sale with a discount failed
-- at COMMIT with "Sale total must equal the sum of receipt line items".
-- The invariant is now: net total + discount = sum of line items.
create or replace function public.assert_sale_receipt_total(target_sale uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  sale_total numeric(12,2);
  sale_discount numeric(12,2);
  line_total_sum numeric(12,2);
begin
  select total, coalesce(discount_amount, 0)
    into sale_total, sale_discount
  from public.sales where id = target_sale;
  if sale_total is null then
    return;
  end if;
  select coalesce(sum(line_total), 0)
    into line_total_sum
  from public.sale_items
  where sale_id = target_sale;
  if sale_total + sale_discount <> line_total_sum then
    raise exception 'Sale total plus discount must equal the sum of receipt line items';
  end if;
end;
$$;
