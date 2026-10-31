\set ON_ERROR_STOP on
\pset pager off
-- Self-checking: any failed expectation raises an error and stops the script. Run on a database with every migration applied.
insert into auth.users(id,email) values
  ('00000000-0000-4000-d000-000000000001','an-super@t.test'), ('00000000-0000-4000-d000-000000000002','an-support@t.test'),
  ('00000000-0000-4000-d000-000000000003','an-owner@t.test'), ('00000000-0000-4000-d000-000000000004','an-other@t.test') on conflict do nothing;
insert into platform_admin_access(user_id,role,status) values ('00000000-0000-4000-d000-000000000001','SUPER_ADMIN','active'),('00000000-0000-4000-d000-000000000002','SUPPORT_ADMIN','active') on conflict do nothing;
insert into organizations(id,name,slug) values ('00000000-0000-4000-e000-000000000001','Analytics Org','analytics-org'),('00000000-0000-4000-e000-000000000002','Other Org','analytics-other-org') on conflict do nothing;
insert into organization_members(organization_id,user_id,role) values ('00000000-0000-4000-e000-000000000001','00000000-0000-4000-d000-000000000003','owner'),('00000000-0000-4000-e000-000000000002','00000000-0000-4000-d000-000000000004','owner') on conflict do nothing;
update subscriptions set plan_id=(select id from plans where code='pro_plus') where organization_id in ('00000000-0000-4000-e000-000000000001','00000000-0000-4000-e000-000000000002');
delete from site_visits; delete from user_activity_daily;
insert into products(organization_id,name,sku,stock,price,cost_price,reorder_point) values
  ('00000000-0000-4000-e000-000000000001','Low item','LOW1',2,100,50,5),('00000000-0000-4000-e000-000000000001','Fine item','FINE1',500,100,50,5) on conflict do nothing;
insert into customers(id,organization_id,name) select ('00000000-0000-4000-f000-' || lpad(g::text,12,'0'))::uuid,'00000000-0000-4000-e000-000000000001','Cust '||g from generate_series(1,5) g on conflict do nothing;

create or replace function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, false), set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, false) $$;

-- ---- A. collection: sanitised, capped, and not readable from the browser
set role anon;
select track_visit('abcdefghijklmnop1234','/','https://www.google.com/search?q=x','PAT1','desktop');
select track_visit('abcdefghijklmnop1234','/guide','https://www.google.com/','PAT1','desktop');
select track_visit('zyxwvutsrqponmlk9999','/','https://wa.me/abc',null,'mobile');
select track_visit('short','/',null,null,'desktop');
select track_visit('abcdefghijklmnop1234','/secret-admin-path',null,null,'desktop');
select track_visit('abcdefghijklmnop1234','/','not a url','bad code!!','weird');
select track_visit('floodervisitor123456','/',null,null,'desktop') from generate_series(1,100);
reset role;
do $$ begin
  assert (select count(*) from site_visits where visitor_hash <> md5('floodervisitor123456:' || (now() at time zone 'Africa/Lagos')::date::text)) = 4, 'only valid visits on known routes are stored';
  assert (select count(*) from site_visits where visitor_hash = md5('floodervisitor123456:' || (now() at time zone 'Africa/Lagos')::date::text)) = 60, 'one visitor is capped at 60 rows a day';
  assert (select count(*) from site_visits where ref_code = 'bad code!!') = 0 and (select count(*) from site_visits where referrer_host = 'not a url') = 0, 'junk referrer and promoter codes are dropped';
  assert (select device from site_visits where path='/' and referrer_host is null and ref_code is null and device='other' limit 1) = 'other', 'unknown device class becomes other';
end $$;
delete from site_visits where visitor_hash = md5('floodervisitor123456:' || (now() at time zone 'Africa/Lagos')::date::text);
do $$ declare failed boolean := false; begin
  set local role anon;
  begin perform count(*) from site_visits; exception when insufficient_privilege then failed := true; end;
  assert failed, 'anon must not read site_visits';
  failed := false; set local role authenticated;
  begin insert into site_visits(day, visitor_hash, path) values (current_date, 'x', '/'); exception when insufficient_privilege then failed := true; end;
  assert failed, 'a signed-in browser must not write site_visits directly';
  reset role;
end $$;

-- ---- B. signed-in activity: one row per account per day, counts opens, ignores orgs you are not in
select pg_temp.as_user('00000000-0000-4000-d000-000000000003');
set role authenticated; select record_activity('00000000-0000-4000-e000-000000000001'); select record_activity('00000000-0000-4000-e000-000000000002'); reset role;
do $$ begin
  assert (select opens from user_activity_daily where user_id='00000000-0000-4000-d000-000000000003') = 2, 'repeat opens count on the same row';
  assert (select organization_id from user_activity_daily where user_id='00000000-0000-4000-d000-000000000003') = '00000000-0000-4000-e000-000000000001', 'an organization you do not belong to is ignored';
end $$;

-- ---- C. who can read the analytics
do $$ declare r jsonb; refused boolean := false; begin
  perform pg_temp.as_user('00000000-0000-4000-d000-000000000003'); set local role authenticated;
  begin perform admin_get_analytics(30); exception when others then refused := true; end;
  assert refused, 'a business owner must be refused';
  reset role; perform pg_temp.as_user('00000000-0000-4000-d000-000000000002'); set local role authenticated;
  r := admin_get_analytics(30);
  assert not (r ? 'revenue') and not (r ? 'security'), 'a support admin gets no revenue or security data';
  assert (r->'visitors'->>'today')::int = 2 and (r->'visitors'->>'page_views_today')::int = 4, 'visitor numbers match what was recorded';
  assert jsonb_array_length(r->'visitors'->'series') = 30, 'one point per day';
  reset role; perform pg_temp.as_user('00000000-0000-4000-d000-000000000001'); set local role authenticated;
  r := admin_get_analytics(30);
  assert (r ? 'revenue') and (r ? 'security'), 'a super admin gets revenue and security data';
  assert (r->'users'->>'dau')::int = 1, 'daily active users counted';
  reset role;
end $$;

-- ---- D. pagination helpers
do $$ declare n int; refused boolean := false; begin
  perform pg_temp.as_user('00000000-0000-4000-d000-000000000003'); set local role authenticated;
  assert (select count(*) from get_low_stock_products('00000000-0000-4000-e000-000000000001', 4)) = 1, 'only the low item is returned';
  assert (select name from get_low_stock_products('00000000-0000-4000-e000-000000000001', 4) limit 1) = 'Low item', 'the right product is returned';
  assert (select count(*) from get_customer_balances('00000000-0000-4000-e000-000000000001', array['00000000-0000-4000-f000-000000000001','00000000-0000-4000-f000-000000000002']::uuid[])) = 2, 'balances only for the customers asked about';
  assert (select count(*) from get_customer_balances('00000000-0000-4000-e000-000000000001')) = 5, 'balances for everyone when no list is given';
  select row_count into n from get_record_totals('00000000-0000-4000-e000-000000000001','sales'); assert n = 0, 'record totals work';
  reset role; perform pg_temp.as_user('00000000-0000-4000-d000-000000000004'); set local role authenticated;
  assert (select count(*) from get_low_stock_products('00000000-0000-4000-e000-000000000001', 4)) = 0, 'another business sees no low stock';
  assert (select count(*) from get_customer_balances('00000000-0000-4000-e000-000000000001')) = 0, 'another business sees no balances';
  begin perform * from get_record_totals('00000000-0000-4000-e000-000000000001','sales'); exception when others then refused := true; end;
  assert refused, 'another business is refused record totals';
  reset role;
end $$;
\echo 'ALL ANALYTICS AND PAGINATION CHECKS PASSED'
