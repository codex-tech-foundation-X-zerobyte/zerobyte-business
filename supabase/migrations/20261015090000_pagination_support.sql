-- Support for paginated screens.
--  * get_customer_balances now accepts the ids of the customers being shown, so a page of 50 customers does not
--    compute balances for every customer in the business.
--  * get_low_stock_products returns the few products that are actually running low (with the total), so the dashboard
--    no longer downloads the whole catalogue just to find them. Managers and owners only, as before.

drop function if exists public.get_customer_balances(uuid);
create or replace function public.get_customer_balances(target_org uuid, target_customers uuid[] default null)
returns table (customer_id uuid, total_credit numeric, total_paid numeric, balance numeric)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id as customer_id,
    coalesce(s.credit_total, 0) as total_credit,
    coalesce(p.paid_total, 0) as total_paid,
    coalesce(s.credit_total, 0) - coalesce(p.paid_total, 0) as balance
  from public.customers c
  left join (
    select customer_id, sum(total + tax_amount) as credit_total
    from public.sales
    where organization_id = target_org and payment_method = 'credit' and customer_id is not null
      and (target_customers is null or customer_id = any(target_customers))
    group by customer_id
  ) s on s.customer_id = c.id
  left join (
    select customer_id, sum(amount) as paid_total
    from public.customer_payments
    where organization_id = target_org
      and (target_customers is null or customer_id = any(target_customers))
    group by customer_id
  ) p on p.customer_id = c.id
  where c.organization_id = target_org
    and (target_customers is null or c.id = any(target_customers))
    and public.is_org_member(target_org);
$$;
grant execute on function public.get_customer_balances(uuid, uuid[]) to authenticated;
revoke all on function public.get_customer_balances(uuid, uuid[]) from public, anon;

create or replace function public.get_low_stock_products(target_org uuid, max_rows integer default 8)
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
    and p.stock <= coalesce(p.reorder_point, 5)
  order by p.stock asc, p.name asc
  limit least(greatest(coalesce(max_rows, 8), 1), 50);
$$;
grant execute on function public.get_low_stock_products(uuid, integer) to authenticated;
revoke all on function public.get_low_stock_products(uuid, integer) from public, anon;

notify pgrst, 'reload schema';

-- Records page header figures for the WHOLE filtered set (not just the rows loaded on screen).
create or replace function public.get_record_totals(target_org uuid, record_kind text, date_from date default null, date_to date default null)
returns table (row_count bigint, total numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  from_ts timestamptz := case when date_from is null then null else date_from::timestamp at time zone 'UTC' end;
  to_ts timestamptz := case when date_to is null then null else (date_to + 1)::timestamp at time zone 'UTC' end;
begin
  if not public.is_org_manager(target_org) then raise exception 'UNAUTHORIZED: owners and managers only'; end if;
  if record_kind = 'sales' then
    return query select count(*), coalesce(sum(s.total), 0)::numeric from public.sales s
      where s.organization_id = target_org and (from_ts is null or s.created_at >= from_ts) and (to_ts is null or s.created_at < to_ts);
  elsif record_kind = 'expenses' then
    return query select count(*), coalesce(sum(e.amount), 0)::numeric from public.expenses e
      where e.organization_id = target_org and (date_from is null or e.expense_date >= date_from) and (date_to is null or e.expense_date <= date_to);
  elsif record_kind = 'stock' then
    return query select count(*), coalesce(sum(m.quantity), 0)::numeric from public.stock_movements m
      where m.organization_id = target_org and m.quantity > 0 and (from_ts is null or m.created_at >= from_ts) and (to_ts is null or m.created_at < to_ts);
  else
    raise exception 'UNKNOWN_KIND';
  end if;
end;
$$;
grant execute on function public.get_record_totals(uuid, text, date, date) to authenticated;
revoke all on function public.get_record_totals(uuid, text, date, date) from public, anon;

notify pgrst, 'reload schema';
