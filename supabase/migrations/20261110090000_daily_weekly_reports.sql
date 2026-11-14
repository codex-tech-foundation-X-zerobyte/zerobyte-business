-- =====================================================================================================================
-- Daily and weekly business reports.
--   * Overview and Reports now measure a "day" in the BUSINESS's own time zone (default Africa/Lagos), not UTC. Before
--     this, a sale at 00:30 Lagos time was counted on the previous day.
--   * One report builder produces the numbers for the in-app report, the stored daily/weekly reports, the PDF/CSV
--     downloads and the notification text, so they can never disagree.
--   * Security: only owners and admins of the business can read reports; nobody can write them from the app; the builder
--     and the scheduler cannot be called by customers at all; payloads carry names and totals only (no phones or emails).
-- =====================================================================================================================

-- ---------- 1. per-business report settings ---------------------------------------------------------------------
alter table public.organizations
  add column if not exists report_timezone text not null default 'Africa/Lagos',
  add column if not exists report_daily_enabled boolean not null default true,
  add column if not exists report_weekly_enabled boolean not null default true,
  add column if not exists report_hour smallint not null default 21;

do $$ begin
  alter table public.organizations add constraint organizations_report_hour_check check (report_hour between 0 and 23);
exception when duplicate_object then null; end $$;

create or replace function public.validate_report_timezone()
returns trigger language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from pg_timezone_names where name = new.report_timezone) then
    raise exception 'VALIDATION_ERROR: unknown time zone';
  end if;
  return new;
end $$;
drop trigger if exists organizations_validate_report_timezone on public.organizations;
create trigger organizations_validate_report_timezone before insert or update of report_timezone on public.organizations
  for each row execute function public.validate_report_timezone();

create or replace function public.org_timezone(p_org uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select report_timezone from public.organizations where id = p_org), 'Africa/Lagos')
$$;
revoke all on function public.org_timezone(uuid) from public, anon, authenticated;

create or replace function public.report_money(p_amount numeric, p_currency text)
returns text language sql immutable as $$
  select case coalesce(p_currency, 'NGN') when 'NGN' then '₦' else p_currency || ' ' end
         || case when p_amount < 0 then '-' else '' end
         || to_char(abs(round(coalesce(p_amount, 0))), 'FM999,999,999,999,990')
$$;
revoke all on function public.report_money(numeric, text) from public, anon, authenticated;

-- ---------- 2. stored reports ------------------------------------------------------------------------------------
create table if not exists public.business_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('daily', 'weekly')),
  period_from date not null,
  period_to date not null,
  payload jsonb not null,
  is_final boolean not null default false,
  generated_at timestamptz not null default now(),
  unique (organization_id, kind, period_from),
  check (period_to >= period_from)
);
create index if not exists business_reports_org_kind_idx on public.business_reports (organization_id, kind, period_from desc);
create index if not exists business_reports_retention_idx on public.business_reports (kind, period_from);
alter table public.business_reports enable row level security;
revoke all on public.business_reports from anon, authenticated;
grant select on public.business_reports to authenticated;
-- Read-only for the people who run the business. There is deliberately NO insert/update/delete policy.
drop policy if exists "managers read business reports" on public.business_reports;
create policy "managers read business reports" on public.business_reports for select to authenticated
  using (public.is_org_manager(organization_id));

-- ---------- 3. the single report builder (no caller check: only the wrappers below and the scheduler can reach it) --
create or replace function public._build_business_report(p_org uuid, p_from date, p_to date, p_kind text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text := public.org_timezone(p_org);
  v_start timestamptz := p_from::timestamp at time zone v_tz;
  v_end timestamptz := (p_to + 1)::timestamp at time zone v_tz;
  v_days integer := (p_to - p_from) + 1;
  v_prev_from date := p_from - ((p_to - p_from) + 1);
  v_prev_to date := p_from - 1;
  v_prev_start timestamptz := (p_from - ((p_to - p_from) + 1))::timestamp at time zone v_tz;
  v_org record;
  v_revenue numeric; v_sales bigint; v_cogs numeric; v_expenses numeric; v_items bigint; v_discount numeric; v_tax numeric;
  v_refund_count bigint; v_refund_total numeric; v_prev_revenue numeric; v_prev_sales bigint; v_collected numeric;
  v_owing_count bigint; v_owing_total numeric;
begin
  select name, currency into v_org from public.organizations where id = p_org;
  if not found then raise exception 'NOT_FOUND: organization'; end if;

  select count(*), coalesce(sum(total), 0), coalesce(sum(discount_amount), 0), coalesce(sum(tax_amount), 0)
    into v_sales, v_revenue, v_discount, v_tax
    from public.sales where organization_id = p_org and status = 'completed' and created_at >= v_start and created_at < v_end;

  select coalesce(sum(si.quantity * coalesce(si.cost_price, 0)), 0), coalesce(sum(si.quantity), 0)
    into v_cogs, v_items
    from public.sale_items si join public.sales s on s.id = si.sale_id
   where s.organization_id = p_org and s.status = 'completed' and s.created_at >= v_start and s.created_at < v_end;

  select coalesce(sum(amount), 0) into v_expenses from public.expenses where organization_id = p_org and expense_date between p_from and p_to;

  select count(*), coalesce(sum(total), 0) into v_refund_count, v_refund_total
    from public.sales where organization_id = p_org and status = 'refunded' and created_at >= v_start and created_at < v_end;

  select count(*), coalesce(sum(total), 0) into v_prev_sales, v_prev_revenue
    from public.sales where organization_id = p_org and status = 'completed' and created_at >= v_prev_start and created_at < v_start;

  select coalesce(sum(amount), 0) into v_collected
    from public.customer_payments where organization_id = p_org and created_at >= v_start and created_at < v_end;

  -- Same formula as the Customers page (get_customer_balances): credit sales incl. tax minus repayments.
  select count(*) filter (where bal > 0), coalesce(sum(bal) filter (where bal > 0), 0) into v_owing_count, v_owing_total
    from (
      select coalesce(s.credit_total, 0) - coalesce(p.paid_total, 0) as bal
        from public.customers c
        left join (select customer_id, sum(total + tax_amount) as credit_total from public.sales
                    where organization_id = p_org and payment_method = 'credit' and customer_id is not null group by customer_id) s on s.customer_id = c.id
        left join (select customer_id, sum(amount) as paid_total from public.customer_payments
                    where organization_id = p_org group by customer_id) p on p.customer_id = c.id
       where c.organization_id = p_org
    ) balances;

  return jsonb_build_object(
    'version', 1,
    'kind', p_kind,
    'period_from', p_from,
    'period_to', p_to,
    'days', v_days,
    'timezone', v_tz,
    'generated_at', now(),
    'business', jsonb_build_object('name', v_org.name, 'currency', coalesce(v_org.currency, 'NGN')),
    'summary', jsonb_build_object(
      'revenue', v_revenue, 'sales_count', v_sales,
      'average_sale', case when v_sales > 0 then round(v_revenue / v_sales, 2) else 0 end,
      'items_sold', v_items, 'cogs', v_cogs, 'gross_profit', v_revenue - v_cogs,
      'operating_expenses', v_expenses, 'net_profit', v_revenue - v_cogs - v_expenses,
      'discounts', v_discount, 'tax_collected', v_tax,
      'refunds_count', v_refund_count, 'refunds_total', v_refund_total),
    'comparison', jsonb_build_object(
      'previous_from', v_prev_from, 'previous_to', v_prev_to,
      'previous_revenue', v_prev_revenue, 'previous_sales_count', v_prev_sales,
      'revenue_change_pct', case when v_prev_revenue > 0 then round((v_revenue - v_prev_revenue) / v_prev_revenue * 100, 1) else null end),
    'payments', jsonb_build_object(
      'by_method', (select coalesce(jsonb_agg(jsonb_build_object('method', m.payment_method, 'sales_count', m.c, 'total', m.t) order by m.t desc), '[]'::jsonb)
                      from (select payment_method, count(*) c, sum(total) t from public.sales
                             where organization_id = p_org and status = 'completed' and created_at >= v_start and created_at < v_end group by payment_method) m),
      'credit_sales_total', (select coalesce(sum(total), 0) from public.sales where organization_id = p_org and status = 'completed'
                                and payment_method = 'credit' and created_at >= v_start and created_at < v_end),
      'credit_collected', v_collected),
    'top_products', (select coalesce(jsonb_agg(jsonb_build_object('name', t.name, 'quantity', t.q, 'revenue', t.r) order by t.r desc, t.name), '[]'::jsonb)
                       from (select p.name, sum(si.quantity) q, sum(si.line_total) r
                               from public.sale_items si join public.sales s on s.id = si.sale_id join public.products p on p.id = si.product_id
                              where s.organization_id = p_org and s.status = 'completed' and s.created_at >= v_start and s.created_at < v_end
                              group by p.id, p.name order by sum(si.line_total) desc, p.name limit 5) t),
    'low_stock', jsonb_build_object(
      'count', (select count(*) from public.products where organization_id = p_org and stock <= reorder_point),
      'items', (select coalesce(jsonb_agg(jsonb_build_object('name', l.name, 'stock', l.stock, 'reorder_point', l.reorder_point) order by l.stock, l.name), '[]'::jsonb)
                  from (select name, stock, reorder_point from public.products where organization_id = p_org and stock <= reorder_point order by stock, name limit 8) l)),
    'new_products', jsonb_build_object(
      'count', (select count(*) from public.products where organization_id = p_org and created_at >= v_start and created_at < v_end),
      'names', (select coalesce(jsonb_agg(n.name order by n.created_at), '[]'::jsonb)
                  from (select name, created_at from public.products where organization_id = p_org and created_at >= v_start and created_at < v_end order by created_at limit 5) n)),
    'customers', jsonb_build_object(
      'new_count', (select count(*) from public.customers where organization_id = p_org and created_at >= v_start and created_at < v_end),
      'new_names', (select coalesce(jsonb_agg(n.name order by n.created_at), '[]'::jsonb)
                      from (select name, created_at from public.customers where organization_id = p_org and created_at >= v_start and created_at < v_end order by created_at limit 5) n),
      'top', (select coalesce(jsonb_agg(jsonb_build_object('name', t.name, 'sales_count', t.c, 'total', t.r) order by t.r desc, t.name), '[]'::jsonb)
                from (select c.name, count(*) c, sum(s.total) r from public.sales s join public.customers c on c.id = s.customer_id
                       where s.organization_id = p_org and s.status = 'completed' and s.created_at >= v_start and s.created_at < v_end
                       group by c.id, c.name order by sum(s.total) desc, c.name limit 5) t),
      'owing_count', v_owing_count, 'owing_total', v_owing_total),
    'staff', (select coalesce(jsonb_agg(jsonb_build_object('name', w.name, 'sales_count', w.c, 'revenue', w.r) order by w.r desc, w.name), '[]'::jsonb)
                from (select coalesce(ep.full_name, pr.full_name, 'Team member') as name, count(*) c, sum(s.total) r
                        from public.sales s
                        left join public.employee_profiles ep on ep.organization_id = s.organization_id and ep.user_id = s.created_by
                        left join public.profiles pr on pr.id = s.created_by
                       where s.organization_id = p_org and s.status = 'completed' and s.created_at >= v_start and s.created_at < v_end
                       group by s.created_by, coalesce(ep.full_name, pr.full_name, 'Team member') order by sum(s.total) desc limit 8) w),
    'branches', (select coalesce(jsonb_agg(jsonb_build_object('name', b.name, 'sales_count', b.c, 'revenue', b.r) order by b.r desc, b.name), '[]'::jsonb)
                   from (select br.name, count(s.id) c, coalesce(sum(s.total), 0) r from public.branches br
                           left join public.sales s on s.branch_id = br.id and s.organization_id = p_org and s.status = 'completed'
                                 and s.created_at >= v_start and s.created_at < v_end
                          where br.organization_id = p_org group by br.id, br.name) b),
    'expense_categories', (select coalesce(jsonb_agg(jsonb_build_object('category', e.category, 'amount', e.a) order by e.a desc), '[]'::jsonb)
                             from (select coalesce(category, 'Other') category, sum(amount) a from public.expenses
                                    where organization_id = p_org and expense_date between p_from and p_to group by 1 order by sum(amount) desc limit 5) e),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('date', g.d::date, 'sales_count', coalesce(x.c, 0), 'revenue', coalesce(x.r, 0)) order by g.d), '[]'::jsonb)
                from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g(d)
                left join (select (created_at at time zone v_tz)::date as d, count(*) c, sum(total) r from public.sales
                            where organization_id = p_org and status = 'completed' and created_at >= v_start and created_at < v_end group by 1) x
                       on x.d = g.d::date),
    'peak_hour', (select jsonb_build_object('hour', h.hr, 'revenue', h.r)
                    from (select extract(hour from created_at at time zone v_tz)::int hr, sum(total) r from public.sales
                           where organization_id = p_org and status = 'completed' and created_at >= v_start and created_at < v_end
                           group by 1 order by sum(total) desc limit 1) h)
  );
end $$;
revoke all on function public._build_business_report(uuid, date, date, text) from public, anon, authenticated;

-- ---------- 4. on-demand report for the app (owners and admins only) -----------------------------------------------
create or replace function public.get_business_report(p_org uuid, p_kind text default 'daily', p_date date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := (now() at time zone public.org_timezone(p_org))::date;
  v_date date := coalesce(p_date, v_today);
  v_from date; v_to date;
begin
  if not public.is_org_manager(p_org) then
    raise exception using message = '{"code":"ORGANIZATION_ACCESS_DENIED","message":"Organization access denied"}';
  end if;
  if p_kind not in ('daily', 'weekly') then
    raise exception using message = '{"code":"INVALID_REPORT_KIND","message":"Report kind must be daily or weekly"}';
  end if;
  if v_date > v_today or v_date < v_today - 400 then
    raise exception using message = '{"code":"INVALID_DATE_RANGE","message":"That date is outside the reports available"}';
  end if;
  if p_kind = 'daily' then
    v_from := v_date; v_to := v_date;
  else
    v_from := date_trunc('week', v_date::timestamp)::date; v_to := v_from + 6; -- Monday to Sunday
  end if;
  return public._build_business_report(p_org, v_from, v_to, p_kind);
end $$;
revoke all on function public.get_business_report(uuid, text, date) from public, anon;
grant execute on function public.get_business_report(uuid, text, date) to authenticated;

-- ---------- 5. storing + notifying -------------------------------------------------------------------------------
create or replace function public._store_business_report(p_org uuid, p_kind text, p_from date, p_to date, p_final boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_payload jsonb := public._build_business_report(p_org, p_from, p_to, p_kind);
  v_sales bigint := (v_payload #>> '{summary,sales_count}')::bigint;
  v_active boolean;
  v_inserted boolean;
begin
  -- A quiet day or week is not worth a row or a notification.
  v_active := case p_kind
    when 'daily' then v_sales > 0 or (v_payload #>> '{summary,operating_expenses}')::numeric > 0 or (v_payload #>> '{customers,new_count}')::int > 0
    else v_sales > 0 end;
  if not v_active then return jsonb_build_object('state', 'skipped'); end if;

  insert into public.business_reports (organization_id, kind, period_from, period_to, payload, is_final)
  values (p_org, p_kind, p_from, p_to, v_payload, p_final)
  on conflict (organization_id, kind, period_from) do update
    set payload = excluded.payload, period_to = excluded.period_to, is_final = public.business_reports.is_final or excluded.is_final, generated_at = now()
    where not public.business_reports.is_final or excluded.is_final
  returning (xmax = 0) into v_inserted;

  return jsonb_build_object('state', case when v_inserted then 'inserted' else 'updated' end, 'payload', v_payload);
end $$;
revoke all on function public._store_business_report(uuid, text, date, date, boolean) from public, anon, authenticated;

create or replace function public._notify_report(p_org uuid, p_kind text, p_payload jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_cur text := p_payload #>> '{business,currency}';
  v_sales bigint := (p_payload #>> '{summary,sales_count}')::bigint;
  v_revenue numeric := (p_payload #>> '{summary,revenue}')::numeric;
  v_title text; v_body text; v_change numeric; v_best jsonb; v_top text; v_new int; v_low int;
begin
  v_top := p_payload #>> '{top_products,0,name}';
  v_new := (p_payload #>> '{customers,new_count}')::int;
  v_low := (p_payload #>> '{low_stock,count}')::int;
  if p_kind = 'daily' then
    v_title := case when v_sales = 0 then 'Daily report: no sales recorded today'
                    else 'Daily report: ' || public.report_money(v_revenue, v_cur) || ' from ' || v_sales || case when v_sales = 1 then ' sale' else ' sales' end end;
    v_body := concat_ws(' · ',
      'Profit ' || public.report_money((p_payload #>> '{summary,net_profit}')::numeric, v_cur) || ' after expenses',
      case when v_top is not null then 'Top seller: ' || v_top end,
      case when v_new > 0 then v_new || ' new customer' || case when v_new = 1 then '' else 's' end end,
      case when v_low > 0 then v_low || ' item' || case when v_low = 1 then '' else 's' end || ' running low' end,
      'Open Reports to download it.');
  else
    v_change := (p_payload #>> '{comparison,revenue_change_pct}')::numeric;
    select d into v_best from jsonb_array_elements(p_payload -> 'daily') d order by (d ->> 'revenue')::numeric desc limit 1;
    v_title := 'Weekly report: ' || public.report_money(v_revenue, v_cur) || ' from ' || v_sales || case when v_sales = 1 then ' sale' else ' sales' end;
    v_body := concat_ws(' · ',
      case when v_change is null then null when v_change > 999 then 'Up over 999% on last week' when v_change >= 0 then 'Up ' || v_change || '% on last week'
           when v_change < -999 then 'Down over 999% on last week' else 'Down ' || abs(v_change) || '% on last week' end,
      case when v_best is not null and (v_best ->> 'revenue')::numeric > 0 then 'Best day: ' || to_char((v_best ->> 'date')::date, 'FMDay') end,
      case when v_top is not null then 'Top seller: ' || v_top end,
      case when v_new > 0 then v_new || ' new customer' || case when v_new = 1 then '' else 's' end end,
      'Open Reports to download it.');
  end if;
  insert into public.notifications (organization_id, user_id, title, body)
  select p_org, m.user_id, v_title, v_body from public.organization_members m where m.organization_id = p_org and m.role = 'owner';
end $$;
revoke all on function public._notify_report(uuid, text, jsonb) from public, anon, authenticated;

-- ---------- 6. the scheduler (runs every 5 minutes; each business has its own slot inside the hour) -----------------
create or replace function public.run_scheduled_reports(p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  o record; v_local timestamp; v_date date; v_hour int; v_minute int; v_dow int;
  v_result jsonb; v_checked int := 0; v_created int := 0; v_notified int := 0;
begin
  for o in
    select org.id, org.report_timezone as tz, org.report_hour as hr, org.report_daily_enabled as daily_on, org.report_weekly_enabled as weekly_on
      from public.organizations org
     where (org.report_daily_enabled or org.report_weekly_enabled)
       and exists (select 1 from public.subscriptions s where s.organization_id = org.id and s.status in ('trialing', 'active'))
  loop
    v_local := p_now at time zone o.tz;
    v_date := v_local::date; v_hour := extract(hour from v_local)::int; v_minute := extract(minute from v_local)::int;
    v_dow := extract(isodow from v_local)::int; -- 1 = Monday ... 7 = Sunday
    continue when (abs(hashtext(o.id::text)) % 12) <> (v_minute / 5);
    v_checked := v_checked + 1;

    -- Evening summary: today so far, then a notification to the owners.
    if v_hour = o.hr and o.daily_on then
      v_result := public._store_business_report(o.id, 'daily', v_date, v_date, false);
      if v_result ->> 'state' <> 'skipped' then v_created := v_created + 1; end if;
      if v_result ->> 'state' = 'inserted' then perform public._notify_report(o.id, 'daily', v_result -> 'payload'); v_notified := v_notified + 1; end if;
    end if;
    -- Sunday evening: the week so far.
    if v_hour = o.hr and o.weekly_on and v_dow = 7 then
      v_result := public._store_business_report(o.id, 'weekly', v_date - 6, v_date, false);
      if v_result ->> 'state' <> 'skipped' then v_created := v_created + 1; end if;
      if v_result ->> 'state' = 'inserted' then perform public._notify_report(o.id, 'weekly', v_result -> 'payload'); v_notified := v_notified + 1; end if;
    end if;
    -- Just after midnight: close the books on yesterday (late-night trading included), and last week on Mondays. Silent.
    if v_hour = 0 then
      if o.daily_on then perform public._store_business_report(o.id, 'daily', v_date - 1, v_date - 1, true); end if;
      if o.weekly_on and v_dow = 1 then perform public._store_business_report(o.id, 'weekly', v_date - 7, v_date - 1, true); end if;
    end if;
  end loop;

  -- Housekeeping, once an hour: keep 400 days of daily reports and about 2 years of weekly ones.
  if extract(minute from p_now) < 5 then
    delete from public.business_reports where kind = 'daily' and period_from < (p_now at time zone 'UTC')::date - 400;
    delete from public.business_reports where kind = 'weekly' and period_from < (p_now at time zone 'UTC')::date - 800;
  end if;
  return jsonb_build_object('businesses_checked', v_checked, 'reports_written', v_created, 'notifications_sent', v_notified);
end $$;
revoke all on function public.run_scheduled_reports(timestamptz) from public, anon, authenticated;
grant execute on function public.run_scheduled_reports(timestamptz) to service_role;

-- Install the 5-minute timer where pg_cron exists (Supabase has it; enable it under Integrations > Cron if this notice appears).
do $$ begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
      perform cron.schedule('zb-scheduled-reports', '*/5 * * * *', 'select public.run_scheduled_reports()');
    exception when others then
      raise notice 'pg_cron could not be enabled automatically (%). Enable it in Supabase > Integrations > Cron, then run: select cron.schedule(''zb-scheduled-reports'', ''*/5 * * * *'', ''select public.run_scheduled_reports()'');', sqlerrm;
    end;
  else
    raise notice 'pg_cron is not available here. Schedule public.run_scheduled_reports() every 5 minutes with your platform''s scheduler.';
  end if;
end $$;

-- ---------- 7. Overview/Reports now count a day in the business's own time zone (was UTC) ----------
CREATE OR REPLACE FUNCTION public.get_dashboard_metrics(target_org uuid, date_from date, date_to date, target_branch uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tz text := public.org_timezone(target_org);
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
    and s.created_at >= (date_from::timestamp at time zone v_tz)
    and s.created_at < ((date_to + 1)::timestamp at time zone v_tz)
    and (target_branch is null or s.branch_id = target_branch);

  select coalesce(sum(si.quantity * coalesce(si.cost_price, 0)), 0)
    into cogs
  from public.sale_items si
  join public.sales s on s.id = si.sale_id
  where s.organization_id = target_org
    and s.status = 'completed'
    and s.created_at >= (date_from::timestamp at time zone v_tz)
    and s.created_at < ((date_to + 1)::timestamp at time zone v_tz)
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
        and (sm.created_at at time zone v_tz)::date between date_from and date_to
        and (target_branch is null or sm.branch_id = target_branch)
    ),
    'stock_sold', (
      select coalesce(sum(abs(sm.quantity)), 0)
      from public.stock_movements sm
      where sm.organization_id = target_org
        and sm.movement_type = 'SALE'
        and (sm.created_at at time zone v_tz)::date between date_from and date_to
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
          and s.created_at >= (date_from::timestamp at time zone v_tz)
          and s.created_at < ((date_to + 1)::timestamp at time zone v_tz)
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
          and s.created_at >= (date_from::timestamp at time zone v_tz)
          and s.created_at < ((date_to + 1)::timestamp at time zone v_tz)
        where b.organization_id = target_org
          and (target_branch is null or b.id = target_branch)
        group by b.id, b.name
      ) branch_result
    )
  );
end;
$function$;

-- Revenue by branch follows the same business-day rule.
CREATE OR REPLACE FUNCTION public.get_branch_breakdown(target_org uuid, date_from date, date_to date)
 RETURNS TABLE(branch_id uuid, branch_name text, revenue numeric, sales_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_org_manager(target_org) then raise exception 'UNAUTHORIZED: owners and managers only'; end if;
  if date_from is null or date_to is null or date_from > date_to then raise exception 'INVALID_DATE_RANGE'; end if;
  return query
    with sold as (
      select s.branch_id, sum(s.total)::numeric as revenue, count(*) as sales_count
      from public.sales s
      where s.organization_id = target_org and s.status = 'completed'
        and s.created_at >= (date_from::timestamp at time zone public.org_timezone(target_org))
        and s.created_at < ((date_to + 1)::timestamp at time zone public.org_timezone(target_org))
      group by s.branch_id
    )
    select b.id, b.name::text, coalesce(sold.revenue, 0), coalesce(sold.sales_count, 0)
      from public.branches b left join sold on sold.branch_id = b.id
     where b.organization_id = target_org and b.status = 'active'
    union all
    select null::uuid, 'No branch'::text, sold.revenue, sold.sales_count from sold where sold.branch_id is null
    order by 3 desc, 2;
end;
$function$;

notify pgrst, 'reload schema';
