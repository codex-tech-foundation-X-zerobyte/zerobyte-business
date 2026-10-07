-- Stock transfer between branches.
--
-- Scoped to what the current data model actually supports: each product is
-- a single row, tied to at most one branch (branch_id null = shared across
-- the org), with SKUs unique per organization (not per branch). So there is
-- no independent per-branch stock count to split -- a "transfer" here means
-- moving the product (and whatever stock it currently has) to a different
-- branch, not splitting a quantity between two branches while both keep
-- selling it locally. Splitting would need a real per-branch stock ledger,
-- a larger schema change than this migration makes; noting that honestly
-- rather than building a transfer flow that implies a partial-split
-- capability the schema can't back up.

create or replace function public.transfer_product_branch(
  target_org uuid,
  target_product uuid,
  destination_branch uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  product_row public.products%rowtype;
  source_branch uuid;
  source_branch_name text;
  destination_branch_name text;
begin
  -- Moving stock ownership between branches is a manager-level action, not
  -- something any worker assigned to a branch should be able to trigger.
  if not public.is_org_manager(target_org) then
    raise exception using message = '{"code":"BRANCH_TRANSFER_DENIED","message":"Only an owner or manager can transfer stock between branches"}';
  end if;

  select * into product_row
  from public.products
  where id = target_product and organization_id = target_org
  for update;
  if not found then
    raise exception using message = '{"code":"PRODUCT_NOT_FOUND","message":"Product does not belong to this organization"}';
  end if;

  if destination_branch is not null and not public.valid_org_branch(target_org, destination_branch) then
    raise exception using message = '{"code":"BRANCH_NOT_FOUND","message":"Destination branch does not belong to this organization"}';
  end if;

  if destination_branch is not distinct from product_row.branch_id then
    raise exception using message = '{"code":"NO_OP_TRANSFER","message":"Product is already at that branch"}';
  end if;

  source_branch := product_row.branch_id;
  select name into source_branch_name from public.branches where id = source_branch;
  select name into destination_branch_name from public.branches where id = destination_branch;

  update public.products
  set branch_id = destination_branch, updated_at = now()
  where id = target_product;

  insert into public.audit_logs
    (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values
    (target_org, auth.uid(), 'product.branch_transferred', 'product', target_product,
     jsonb_build_object(
       'product_name', product_row.name,
       'sku', product_row.sku,
       'stock', product_row.stock,
       'from_branch_id', source_branch,
       'from_branch_name', coalesce(source_branch_name, 'Shared (all branches)'),
       'to_branch_id', destination_branch,
       'to_branch_name', coalesce(destination_branch_name, 'Shared (all branches)')
     ));
end;
$$;

grant execute on function public.transfer_product_branch(uuid, uuid, uuid) to authenticated;
revoke all on function public.transfer_product_branch(uuid, uuid, uuid) from public, anon;
