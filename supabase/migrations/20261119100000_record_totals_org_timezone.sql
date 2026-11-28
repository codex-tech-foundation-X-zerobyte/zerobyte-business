-- Records follow the business's own time zone (Settings > Reports, default Africa/Lagos), exactly like the Overview and the
-- daily report, instead of a fixed Lagos clock. Replaces the two functions from 20261118090000_record_period_totals.sql;
-- nothing else changes.

create or replace function public.get_record_period_totals(
  target_org uuid,
  record_kind text,
  granularity text,
  date_from date default null,
  date_to date default null,
  max_rows integer default 400
)
returns table (period date, row_count bigint, total numeric, refund_count bigint, refund_total numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  tz text := public.org_timezone(target_org);
  from_ts timestamptz := case when date_from is null then null else date_from::timestamp at time zone tz end;
  to_ts timestamptz := case when date_to is null then null else (date_to + 1)::timestamp at time zone tz end;
  cap integer := least(greatest(coalesce(max_rows, 400), 1), 1000);
begin
  if not public.is_org_manager(target_org) then raise exception 'UNAUTHORIZED: owners and managers only'; end if;
  if granularity not in ('day', 'month', 'year') then raise exception 'UNKNOWN_GRANULARITY'; end if;

  if record_kind = 'sales' then
    return query
      select date_trunc(granularity, s.created_at at time zone tz)::date,
             count(*) filter (where s.status = 'completed'),
             coalesce(sum(s.total) filter (where s.status = 'completed'), 0)::numeric,
             count(*) filter (where s.status = 'refunded'),
             coalesce(sum(s.total) filter (where s.status = 'refunded'), 0)::numeric
        from public.sales s
       where s.organization_id = target_org
         and (from_ts is null or s.created_at >= from_ts)
         and (to_ts is null or s.created_at < to_ts)
       group by 1
       order by 1 desc
       limit cap;
  elsif record_kind = 'expenses' then
    return query
      select date_trunc(granularity, e.expense_date::timestamp)::date,
             count(*),
             coalesce(sum(e.amount), 0)::numeric,
             0::bigint,
             0::numeric
        from public.expenses e
       where e.organization_id = target_org
         and (date_from is null or e.expense_date >= date_from)
         and (date_to is null or e.expense_date <= date_to)
       group by 1
       order by 1 desc
       limit cap;
  elsif record_kind = 'stock' then
    return query
      select date_trunc(granularity, m.created_at at time zone tz)::date,
             count(*),
             coalesce(sum(m.quantity), 0)::numeric,
             0::bigint,
             0::numeric
        from public.stock_movements m
       where m.organization_id = target_org
         and m.quantity > 0
         and (from_ts is null or m.created_at >= from_ts)
         and (to_ts is null or m.created_at < to_ts)
       group by 1
       order by 1 desc
       limit cap;
  else
    raise exception 'UNKNOWN_KIND';
  end if;
end;
$$;
grant execute on function public.get_record_period_totals(uuid, text, text, date, date, integer) to authenticated;
revoke all on function public.get_record_period_totals(uuid, text, text, date, date, integer) from public, anon;

create or replace function public.get_record_totals(target_org uuid, record_kind text, date_from date default null, date_to date default null)
returns table (row_count bigint, total numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  tz text := public.org_timezone(target_org);
  from_ts timestamptz := case when date_from is null then null else date_from::timestamp at time zone tz end;
  to_ts timestamptz := case when date_to is null then null else (date_to + 1)::timestamp at time zone tz end;
begin
  if not public.is_org_manager(target_org) then raise exception 'UNAUTHORIZED: owners and managers only'; end if;
  if record_kind = 'sales' then
    -- count = every sale listed; total = what was actually sold (completed). Refunded sales are listed but not added up.
    return query select count(*), coalesce(sum(s.total) filter (where s.status = 'completed'), 0)::numeric from public.sales s
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
