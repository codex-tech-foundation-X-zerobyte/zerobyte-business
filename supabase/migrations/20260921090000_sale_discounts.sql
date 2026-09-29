-- Discount support -- the receipt has shown a hardcoded "Discount: 0" line
-- since it was first built; this is what makes it real, the same way
-- 20260918090000_sales_tax.sql made the hardcoded "VAT / tax: 0" line real.
--
-- `sales.total` keeps meaning "the taxable base" as established in that
-- migration -- it's now net of any discount, same as it was already net of
-- nothing. `discount_amount` stores the raw discount given so it stays
-- visible on the receipt rather than disappearing into a lower total with
-- no explanation. Tax is computed on the discounted amount (standard
-- practice: VAT applies to what the customer actually pays for the goods).
--
-- Scope note: only create_sale (the online path) takes a discount.
-- create_sale_with_operation (the offline-sync wrapper) is not changed --
-- it still calls create_sale with a 5-argument list, so synced offline
-- sales get the new discount_amount parameter's default of 0. Extending
-- the offline path too would mean touching its idempotency logic as well;
-- given offline sales already skip real-time price/stock validation until
-- sync, not supporting discounts there is a deliberate, smaller scope
-- rather than an oversight.

alter table public.sales
  add column if not exists discount_amount numeric(12,2) not null default 0;

alter table public.sales drop constraint if exists sales_discount_amount_check;
alter table public.sales add constraint sales_discount_amount_check
  check (discount_amount >= 0);

comment on column public.sales.discount_amount is
  'Discount applied at sale time, already subtracted from total. Stored separately so the receipt can show it as its own line rather than a total that silently doesn''t match the item prices.';

-- create_sale is changing from five arguments to six (adding discount_amount).
-- `create or replace` only replaces a function with the exact same argument
-- list; a different one creates a second, ambiguous overload instead -- the
-- same trap already noted in three earlier migrations this session
-- (get_platform_monitoring, update_product_catalog, and this function's own
-- prior discount-free version). Drop the old five-argument signature first.
drop function if exists public.create_sale(uuid, uuid, jsonb, uuid, text);

create or replace function public.create_sale(
  target_org uuid,
  target_customer uuid,
  items jsonb,
  target_branch uuid,
  target_payment_method text default 'cash',
  discount_amount numeric default 0
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
  gross_total numeric(12,2) := 0;
  net_total numeric(12,2) := 0;
  applied_discount numeric(12,2) := round(coalesce(discount_amount, 0), 2);
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
  if normalized_payment_method not in ('cash', 'card', 'transfer', 'mobile_money', 'mixed', 'credit', 'other') then
    raise exception 'Unsupported payment method';
  end if;
  if applied_discount < 0 then
    raise exception 'Discount cannot be negative';
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
    gross_total := gross_total + (product_row.price * item_quantity);
  end loop;

  if applied_discount > gross_total then
    raise exception 'Discount cannot exceed the sale subtotal';
  end if;
  net_total := gross_total - applied_discount;
  calculated_tax := round(net_total * org_tax_rate / 100, 2);

  insert into public.sales (organization_id, branch_id, customer_id, payment_method, total, discount_amount, tax_amount, created_by)
  values (target_org, resolved_branch, target_customer, normalized_payment_method, net_total, applied_discount, calculated_tax, auth.uid())
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
     jsonb_build_object('total', net_total, 'discount_amount', applied_discount, 'tax_amount', calculated_tax,
                        'branch_id', resolved_branch, 'payment_method', normalized_payment_method));
  return new_sale_id;
end;
$$;

grant execute on function public.create_sale(uuid, uuid, jsonb, uuid, text, numeric) to authenticated;
revoke all on function public.create_sale(uuid, uuid, jsonb, uuid, text, numeric) from public, anon;
