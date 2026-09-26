-- Close the remaining direct-mutation paths. Managers use trusted RPCs for
-- inventory changes and the worker deactivation function revokes Auth access.

create or replace function public.prevent_direct_inventory_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.stock is distinct from old.stock
      or new.cost_price is distinct from old.cost_price)
     and current_setting('app.inventory_mutation', true) <> 'on' then
    raise exception using
      message = '{"code":"INVENTORY_RPC_REQUIRED","message":"Inventory changes must use a stock movement operation"}';
  end if;
  return new;
end;
$$;

drop trigger if exists products_require_inventory_rpc on public.products;
create trigger products_require_inventory_rpc
before update on public.products
for each row execute function public.prevent_direct_inventory_mutation();

create or replace function public.prevent_product_history_deletion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.stock_movements where product_id = old.id)
     or exists (select 1 from public.sale_items where product_id = old.id) then
    raise exception using
      message = '{"code":"PRODUCT_HAS_HISTORY","message":"Products with stock or sales history cannot be deleted"}';
  end if;
  return old;
end;
$$;

drop trigger if exists products_keep_history on public.products;
create trigger products_keep_history
before delete on public.products
for each row execute function public.prevent_product_history_deletion();

create or replace function public.prevent_client_worker_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.employment_status is distinct from old.employment_status
     and current_setting('request.jwt.claim.role', true) <> 'service_role' then
    raise exception using
      message = '{"code":"WORKER_STATUS_RPC_REQUIRED","message":"Worker status changes must use the secure deactivation service"}';
  end if;
  return new;
end;
$$;

drop trigger if exists employee_status_service_only on public.employee_profiles;
create trigger employee_status_service_only
before update of employment_status on public.employee_profiles
for each row execute function public.prevent_client_worker_status_change();

-- A manager can change stock and prices only inside a trusted transaction.
create or replace function public.receive_stock(
  target_org uuid,
  target_product uuid,
  quantity_to_add integer,
  new_cost numeric default null,
  new_selling numeric default null,
  target_branch uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  movement_id uuid;
  previous_stock integer;
  product_branch uuid;
begin
  if not public.can_manage_inventory(target_org) then
    raise exception using message = '{"code":"INVENTORY_ACCESS_DENIED","message":"Only an owner or manager can receive stock"}';
  end if;
  if quantity_to_add <= 0 then
    raise exception using message = '{"code":"VALIDATION_ERROR","message":"Quantity must be greater than zero"}';
  end if;
  select stock, branch_id into previous_stock, product_branch
  from public.products
  where id = target_product and organization_id = target_org
  for update;
  if not found then
    raise exception using message = '{"code":"PRODUCT_NOT_FOUND","message":"Product does not belong to this organization"}';
  end if;
  if target_branch is not null and not public.valid_org_branch(target_org, target_branch) then
    raise exception using message = '{"code":"BRANCH_ACCESS_DENIED","message":"Branch does not belong to this organization"}';
  end if;
  perform set_config('app.inventory_mutation', 'on', true);
  update public.products
  set stock = stock + quantity_to_add,
      cost_price = coalesce(new_cost, cost_price),
      price = coalesce(new_selling, price),
      branch_id = coalesce(target_branch, product_branch),
      updated_at = now()
  where id = target_product and organization_id = target_org;
  insert into public.stock_movements
    (organization_id, branch_id, product_id, movement_type, quantity,
     cost_price, selling_price, actor_id, reason)
  select target_org, coalesce(target_branch, branch_id), id, 'STOCK_RECEIVED',
         quantity_to_add, cost_price, price, auth.uid(), 'Stock received'
  from public.products
  where id = target_product
  returning id into movement_id;
  return movement_id;
end;
$$;

grant execute on function public.receive_stock(uuid, uuid, integer, numeric, numeric, uuid) to authenticated;
revoke all on function public.receive_stock(uuid, uuid, integer, numeric, numeric, uuid) from public, anon;

create or replace function public.initialize_stock(
  target_org uuid,
  target_product uuid,
  opening_quantity integer
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  movement_id uuid;
begin
  if not public.can_manage_inventory(target_org) then
    raise exception using message = '{"code":"INVENTORY_ACCESS_DENIED","message":"Only an owner or manager can initialize stock"}';
  end if;
  if opening_quantity < 0 then
    raise exception using message = '{"code":"VALIDATION_ERROR","message":"Opening stock cannot be negative"}';
  end if;
  perform 1 from public.products
  where id = target_product and organization_id = target_org
  for update;
  if not found then
    raise exception using message = '{"code":"PRODUCT_NOT_FOUND","message":"Product does not belong to this organization"}';
  end if;
  if opening_quantity = 0 then return null; end if;
  perform set_config('app.inventory_mutation', 'on', true);
  update public.products
  set stock = opening_quantity, updated_at = now()
  where id = target_product and organization_id = target_org and stock = 0;
  if not found then
    raise exception using message = '{"code":"OPERATION_CONFLICT","message":"Opening stock can only be initialized once"}';
  end if;
  insert into public.stock_movements
    (organization_id, branch_id, product_id, movement_type, quantity,
     cost_price, selling_price, actor_id, reason)
  select target_org, branch_id, id, 'INITIAL_STOCK', opening_quantity,
         cost_price, price, auth.uid(), 'Opening stock'
  from public.products
  where id = target_product
  returning id into movement_id;
  return movement_id;
end;
$$;

grant execute on function public.initialize_stock(uuid, uuid, integer) to authenticated;
revoke all on function public.initialize_stock(uuid, uuid, integer) from public, anon;

-- Keep worker-facing employee data free of salary fields while allowing managers
-- to use the existing workforce screen through an explicit view.
create or replace view public.employee_profiles_manager
as
select id, organization_id, user_id, employee_id, full_name, email, phone,
       job_title, department, employment_status, hired_on, branch_id,
       monthly_salary, created_at, updated_at
from public.employee_profiles
where public.is_org_manager(organization_id);
grant select on public.employee_profiles_manager to authenticated;

create or replace view public.employee_profiles_self
as
select id, organization_id, user_id, employee_id, full_name, email, phone,
       job_title, department, employment_status, hired_on, branch_id,
       must_change_password, created_at, updated_at
from public.employee_profiles
where user_id = auth.uid();
grant select on public.employee_profiles_self to authenticated;

drop policy if exists "members view employees" on public.employee_profiles;
create policy "managers view employees"
on public.employee_profiles for select
using (public.is_org_manager(organization_id));
create policy "workers view own employee profile"
on public.employee_profiles for select
using (user_id = auth.uid());

create or replace function public.create_workspace(workspace_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org_id uuid;
  workspace_slug text;
begin
  if auth.uid() is null then
    raise exception using message = '{"code":"AUTH_REQUIRED","message":"You must be signed in"}';
  end if;
  if exists (select 1 from public.employee_profiles where user_id = auth.uid()) then
    raise exception using message = '{"code":"WORKER_ACCESS_DENIED","message":"Worker accounts cannot create organizations"}';
  end if;
  if length(trim(workspace_name)) < 2 then
    raise exception using message = '{"code":"VALIDATION_ERROR","message":"Business name must be at least 2 characters"}';
  end if;
  workspace_slug := regexp_replace(lower(trim(workspace_name)), '[^a-z0-9]+', '-', 'g')
    || '-' || substr(replace(auth.uid()::text, '-', ''), 1, 8);
  insert into public.organizations (name, slug)
  values (trim(workspace_name), workspace_slug)
  returning id into new_org_id;
  insert into public.organization_members (organization_id, user_id, role)
  values (new_org_id, auth.uid(), 'owner');
  insert into public.entitlements (organization_id, plan, features)
  values (new_org_id, 'starter', '{"inventory":true,"sales":true,"receipts":true,"invoices":true,"expenses":true,"reports":true}'::jsonb);
  return new_org_id;
end;
$$;

grant execute on function public.create_workspace(text) to authenticated;
revoke all on function public.create_workspace(text) from public, anon;
