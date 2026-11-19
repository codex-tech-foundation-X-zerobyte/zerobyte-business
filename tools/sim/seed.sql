\set U '\'22222222-2222-4222-8222-222222222222\''
\set O '\'11111111-1111-4111-8111-111111111111\''
insert into auth.users(id,email) values (:U,'ada@adaeze.ng') on conflict do nothing;
insert into public.organizations(id,name,slug,tax_rate) values (:O,'Adaeze Stores','adaeze-stores',0) on conflict do nothing;
insert into public.organization_members(organization_id,user_id,role) values (:O,:U,'owner') on conflict do nothing;
insert into public.branches(id,organization_id,name,code,address,phone) values ('aaaaaaaa-0000-4000-8000-000000000001',:O,'Ikeja Branch','IKJ','12 Allen Avenue, Ikeja','08031234567') on conflict do nothing;
insert into public.products(id,organization_id,name,sku,category,stock,price,cost_price,reorder_point) values
 ('b0000000-0000-4000-8000-000000000001',:O,'Peak Milk 400g','PM-400','Dairy',9,2100,1800,10),
 ('b0000000-0000-4000-8000-000000000002',:O,'Rice 5kg','GP-5','Grocery',52,9800,8900,10),
 ('b0000000-0000-4000-8000-000000000003',:O,'Indomie Chicken (carton)','IN-70','Grocery',0,7800,6900,5),
 ('b0000000-0000-4000-8000-000000000004',:O,'Dangote Sugar 1kg','DS-1','Grocery',70,1900,1600,10),
 ('b0000000-0000-4000-8000-000000000005',:O,'Power Oil 5L','PO-5','Cooking',23,12500,10800,5),
 ('b0000000-0000-4000-8000-000000000006',:O,'Hypo Bleach 1L','HB-1','Household',55,1100,800,10) on conflict do nothing;
insert into public.customers(id,organization_id,name,email,phone,address) values
 ('c0000000-0000-4000-8000-000000000001',:O,'Mama Tunde',null,'08030000000','Allen Ave'),
 ('c0000000-0000-4000-8000-000000000002',:O,'Okafor & Sons','okafor@mail.com','08031112222','Lekki'),
 ('c0000000-0000-4000-8000-000000000003',:O,'Chioma Eze',null,'08055554444','Yaba') on conflict do nothing;
insert into public.suppliers(organization_id,name,phone) values (:O,'Sule Wholesale','08099887766'),(:O,'Bola Distributors','08077665544');
insert into public.expenses(organization_id,title,category,amount,expense_date,payment_method) values
 (:O,'Shop rent','Rent',50000,current_date-9,'transfer'),(:O,'Generator fuel','Fuel',12000,current_date-4,'cash'),(:O,'Staff lunch','Welfare',6500,current_date-1,'cash');
insert into public.invoices(organization_id,invoice_number,total,status,due_date) values (:O,'INV-001',45000,'SENT',current_date+7),(:O,'INV-002',18500,'DRAFT',null),(:O,'INV-003',92000,'PAID',current_date-3);

begin; set local role authenticated; set local request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
select public.create_sale_with_operation('11111111-1111-4111-8111-111111111111','c0000000-0000-4000-8000-000000000001','[{"product_id":"b0000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,null,'cash','aaaaaaaa-1111-4000-8000-000000000000',0);
select public.create_sale_with_operation('11111111-1111-4111-8111-111111111111','c0000000-0000-4000-8000-000000000002','[{"product_id":"b0000000-0000-4000-8000-000000000002","quantity":2}]'::jsonb,null,'transfer','aaaaaaaa-1111-4000-8000-000000000001',0);
select public.create_sale_with_operation('11111111-1111-4111-8111-111111111111','c0000000-0000-4000-8000-000000000003','[{"product_id":"b0000000-0000-4000-8000-000000000004","quantity":3}]'::jsonb,null,'card','aaaaaaaa-1111-4000-8000-000000000002',0);
select public.create_sale_with_operation('11111111-1111-4111-8111-111111111111',null,'[{"product_id":"b0000000-0000-4000-8000-000000000005","quantity":1}]'::jsonb,null,'cash','aaaaaaaa-1111-4000-8000-000000000003',0);
select public.create_sale_with_operation('11111111-1111-4111-8111-111111111111','c0000000-0000-4000-8000-000000000001','[{"product_id":"b0000000-0000-4000-8000-000000000006","quantity":2}]'::jsonb,null,'cash','aaaaaaaa-1111-4000-8000-000000000004',0);
select public.create_sale_with_operation('11111111-1111-4111-8111-111111111111','c0000000-0000-4000-8000-000000000002','[{"product_id":"b0000000-0000-4000-8000-000000000001","quantity":3}]'::jsonb,null,'transfer','aaaaaaaa-1111-4000-8000-000000000005',0);
select public.create_sale_with_operation('11111111-1111-4111-8111-111111111111','c0000000-0000-4000-8000-000000000003','[{"product_id":"b0000000-0000-4000-8000-000000000002","quantity":1}]'::jsonb,null,'card','aaaaaaaa-1111-4000-8000-000000000006',0);
select public.create_sale_with_operation('11111111-1111-4111-8111-111111111111',null,'[{"product_id":"b0000000-0000-4000-8000-000000000004","quantity":2}]'::jsonb,null,'cash','aaaaaaaa-1111-4000-8000-000000000007',0);
select public.create_sale_with_operation('11111111-1111-4111-8111-111111111111','c0000000-0000-4000-8000-000000000001','[{"product_id":"b0000000-0000-4000-8000-000000000005","quantity":3}]'::jsonb,null,'cash','aaaaaaaa-1111-4000-8000-000000000008',0);
select public.create_sale_with_operation('11111111-1111-4111-8111-111111111111','c0000000-0000-4000-8000-000000000002','[{"product_id":"b0000000-0000-4000-8000-000000000006","quantity":1}]'::jsonb,null,'transfer','aaaaaaaa-1111-4000-8000-000000000009',0);
select public.create_sale_with_operation('11111111-1111-4111-8111-111111111111','c0000000-0000-4000-8000-000000000003','[{"product_id":"b0000000-0000-4000-8000-000000000001","quantity":2}]'::jsonb,null,'card','aaaaaaaa-1111-4000-8000-000000000010',0);
select public.create_sale_with_operation('11111111-1111-4111-8111-111111111111',null,'[{"product_id":"b0000000-0000-4000-8000-000000000002","quantity":3}]'::jsonb,null,'cash','aaaaaaaa-1111-4000-8000-000000000011',0);
select public.create_sale_with_operation('11111111-1111-4111-8111-111111111111','c0000000-0000-4000-8000-000000000001','[{"product_id":"b0000000-0000-4000-8000-000000000004","quantity":1}]'::jsonb,null,'cash','aaaaaaaa-1111-4000-8000-000000000012',0);
select public.create_sale_with_operation('11111111-1111-4111-8111-111111111111','c0000000-0000-4000-8000-000000000002','[{"product_id":"b0000000-0000-4000-8000-000000000005","quantity":2}]'::jsonb,null,'transfer','aaaaaaaa-1111-4000-8000-000000000013',0);
commit; reset role;
update public.sales set created_at = now() - (random()*interval '28 days');

