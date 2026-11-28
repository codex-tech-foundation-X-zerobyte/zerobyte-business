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
    calculated_total := calculated_total + (product_row.price * item_quantity);
  end loop;
  insert into public.sales (organization_id, customer_id, total, created_by) values (target_org, target_customer, calculated_total, auth.uid()) returning id into new_sale_id;
  for item in select * from jsonb_array_elements(items) loop
    select * into product_row from public.products where id = (item->>'product_id')::uuid and organization_id = target_org for update;
    item_quantity := (item->>'quantity')::integer;
    update public.products set stock = stock - item_quantity, updated_at = now() where id = product_row.id and stock >= item_quantity returning id into updated_product_id;
    if updated_product_id is null then raise exception 'Insufficient stock for %', product_row.name; end if;
    insert into public.sale_items (sale_id, product_id, quantity, unit_price) values (new_sale_id, product_row.id, item_quantity, product_row.price);
    insert into public.stock_movements (organization_id, branch_id, product_id, movement_type, quantity, cost_price, selling_price, actor_id) values (target_org, product_row.branch_id, product_row.id, 'sale', -item_quantity, product_row.cost_price, product_row.price, auth.uid());
  end loop;
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, metadata) values (target_org, auth.uid(), 'sale.created', 'sale', new_sale_id, jsonb_build_object('total', calculated_total));
  return new_sale_id;
end;
$$;

grant execute on function public.create_sale(uuid, uuid, jsonb) to authenticated;
