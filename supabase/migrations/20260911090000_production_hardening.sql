-- Production hardening: active worker enforcement, immutable stock history,
-- historical cost capture, reporting aggregates, and admin delivery.

create index if not exists idx_members_user_org
  on public.organization_members(user_id, organization_id);
create index if not exists idx_products_org_branch
  on public.products(organization_id, branch_id);
create index if not exists idx_expenses_org_date
  on public.expenses(organization_id, expense_date desc);
create index if not exists idx_sales_org_date
  on public.sales(organization_id, created_at desc);
create index if not exists idx_notifications_user_unread
  on public.notifications(user_id, read_at, created_at desc);
create index if not exists idx_employee_status
  on public.employee_profiles(organization_id, employment_status);

-- Membership is not sufficient for a provisioned worker: an archived worker
-- keeps an audit-friendly membership row but no longer passes authorization.
create or replace function public.is_org_member(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members om
    where om.organization_id = target_org
      and om.user_id = auth.uid()
      and not exists (
        select 1
        from public.employee_profiles ep
        where ep.user_id = auth.uid()
          and ep.organization_id = target_org
          and ep.employment_status <> 'active'
      )
  );
$$;

-- Workers must not read financial expense/invoice records or salary columns.
drop policy if exists "members view expenses" on public.expenses;
drop policy if exists "members view assigned expenses" on public.expenses;
drop policy if exists "members view scoped expenses" on public.expenses;
drop policy if exists "members view invoices" on public.invoices;
drop policy if exists "members view assigned invoices" on public.invoices;
drop policy if exists "members view scoped invoices" on public.invoices;
create policy "managers view scoped expenses"
on public.expenses for select
using (public.is_org_manager(organization_id));
create policy "managers view scoped invoices"
on public.invoices for select
using (public.is_org_manager(organization_id));

-- Capture the cost basis at sale time. A later product cost change cannot
-- rewrite historical COGS. This must run before column-level privileges refer
-- to the new column on fresh databases.
alter table public.sale_items
  add column if not exists cost_price numeric(12,2)
  check (cost_price is null or cost_price >= 0);

revoke select (monthly_salary) on public.employee_profiles from anon, authenticated;
revoke update (stock, cost_price) on public.products from anon, authenticated;
revoke select (cost_price) on public.sale_items from anon, authenticated;
revoke select (cost_price) on public.stock_movements from anon, authenticated;

create or replace function public.capture_sale_item_cost()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.cost_price is null then
    select p.cost_price into new.cost_price
    from public.products p
    where p.id = new.product_id;
  end if;
  return new;
end;
$$;

drop trigger if exists sale_items_capture_cost on public.sale_items;
create trigger sale_items_capture_cost
before insert on public.sale_items
for each row execute function public.capture_sale_item_cost();

-- Extend the existing movement ledger without breaking historical rows.
alter table public.stock_movements
  add column if not exists previous_quantity integer,
  add column if not exists new_quantity integer,
  add column if not exists previous_cost_price numeric(12,2),
  add column if not exists new_cost_price numeric(12,2),
  add column if not exists previous_selling_price numeric(12,2),
  add column if not exists new_selling_price numeric(12,2),
  add column if not exists reason text,
  add column if not exists reference_id uuid;

create or replace function public.complete_stock_movement_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_product public.products%rowtype;
begin
  new.movement_type := case lower(new.movement_type)
    when 'receive' then 'STOCK_RECEIVED'
    when 'stock_received' then 'STOCK_RECEIVED'
    when 'initial_stock' then 'INITIAL_STOCK'
    when 'sale' then 'SALE'
    when 'adjustment' then 'ADJUSTMENT'
    when 'correction' then 'CORRECTION'
    when 'return' then 'CORRECTION'
    else upper(new.movement_type)
  end;
  select * into current_product from public.products where id = new.product_id;
  if current_product.id is not null then
    new.new_quantity := current_product.stock;
    new.previous_quantity := current_product.stock - new.quantity;
    new.new_cost_price := current_product.cost_price;
    new.new_selling_price := current_product.price;
    new.previous_cost_price := coalesce(new.previous_cost_price, current_product.cost_price);
    new.previous_selling_price := coalesce(new.previous_selling_price, current_product.price);
  end if;
  return new;
end;
$$;

drop trigger if exists stock_movement_complete_audit on public.stock_movements;
create trigger stock_movement_complete_audit
before insert on public.stock_movements
for each row execute function public.complete_stock_movement_audit();

alter table public.stock_movements drop constraint if exists stock_movements_movement_type_check;

-- Existing movement names are normalised while retaining legacy RETURN rows.
update public.stock_movements
set movement_type = case lower(movement_type)
  when 'receive' then 'STOCK_RECEIVED'
  when 'stock_received' then 'STOCK_RECEIVED'
  when 'initial_stock' then 'INITIAL_STOCK'
  when 'sale' then 'SALE'
  when 'adjustment' then 'ADJUSTMENT'
  when 'correction' then 'CORRECTION'
  when 'return' then 'CORRECTION'
  else upper(movement_type)
end;

alter table public.stock_movements add constraint stock_movements_movement_type_check
  check (movement_type in ('INITIAL_STOCK', 'STOCK_RECEIVED', 'SALE', 'ADJUSTMENT', 'CORRECTION', 'RETURN'));

-- A single trusted function performs broadcast creation, fan-out, and audit.
create or replace function public.send_platform_broadcast(
  notification_title text,
  notification_message text,
  target_audience text default 'all_users'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  broadcast_id uuid;
begin
  if not public.is_platform_admin() then
    raise exception using message = '{"code":"ADMIN_ACCESS_DENIED","message":"Platform administrator access required"}';
  end if;
  if nullif(trim(notification_title), '') is null or nullif(trim(notification_message), '') is null then
    raise exception using message = '{"code":"VALIDATION_ERROR","message":"Title and message are required"}';
  end if;
  if target_audience <> 'all_users' then
    raise exception using message = '{"code":"VALIDATION_ERROR","message":"Unsupported audience"}';
  end if;
  insert into public.admin_notifications
    (created_by, title, message, audience, status, sent_at)
  values
    (auth.uid(), trim(notification_title), trim(notification_message), target_audience, 'sent', now())
  returning id into broadcast_id;
  insert into public.notifications (organization_id, user_id, title, body)
  select om.organization_id, om.user_id, trim(notification_title), trim(notification_message)
  from public.organization_members om;
  insert into public.admin_audit_logs
    (actor_id, action, target_type, target_id, metadata)
  values
    (auth.uid(), 'broadcast.sent', 'admin_notification', broadcast_id,
     jsonb_build_object('audience', target_audience));
  return broadcast_id;
end;
$$;

grant execute on function public.send_platform_broadcast(text, text, text) to authenticated;
revoke all on function public.send_platform_broadcast(text, text, text) from public, anon;
