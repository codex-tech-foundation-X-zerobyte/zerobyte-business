-- Role-aware, branch-aware foundations for the V1 operating model.
create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  code text not null,
  address text,
  phone text,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  unique (organization_id, code)
);

create table if not exists public.branch_members (
  branch_id uuid not null references public.branches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (branch_id, user_id)
);

create table if not exists public.employee_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  employee_id text not null,
  full_name text not null,
  email text,
  phone text,
  job_title text,
  department text,
  employment_status text not null default 'active' check (employment_status in ('active', 'inactive', 'archived')),
  hired_on date,
  branch_id uuid references public.branches(id) on delete set null,
  monthly_salary numeric(12,2) check (monthly_salary >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, employee_id)
);

create table if not exists public.work_schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete cascade,
  employee_id uuid references public.employee_profiles(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  starts_at time not null,
  ends_at time not null,
  break_minutes integer not null default 0 check (break_minutes >= 0),
  effective_from date not null default current_date,
  effective_to date,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employee_profiles(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  work_date date not null,
  clocked_in_at timestamptz,
  clocked_out_at timestamptz,
  expected_start time,
  expected_end time,
  status text not null default 'present' check (status in ('present', 'late', 'absent', 'early_departure')),
  created_at timestamptz not null default now(),
  unique (employee_id, work_date)
);

alter table public.products add column if not exists cost_price numeric(12,2) not null default 0 check (cost_price >= 0);
alter table public.products add column if not exists branch_id uuid references public.branches(id) on delete set null;
alter table public.sales add column if not exists branch_id uuid references public.branches(id) on delete set null;
alter table public.expenses add column if not exists branch_id uuid references public.branches(id) on delete set null;
alter table public.invoices add column if not exists branch_id uuid references public.branches(id) on delete set null;

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  product_id uuid not null references public.products(id) on delete cascade,
  movement_type text not null check (movement_type in ('receive', 'sale', 'adjustment', 'return')),
  quantity integer not null check (quantity <> 0),
  cost_price numeric(12,2) check (cost_price >= 0),
  selling_price numeric(12,2) check (selling_price >= 0),
  actor_id uuid references auth.users(id),
  note text,
  created_at timestamptz not null default now()
);

create or replace function public.is_org_admin(target_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organization_members
    where organization_id = target_org and user_id = auth.uid() and role in ('owner', 'admin')
  );
$$;

create or replace function public.can_manage_inventory(target_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_org_admin(target_org);
$$;

alter table public.branches enable row level security;
alter table public.branch_members enable row level security;
alter table public.employee_profiles enable row level security;
alter table public.work_schedules enable row level security;
alter table public.attendance enable row level security;
alter table public.stock_movements enable row level security;

drop policy if exists "members manage products" on public.products;
drop policy if exists "members manage customers" on public.customers;
drop policy if exists "members manage expenses" on public.expenses;
drop policy if exists "members manage invoices" on public.invoices;
drop policy if exists "members update organization" on public.organizations;

create policy "members view products" on public.products for select using (public.is_org_member(organization_id));
create policy "admins manage products" on public.products for insert with check (public.can_manage_inventory(organization_id));
create policy "admins update products" on public.products for update using (public.can_manage_inventory(organization_id)) with check (public.can_manage_inventory(organization_id));
create policy "admins delete products" on public.products for delete using (public.can_manage_inventory(organization_id));
create policy "members view customers" on public.customers for select using (public.is_org_member(organization_id));
create policy "members create customers" on public.customers for insert with check (public.is_org_member(organization_id));
create policy "admins update customers" on public.customers for update using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));
create policy "admins delete customers" on public.customers for delete using (public.is_org_admin(organization_id));
create policy "members view expenses" on public.expenses for select using (public.is_org_member(organization_id));
create policy "admins manage expenses" on public.expenses for all using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));
create policy "members view invoices" on public.invoices for select using (public.is_org_member(organization_id));
create policy "admins manage invoices" on public.invoices for all using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));
create policy "admins update organization" on public.organizations for update using (public.is_org_admin(id)) with check (public.is_org_admin(id));

create policy "members view branches" on public.branches for select using (public.is_org_member(organization_id));
create policy "admins manage branches" on public.branches for all using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));
create policy "members view branch assignments" on public.branch_members for select using (exists (select 1 from public.branches b where b.id = branch_id and public.is_org_member(b.organization_id)));
create policy "admins manage branch assignments" on public.branch_members for all using (exists (select 1 from public.branches b where b.id = branch_id and public.is_org_admin(b.organization_id))) with check (exists (select 1 from public.branches b where b.id = branch_id and public.is_org_admin(b.organization_id)));
create policy "members view employees" on public.employee_profiles for select using (public.is_org_member(organization_id));
create policy "admins manage employees" on public.employee_profiles for all using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));
create policy "members view schedules" on public.work_schedules for select using (public.is_org_member(organization_id));
create policy "admins manage schedules" on public.work_schedules for all using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));
create policy "members view attendance" on public.attendance for select using (public.is_org_member(organization_id));
create policy "members clock attendance" on public.attendance for insert with check (public.is_org_member(organization_id));
create policy "admins manage attendance" on public.attendance for update using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));
create policy "members view stock movements" on public.stock_movements for select using (public.is_org_member(organization_id));

create or replace function public.receive_stock(
  target_org uuid,
  target_product uuid,
  quantity_to_add integer,
  new_cost numeric default null,
  new_selling numeric default null,
  target_branch uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  movement_id uuid;
begin
  if not public.can_manage_inventory(target_org) then raise exception 'Only an owner or manager can receive stock'; end if;
  if quantity_to_add <= 0 then raise exception 'Quantity must be greater than zero'; end if;
  if not exists (select 1 from public.products where id = target_product and organization_id = target_org) then raise exception 'Product does not belong to this organization'; end if;
  update public.products set stock = stock + quantity_to_add, cost_price = coalesce(new_cost, cost_price), price = coalesce(new_selling, price), branch_id = coalesce(target_branch, branch_id), updated_at = now()
    where id = target_product and organization_id = target_org;
  insert into public.stock_movements (organization_id, branch_id, product_id, movement_type, quantity, cost_price, selling_price, actor_id)
    select target_org, target_branch, id, 'receive', quantity_to_add, coalesce(new_cost, cost_price), coalesce(new_selling, price), auth.uid()
    from public.products where id = target_product
    returning id into movement_id;
  return movement_id;
end;
$$;

create or replace function public.create_sale(target_org uuid, target_customer uuid, items jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  new_sale_id uuid;
  item jsonb;
  product_row public.products%rowtype;
  item_quantity integer;
  updated_product_id uuid;
  calculated_total numeric(12,2) := 0;
begin
  if not public.is_org_member(target_org) then raise exception 'Not authorized for organization'; end if;
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) = 0 then raise exception 'At least one sale item is required'; end if;
  if target_customer is not null and not exists (select 1 from public.customers where id = target_customer and organization_id = target_org) then raise exception 'Customer does not belong to this organization'; end if;
  for item in select * from jsonb_array_elements(items) loop
    item_quantity := (item->>'quantity')::integer;
    if item_quantity is null or item_quantity <= 0 then raise exception 'Sale quantity must be greater than zero'; end if;
    select * into product_row from public.products where id = (item->>'product_id')::uuid and organization_id = target_org for update;
    if not found then raise exception 'Product does not belong to this organization'; end if;
    if product_row.stock < item_quantity then raise exception 'Insufficient stock for %', product_row.name; end if;
    calculated_total := calculated_total + (product_row.price * item_quantity);
  end loop;
  insert into public.sales (organization_id, customer_id, total, created_by) values (target_org, target_customer, calculated_total, auth.uid()) returning id into new_sale_id;
  for item in select * from jsonb_array_elements(items) loop
    select * into product_row from public.products where id = (item->>'product_id')::uuid and organization_id = target_org for update;
    item_quantity := (item->>'quantity')::integer;
    if product_row.stock < item_quantity then raise exception 'Insufficient stock for %', product_row.name; end if;
    insert into public.sale_items (sale_id, product_id, quantity, unit_price) values (new_sale_id, product_row.id, item_quantity, product_row.price);
    update public.products set stock = stock - item_quantity, updated_at = now() where id = product_row.id and stock >= item_quantity returning id into updated_product_id;
    if updated_product_id is null then raise exception 'Insufficient stock for %', product_row.name; end if;
    insert into public.stock_movements (organization_id, branch_id, product_id, movement_type, quantity, cost_price, selling_price, actor_id) values (target_org, product_row.branch_id, product_row.id, 'sale', -item_quantity, product_row.cost_price, product_row.price, auth.uid());
  end loop;
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, metadata) values (target_org, auth.uid(), 'sale.created', 'sale', new_sale_id, jsonb_build_object('total', calculated_total));
  return new_sale_id;
end;
$$;

grant execute on function public.receive_stock(uuid, uuid, integer, numeric, numeric, uuid) to authenticated;
grant execute on function public.create_sale(uuid, uuid, jsonb) to authenticated;
