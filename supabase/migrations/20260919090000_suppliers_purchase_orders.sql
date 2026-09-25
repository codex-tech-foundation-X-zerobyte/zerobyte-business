-- Suppliers and purchase orders -- the natural companion to the low-stock
-- alert: "low on X" now has a "reorder from Supplier Y, and receiving it
-- updates stock the same trusted way Stock Receiving already does".

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  address text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.suppliers enable row level security;
create policy "members view suppliers" on public.suppliers for select using (public.is_org_member(organization_id));
create policy "members create suppliers" on public.suppliers for insert with check (public.is_org_member(organization_id));
create policy "admins update suppliers" on public.suppliers for update using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));
create policy "admins delete suppliers" on public.suppliers for delete using (public.is_org_admin(organization_id));

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  status text not null default 'ordered' check (status in ('ordered', 'received', 'cancelled')),
  notes text,
  total_cost numeric(12,2) not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  received_at timestamptz,
  received_by uuid references auth.users(id) on delete set null
);

create index if not exists idx_purchase_orders_org_status on public.purchase_orders (organization_id, status, created_at desc);

alter table public.purchase_orders enable row level security;
-- Writes only ever happen through the RPCs below (security definer), same
-- pattern as sales/sale_items: RLS here just gates who can read.
create policy "members view purchase orders" on public.purchase_orders for select using (public.is_org_member(organization_id));

create table if not exists public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  unit_cost numeric(12,2) not null check (unit_cost >= 0)
);

alter table public.purchase_order_items enable row level security;
create policy "members view purchase order items" on public.purchase_order_items for select
  using (exists (select 1 from public.purchase_orders po where po.id = purchase_order_id and public.is_org_member(po.organization_id)));

create or replace function public.create_purchase_order(
  target_org uuid,
  target_supplier uuid,
  target_branch uuid,
  items jsonb,
  po_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_po_id uuid;
  item jsonb;
  item_product_id uuid;
  item_quantity integer;
  item_unit_cost numeric(12,2);
  running_total numeric(12,2) := 0;
begin
  if not public.can_manage_inventory(target_org) then
    raise exception using message = '{"code":"PO_ACCESS_DENIED","message":"Only an owner or manager can create purchase orders"}';
  end if;
  if not exists (select 1 from public.suppliers where id = target_supplier and organization_id = target_org) then
    raise exception using message = '{"code":"SUPPLIER_NOT_FOUND","message":"Supplier does not belong to this organization"}';
  end if;
  if target_branch is not null and not public.valid_org_branch(target_org, target_branch) then
    raise exception using message = '{"code":"BRANCH_NOT_FOUND","message":"Branch does not belong to this organization"}';
  end if;
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) = 0 then
    raise exception using message = '{"code":"VALIDATION_ERROR","message":"At least one line item is required"}';
  end if;

  for item in select * from jsonb_array_elements(items) loop
    item_product_id := (item->>'product_id')::uuid;
    item_quantity := (item->>'quantity')::integer;
    item_unit_cost := (item->>'unit_cost')::numeric;
    if item_quantity is null or item_quantity <= 0 then
      raise exception using message = '{"code":"VALIDATION_ERROR","message":"Quantity must be greater than zero"}';
    end if;
    if item_unit_cost is null or item_unit_cost < 0 then
      raise exception using message = '{"code":"VALIDATION_ERROR","message":"Unit cost cannot be negative"}';
    end if;
    if not exists (select 1 from public.products where id = item_product_id and organization_id = target_org) then
      raise exception using message = '{"code":"PRODUCT_NOT_FOUND","message":"Product does not belong to this organization"}';
    end if;
    running_total := running_total + (item_quantity * item_unit_cost);
  end loop;

  insert into public.purchase_orders (organization_id, branch_id, supplier_id, notes, total_cost, created_by)
  values (target_org, target_branch, target_supplier, nullif(trim(coalesce(po_notes, '')), ''), running_total, auth.uid())
  returning id into new_po_id;

  for item in select * from jsonb_array_elements(items) loop
    insert into public.purchase_order_items (purchase_order_id, product_id, quantity, unit_cost)
    values (new_po_id, (item->>'product_id')::uuid, (item->>'quantity')::integer, (item->>'unit_cost')::numeric);
  end loop;

  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'purchase_order.created', 'purchase_order', new_po_id,
    jsonb_build_object('supplier_id', target_supplier, 'total_cost', running_total, 'item_count', jsonb_array_length(items)));

  return new_po_id;
end;
$$;

-- Receiving a PO reuses the exact same stock-increment + stock_movements
-- audit trail as manual Stock Receiving, so a purchase order isn't a
-- separate, less-trustworthy path for changing stock -- it's the same one.
create or replace function public.receive_purchase_order(
  target_org uuid,
  target_po uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  po_row public.purchase_orders%rowtype;
  line record;
begin
  if not public.can_manage_inventory(target_org) then
    raise exception using message = '{"code":"PO_ACCESS_DENIED","message":"Only an owner or manager can receive purchase orders"}';
  end if;
  select * into po_row from public.purchase_orders where id = target_po and organization_id = target_org for update;
  if not found then
    raise exception using message = '{"code":"PO_NOT_FOUND","message":"Purchase order does not belong to this organization"}';
  end if;
  if po_row.status <> 'ordered' then
    raise exception using message = '{"code":"PO_NOT_RECEIVABLE","message":"Only an ordered purchase order can be received"}';
  end if;

  for line in select * from public.purchase_order_items where purchase_order_id = target_po loop
    update public.products
    set stock = stock + line.quantity, cost_price = line.unit_cost, updated_at = now()
    where id = line.product_id and organization_id = target_org;
    -- 'receive' is normalized to 'STOCK_RECEIVED' by the existing
    -- complete_stock_movement_audit trigger (see
    -- 20260911090000_production_hardening.sql) -- the same type manual
    -- Stock Receiving already uses. Reusing it (rather than inventing a
    -- new 'purchase_order_received' type, which the trigger would uppercase
    -- to a value the movement_type CHECK constraint doesn't allow, failing
    -- the insert outright) keeps a PO receipt and a manual stock receipt
    -- reading as the same kind of event; which one it was is still fully
    -- recoverable from the purchase_order.received audit_logs entry below.
    insert into public.stock_movements
      (organization_id, branch_id, product_id, movement_type, quantity, cost_price, actor_id)
    values
      (target_org, po_row.branch_id, line.product_id, 'receive', line.quantity, line.unit_cost, auth.uid());
  end loop;

  update public.purchase_orders
  set status = 'received', received_at = now(), received_by = auth.uid()
  where id = target_po;

  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'purchase_order.received', 'purchase_order', target_po,
    jsonb_build_object('supplier_id', po_row.supplier_id, 'total_cost', po_row.total_cost));
end;
$$;

create or replace function public.cancel_purchase_order(
  target_org uuid,
  target_po uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  po_row public.purchase_orders%rowtype;
begin
  if not public.can_manage_inventory(target_org) then
    raise exception using message = '{"code":"PO_ACCESS_DENIED","message":"Only an owner or manager can cancel purchase orders"}';
  end if;
  select * into po_row from public.purchase_orders where id = target_po and organization_id = target_org for update;
  if not found then
    raise exception using message = '{"code":"PO_NOT_FOUND","message":"Purchase order does not belong to this organization"}';
  end if;
  if po_row.status <> 'ordered' then
    raise exception using message = '{"code":"PO_NOT_CANCELLABLE","message":"Only an ordered purchase order can be cancelled"}';
  end if;
  update public.purchase_orders set status = 'cancelled' where id = target_po;
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'purchase_order.cancelled', 'purchase_order', target_po, '{}'::jsonb);
end;
$$;

grant execute on function public.create_purchase_order(uuid, uuid, uuid, jsonb, text) to authenticated;
grant execute on function public.receive_purchase_order(uuid, uuid) to authenticated;
grant execute on function public.cancel_purchase_order(uuid, uuid) to authenticated;
revoke all on function public.create_purchase_order(uuid, uuid, uuid, jsonb, text) from public, anon;
revoke all on function public.receive_purchase_order(uuid, uuid) from public, anon;
revoke all on function public.cancel_purchase_order(uuid, uuid) from public, anon;
