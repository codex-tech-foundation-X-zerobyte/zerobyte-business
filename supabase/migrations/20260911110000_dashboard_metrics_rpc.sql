-- Keep one unambiguous PostgREST RPC contract for dashboard/report metrics.
-- The client always supplies all four arguments, so this intentionally has no
-- default parameters and cannot be confused with an overloaded function.

drop function if exists public.get_dashboard_metrics(uuid, date, date);
drop function if exists public.get_dashboard_metrics(uuid, date, date, uuid);

create or replace function public.get_dashboard_metrics(
  target_org uuid,
  date_from date,
  date_to date,
  target_branch uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  revenue numeric := 0;
  cogs numeric := 0;
  expenses_total numeric := 0;
  sales_count bigint := 0;
begin
  if not public.is_org_member(target_org) then
    raise exception using
      message = '{"code":"ORGANIZATION_ACCESS_DENIED","message":"Organization access denied"}';
  end if;

  if date_from is null or date_to is null or date_from > date_to then
    raise exception using
      message = '{"code":"INVALID_DATE_RANGE","message":"The report date range is invalid"}';
  end if;

  if not public.can_access_branch(target_org, target_branch) then
    raise exception using
      message = '{"code":"BRANCH_ACCESS_DENIED","message":"Branch access denied"}';
  end if;

  select count(*), coalesce(sum(s.total), 0)
    into sales_count, revenue
  from public.sales s
  where s.organization_id = target_org
    and s.status = 'completed'
    and s.created_at >= date_from::timestamptz
    and s.created_at < (date_to + 1)::timestamptz
    and (target_branch is null or s.branch_id = target_branch);

  select coalesce(sum(si.quantity * coalesce(si.cost_price, 0)), 0)
    into cogs
  from public.sale_items si
  join public.sales s on s.id = si.sale_id
  where s.organization_id = target_org
    and s.status = 'completed'
    and s.created_at >= date_from::timestamptz
    and s.created_at < (date_to + 1)::timestamptz
    and (target_branch is null or s.branch_id = target_branch);

  select coalesce(sum(e.amount), 0)
    into expenses_total
  from public.expenses e
  where e.organization_id = target_org
    and e.expense_date between date_from and date_to
    and (target_branch is null or e.branch_id = target_branch);

  return jsonb_build_object(
    'revenue', revenue,
    'cogs', cogs,
    'gross_profit', revenue - cogs,
    'operating_expenses', expenses_total,
    'net_profit', revenue - cogs - expenses_total,
    'sales_count', sales_count,
    'low_stock_products', (
      select count(*)
      from public.products p
      where p.organization_id = target_org
        and p.stock <= p.reorder_point
        and (target_branch is null or p.branch_id = target_branch)
    ),
    'stock_received', (
      select coalesce(sum(sm.quantity), 0)
      from public.stock_movements sm
      where sm.organization_id = target_org
        and sm.movement_type in ('INITIAL_STOCK', 'STOCK_RECEIVED')
        and sm.created_at::date between date_from and date_to
        and (target_branch is null or sm.branch_id = target_branch)
    ),
    'stock_sold', (
      select coalesce(sum(abs(sm.quantity)), 0)
      from public.stock_movements sm
      where sm.organization_id = target_org
        and sm.movement_type = 'SALE'
        and sm.created_at::date between date_from and date_to
        and (target_branch is null or sm.branch_id = target_branch)
    ),
    'top_products', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'product_id', top_product.product_id,
          'name', top_product.name,
          'quantity', top_product.quantity,
          'revenue', top_product.revenue
        )
        order by top_product.revenue desc, top_product.name
      ), '[]'::jsonb)
      from (
        select
          p.id as product_id,
          p.name,
          sum(si.quantity) as quantity,
          sum(si.line_total) as revenue
        from public.sale_items si
        join public.sales s on s.id = si.sale_id
        join public.products p on p.id = si.product_id
        where s.organization_id = target_org
          and s.status = 'completed'
          and s.created_at >= date_from::timestamptz
          and s.created_at < (date_to + 1)::timestamptz
          and (target_branch is null or s.branch_id = target_branch)
        group by p.id, p.name
        order by sum(si.line_total) desc, p.name
        limit 5
      ) top_product
    ),
    'branch_performance', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'branch_id', branch_result.branch_id,
          'name', branch_result.name,
          'sales_count', branch_result.sales_count,
          'revenue', branch_result.revenue
        )
        order by branch_result.revenue desc, branch_result.name
      ), '[]'::jsonb)
      from (
        select
          b.id as branch_id,
          b.name,
          count(s.id) as sales_count,
          coalesce(sum(s.total), 0) as revenue
        from public.branches b
        left join public.sales s
          on s.branch_id = b.id
          and s.organization_id = target_org
          and s.status = 'completed'
          and s.created_at >= date_from::timestamptz
          and s.created_at < (date_to + 1)::timestamptz
        where b.organization_id = target_org
          and (target_branch is null or b.id = target_branch)
        group by b.id, b.name
      ) branch_result
    )
  );
end;
$$;

revoke all on function public.get_dashboard_metrics(uuid, date, date, uuid) from public, anon;
grant execute on function public.get_dashboard_metrics(uuid, date, date, uuid) to authenticated;

-- Make the new signature visible immediately to the PostgREST schema cache.
notify pgrst, 'reload schema';
