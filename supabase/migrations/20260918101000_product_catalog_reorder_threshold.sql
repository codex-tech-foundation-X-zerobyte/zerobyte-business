-- Lets the reorder point be edited from the same product-edit form as the
-- rest of the catalog fields (name/sku/category/price).
--
-- This changes update_product_catalog's argument list (adding a 7th param),
-- and `create or replace` only replaces a function with the exact same
-- argument types -- a different list creates a second, ambiguous overload
-- instead (the same trap noted in 20260916090000_monitoring_health_tiers.sql).
-- Drop the old 6-argument signature explicitly first.
drop function if exists public.update_product_catalog(uuid, uuid, text, text, text, numeric);

create or replace function public.update_product_catalog(
  target_org uuid,
  target_product uuid,
  product_name text,
  product_sku text,
  product_category text,
  selling_price numeric,
  target_reorder_point integer default 5
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_manage_inventory(target_org) then
    raise exception using message = '{"code":"INVENTORY_ACCESS_DENIED","message":"Only an owner or manager can edit products"}';
  end if;
  if length(trim(product_name)) < 1 or length(trim(product_sku)) < 1 then
    raise exception using message = '{"code":"VALIDATION_ERROR","message":"Product name and SKU are required"}';
  end if;
  if selling_price < 0 then
    raise exception using message = '{"code":"VALIDATION_ERROR","message":"Selling price cannot be negative"}';
  end if;
  if target_reorder_point < 0 then
    raise exception using message = '{"code":"VALIDATION_ERROR","message":"Reorder point cannot be negative"}';
  end if;
  update public.products
  set name = trim(product_name),
      sku = trim(product_sku),
      category = coalesce(nullif(trim(product_category), ''), 'Uncategorized'),
      price = selling_price,
      reorder_point = target_reorder_point,
      updated_at = now()
  where id = target_product
    and organization_id = target_org;
  if not found then
    raise exception using message = '{"code":"PRODUCT_NOT_FOUND","message":"Product does not belong to this organization"}';
  end if;
end;
$$;

grant execute on function public.update_product_catalog(uuid, uuid, text, text, text, numeric, integer) to authenticated;
revoke all on function public.update_product_catalog(uuid, uuid, text, text, text, numeric, integer) from public, anon;
