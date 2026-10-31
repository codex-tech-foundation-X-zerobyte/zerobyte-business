create extension if not exists "pgcrypto";

create type public.member_role as enum ('owner', 'admin', 'member');
create type public.sale_status as enum ('completed', 'pending', 'refunded');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  sku text not null,
  category text not null default 'Uncategorized',
  stock integer not null default 0 check (stock >= 0),
  price numeric(12,2) not null default 0 check (price >= 0),
  reorder_point integer not null default 5 check (reorder_point >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, sku)
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  email text,
  phone text,
  created_at timestamptz not null default now()
);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  status public.sale_status not null default 'completed',
  total numeric(12,2) not null check (total >= 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0)
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid references auth.users(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.entitlements (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  plan text not null default 'starter',
  max_members integer not null default 3,
  features jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create or replace function public.is_org_member(target_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organization_members
    where organization_id = target_org and user_id = auth.uid()
  );
$$;

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.products enable row level security;
alter table public.customers enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.audit_logs enable row level security;
alter table public.notifications enable row level security;
alter table public.entitlements enable row level security;

create policy "members can view organizations" on public.organizations for select using (public.is_org_member(id));
create policy "members can view membership" on public.organization_members for select using (public.is_org_member(organization_id));
create policy "members manage products" on public.products for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "members manage customers" on public.customers for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "members view sales" on public.sales for select using (public.is_org_member(organization_id));
create policy "members view sale items" on public.sale_items for select using (exists (select 1 from public.sales s where s.id = sale_id and public.is_org_member(s.organization_id)));
create policy "members view audit logs" on public.audit_logs for select using (public.is_org_member(organization_id));
create policy "users view notifications" on public.notifications for select using (user_id = auth.uid() and public.is_org_member(organization_id));
create policy "members view entitlements" on public.entitlements for select using (public.is_org_member(organization_id));

create or replace function public.create_sale(
  target_org uuid,
  target_customer uuid,
  items jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  new_sale_id uuid;
  calculated_total numeric(12,2);
begin
  if not public.is_org_member(target_org) then raise exception 'Not authorized for organization'; end if;
  select coalesce(sum((item->>'quantity')::integer * p.price), 0)
    into calculated_total
    from jsonb_array_elements(items) item
    join public.products p on p.id = (item->>'product_id')::uuid
    where p.organization_id = target_org;
  insert into public.sales (organization_id, customer_id, total, created_by)
    values (target_org, target_customer, calculated_total, auth.uid())
    returning id into new_sale_id;
  insert into public.sale_items (sale_id, product_id, quantity, unit_price)
    select new_sale_id, (item->>'product_id')::uuid, (item->>'quantity')::integer, p.price
    from jsonb_array_elements(items) item join public.products p on p.id = (item->>'product_id')::uuid;
  update public.products p set stock = p.stock - (item->>'quantity')::integer, updated_at = now()
    from jsonb_array_elements(items) item
    where p.id = (item->>'product_id')::uuid and p.organization_id = target_org;
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, metadata)
    values (target_org, auth.uid(), 'sale.created', 'sale', new_sale_id, jsonb_build_object('total', calculated_total));
  return new_sale_id;
end;
$$;
