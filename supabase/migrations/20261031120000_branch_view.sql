-- Branch view: the dashboard can show one branch or the total, and the owner can see revenue per branch.

-- Low stock for one branch (or all). The old two-argument version is replaced so calls never become ambiguous.
drop function if exists public.get_low_stock_products(uuid, integer);
create function public.get_low_stock_products(target_org uuid, max_rows integer default 8, target_branch uuid default null)
returns table (id uuid, name text, sku text, stock integer, reorder_point integer, total_low bigint)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.name, p.sku, p.stock, p.reorder_point, count(*) over () as total_low
  from public.products p
  where p.organization_id = target_org
    and public.is_org_manager(target_org)
    and public.can_access_branch(target_org, target_branch)
    and (target_branch is null or p.branch_id = target_branch)
    and p.stock <= coalesce(p.reorder_point, 5)
  order by p.stock asc, p.name asc
  limit least(greatest(coalesce(max_rows, 8), 1), 50);
$$;
revoke all on function public.get_low_stock_products(uuid, integer, uuid) from public, anon;
grant execute on function public.get_low_stock_products(uuid, integer, uuid) to authenticated;

-- Revenue and number of sales per branch for a period (completed sales only). Every active branch is listed,
-- even with no sales, plus a line for sales that were recorded without a branch.
create or replace function public.get_branch_breakdown(target_org uuid, date_from date, date_to date)
returns table (branch_id uuid, branch_name text, revenue numeric, sales_count bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_org_manager(target_org) then raise exception 'UNAUTHORIZED: owners and managers only'; end if;
  if date_from is null or date_to is null or date_from > date_to then raise exception 'INVALID_DATE_RANGE'; end if;
  return query
    with sold as (
      select s.branch_id, sum(s.total)::numeric as revenue, count(*) as sales_count
      from public.sales s
      where s.organization_id = target_org and s.status = 'completed'
        and s.created_at >= date_from::timestamptz and s.created_at < (date_to + 1)::timestamptz
      group by s.branch_id
    )
    select b.id, b.name::text, coalesce(sold.revenue, 0), coalesce(sold.sales_count, 0)
      from public.branches b left join sold on sold.branch_id = b.id
     where b.organization_id = target_org and b.status = 'active'
    union all
    select null::uuid, 'No branch'::text, sold.revenue, sold.sales_count from sold where sold.branch_id is null
    order by 3 desc, 2;
end;
$$;
revoke all on function public.get_branch_breakdown(uuid, date, date) from public, anon;
grant execute on function public.get_branch_breakdown(uuid, date, date) to authenticated;

notify pgrst, 'reload schema';
