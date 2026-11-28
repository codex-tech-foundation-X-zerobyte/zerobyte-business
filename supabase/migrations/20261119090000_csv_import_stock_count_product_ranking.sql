-- 1. Faster product entry: import_products() adds up to 1,000 products from a CSV file in one step.
-- 2. Stock control: stock counts. A physical count is compared with what the system says; differences are written as
--    ADJUSTMENT stock movements (so the stock history explains every change) and each count is kept for review.
-- 3. A "needs restocking" flag on products (low_stock) so the catalogue can be filtered by it.
-- 4. get_product_performance(): best sellers and slow movers for a period (used on the Reports page).
--
-- Low-stock alerts already exist (notify_low_stock, one notification per crossing). They are shown inside the app only;
-- this migration only teaches that trigger to stay quiet while a bulk import or a count is running, and sends ONE summary
-- notification instead of one per product.

alter table public.products
  add column if not exists low_stock boolean generated always as (stock <= reorder_point) stored;

create or replace function public.notify_low_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  was_above_threshold boolean;
begin
  if current_setting('app.suppress_low_stock', true) = 'on' then return NEW; end if;
  was_above_threshold := (TG_OP = 'INSERT') or (OLD.stock > OLD.reorder_point);
  if NEW.stock <= NEW.reorder_point and was_above_threshold then
    insert into public.notifications (organization_id, user_id, title, body)
    select
      NEW.organization_id,
      om.user_id,
      'Low stock: ' || NEW.name,
      NEW.name || ' (' || NEW.sku || ') is down to ' || NEW.stock ||
        ' unit' || (case when NEW.stock = 1 then '' else 's' end) ||
        ', at or below the reorder point of ' || NEW.reorder_point || '.'
    from public.organization_members om
    where om.organization_id = NEW.organization_id
      and om.role in ('owner', 'admin');
  end if;
  return NEW;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- CSV import
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.import_products(
  target_org uuid,
  items jsonb,
  target_branch uuid default null,
  on_duplicate text default 'skip'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  idx integer := 0;
  v_name text;
  v_sku text;
  v_category text;
  v_cost_text text;
  v_price_text text;
  v_stock_text text;
  v_reorder_text text;
  v_cost numeric;
  v_price numeric;
  v_stock integer;
  v_reorder integer;
  v_seq integer;
  v_new_id uuid;
  v_existing uuid;
  v_seen text[] := '{}';
  v_created integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_low integer := 0;
begin
  if not public.can_manage_inventory(target_org) then
    raise exception using message = '{"code":"INVENTORY_ACCESS_DENIED","message":"Only an owner or manager can import products"}';
  end if;
  if on_duplicate not in ('skip', 'update') then
    raise exception using message = '{"code":"VALIDATION_ERROR","message":"Choose whether to skip or update products that already exist"}';
  end if;
  if items is null or jsonb_typeof(items) <> 'array' or jsonb_array_length(items) = 0 then
    raise exception using message = '{"code":"VALIDATION_ERROR","message":"The file has no products to import"}';
  end if;
  if jsonb_array_length(items) > 1000 then
    raise exception using message = '{"code":"VALIDATION_ERROR","message":"Import up to 1,000 products at a time. Split the file and import it in parts"}';
  end if;
  if target_branch is not null and not exists (
    select 1 from public.branches b where b.id = target_branch and b.organization_id = target_org
  ) then
    raise exception using message = '{"code":"VALIDATION_ERROR","message":"That branch does not belong to this business"}';
  end if;

  -- Products without a SKU get ITEM-000001, ITEM-000002 ... continuing after the highest one already used.
  select coalesce(max(substring(p.sku from '^ITEM-(\d{1,9})$')::integer), 0)
    into v_seq
    from public.products p
   where p.organization_id = target_org and p.sku ~ '^ITEM-\d{1,9}$';

  perform set_config('app.inventory_mutation', 'on', true);
  perform set_config('app.suppress_low_stock', 'on', true);

  for item in select value from jsonb_array_elements(items) loop
    idx := idx + 1;
    v_name := nullif(btrim(coalesce(item->>'name', '')), '');
    v_sku := nullif(btrim(coalesce(item->>'sku', '')), '');
    v_category := coalesce(nullif(btrim(coalesce(item->>'category', '')), ''), 'Uncategorized');
    v_cost_text := nullif(btrim(coalesce(item->>'cost_price', '')), '');
    v_price_text := nullif(btrim(coalesce(item->>'price', '')), '');
    v_stock_text := nullif(btrim(coalesce(item->>'stock', '')), '');
    v_reorder_text := nullif(btrim(coalesce(item->>'reorder_point', '')), '');

    if v_name is null or char_length(v_name) > 200 then
      raise exception using message = format('{"code":"VALIDATION_ERROR","message":"Row %s: the product name is required (200 characters at most)"}', idx);
    end if;
    if v_sku is not null and char_length(v_sku) > 80 then
      raise exception using message = format('{"code":"VALIDATION_ERROR","message":"Row %s: the SKU is longer than 80 characters"}', idx);
    end if;
    if char_length(v_category) > 80 then
      raise exception using message = format('{"code":"VALIDATION_ERROR","message":"Row %s: the category is longer than 80 characters"}', idx);
    end if;
    if v_price_text is null or v_price_text !~ '^\d{1,10}(\.\d{1,2})?$' then
      raise exception using message = format('{"code":"VALIDATION_ERROR","message":"Row %s: the selling price must be a number such as 1500 or 1500.50"}', idx);
    end if;
    if v_cost_text is not null and v_cost_text !~ '^\d{1,10}(\.\d{1,2})?$' then
      raise exception using message = format('{"code":"VALIDATION_ERROR","message":"Row %s: the cost price must be a number such as 1200"}', idx);
    end if;
    if v_stock_text is not null and v_stock_text !~ '^\d{1,9}$' then
      raise exception using message = format('{"code":"VALIDATION_ERROR","message":"Row %s: the stock must be a whole number such as 24"}', idx);
    end if;
    if v_reorder_text is not null and v_reorder_text !~ '^\d{1,9}$' then
      raise exception using message = format('{"code":"VALIDATION_ERROR","message":"Row %s: the reorder level must be a whole number such as 5"}', idx);
    end if;
    v_price := v_price_text::numeric;
    v_cost := coalesce(v_cost_text::numeric, 0);
    v_stock := coalesce(v_stock_text::integer, 0);
    v_reorder := coalesce(v_reorder_text::integer, 5);

    if v_sku is null then
      v_seq := v_seq + 1;
      v_sku := 'ITEM-' || lpad(v_seq::text, 6, '0');
    elsif lower(v_sku) = any (v_seen) then
      v_skipped := v_skipped + 1; -- the same SKU twice in one file: the first row wins
      continue;
    end if;
    v_seen := v_seen || lower(v_sku);

    select p.id into v_existing
      from public.products p
     where p.organization_id = target_org and lower(p.sku) = lower(v_sku)
     limit 1;

    if v_existing is not null then
      if on_duplicate = 'update' then
        update public.products
           set name = v_name, category = v_category, price = v_price, reorder_point = v_reorder, updated_at = now()
         where id = v_existing;
        v_updated := v_updated + 1;
      else
        v_skipped := v_skipped + 1;
      end if;
      continue;
    end if;

    insert into public.products (organization_id, branch_id, name, sku, category, price, cost_price, stock, reorder_point)
    values (target_org, target_branch, v_name, v_sku, v_category, v_price, v_cost, 0, v_reorder)
    returning id into v_new_id;
    if v_stock > 0 then
      update public.products set stock = v_stock, updated_at = now() where id = v_new_id;
      insert into public.stock_movements
        (organization_id, branch_id, product_id, movement_type, quantity, cost_price, selling_price, actor_id, reason)
      values (target_org, target_branch, v_new_id, 'INITIAL_STOCK', v_stock, v_cost, v_price, auth.uid(), 'Opening stock (CSV import)');
    end if;
    if v_stock <= v_reorder then v_low := v_low + 1; end if;
    v_created := v_created + 1;
  end loop;

  perform set_config('app.suppress_low_stock', 'off', true);

  insert into public.audit_logs (organization_id, actor_id, action, entity_type, metadata)
  values (target_org, auth.uid(), 'products.import', 'product',
          jsonb_build_object('created', v_created, 'updated', v_updated, 'skipped', v_skipped, 'low_stock', v_low));

  if v_created > 0 then
    insert into public.notifications (organization_id, user_id, title, body)
    select target_org, om.user_id,
           'Products imported',
           v_created || ' product' || (case when v_created = 1 then '' else 's' end) || ' added from your file.' ||
             (case when v_low > 0 then ' ' || v_low || ' ' || (case when v_low = 1 then 'is' else 'are' end) || ' at or below the reorder level.' else '' end)
      from public.organization_members om
     where om.organization_id = target_org and om.role in ('owner', 'admin');
  end if;

  return jsonb_build_object('created', v_created, 'updated', v_updated, 'skipped', v_skipped, 'low_stock', v_low);
end;
$$;
grant execute on function public.import_products(uuid, jsonb, uuid, text) to authenticated;
revoke all on function public.import_products(uuid, jsonb, uuid, text) from public, anon;

-- ---------------------------------------------------------------------------------------------------------------------
-- Stock counts
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists public.stock_counts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  counted_by uuid references auth.users(id),
  note text check (note is null or char_length(note) <= 200),
  items_counted integer not null default 0,
  items_changed integer not null default 0,
  units_over integer not null default 0,
  units_short integer not null default 0,
  value_over numeric(14, 2) not null default 0,
  value_short numeric(14, 2) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_stock_counts_org_created on public.stock_counts (organization_id, created_at desc);

create table if not exists public.stock_count_items (
  id uuid primary key default gen_random_uuid(),
  count_id uuid not null references public.stock_counts(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  sku text,
  expected integer not null,
  counted integer not null check (counted >= 0),
  difference integer generated always as (counted - expected) stored,
  unit_cost numeric(12, 2) not null default 0
);
create index if not exists idx_stock_count_items_count on public.stock_count_items (count_id);

alter table public.stock_counts enable row level security;
alter table public.stock_count_items enable row level security;
drop policy if exists "managers read stock counts" on public.stock_counts;
create policy "managers read stock counts" on public.stock_counts
  for select to authenticated using (public.can_manage_inventory(organization_id));
drop policy if exists "managers read stock count items" on public.stock_count_items;
create policy "managers read stock count items" on public.stock_count_items
  for select to authenticated using (
    exists (select 1 from public.stock_counts c where c.id = count_id and public.can_manage_inventory(c.organization_id))
  );
revoke all on public.stock_counts, public.stock_count_items from anon;
grant select on public.stock_counts, public.stock_count_items to authenticated;

-- Applies a finished count. Each product is locked, compared with what the system holds RIGHT NOW, set to the counted
-- number and explained by an ADJUSTMENT movement. Products that were not counted are left alone.
create or replace function public.apply_stock_count(
  target_org uuid,
  items jsonb,
  count_note text default null,
  target_branch uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  idx integer := 0;
  p record;
  v_count_id uuid;
  v_counted integer;
  v_diff integer;
  v_seen uuid[] := '{}';
  v_note text := nullif(btrim(coalesce(count_note, '')), '');
  n_counted integer := 0;
  n_changed integer := 0;
  u_over integer := 0;
  u_short integer := 0;
  c_over numeric := 0;
  c_short numeric := 0;
begin
  if not public.can_manage_inventory(target_org) then
    raise exception using message = '{"code":"INVENTORY_ACCESS_DENIED","message":"Only an owner or manager can count stock"}';
  end if;
  if items is null or jsonb_typeof(items) <> 'array' or jsonb_array_length(items) = 0 then
    raise exception using message = '{"code":"VALIDATION_ERROR","message":"Count at least one product"}';
  end if;
  if jsonb_array_length(items) > 2000 then
    raise exception using message = '{"code":"VALIDATION_ERROR","message":"Finish the count in parts of up to 2,000 products"}';
  end if;
  if v_note is not null and char_length(v_note) > 200 then
    raise exception using message = '{"code":"VALIDATION_ERROR","message":"The note is longer than 200 characters"}';
  end if;
  if target_branch is not null and not exists (
    select 1 from public.branches b where b.id = target_branch and b.organization_id = target_org
  ) then
    raise exception using message = '{"code":"VALIDATION_ERROR","message":"That branch does not belong to this business"}';
  end if;

  insert into public.stock_counts (organization_id, branch_id, counted_by, note)
  values (target_org, target_branch, auth.uid(), v_note)
  returning id into v_count_id;

  perform set_config('app.inventory_mutation', 'on', true);

  for item in select value from jsonb_array_elements(items) loop
    idx := idx + 1;
    if coalesce(item->>'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception using message = format('{"code":"VALIDATION_ERROR","message":"Item %s has no valid product"}', idx);
    end if;
    if coalesce(item->>'counted', '') !~ '^\d{1,9}$' then
      raise exception using message = format('{"code":"VALIDATION_ERROR","message":"Item %s: the counted number must be a whole number, 0 or more"}', idx);
    end if;
    v_counted := (item->>'counted')::integer;
    if (item->>'product_id')::uuid = any (v_seen) then
      raise exception using message = format('{"code":"VALIDATION_ERROR","message":"Item %s: the same product is listed twice"}', idx);
    end if;
    v_seen := v_seen || (item->>'product_id')::uuid;

    select pr.id, pr.name, pr.sku, pr.stock, pr.cost_price, pr.price, pr.branch_id
      into p
      from public.products pr
     where pr.id = (item->>'product_id')::uuid and pr.organization_id = target_org
       for update;
    if not found then
      raise exception using message = format('{"code":"PRODUCT_NOT_FOUND","message":"Item %s: that product does not belong to this business"}', idx);
    end if;
    if target_branch is not null and p.branch_id is distinct from target_branch then
      raise exception using message = format('{"code":"VALIDATION_ERROR","message":"Item %s: %s is not in the branch being counted"}', idx, p.name);
    end if;

    v_diff := v_counted - p.stock;
    insert into public.stock_count_items (count_id, product_id, product_name, sku, expected, counted, unit_cost)
    values (v_count_id, p.id, p.name, p.sku, p.stock, v_counted, coalesce(p.cost_price, 0));
    n_counted := n_counted + 1;

    if v_diff <> 0 then
      update public.products set stock = v_counted, updated_at = now() where id = p.id;
      insert into public.stock_movements
        (organization_id, branch_id, product_id, movement_type, quantity, cost_price, selling_price, actor_id, reason)
      values (target_org, p.branch_id, p.id, 'ADJUSTMENT', v_diff, p.cost_price, p.price, auth.uid(),
              'Stock count' || coalesce(': ' || v_note, ''));
      n_changed := n_changed + 1;
      if v_diff > 0 then
        u_over := u_over + v_diff;
        c_over := c_over + v_diff * coalesce(p.cost_price, 0);
      else
        u_short := u_short + (-v_diff);
        c_short := c_short + (-v_diff) * coalesce(p.cost_price, 0);
      end if;
    end if;
  end loop;

  update public.stock_counts
     set items_counted = n_counted, items_changed = n_changed, units_over = u_over, units_short = u_short,
         value_over = c_over, value_short = c_short
   where id = v_count_id;

  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'stock.count', 'stock_count', v_count_id,
          jsonb_build_object('items_counted', n_counted, 'items_changed', n_changed, 'units_over', u_over, 'units_short', u_short));

  return jsonb_build_object('count_id', v_count_id, 'items_counted', n_counted, 'items_changed', n_changed,
                            'units_over', u_over, 'units_short', u_short, 'value_over', c_over, 'value_short', c_short);
end;
$$;
grant execute on function public.apply_stock_count(uuid, jsonb, text, uuid) to authenticated;
revoke all on function public.apply_stock_count(uuid, jsonb, text, uuid) from public, anon;

-- ---------------------------------------------------------------------------------------------------------------------
-- Best sellers and slow movers
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.get_product_performance(
  target_org uuid,
  date_from date,
  date_to date,
  target_branch uuid default null,
  max_rows integer default 10
)
returns table (
  kind text,
  product_id uuid,
  name text,
  sku text,
  units bigint,
  revenue numeric,
  profit numeric,
  stock integer,
  last_sold date
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  tz text := public.org_timezone(target_org);
  from_ts timestamptz := date_from::timestamp at time zone public.org_timezone(target_org);
  to_ts timestamptz := (date_to + 1)::timestamp at time zone public.org_timezone(target_org);
  cap integer := least(greatest(coalesce(max_rows, 10), 1), 50);
begin
  if not public.is_org_manager(target_org) then raise exception 'UNAUTHORIZED: owners and managers only'; end if;
  return query
  with sold as (
    select si.product_id as sold_product,
           sum(si.quantity)::bigint as sold_units,
           sum(si.quantity * si.unit_price)::numeric as sold_revenue,
           sum(si.quantity * (si.unit_price - coalesce(si.cost_price, 0)))::numeric as sold_profit
      from public.sale_items si
      join public.sales s on s.id = si.sale_id
     where s.organization_id = target_org
       and s.status = 'completed'
       and s.created_at >= from_ts and s.created_at < to_ts
       and (target_branch is null or s.branch_id = target_branch)
     group by si.product_id
  ),
  best as (
    select 'best'::text as k, pr.id as pid, pr.name as pname, pr.sku as psku, so.sold_units, so.sold_revenue, so.sold_profit,
           pr.stock as pstock, null::date as pdate
      from sold so
      join public.products pr on pr.id = so.sold_product
     order by so.sold_units desc, so.sold_revenue desc, pr.name
     limit cap
  ),
  slow as (
    select 'slow'::text, pr.id, pr.name, pr.sku, 0::bigint, 0::numeric, 0::numeric, pr.stock,
           (select max((s2.created_at at time zone tz)::date)
              from public.sale_items si2
              join public.sales s2 on s2.id = si2.sale_id
             where si2.product_id = pr.id and s2.status = 'completed')
      from public.products pr
     where pr.organization_id = target_org
       and pr.stock > 0
       and (target_branch is null or pr.branch_id = target_branch)
       and not exists (select 1 from sold so where so.sold_product = pr.id)
     order by pr.stock * coalesce(pr.cost_price, 0) desc, pr.name
     limit cap
  )
  select * from best
  union all
  select * from slow;
end;
$$;
grant execute on function public.get_product_performance(uuid, date, date, uuid, integer) to authenticated;
revoke all on function public.get_product_performance(uuid, date, date, uuid, integer) from public, anon;

notify pgrst, 'reload schema';
