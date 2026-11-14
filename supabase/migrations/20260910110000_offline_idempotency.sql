-- Offline clients retry requests after reconnecting. These server-side keys make
-- retries safe without trusting browser-calculated totals or bypassing RLS.
create table if not exists public.sale_sync_operations (
  operation_id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  sale_id uuid references public.sales(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.customer_sync_operations (
  operation_id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.sale_sync_operations enable row level security;
alter table public.customer_sync_operations enable row level security;
revoke all on public.sale_sync_operations, public.customer_sync_operations from public, anon, authenticated;

create or replace function public.create_sale_with_operation(
  target_org uuid,
  target_customer uuid,
  items jsonb,
  target_branch uuid,
  target_payment_method text default 'cash',
  operation_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
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

  created_sale := public.create_sale(target_org, target_customer, items, target_branch, target_payment_method);
  update public.sale_sync_operations
  set sale_id = created_sale
  where sale_sync_operations.operation_id = requested_operation_id;
  return created_sale;
end;
$$;

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

grant execute on function public.create_sale_with_operation(uuid, uuid, jsonb, uuid, text, uuid) to authenticated;
grant execute on function public.create_customer_with_operation(uuid, uuid, text, text, text, uuid, uuid) to authenticated;
revoke all on function public.create_sale_with_operation(uuid, uuid, jsonb, uuid, text, uuid) from public, anon;
revoke all on function public.create_customer_with_operation(uuid, uuid, text, text, text, uuid, uuid) from public, anon;
