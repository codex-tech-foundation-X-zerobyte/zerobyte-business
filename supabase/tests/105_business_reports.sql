\pset pager off
\set ON_ERROR_STOP on
-- Self-checking: prints ALL BUSINESS REPORT CHECKS PASSED or stops at the first failed expectation.
-- Run on a freshly migrated database (see README.md). Dates are relative to "today", so it never goes stale.

create or replace function pg_temp.run_as(p_user uuid, p_sql text) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
  execute case when p_user is null then 'set local role anon' else 'set local role authenticated' end;
  begin execute p_sql; r := 'OK'; exception when others then r := sqlerrm; end;
  execute 'reset role';
  return r;
end $$;
create or replace function pg_temp.count_as(p_user uuid, p_sql text) returns bigint language plpgsql as $$
declare n bigint;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
  execute case when p_user is null then 'set local role anon' else 'set local role authenticated' end;
  begin execute p_sql into n; exception when others then n := -1; end;
  execute 'reset role';
  return n;
end $$;
create or replace function pg_temp.report_as(p_user uuid, p_org uuid, p_kind text, p_date date) returns jsonb language plpgsql as $$
declare j jsonb;
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  set local role authenticated;
  j := public.get_business_report(p_org, p_kind, p_date);
  reset role;
  return j;
end $$;

do $$ declare
  tz constant text := 'Africa/Lagos';
  today date := (now() at time zone 'Africa/Lagos')::date;
  d date := (now() at time zone 'Africa/Lagos')::date - 3;           -- the test day
  sun date := (now() at time zone 'Africa/Lagos')::date - (extract(isodow from (now() at time zone 'Africa/Lagos')::date)::int % 7) - 14; -- a Sunday two weeks back, so the weekly test has a week of its own
  ownerA uuid := gen_random_uuid(); adminA uuid := gen_random_uuid(); workerA uuid := gen_random_uuid(); ownerB uuid := gen_random_uuid(); stranger uuid := gen_random_uuid();
  orgA uuid := gen_random_uuid(); orgB uuid := gen_random_uuid(); orgQ uuid := gen_random_uuid(); orgX uuid := gen_random_uuid(); orgO uuid := gen_random_uuid();
  prodRice uuid := gen_random_uuid(); prodOil uuid := gen_random_uuid(); cust uuid := gen_random_uuid(); s1 uuid := gen_random_uuid(); s2 uuid := gen_random_uuid(); s3 uuid := gen_random_uuid(); s4 uuid := gen_random_uuid();
  r jsonb; m jsonb; res text; n bigint; slot int; t timestamptz; rows_before int;
begin
  insert into auth.users(id,email,email_confirmed_at) values
    (ownerA,'owner-a@t.test',now()),(adminA,'admin-a@t.test',now()),(workerA,'worker-a@t.test',now()),(ownerB,'owner-b@t.test',now()),(stranger,'stranger@t.test',now());
  insert into public.organizations(id,name,slug) values (orgA,'Alpha Stores','alpha-r'),(orgB,'Beta Shop','beta-r'),(orgQ,'Quiet Co','quiet-r'),(orgX,'Expired Co','expired-r'),(orgO,'Off Co','off-r');
  insert into public.organization_members(organization_id,user_id,role) values
    (orgA,ownerA,'owner'),(orgA,adminA,'admin'),(orgA,workerA,'member'),(orgB,ownerB,'owner'),
    (orgQ,ownerB,'owner'),(orgX,ownerB,'owner'),(orgO,ownerB,'owner');
  update public.subscriptions set status = 'active' where organization_id in (orgA,orgB,orgQ,orgO);
  update public.subscriptions set status = 'expired' where organization_id = orgX;

  insert into public.products(id,organization_id,name,sku,price,cost_price,stock,reorder_point) values
    (prodRice,orgA,'Rice 5kg','RC',500,300,50,5),(prodOil,orgA,'Palm Oil 5L','OIL',1500,1000,2,5);
  insert into public.customers(id,organization_id,name,phone,email) values (cust,orgA,'Ngozi Okafor','08011112222','secret@cust.test');

  -- S1 23:30 on day d, S2 00:30 and S3 11:00 on d+1 (Lagos time): S2 is the late-night sale a UTC "day" got wrong.
  insert into public.sales(id,organization_id,status,total,tax_amount,discount_amount,payment_method,created_by,customer_id,created_at) values
    (s1,orgA,'completed',1000,0,0,'cash',ownerA,null,       ((d    )::timestamp + time '23:30') at time zone tz),
    (s2,orgA,'completed',2000,0,0,'transfer',workerA,cust,   ((d + 1)::timestamp + time '00:30') at time zone tz),
    (s3,orgA,'completed',1500,0,0,'credit',ownerA,cust,      ((d + 1)::timestamp + time '11:00') at time zone tz),
    (s4,orgA,'refunded',700,0,0,'cash',ownerA,null,          ((d + 1)::timestamp + time '12:00') at time zone tz);
  insert into public.sale_items(sale_id,product_id,quantity,unit_price,cost_price) values
    (s1,prodRice,2,500,300),(s2,prodOil,1,1500,1000),(s2,prodRice,1,500,300),(s3,prodOil,1,1500,1000);
  insert into public.expenses(organization_id,title,category,amount,expense_date,payment_method) values (orgA,'Transport','Transport',250,d + 1,'cash');
  insert into public.customer_payments(organization_id,customer_id,amount,created_by,created_at) values (orgA,cust,400,ownerA,((d + 1)::timestamp + time '15:00') at time zone tz);

  ---------------------------------------------------------------------------------------------------- correctness
  r := pg_temp.report_as(ownerA, orgA, 'daily', d);
  assert (r #>> '{summary,sales_count}')::int = 1 and (r #>> '{summary,revenue}')::numeric = 1000, 'day d must hold only the 23:30 Lagos sale: '||(r #>> '{summary}');
  r := pg_temp.report_as(ownerA, orgA, 'daily', d + 1);
  assert (r #>> '{summary,sales_count}')::int = 2, 'the 00:30 Lagos sale belongs to the next day, not the UTC day before';
  assert (r #>> '{summary,revenue}')::numeric = 3500, 'revenue 2000 + 1500 (refunded sale excluded)';
  assert (r #>> '{summary,cogs}')::numeric = 1300 + 1000, 'cost of goods = 1000+300 (S2) + 1000 (S3)';
  assert (r #>> '{summary,gross_profit}')::numeric = 1200, 'gross profit';
  assert (r #>> '{summary,operating_expenses}')::numeric = 250 and (r #>> '{summary,net_profit}')::numeric = 950, 'expenses and net profit';
  assert (r #>> '{summary,items_sold}')::int = 3, 'items sold';
  assert (r #>> '{summary,refunds_count}')::int = 1 and (r #>> '{summary,refunds_total}')::numeric = 700, 'refunds reported separately';
  assert (r #>> '{top_products,0,name}') = 'Palm Oil 5L' and (r #>> '{top_products,0,revenue}')::numeric = 3000, 'top product by revenue';
  assert (r #>> '{payments,credit_sales_total}')::numeric = 1500 and (r #>> '{payments,credit_collected}')::numeric = 400, 'credit sold vs credit collected';
  assert (r #>> '{customers,owing_total}')::numeric = 1100 and (r #>> '{customers,owing_count}')::int = 1, 'owing = 1500 credit - 400 repaid (same as the Customers page)';
  assert (r #>> '{customers,top,0,name}') = 'Ngozi Okafor', 'top customer';
  assert (r #>> '{low_stock,count}')::int = 1 and (r #>> '{low_stock,items,0,name}') = 'Palm Oil 5L', 'low stock list';
  assert (r #>> '{comparison,previous_revenue}')::numeric = 1000 and (r #>> '{comparison,revenue_change_pct}')::numeric = 250.0, 'comparison with the day before (+250%)';
  assert jsonb_array_length(r -> 'staff') = 2, 'sales per team member';
  assert (r #>> '{timezone}') = tz, 'timezone recorded';

  -- the Overview numbers and the report can never disagree
  perform set_config('request.jwt.claim.sub', ownerA::text, true); set local role authenticated;
  m := public.get_dashboard_metrics(orgA, d + 1, d + 1, null);
  reset role;
  assert (m ->> 'revenue')::numeric = (r #>> '{summary,revenue}')::numeric, 'Overview revenue = report revenue';
  assert (m ->> 'sales_count')::int = (r #>> '{summary,sales_count}')::int and (m ->> 'cogs')::numeric = (r #>> '{summary,cogs}')::numeric, 'Overview count/cogs = report';
  assert (m ->> 'net_profit')::numeric = (r #>> '{summary,net_profit}')::numeric, 'Overview net profit = report';

  -- revenue by branch uses the same business day
  perform set_config('request.jwt.claim.sub', ownerA::text, true); set local role authenticated;
  assert (select coalesce(sum(revenue), 0) from public.get_branch_breakdown(orgA, d + 1, d + 1)) = 3500, 'branch breakdown uses the Lagos day too';
  reset role;

  -- weekly (Monday to Sunday) holds the whole week, daily series is zero-filled
  r := pg_temp.report_as(ownerA, orgA, 'weekly', d + 1);
  assert (r ->> 'period_to')::date - (r ->> 'period_from')::date = 6 and extract(isodow from (r ->> 'period_from')::date) = 1, 'week runs Monday to Sunday';
  assert jsonb_array_length(r -> 'daily') = 7, 'seven daily points';

  -- the business's own time zone decides the day
  update public.organizations set report_timezone = 'UTC' where id = orgA;
  r := pg_temp.report_as(ownerA, orgA, 'daily', d);
  assert (r #>> '{summary,sales_count}')::int = 2, 'in UTC the 23:30 and 00:30(Lagos) sales both fall on day d: the setting is honoured';
  update public.organizations set report_timezone = tz where id = orgA;

  ---------------------------------------------------------------------------------------------------- privacy
  r := pg_temp.report_as(ownerA, orgA, 'daily', d + 1);
  assert position('08011112222' in r::text) = 0 and position('secret@cust.test' in r::text) = 0, 'no phone numbers or emails in a report';
  assert (select array_agg(k order by k) from jsonb_object_keys(r) k) = array['branches','business','comparison','customers','daily','days','expense_categories','generated_at','kind','low_stock','new_products','payments','peak_hour','period_from','period_to','staff','summary','timezone','top_products','version'],
    'unexpected fields in the report payload';

  ---------------------------------------------------------------------------------------------------- who can read
  assert pg_temp.run_as(adminA, format('select public.get_business_report(%L, ''daily'', %L)', orgA, d)) = 'OK', 'an admin of the business can read';
  res := pg_temp.run_as(workerA, format('select public.get_business_report(%L, ''daily'', %L)', orgA, d));
  assert res like '%ORGANIZATION_ACCESS_DENIED%', 'a plain team member must not read reports: '||res;
  res := pg_temp.run_as(ownerB, format('select public.get_business_report(%L, ''daily'', %L)', orgA, d));
  assert res like '%ORGANIZATION_ACCESS_DENIED%', 'another business must not read reports: '||res;
  res := pg_temp.run_as(stranger, format('select public.get_business_report(%L, ''daily'', %L)', orgA, d));
  assert res like '%ORGANIZATION_ACCESS_DENIED%', 'a stranger must not read reports';
  res := pg_temp.run_as(null, format('select public.get_business_report(%L, ''daily'', %L)', orgA, d));
  assert res like '%permission denied%', 'anonymous visitors must not call it: '||res;

  ---------------------------------------------------------------------------------------------------- input limits
  assert pg_temp.run_as(ownerA, format('select public.get_business_report(%L, ''monthly'', %L)', orgA, d)) like '%INVALID_REPORT_KIND%', 'kind is validated';
  assert pg_temp.run_as(ownerA, format('select public.get_business_report(%L, ''daily'', %L)', orgA, today + 1)) like '%INVALID_DATE_RANGE%', 'no future dates';
  assert pg_temp.run_as(ownerA, format('select public.get_business_report(%L, ''daily'', %L)', orgA, today - 401)) like '%INVALID_DATE_RANGE%', 'no dates older than 400 days';
  assert pg_temp.run_as(ownerA, format('update public.organizations set report_timezone = ''Mars/Olympus'' where id = %L', orgA)) like '%unknown time zone%', 'bad time zone rejected';
  assert pg_temp.run_as(ownerA, format('update public.organizations set report_hour = 24 where id = %L', orgA)) like '%report_hour_check%', 'hour out of range rejected';
  assert pg_temp.run_as(ownerA, format('update public.organizations set report_hour = 20, report_daily_enabled = true where id = %L', orgA)) = 'OK', 'owner can change report settings';
  update public.organizations set report_hour = 21 where id = orgA;

  ---------------------------------------------------------------------------------------------------- scheduler
  -- the engine cannot be called by customers at all
  foreach res in array array[
    format('select public._build_business_report(%L, %L, %L, ''daily'')', orgA, d, d),
    'select public.run_scheduled_reports()',
    format('select public._store_business_report(%L, ''daily'', %L, %L, true)', orgA, d, d),
    format('select public._notify_report(%L, ''daily'', ''{}''::jsonb)', orgA)] loop
    assert pg_temp.run_as(ownerA, res) like '%permission denied%', 'internal function reachable by a customer: '||res;
  end loop;

  slot := abs(hashtext(orgA::text)) % 12;
  -- evening summary at report_hour, inside this business's 5-minute slot
  t := ((d + 1)::timestamp + time '21:00' + ((slot * 5 + 1) * interval '1 minute')) at time zone tz;
  r := public.run_scheduled_reports(t);
  assert (r ->> 'reports_written')::int >= 1 and (r ->> 'notifications_sent')::int >= 1, 'evening run writes and notifies: '||r::text;
  assert (select count(*) from public.business_reports where organization_id = orgA and kind = 'daily' and period_from = d + 1 and not is_final) = 1, 'provisional daily report stored';
  assert (select count(*) from public.notifications where organization_id = orgA and title like 'Daily report: ₦3,500 from 2 sales') = 1, 'owner gets one daily notification: '||coalesce((select string_agg(title,' | ') from public.notifications where organization_id = orgA),'none');
  assert (select user_id from public.notifications where organization_id = orgA limit 1) = ownerA, 'the OWNER is notified (not team members)';
  perform public.run_scheduled_reports(t); perform public.run_scheduled_reports(t + interval '30 seconds');
  assert (select count(*) from public.notifications where organization_id = orgA and title like 'Daily report%') = 1, 'running again never notifies twice';

  -- a different minute is another business's slot: nothing for this one
  select count(*) into rows_before from public.business_reports where organization_id = orgA;
  perform public.run_scheduled_reports(((d + 1)::timestamp + time '21:00' + ((((slot + 1) % 12) * 5 + 1) * interval '1 minute')) at time zone tz);
  assert (select count(*) from public.business_reports where organization_id = orgA) = rows_before, 'other slots do not touch this business';

  -- just after midnight: yesterday is closed (final) silently
  t := ((d + 2)::timestamp + time '00:00' + ((slot * 5 + 1) * interval '1 minute')) at time zone tz;
  perform public.run_scheduled_reports(t);
  assert (select is_final from public.business_reports where organization_id = orgA and kind = 'daily' and period_from = d + 1), 'daily report finalised after midnight';
  assert (select count(*) from public.notifications where organization_id = orgA and title like 'Daily report%') = 1, 'finalising is silent';

  -- a late sale after the evening report is still included once the day is closed
  insert into public.sales(organization_id,status,total,tax_amount,discount_amount,payment_method,created_by,created_at)
    values (orgA,'completed',900,0,0,'cash',ownerA,((d + 1)::timestamp + time '23:45') at time zone tz);
  perform public.run_scheduled_reports(t);
  assert (select (payload #>> '{summary,revenue}')::numeric from public.business_reports where organization_id = orgA and kind = 'daily' and period_from = d + 1) = 4400, 'the 23:45 sale is in the final report';
  -- a provisional run can never overwrite a final report
  perform public.run_scheduled_reports(((d + 1)::timestamp + time '21:00' + ((slot * 5 + 1) * interval '1 minute')) at time zone tz);
  assert (select is_final from public.business_reports where organization_id = orgA and kind = 'daily' and period_from = d + 1), 'final stays final';

  -- weekly: Sunday evening provisional + notification, Monday midnight final
  insert into public.sales(organization_id,status,total,tax_amount,discount_amount,payment_method,created_by,created_at)
    values (orgA,'completed',5000,0,0,'cash',ownerA,(sun::timestamp + time '12:00') at time zone tz);
  n := (select count(*) from public.notifications where organization_id = orgA and title like 'Weekly report: ₦%');
  perform public.run_scheduled_reports(((sun)::timestamp + time '21:00' + ((slot * 5 + 1) * interval '1 minute')) at time zone tz);
  assert (select count(*) from public.business_reports where organization_id = orgA and kind = 'weekly' and period_to = sun and not is_final) = 1, 'Sunday evening weekly report';
  assert (select count(*) from public.notifications where organization_id = orgA and title like 'Weekly report: ₦%') = n + 1, 'weekly notification sent once';
  perform public.run_scheduled_reports(((sun + 1)::timestamp + time '00:00' + ((slot * 5 + 1) * interval '1 minute')) at time zone tz);
  assert (select is_final from public.business_reports where organization_id = orgA and kind = 'weekly' and period_to = sun), 'weekly report finalised on Monday';

  -- stored reports follow the same read rules as live ones
  assert pg_temp.count_as(ownerA, format('select count(*) from public.business_reports where organization_id = %L', orgA)) >= 3, 'the owner can list stored reports';
  assert pg_temp.count_as(adminA, format('select count(*) from public.business_reports where organization_id = %L', orgA)) >= 3, 'an admin can list stored reports';
  assert pg_temp.count_as(workerA, format('select count(*) from public.business_reports where organization_id = %L', orgA)) = 0, 'a team member sees none';
  assert pg_temp.count_as(ownerB, format('select count(*) from public.business_reports where organization_id = %L', orgA)) = 0, 'another business sees none';
  assert pg_temp.count_as(null, 'select count(*) from public.business_reports') = -1, 'anonymous: permission denied';

  -- nobody can write reports from the app, not even the owner
  assert pg_temp.run_as(ownerA, format('insert into public.business_reports(organization_id,kind,period_from,period_to,payload) values (%L,''daily'',%L,%L,''{}'')', orgA, d, d)) like '%permission denied%', 'no insert';
  assert pg_temp.run_as(ownerA, format('update public.business_reports set payload = ''{"forged":true}'' where organization_id = %L', orgA)) like '%permission denied%', 'no update';
  assert pg_temp.run_as(ownerA, format('delete from public.business_reports where organization_id = %L', orgA)) like '%permission denied%', 'no delete';

  -- quiet, expired and switched-off businesses get nothing
  update public.subscriptions set status = 'active' where organization_id = orgX; -- a lapsed plan cannot record sales, so add the sale first
  insert into public.sales(organization_id,status,total,tax_amount,discount_amount,payment_method,created_by,created_at)
    values (orgX,'completed',100,0,0,'cash',ownerB,((d + 1)::timestamp + time '10:00') at time zone tz),
           (orgO,'completed',100,0,0,'cash',ownerB,((d + 1)::timestamp + time '10:00') at time zone tz);
  update public.subscriptions set status = 'expired' where organization_id = orgX;
  update public.organizations set report_daily_enabled = false, report_weekly_enabled = false where id = orgO;
  for slot in 0..11 loop
    perform public.run_scheduled_reports(((d + 1)::timestamp + time '21:00' + ((slot * 5 + 1) * interval '1 minute')) at time zone tz);
  end loop;
  assert not exists (select 1 from public.business_reports where organization_id = orgQ), 'a business with no activity gets no report';
  assert not exists (select 1 from public.business_reports where organization_id = orgX), 'a business whose plan lapsed gets no new reports';
  assert not exists (select 1 from public.business_reports where organization_id = orgO), 'a business that switched reports off gets none';

  -- housekeeping
  insert into public.business_reports(organization_id,kind,period_from,period_to,payload,is_final) values (orgA,'daily',today - 500,today - 500,'{}',true);
  perform public.run_scheduled_reports(date_trunc('hour', now()) + interval '2 minutes');
  assert not exists (select 1 from public.business_reports where organization_id = orgA and period_from = today - 500), 'old daily reports are cleaned up';
end $$;
\echo ALL BUSINESS REPORT CHECKS PASSED
