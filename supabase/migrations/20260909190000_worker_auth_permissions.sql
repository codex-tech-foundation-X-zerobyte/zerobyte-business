-- Worker identity, branch-scoped permissions, and receipt integrity.
-- Auth users are provisioned by the provision-worker Edge Function only.

alter table public.employee_profiles
  add column if not exists must_change_password boolean not null default true;

alter table public.employee_profiles
  add column if not exists password_changed_at timestamptz;

alter table public.customers
  add column if not exists branch_id uuid references public.branches(id) on delete set null;

alter table public.sales
  add column if not exists payment_method text not null default 'cash';

alter table public.sale_items
  add column if not exists line_total numeric(12,2)
    generated always as (round(quantity::numeric * unit_price, 2)) stored;

alter table public.sales
  drop constraint if exists sales_payment_method_check;

alter table public.sales
  add constraint sales_payment_method_check
  check (payment_method in ('cash', 'card', 'transfer', 'mobile_money', 'mixed', 'other'));

create unique index if not exists employee_profiles_org_email_key
  on public.employee_profiles (organization_id, lower(email))
  where email is not null;

create index if not exists employee_profiles_user_id_idx
  on public.employee_profiles (user_id)
  where user_id is not null;

create index if not exists customers_org_branch_idx
  on public.customers (organization_id, branch_id);

create index if not exists sales_org_branch_created_at_idx
  on public.sales (organization_id, branch_id, created_at desc);

create or replace function public.is_org_owner(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members
    where organization_id = target_org
      and user_id = auth.uid()
      and role = 'owner'
  );
$$;

create or replace function public.is_org_manager(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members
    where organization_id = target_org
      and user_id = auth.uid()
      and role in ('owner', 'admin')
  );
$$;

create or replace function public.valid_org_branch(target_org uuid, target_branch uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.branches
    where id = target_branch
      and organization_id = target_org
      and status = 'active'
  );
$$;

create or replace function public.can_access_branch(target_org uuid, target_branch uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_org_member(target_org)
    and (
      (
        target_branch is null
        and public.is_org_manager(target_org)
      )
      or (
        target_branch is not null
        and (
          (
            public.is_org_manager(target_org)
            and exists (
              select 1
              from public.branches b
              where b.id = target_branch
                and b.organization_id = target_org
            )
          )
          or (
            public.valid_org_branch(target_org, target_branch)
            and exists (
              select 1
              from public.branch_members bm
              where bm.branch_id = target_branch
                and bm.user_id = auth.uid()
            )
          )
        )
      )
    );
$$;

create or replace function public.employee_belongs_to_org(target_employee uuid, target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.employee_profiles
    where id = target_employee
      and organization_id = target_org
  );
$$;

create or replace function public.is_employee_self(target_employee uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.employee_profiles
    where id = target_employee
      and user_id = auth.uid()
  );
$$;

create or replace function public.can_view_sale(target_sale uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.sales s
    where s.id = target_sale
      and (
        (s.branch_id is null and public.is_org_manager(s.organization_id))
        or (s.branch_id is not null and public.can_access_branch(s.organization_id, s.branch_id))
      )
  );
$$;

-- A linked identity is write-once. Only a service-role request may attach it,
-- and an identity can never be attached to two employee records.
create or replace function public.prevent_employee_identity_reassignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is not null
     and current_setting('request.jwt.claim.role', true) <> 'service_role' then
    if tg_op = 'INSERT' or old.user_id is distinct from new.user_id then
      raise exception 'Employee identities can only be linked by the provisioning service';
    end if;
  end if;

  if tg_op = 'UPDATE'
     and old.user_id is not null
     and new.user_id is distinct from old.user_id then
    raise exception 'An employee identity cannot be reassigned';
  end if;

  if new.user_id is not null and exists (
    select 1
    from public.employee_profiles other_profile
    where other_profile.user_id = new.user_id
      and other_profile.id <> new.id
  ) then
    raise exception 'This auth identity is already linked to an employee';
  end if;

  return new;
end;
$$;

drop trigger if exists employee_identity_write_once on public.employee_profiles;
create trigger employee_identity_write_once
before insert or update of user_id on public.employee_profiles
for each row execute function public.prevent_employee_identity_reassignment();

-- This RPC is intentionally service-role-only. The Edge Function creates the
-- Auth user, then uses this function to atomically link it to one profile and
-- grant the least-privileged organization role.
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

  select *
    into profile_row
  from public.employee_profiles
  where id = target_employee
    and organization_id = target_org
  for update;

  if not found then
    raise exception 'Employee profile does not belong to this organization';
  end if;
  if profile_row.user_id is not null then
    raise exception 'Employee profile is already linked';
  end if;
  if profile_row.branch_id is not null
     and not public.valid_org_branch(target_org, profile_row.branch_id) then
    raise exception 'Employee branch does not belong to this organization';
  end if;
  if not exists (select 1 from auth.users where id = target_user) then
    raise exception 'Auth identity does not exist';
  end if;
  if exists (
    select 1
    from public.employee_profiles
    where user_id = target_user
  ) then
    raise exception 'Auth identity is already linked to an employee';
  end if;

  select email, phone
    into auth_email, auth_phone
  from auth.users
  where id = target_user;
  if profile_row.email is not null
     and (auth_email is null or lower(profile_row.email) <> lower(auth_email)) then
    raise exception 'Auth email does not match the employee profile';
  end if;
  if exists (
    select 1
    from public.organization_members
    where organization_id = target_org
      and user_id = target_user
  ) then
    raise exception 'Auth identity already belongs to this organization';
  end if;

  update public.employee_profiles
  set user_id = target_user,
      email = coalesce(auth_email, email),
      phone = coalesce(auth_phone, phone),
      must_change_password = true,
      updated_at = now()
  where id = target_employee;

  insert into public.organization_members (organization_id, user_id, role)
  values (target_org, target_user, 'member')
  on conflict (organization_id, user_id) do nothing;

  return target_employee;
end;
$$;

revoke all on function public.link_provisioned_worker(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.link_provisioned_worker(uuid, uuid, uuid) to service_role;

create or replace function public.mark_worker_password_changed()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  changed boolean;
begin
  update public.employee_profiles
  set must_change_password = false,
      password_changed_at = now(),
      updated_at = now()
  where user_id = auth.uid()
    and must_change_password = true
  returning true into changed;
  return coalesce(changed, false);
end;
$$;

grant execute on function public.mark_worker_password_changed() to authenticated;
revoke all on function public.mark_worker_password_changed() from public, anon;

create or replace function public.create_customer(
  target_org uuid,
  target_branch uuid,
  customer_name text,
  customer_email text default null,
  customer_phone text default null
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

  insert into public.customers (organization_id, branch_id, name, email, phone)
  values (target_org, resolved_branch, trim(customer_name), nullif(trim(customer_email), ''), nullif(trim(customer_phone), ''))
  returning id into new_customer_id;
  return new_customer_id;
end;
$$;

grant execute on function public.create_customer(uuid, uuid, text, text, text) to authenticated;
revoke all on function public.create_customer(uuid, uuid, text, text, text) from public, anon;

create or replace function public.receive_stock(
  target_org uuid,
  target_product uuid,
  quantity_to_add integer,
  new_cost numeric default null,
  new_selling numeric default null,
  target_branch uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  movement_id uuid;
begin
  if not public.can_manage_inventory(target_org) then
    raise exception 'Only an owner or manager can receive stock';
  end if;
  if quantity_to_add <= 0 then
    raise exception 'Quantity must be greater than zero';
  end if;
  if target_branch is not null
     and not public.valid_org_branch(target_org, target_branch) then
    raise exception 'Branch does not belong to this organization';
  end if;
  if not exists (
    select 1
    from public.products
    where id = target_product
      and organization_id = target_org
  ) then
    raise exception 'Product does not belong to this organization';
  end if;

  update public.products
  set stock = stock + quantity_to_add,
      cost_price = coalesce(new_cost, cost_price),
      price = coalesce(new_selling, price),
      branch_id = coalesce(target_branch, branch_id),
      updated_at = now()
  where id = target_product
    and organization_id = target_org;

  insert into public.stock_movements (
    organization_id, branch_id, product_id, movement_type, quantity,
    cost_price, selling_price, actor_id
  )
  select target_org, coalesce(target_branch, branch_id), id, 'receive',
         quantity_to_add, coalesce(new_cost, cost_price),
         coalesce(new_selling, price), auth.uid()
  from public.products
  where id = target_product
  returning id into movement_id;
  return movement_id;
end;
$$;

grant execute on function public.receive_stock(uuid, uuid, integer, numeric, numeric, uuid) to authenticated;
revoke all on function public.receive_stock(uuid, uuid, integer, numeric, numeric, uuid) from public, anon;

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
      and (
        c.branch_id is null
        or resolved_branch is null
        or c.branch_id = resolved_branch
      )
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

    select *
      into product_row
    from public.products
    where id = item_product_id
      and organization_id = target_org
      and (
        branch_id is null
        or resolved_branch is null
        or branch_id = resolved_branch
      )
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

  for item in select * from jsonb_array_elements(items) loop
    item_product_id := (item->>'product_id')::uuid;
    item_quantity := (item->>'quantity')::integer;
    select *
      into product_row
    from public.products
    where id = item_product_id
      and organization_id = target_org
    for update;

    update public.products
    set stock = stock - item_quantity,
        updated_at = now()
    where id = product_row.id
      and stock >= item_quantity
    returning id into updated_product_id;
    if updated_product_id is null then
      raise exception 'Insufficient stock for %', product_row.name;
    end if;

    insert into public.sale_items (sale_id, product_id, quantity, unit_price)
    values (new_sale_id, product_row.id, item_quantity, product_row.price);

    insert into public.stock_movements (
      organization_id, branch_id, product_id, movement_type, quantity,
      cost_price, selling_price, actor_id
    )
    values (
      target_org, resolved_branch, product_row.id, 'sale', -item_quantity,
      product_row.cost_price, product_row.price, auth.uid()
    );
  end loop;

  insert into public.audit_logs (
    organization_id, actor_id, action, entity_type, entity_id, metadata
  )
  values (
    target_org, auth.uid(), 'sale.created', 'sale', new_sale_id,
    jsonb_build_object(
      'total', calculated_total,
      'branch_id', resolved_branch,
      'payment_method', normalized_payment_method
    )
  );
  return new_sale_id;
end;
$$;

-- Keep the existing frontend contract working while allowing branch-aware
-- clients to use the five-argument overload above.
drop function if exists public.create_sale(uuid, uuid, jsonb);
create or replace function public.create_sale(
  target_org uuid,
  target_customer uuid,
  items jsonb
)
returns uuid
language sql
security definer
set search_path = public
as $$
  select public.create_sale(target_org, target_customer, items, null, 'cash');
$$;

grant execute on function public.create_sale(uuid, uuid, jsonb, uuid, text) to authenticated;
grant execute on function public.create_sale(uuid, uuid, jsonb) to authenticated;
revoke all on function public.create_sale(uuid, uuid, jsonb, uuid, text) from public, anon;
revoke all on function public.create_sale(uuid, uuid, jsonb) from public, anon;

create or replace function public.validate_sale_item_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  sale_row public.sales%rowtype;
  product_row public.products%rowtype;
begin
  select * into sale_row from public.sales where id = new.sale_id;
  if not found then
    raise exception 'Sale does not exist';
  end if;
  select * into product_row from public.products where id = new.product_id;
  if not found then
    raise exception 'Sale item product does not exist';
  end if;
  if sale_row.organization_id <> product_row.organization_id then
    raise exception 'Sale item crosses organization boundaries';
  end if;
  if sale_row.branch_id is not null
     and product_row.branch_id is not null
     and sale_row.branch_id <> product_row.branch_id then
    raise exception 'Sale item crosses branch boundaries';
  end if;
  return new;
end;
$$;

drop trigger if exists sale_item_scope_check on public.sale_items;
create trigger sale_item_scope_check
before insert or update of sale_id, product_id on public.sale_items
for each row execute function public.validate_sale_item_scope();

create or replace function public.assert_sale_receipt_total(target_sale uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  sale_total numeric(12,2);
  line_total_sum numeric(12,2);
begin
  select total into sale_total from public.sales where id = target_sale;
  if sale_total is null then
    return;
  end if;
  select coalesce(sum(line_total), 0)
    into line_total_sum
  from public.sale_items
  where sale_id = target_sale;
  if sale_total <> line_total_sum then
    raise exception 'Sale total must equal the sum of receipt line items';
  end if;
end;
$$;

create or replace function public.validate_sale_receipt_total()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.assert_sale_receipt_total(old.sale_id);
  elsif tg_op = 'UPDATE' and old.sale_id is distinct from new.sale_id then
    perform public.assert_sale_receipt_total(old.sale_id);
    perform public.assert_sale_receipt_total(new.sale_id);
  else
    perform public.assert_sale_receipt_total(new.sale_id);
  end if;
  return null;
end;
$$;

drop trigger if exists sale_items_receipt_total on public.sale_items;
create constraint trigger sale_items_receipt_total
after insert or update or delete on public.sale_items
deferrable initially deferred
for each row execute function public.validate_sale_receipt_total();

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.employee_profiles enable row level security;
alter table public.customers enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.work_schedules enable row level security;
alter table public.attendance enable row level security;

drop policy if exists "members can view membership" on public.organization_members;
create policy "members view permitted membership"
on public.organization_members for select
using (
  user_id = auth.uid()
  or public.is_org_manager(organization_id)
);

drop policy if exists "members view products" on public.products;
drop policy if exists "members view assigned products" on public.products;
drop policy if exists "admins manage products" on public.products;
create policy "members view scoped products"
on public.products for select
using (
  public.is_org_member(organization_id)
  and (
    branch_id is null
    or (
      public.valid_org_branch(organization_id, branch_id)
      and public.can_access_branch(organization_id, branch_id)
    )
  )
);
create policy "managers manage scoped products"
on public.products for all
using (public.is_org_manager(organization_id))
with check (
  public.is_org_manager(organization_id)
  and (
    branch_id is null
    or public.valid_org_branch(organization_id, branch_id)
  )
);

drop policy if exists "members view customers" on public.customers;
drop policy if exists "members create customers" on public.customers;
drop policy if exists "admins update customers" on public.customers;
drop policy if exists "admins delete customers" on public.customers;
create policy "members view scoped customers"
on public.customers for select
using (
  public.is_org_member(organization_id)
  and (
    branch_id is null
    or (
      public.valid_org_branch(organization_id, branch_id)
      and public.can_access_branch(organization_id, branch_id)
    )
  )
);
create policy "members create scoped customers"
on public.customers for insert
with check (
  public.is_org_member(organization_id)
  and (
    (branch_id is null and public.is_org_manager(organization_id))
    or (branch_id is not null and public.can_access_branch(organization_id, branch_id))
  )
);
create policy "managers update scoped customers"
on public.customers for update
using (public.is_org_manager(organization_id))
with check (
  public.is_org_manager(organization_id)
  and (
    branch_id is null
    or public.valid_org_branch(organization_id, branch_id)
  )
);
create policy "managers delete scoped customers"
on public.customers for delete
using (public.is_org_manager(organization_id));

drop policy if exists "members view sales" on public.sales;
create policy "members view scoped sales"
on public.sales for select
using (public.can_view_sale(id));

drop policy if exists "members view sale items" on public.sale_items;
create policy "members view scoped sale items"
on public.sale_items for select
using (public.can_view_sale(sale_id));

drop policy if exists "members view employees" on public.employee_profiles;
drop policy if exists "admins manage employees" on public.employee_profiles;
create policy "managers manage employees"
on public.employee_profiles for all
using (public.is_org_manager(organization_id))
with check (
  public.is_org_manager(organization_id)
  and (
    branch_id is null
    or public.valid_org_branch(organization_id, branch_id)
  )
);
create policy "workers view their employee profile"
on public.employee_profiles for select
using (public.is_employee_self(id));

drop policy if exists "members view schedules" on public.work_schedules;
drop policy if exists "admins manage schedules" on public.work_schedules;
create policy "managers manage schedules"
on public.work_schedules for all
using (public.is_org_manager(organization_id))
with check (
  public.is_org_manager(organization_id)
  and public.employee_belongs_to_org(employee_id, organization_id)
  and (branch_id is null or public.valid_org_branch(organization_id, branch_id))
);
create policy "workers view own schedules"
on public.work_schedules for select
using (public.is_employee_self(employee_id));

drop policy if exists "members view attendance" on public.attendance;
drop policy if exists "members clock attendance" on public.attendance;
drop policy if exists "admins manage attendance" on public.attendance;
create policy "managers manage attendance"
on public.attendance for all
using (public.is_org_manager(organization_id))
with check (
  public.is_org_manager(organization_id)
  and public.employee_belongs_to_org(employee_id, organization_id)
  and (branch_id is null or public.valid_org_branch(organization_id, branch_id))
);
create policy "workers view own attendance"
on public.attendance for select
using (public.is_employee_self(employee_id));
create policy "workers clock own attendance"
on public.attendance for insert
with check (
  public.is_employee_self(employee_id)
  and public.is_org_member(organization_id)
  and (
    branch_id is null
    or public.can_access_branch(organization_id, branch_id)
  )
);

drop policy if exists "members view assigned expenses" on public.expenses;
create policy "members view scoped expenses"
on public.expenses for select
using (
  public.is_org_member(organization_id)
  and (
    branch_id is null
    or (
      public.valid_org_branch(organization_id, branch_id)
      and public.can_access_branch(organization_id, branch_id)
    )
  )
);

drop policy if exists "members view assigned invoices" on public.invoices;
create policy "members view scoped invoices"
on public.invoices for select
using (
  public.is_org_member(organization_id)
  and (
    branch_id is null
    or (
      public.valid_org_branch(organization_id, branch_id)
      and public.can_access_branch(organization_id, branch_id)
    )
  )
);

drop policy if exists "admins manage expenses" on public.expenses;
create policy "managers manage scoped expenses"
on public.expenses for all
using (public.is_org_manager(organization_id))
with check (
  public.is_org_manager(organization_id)
  and (
    branch_id is null
    or public.valid_org_branch(organization_id, branch_id)
  )
);

drop policy if exists "admins manage invoices" on public.invoices;
create policy "managers manage scoped invoices"
on public.invoices for all
using (public.is_org_manager(organization_id))
with check (
  public.is_org_manager(organization_id)
  and (
    branch_id is null
    or public.valid_org_branch(organization_id, branch_id)
  )
);

drop policy if exists "members view audit logs" on public.audit_logs;
create policy "managers view audit logs"
on public.audit_logs for select
using (public.is_org_manager(organization_id));

drop policy if exists "members view branch assignments" on public.branch_members;
drop policy if exists "admins manage branch assignments" on public.branch_members;
create policy "members view own branch assignments"
on public.branch_members for select
using (
  user_id = auth.uid()
  or public.is_org_manager(public.branch_org_id(branch_id))
);
create policy "managers manage branch assignments"
on public.branch_members for all
using (public.is_org_manager(public.branch_org_id(branch_id)))
with check (public.is_org_manager(public.branch_org_id(branch_id)));

grant select on public.employee_profiles to authenticated;
grant insert, update, delete on public.employee_profiles to authenticated;
grant select, insert, update, delete on public.customers to authenticated;
grant select on public.sales, public.sale_items to authenticated;
grant select on public.organization_members to authenticated;
grant execute on function public.create_customer(uuid, uuid, text, text, text) to authenticated;
grant execute on function public.create_sale(uuid, uuid, jsonb, uuid, text) to authenticated;
grant execute on function public.create_sale(uuid, uuid, jsonb) to authenticated;
revoke all on function public.is_org_owner(uuid) from public, anon, authenticated;
revoke all on function public.is_org_manager(uuid) from public, anon;
revoke all on function public.valid_org_branch(uuid, uuid) from public, anon;
revoke all on function public.can_access_branch(uuid, uuid) from public, anon;
revoke all on function public.employee_belongs_to_org(uuid, uuid) from public, anon;
revoke all on function public.is_employee_self(uuid) from public, anon;
revoke all on function public.can_view_sale(uuid) from public, anon;
revoke all on function public.assert_sale_receipt_total(uuid) from public, anon, authenticated;
grant execute on function public.is_org_manager(uuid) to authenticated;
grant execute on function public.valid_org_branch(uuid, uuid) to authenticated;
grant execute on function public.can_access_branch(uuid, uuid) to authenticated;
grant execute on function public.employee_belongs_to_org(uuid, uuid) to authenticated;
grant execute on function public.is_employee_self(uuid) to authenticated;
grant execute on function public.can_view_sale(uuid) to authenticated;
