-- PostgreSQL has no min(uuid) aggregate. Recreate the branch-aware sale RPC
-- with a separate count and single-row branch lookup.
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

  insert into public.sales (organization_id, branch_id, customer_id, payment_method, total, created_by)
  values (target_org, resolved_branch, target_customer, normalized_payment_method, calculated_total, auth.uid())
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
     jsonb_build_object('total', calculated_total, 'branch_id', resolved_branch,
                        'payment_method', normalized_payment_method));
  return new_sale_id;
end;
$$;

grant execute on function public.create_sale(uuid, uuid, jsonb, uuid, text) to authenticated;
revoke all on function public.create_sale(uuid, uuid, jsonb, uuid, text) from public, anon;

-- Employee branch assignments are the source of truth for provisioned workers.
-- Keep the access table in sync so branch-scoped RLS and sale resolution use
-- the same assignment.
insert into public.branch_members (branch_id, user_id)
select ep.branch_id, ep.user_id
from public.employee_profiles ep
join public.branches b on b.id = ep.branch_id
where ep.user_id is not null
  and ep.branch_id is not null
  and b.status = 'active'
on conflict (branch_id, user_id) do nothing;

create or replace function public.link_provisioned_worker(
  target_org uuid,
  target_employee uuid,
  target_user uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  profile_row public.employee_profiles%rowtype;
  auth_email text;
  auth_phone text;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then
    raise exception 'Worker identity linking is service-role only';
  end if;

  select * into profile_row
  from public.employee_profiles
  where id = target_employee and organization_id = target_org
  for update;
  if not found then raise exception 'Employee profile does not belong to this organization'; end if;
  if profile_row.user_id is not null then raise exception 'Employee profile is already linked'; end if;
  if profile_row.branch_id is not null
     and not public.valid_org_branch(target_org, profile_row.branch_id) then
    raise exception 'Employee branch does not belong to this organization';
  end if;
  if not exists (select 1 from auth.users where id = target_user) then
    raise exception 'Auth identity does not exist';
  end if;
  if exists (select 1 from public.employee_profiles where user_id = target_user) then
    raise exception 'Auth identity is already linked to an employee';
  end if;
  select email, phone into auth_email, auth_phone from auth.users where id = target_user;
  if profile_row.email is not null
     and (auth_email is null or lower(profile_row.email) <> lower(auth_email)) then
    raise exception 'Auth email does not match the employee profile';
  end if;
  if exists (
    select 1 from public.organization_members
    where organization_id = target_org and user_id = target_user
  ) then
    raise exception 'Auth identity already belongs to this organization';
  end if;

  update public.employee_profiles
  set user_id = target_user, email = coalesce(auth_email, email),
      phone = coalesce(auth_phone, phone), must_change_password = true,
      updated_at = now()
  where id = target_employee;

  insert into public.organization_members (organization_id, user_id, role)
  values (target_org, target_user, 'member')
  on conflict (organization_id, user_id) do nothing;

  if profile_row.branch_id is not null then
    insert into public.branch_members (branch_id, user_id)
    values (profile_row.branch_id, target_user)
    on conflict (branch_id, user_id) do nothing;
  end if;
  return target_employee;
end;
$$;

revoke all on function public.link_provisioned_worker(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.link_provisioned_worker(uuid, uuid, uuid) to service_role;
