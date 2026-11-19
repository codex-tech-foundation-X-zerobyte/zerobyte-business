create or replace function public.update_product_catalog(
  target_org uuid,
  target_product uuid,
  product_name text,
  product_sku text,
  product_category text,
  selling_price numeric
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
  update public.products
  set name = trim(product_name),
      sku = trim(product_sku),
      category = coalesce(nullif(trim(product_category), ''), 'Uncategorized'),
      price = selling_price,
      updated_at = now()
  where id = target_product
    and organization_id = target_org;
  if not found then
    raise exception using message = '{"code":"PRODUCT_NOT_FOUND","message":"Product does not belong to this organization"}';
  end if;
end;
$$;

grant execute on function public.update_product_catalog(uuid, uuid, text, text, text, numeric) to authenticated;
revoke all on function public.update_product_catalog(uuid, uuid, text, text, text, numeric) from public, anon;
