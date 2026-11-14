-- Receipt / customer / business-profile fixes
--
-- 1. customers.address and organizations.tagline (both optional) so a receipt can show a customer's address
--    and a business's own slogan instead of a platform slogan.
-- 2. create_customer / create_customer_with_operation accept the address (old signatures dropped so PostgREST
--    never sees two overloads it cannot choose between).
-- 3. A credit sale now requires a registered customer. 'credit' adds to a customer's running balance, so a
--    walk-in credit sale would create a debt nobody can collect.

alter table public.customers add column if not exists address text;
alter table public.organizations add column if not exists tagline text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'customers_address_length') then
    alter table public.customers add constraint customers_address_length check (address is null or char_length(address) <= 300);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'organizations_tagline_length') then
    alter table public.organizations add constraint organizations_tagline_length check (tagline is null or char_length(tagline) <= 120);
  end if;
end $$;

drop function if exists public.create_customer(uuid, uuid, text, text, text);
create or replace function public.create_customer(
  target_org uuid,
  target_branch uuid,
  customer_name text,
  customer_email text default null,
  customer_phone text default null,
  customer_address text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_branch uuid := target_branch;
  branch_count integer;
  new_customer_id uuid;
begin
  if not public.is_org_member(target_org) then
    raise exception 'Not authorized for organization';
  end if;
  if nullif(trim(customer_name), '') is null then
    raise exception 'Customer name is required';
  end if;
  if char_length(coalesce(customer_address, '')) > 300 then
    raise exception 'Customer address is too long';
  end if;

  if resolved_branch is null and not public.is_org_manager(target_org) then
    select count(*), min(bm.branch_id)
      into branch_count, resolved_branch
    from public.branch_members bm
    join public.branches b on b.id = bm.branch_id
    where bm.user_id = auth.uid()
      and b.organization_id = target_org
      and b.status = 'active';
    if branch_count <> 1 then
      raise exception 'Select one of your assigned branches';
    end if;
  elsif resolved_branch is not null and not public.can_access_branch(target_org, resolved_branch) then
    raise exception 'Branch is not assigned to this worker';
  end if;

  if resolved_branch is null and not public.is_org_manager(target_org) then
    raise exception 'A worker customer must have a branch';
  end if;

  insert into public.customers (organization_id, branch_id, name, email, phone, address)
  values (target_org, resolved_branch, trim(customer_name), nullif(trim(customer_email), ''),
          nullif(trim(customer_phone), ''), nullif(trim(customer_address), ''))
  returning id into new_customer_id;
  return new_customer_id;
end;
$$;
revoke all on function public.create_customer(uuid, uuid, text, text, text, text) from public, anon;
grant execute on function public.create_customer(uuid, uuid, text, text, text, text) to authenticated;

drop function if exists public.create_customer_with_operation(uuid, uuid, text, text, text, uuid, uuid);
create or replace function public.create_customer_with_operation(
  target_org uuid,
  target_branch uuid,
  customer_name text,
  customer_email text default null,
  customer_phone text default null,
  operation_id uuid default null,
  client_id uuid default null,
  customer_address text default null
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

  created_customer := public.create_customer(target_org, target_branch, customer_name, customer_email, customer_phone, customer_address);
  update public.customer_sync_operations
  set customer_id = created_customer
  where customer_sync_operations.operation_id = requested_operation_id;
  return created_customer;
end;
$$;
revoke all on function public.create_customer_with_operation(uuid, uuid, text, text, text, uuid, uuid, text) from public, anon;
grant execute on function public.create_customer_with_operation(uuid, uuid, text, text, text, uuid, uuid, text) to authenticated;

-- create_sale: identical to the previous definition except for the credit-needs-a-customer guard.
CREATE OR REPLACE FUNCTION public.create_sale(target_org uuid, target_customer uuid, items jsonb, target_branch uuid, target_payment_method text DEFAULT 'cash'::text, discount_amount numeric DEFAULT 0)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if normalized_payment_method = 'credit' and target_customer is null then
    raise exception 'A credit sale needs a registered customer';
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
$function$;
