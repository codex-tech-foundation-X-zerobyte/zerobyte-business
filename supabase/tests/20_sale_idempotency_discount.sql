\pset pager off
\set ON_ERROR_STOP off
\set U '\'00000000-0000-4000-8000-0000000000b1\''
\set O '\'00000000-0000-4000-8000-0000000000c1\''
\set P '\'00000000-0000-4000-8000-0000000000d1\''
\set C '\'00000000-0000-4000-8000-0000000000e1\''
insert into auth.users(id,email) values (:U,'owner@t.test') on conflict do nothing;
insert into public.organizations(id,name,slug,tax_rate) values (:O,'T Org','t-org',7.5) on conflict do nothing;
insert into public.organization_members(organization_id,user_id,role) values (:O,:U,'owner') on conflict do nothing;
insert into public.products(id,organization_id,name,sku,stock,price,cost_price) values (:P,:O,'Rice','R1',50,10000,6000) on conflict (id) do update set stock=50;
insert into public.customers(id,organization_id,name) values (:C,:O,'Cust') on conflict do nothing;
delete from public.sales;  -- line items go with their sale (deleting items alone trips the receipt-total check, correctly) delete from public.sale_sync_operations;
\echo '--- A. same operation id sent 3x (double-tap / retry) with 1000 discount'
begin; set local role authenticated; set local request.jwt.claim.sub=:U;
select public.create_sale_with_operation(:O,:C,'[{"product_id":"00000000-0000-4000-8000-0000000000d1","quantity":2}]'::jsonb,null,'cash','aaaaaaaa-0000-4000-8000-000000000001',1000) as sale_1 \gset
select public.create_sale_with_operation(:O,:C,'[{"product_id":"00000000-0000-4000-8000-0000000000d1","quantity":2}]'::jsonb,null,'cash','aaaaaaaa-0000-4000-8000-000000000001',1000) = :'sale_1' as second_call_returns_same_sale;
select public.create_sale_with_operation(:O,:C,'[{"product_id":"00000000-0000-4000-8000-0000000000d1","quantity":2}]'::jsonb,null,'cash','aaaaaaaa-0000-4000-8000-000000000001',1000) = :'sale_1' as third_call_returns_same_sale;
commit;
reset role;
select count(*) as sales_rows, max(discount_amount) as discount_recorded, max(total) as net_total, (select stock from public.products where id=:P) as stock_expect_48 from public.sales;
\echo '--- B. a different operation id is a genuinely new sale'
begin; set local role authenticated; set local request.jwt.claim.sub=:U;
select public.create_sale_with_operation(:O,:C,'[{"product_id":"00000000-0000-4000-8000-0000000000d1","quantity":1}]'::jsonb,null,'cash','aaaaaaaa-0000-4000-8000-000000000002',0) is not null as new_sale_created;
commit; reset role;
select count(*) as sales_rows, (select stock from public.products where id=:P) as stock_expect_47 from public.sales;
\echo '--- C. discount larger than total is rejected'
begin; set local role authenticated; set local request.jwt.claim.sub=:U;
select public.create_sale_with_operation(:O,:C,'[{"product_id":"00000000-0000-4000-8000-0000000000d1","quantity":1}]'::jsonb,null,'cash','aaaaaaaa-0000-4000-8000-000000000003',999999);
commit; reset role;
\echo '--- D. old 6-arg call (no discount) still works via default'
begin; set local role authenticated; set local request.jwt.claim.sub=:U;
select public.create_sale_with_operation(:O,:C,'[{"product_id":"00000000-0000-4000-8000-0000000000d1","quantity":1}]'::jsonb,null,'cash','aaaaaaaa-0000-4000-8000-000000000004') is not null as ok_without_discount;
commit;
