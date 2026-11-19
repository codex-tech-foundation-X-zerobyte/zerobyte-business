\set ON_ERROR_STOP on
\pset pager off
-- Self-checking: prints ALL BRANCH VIEW CHECKS PASSED. Run on a freshly migrated database.
create or replace function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, false), set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, false) $$;
create or replace function pg_temp.fails(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlerrm; end $$;

insert into auth.users(id,email) values ('00000000-0000-4000-f700-000000000001','bv-owner@t.test'),('00000000-0000-4000-f700-000000000002','bv-outsider@t.test');
insert into organizations(id,name,slug) values ('00000000-0000-4000-f800-000000000001','Two Branch Shop','bv-shop');
insert into organization_members(organization_id,user_id,role) values ('00000000-0000-4000-f800-000000000001','00000000-0000-4000-f700-000000000001','owner');
update subscriptions set plan_id=(select id from plans where code='pro_plus') where organization_id='00000000-0000-4000-f800-000000000001';
insert into branches(id,organization_id,name,code) values ('00000000-0000-4000-f900-000000000001','00000000-0000-4000-f800-000000000001','Lagos','LAG'),('00000000-0000-4000-f900-000000000002','00000000-0000-4000-f800-000000000001','Abuja','ABJ'),('00000000-0000-4000-f900-000000000003','00000000-0000-4000-f800-000000000001','Quiet branch','QUI');
insert into products(organization_id,branch_id,name,sku,stock,price,cost_price,reorder_point) values
 ('00000000-0000-4000-f800-000000000001','00000000-0000-4000-f900-000000000001','Lagos item','L1',1,100,50,5),
 ('00000000-0000-4000-f800-000000000001','00000000-0000-4000-f900-000000000002','Abuja item','A1',2,100,50,5),
 ('00000000-0000-4000-f800-000000000001',null,'Shared item','S1',3,100,50,5);
insert into sales(organization_id,branch_id,status,total,created_by) values
 ('00000000-0000-4000-f800-000000000001','00000000-0000-4000-f900-000000000001','completed',1000,'00000000-0000-4000-f700-000000000001'),
 ('00000000-0000-4000-f800-000000000001','00000000-0000-4000-f900-000000000001','completed',500,'00000000-0000-4000-f700-000000000001'),
 ('00000000-0000-4000-f800-000000000001','00000000-0000-4000-f900-000000000002','completed',300,'00000000-0000-4000-f700-000000000001'),
 ('00000000-0000-4000-f800-000000000001',null,'completed',50,'00000000-0000-4000-f700-000000000001');

do $$ declare lagos jsonb; abuja jsonb; total jsonb; n int; r record; begin
  perform pg_temp.as_user('00000000-0000-4000-f700-000000000001'); set local role authenticated;
  lagos := get_dashboard_metrics('00000000-0000-4000-f800-000000000001', current_date - 1, current_date, '00000000-0000-4000-f900-000000000001');
  abuja := get_dashboard_metrics('00000000-0000-4000-f800-000000000001', current_date - 1, current_date, '00000000-0000-4000-f900-000000000002');
  total := get_dashboard_metrics('00000000-0000-4000-f800-000000000001', current_date - 1, current_date, null);
  assert (lagos->>'revenue')::numeric = 1500 and (abuja->>'revenue')::numeric = 300 and (total->>'revenue')::numeric = 1850, 'branch and total revenue';

  select count(*) into n from get_low_stock_products('00000000-0000-4000-f800-000000000001', 8, '00000000-0000-4000-f900-000000000001');
  assert n = 1, 'low stock for Lagos lists only Lagos products';
  select count(*) into n from get_low_stock_products('00000000-0000-4000-f800-000000000001', 8, null);
  assert n = 3, 'low stock for Total lists everything';
  select count(*) into n from get_low_stock_products('00000000-0000-4000-f800-000000000001');
  assert n = 3, 'the call without a branch still works';

  select count(*) into n from get_branch_breakdown('00000000-0000-4000-f800-000000000001', current_date - 1, current_date);
  assert n = 4, 'three branches plus the no-branch line';
  select * into r from get_branch_breakdown('00000000-0000-4000-f800-000000000001', current_date - 1, current_date) limit 1;
  assert r.branch_name = 'Lagos' and r.revenue = 1500 and r.sales_count = 2, 'best branch first';
  assert (select revenue from get_branch_breakdown('00000000-0000-4000-f800-000000000001', current_date - 1, current_date) where branch_name = 'Quiet branch') = 0, 'a branch with no sales shows zero';
  reset role;

  perform pg_temp.as_user('00000000-0000-4000-f700-000000000002'); set local role authenticated;
  assert pg_temp.fails($f$select * from get_branch_breakdown('00000000-0000-4000-f800-000000000001', current_date - 1, current_date)$f$) like 'UNAUTHORIZED%', 'a stranger cannot read branch revenue';
  reset role;
end $$;
select 'ALL BRANCH VIEW CHECKS PASSED' as result;
