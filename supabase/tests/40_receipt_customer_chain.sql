\pset pager off
\set ON_ERROR_STOP off
-- Fixtures: two independent businesses (A, B) each with an owner and a product.
\set UA '\'00000000-0000-4000-8000-0000000000a1\''
\set UB '\'00000000-0000-4000-8000-0000000000b2\''
\set OA '\'00000000-0000-4000-8000-0000000000c1\''
\set OB '\'00000000-0000-4000-8000-0000000000c2\''
\set PA '\'00000000-0000-4000-8000-0000000000d1\''
\set PB '\'00000000-0000-4000-8000-0000000000d2\''
insert into auth.users(id,email) values (:UA,'ownerA@t.test'),(:UB,'ownerB@t.test') on conflict do nothing;
insert into public.organizations(id,name,slug,tax_rate,address,phone,email,tagline) values
 (:OA,'Alpha Stores','alpha',0,'1 Alpha Rd, Enugu','+2348011111111','hello@alpha.test','Quality you can trust'),
 (:OB,'Beta Mart','beta',0,'2 Beta St, Lagos','+2348022222222','hi@beta.test',null) on conflict (id) do nothing;
insert into public.organization_members(organization_id,user_id,role) values (:OA,:UA,'owner'),(:OB,:UB,'owner') on conflict do nothing;
insert into public.products(id,organization_id,name,sku,stock,price,cost_price) values (:PA,:OA,'Rice','R1',100,10000,6000),(:PB,:OB,'Soap','S1',100,500,300) on conflict (id) do update set stock=100;
delete from public.sales;  -- line items go with their sale (deleting items alone trips the receipt-total check, correctly) delete from public.customers;

\echo '=== 1. Business A creates John Doe (with phone, email, address)'
begin; set local role authenticated; set local request.jwt.claim.sub=:UA;
select public.create_customer(:OA,null,'John Doe','john@example.com','+2348030000001','12 Ogui Road, Enugu') as john \gset
commit;
\echo '=== 2. Sale to John, then read it back the way the Receipts screen does (sales LEFT JOIN customers, as the signed-in user)'
begin; set local role authenticated; set local request.jwt.claim.sub=:UA;
select public.create_sale(:OA,:'john','[{"product_id":"00000000-0000-4000-8000-0000000000d1","quantity":1}]'::jsonb,null,'cash',0) as sale_john \gset
commit;
begin; set local role authenticated; set local request.jwt.claim.sub=:UA;
select s.customer_id = :'john' as customer_id_saved_on_sale, c.name, c.phone, c.email, c.address from public.sales s left join public.customers c on c.id = s.customer_id where s.id = :'sale_john';
commit;
\echo '=== 3. Walk-in sale (no customer): customer_id must be NULL, sale must succeed'
begin; set local role authenticated; set local request.jwt.claim.sub=:UA;
select public.create_sale(:OA,null,'[{"product_id":"00000000-0000-4000-8000-0000000000d1","quantity":1}]'::jsonb,null,'cash',0) as sale_walkin \gset
commit;
begin; set local role authenticated; set local request.jwt.claim.sub=:UA;
select s.customer_id is null as walkin_has_no_customer, c.name from public.sales s left join public.customers c on c.id = s.customer_id where s.id = :'sale_walkin';
commit;
\echo '=== 4. A different customer (no address) must not inherit John''s details'
begin; set local role authenticated; set local request.jwt.claim.sub=:UA;
select public.create_customer(:OA,null,'Mary Okafor',null,'+2348030000002',null) as mary \gset
select public.create_sale(:OA,:'mary','[{"product_id":"00000000-0000-4000-8000-0000000000d1","quantity":1}]'::jsonb,null,'cash',0) as sale_mary \gset
commit;
begin; set local role authenticated; set local request.jwt.claim.sub=:UA;
select c.name, c.phone, c.email as email_is_null_expected, c.address as address_is_null_expected from public.sales s left join public.customers c on c.id = s.customer_id where s.id = :'sale_mary';
commit;
\echo '=== 5. ISOLATION: Business B tries to sell to Business A''s customer (must be refused)'
begin; set local role authenticated; set local request.jwt.claim.sub=:UB;
select public.create_sale(:OB,:'john','[{"product_id":"00000000-0000-4000-8000-0000000000d2","quantity":1}]'::jsonb,null,'cash',0);
commit;
\echo '=== 6. ISOLATION: Business B tries to act inside Business A (must be refused)'
begin; set local role authenticated; set local request.jwt.claim.sub=:UB;
select public.create_sale(:OA,:'john','[{"product_id":"00000000-0000-4000-8000-0000000000d1","quantity":1}]'::jsonb,null,'cash',0);
commit;
begin; set local role authenticated; set local request.jwt.claim.sub=:UB;
select public.create_customer(:OA,null,'Intruder',null,null,null);
commit;
\echo '=== 7. ISOLATION: what Business B can read of Business A (all counts must be 0)'
begin; set local role authenticated; set local request.jwt.claim.sub=:UB;
select (select count(*) from public.customers where organization_id=:OA) as a_customers_visible_to_b,
       (select count(*) from public.sales where organization_id=:OA) as a_sales_visible_to_b,
       (select count(*) from public.organizations where id=:OA) as a_business_profile_visible_to_b,
       (select count(*) from public.customers c where c.id=:'john') as john_by_id_visible_to_b;
commit;
\echo '=== 8. Business A sees its OWN business profile incl. tagline; B has none (NULL)'
begin; set local role authenticated; set local request.jwt.claim.sub=:UA;
select name, address, phone, email, tagline from public.organizations where id=:OA;
commit;
begin; set local role authenticated; set local request.jwt.claim.sub=:UB;
select name, tagline as tagline_is_null_expected from public.organizations where id=:OB;
commit;
\echo '=== 9. Credit sale: refused without a customer, allowed with one'
begin; set local role authenticated; set local request.jwt.claim.sub=:UA;
select public.create_sale(:OA,null,'[{"product_id":"00000000-0000-4000-8000-0000000000d1","quantity":1}]'::jsonb,null,'credit',0);
commit;
begin; set local role authenticated; set local request.jwt.claim.sub=:UA;
select public.create_sale(:OA,:'john','[{"product_id":"00000000-0000-4000-8000-0000000000d1","quantity":1}]'::jsonb,null,'credit',0) is not null as credit_with_customer_ok;
commit;
\echo '=== 10. Address length cap (301 chars refused) and offline-queue RPC carries the address'
begin; set local role authenticated; set local request.jwt.claim.sub=:UA;
select public.create_customer(:OA,null,'Too Long',null,null,repeat('x',301));
commit;
begin; set local role authenticated; set local request.jwt.claim.sub=:UA;
select public.create_customer_with_operation(:OA,null,'Offline Olu',null,'0803','eeeeeeee-0000-4000-8000-000000000001','ffffffff-0000-4000-8000-000000000001','5 Market Rd, Aba') as c1 \gset
select public.create_customer_with_operation(:OA,null,'Offline Olu',null,'0803','eeeeeeee-0000-4000-8000-000000000001','ffffffff-0000-4000-8000-000000000001','5 Market Rd, Aba') = :'c1' as retry_returns_same_customer;
commit;
select count(*) as offline_olu_rows, max(address) as saved_address from public.customers where name='Offline Olu';
