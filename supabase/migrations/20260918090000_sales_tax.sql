-- Adds a configurable tax rate per organization and a tax amount computed
-- and stored on each sale at the moment it's created.
--
-- Deliberately additive and non-breaking: `sales.total` keeps its existing
-- meaning (the pre-tax subtotal, i.e. sum of item prices) rather than being
-- silently redefined to include tax. Every existing dashboard, report, and
-- reconciliation query that already reads `total` keeps working exactly as
-- before, with the same figures it always had. This is also the correct
-- accounting treatment, not just the safe one: VAT collected from a
-- customer is money held on behalf of the tax authority, not the
-- business's own revenue, so tracking it in a separate column is standard
-- practice, not a workaround.
--
-- The one place a customer actually sees this breakdown -- the receipt --
-- already had a hardcoded "VAT / tax: 0" line; this migration is what
-- makes that line real.

alter table public.organizations
  add column if not exists tax_rate numeric(5,2) not null default 0;

alter table public.organizations
  drop constraint if exists organizations_tax_rate_check;
alter table public.organizations
  add constraint organizations_tax_rate_check
  check (tax_rate >= 0 and tax_rate <= 100);

alter table public.sales
  add column if not exists tax_amount numeric(12,2) not null default 0;

alter table public.sales
  drop constraint if exists sales_tax_amount_check;
alter table public.sales
  add constraint sales_tax_amount_check
  check (tax_amount >= 0);

comment on column public.organizations.tax_rate is
  'VAT/sales tax percentage (0-100) applied to new sales at creation time. Changing this does not retroactively change tax_amount on past sales.';
comment on column public.sales.tax_amount is
  'Tax computed from the organization''s tax_rate at the moment this sale was created, stored so historical receipts stay accurate even if the org''s rate changes later.';

-- Same signature as the existing function (create or replace therefore
-- updates it in place rather than creating an overload); the only change
-- is computing and storing tax_amount from the org's own configured rate.
-- The rate is read server-side from the organizations row, never trusted
-- from client input, since this is a financial calculation.
create or replace function public.create_sale(
  target_org uuid,
  target_customer uuid,
  items jsonb,
  target_branch uuid,
  target_payment_method text default 'cash'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_sale_id uuid;
  item jsonb;
  product_row public.products%rowtype;
  item_product_id uuid;
  item_quantity integer;
  updated_product_id uuid;
  resolved_branch uuid := target_branch;
  calculated_total numeric(12,2) := 0;
  calculated_tax numeric(12,2) := 0;
  org_tax_rate numeric(5,2) := 0;
  assigned_branch_count integer;
  assigned_branch uuid;
  seen_product_ids uuid[] := '{}';
  normalized_payment_method text := lower(coalesce(nullif(trim(target_payment_method), ''), 'cash'));
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'Not authorized for organization';
  end if;
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) = 0 then
    raise exception 'At least one sale item is required';
  end if;
  if normalized_payment_method not in ('cash', 'card', 'transfer', 'mobile_money', 'mixed', 'other') then
    raise exception 'Unsupported payment method';
  end if;

  select coalesce(tax_rate, 0) into org_tax_rate
  from public.organizations
  where id = target_org;

  if resolved_branch is null and not public.is_org_manager(target_org) then
    select count(*)
      into assigned_branch_count
    from public.branch_members bm
    join public.branches b on b.id = bm.branch_id
    where bm.user_id = auth.uid()
      and b.organization_id = target_org
      and b.status = 'active';
    if assigned_branch_count <> 1 then
      raise exception 'Select one of your assigned branches';
    end if;
    select bm.branch_id
      into assigned_branch
    from public.branch_members bm
    join public.branches b on b.id = bm.branch_id
    where bm.user_id = auth.uid()
      and b.organization_id = target_org
      and b.status = 'active'
    limit 1;
    resolved_branch := assigned_branch;
  elsif resolved_branch is not null then
    if not public.valid_org_branch(target_org, resolved_branch) then
      raise exception 'Branch does not belong to this organization';
    end if;
    if not public.can_access_branch(target_org, resolved_branch) then
      raise exception 'Branch is not assigned to this worker';
    end if;
  end if;

  if target_customer is not null and not exists (
    select 1
    from public.customers c
    where c.id = target_customer
      and c.organization_id = target_org
      and (c.branch_id is null or resolved_branch is null or c.branch_id = resolved_branch)
  ) then
    raise exception 'Customer does not belong to this organization or branch';
  end if;

  for item in select * from jsonb_array_elements(items) loop
    item_product_id := (item->>'product_id')::uuid;
    item_quantity := (item->>'quantity')::integer;
    if item_quantity is null or item_quantity <= 0 then
      raise exception 'Sale quantity must be greater than zero';
    end if;
    if item_product_id = any(seen_product_ids) then
      raise exception 'A product may only appear once in a sale';
    end if;
    seen_product_ids := array_append(seen_product_ids, item_product_id);
    select * into product_row
    from public.products
    where id = item_product_id
      and organization_id = target_org
      and (branch_id is null or resolved_branch is null or branch_id = resolved_branch)
    for update;
    if not found then
      raise exception 'Product does not belong to this organization or branch';
    end if;
    if product_row.stock < item_quantity then
      raise exception 'Insufficient stock for %', product_row.name;
    end if;
    calculated_total := calculated_total + (product_row.price * item_quantity);
  end loop;

  calculated_tax := round(calculated_total * org_tax_rate / 100, 2);

  insert into public.sales (organization_id, branch_id, customer_id, payment_method, total, tax_amount, created_by)
  values (target_org, resolved_branch, target_customer, normalized_payment_method, calculated_total, calculated_tax, auth.uid())
  returning id into new_sale_id;

  perform set_config('app.inventory_mutation', 'on', true);
  for item in select * from jsonb_array_elements(items) loop
    item_product_id := (item->>'product_id')::uuid;
    item_quantity := (item->>'quantity')::integer;
    select * into product_row
    from public.products
    where id = item_product_id and organization_id = target_org
    for update;
    update public.products
    set stock = stock - item_quantity, updated_at = now()
    where id = product_row.id and stock >= item_quantity
    returning id into updated_product_id;
    if updated_product_id is null then
      raise exception 'Insufficient stock for %', product_row.name;
    end if;
    insert into public.sale_items (sale_id, product_id, quantity, unit_price)
    values (new_sale_id, product_row.id, item_quantity, product_row.price);
    insert into public.stock_movements
      (organization_id, branch_id, product_id, movement_type, quantity, cost_price, selling_price, actor_id)
    values
      (target_org, resolved_branch, product_row.id, 'sale', -item_quantity,
       product_row.cost_price, product_row.price, auth.uid());
  end loop;

  insert into public.audit_logs
    (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values
    (target_org, auth.uid(), 'sale.created', 'sale', new_sale_id,
     jsonb_build_object('total', calculated_total, 'tax_amount', calculated_tax, 'branch_id', resolved_branch,
                        'payment_method', normalized_payment_method));
  return new_sale_id;
end;
$$;

grant execute on function public.create_sale(uuid, uuid, jsonb, uuid, text) to authenticated;
revoke all on function public.create_sale(uuid, uuid, jsonb, uuid, text) from public, anon;
