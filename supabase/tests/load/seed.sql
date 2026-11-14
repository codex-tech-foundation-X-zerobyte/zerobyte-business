\set ON_ERROR_STOP on
\timing off
-- auth.uid() the way real Supabase does it: from the JWT claims PostgREST provides
create or replace function auth.uid() returns uuid language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true),''), (nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'sub'))::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true),''), nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'role', 'anon') $$;
grant usage on schema public to authenticator;

insert into auth.users(id,email) select ('00000000-0000-4000-a000-' || lpad(g::text,12,'0'))::uuid, 'owner'||g||'@load.test' from generate_series(1,300) g;
insert into organizations(id,name,slug) select ('00000000-0000-4000-b000-' || lpad(g::text,12,'0'))::uuid, 'Load Biz '||g, 'load-biz-'||g from generate_series(1,300) g;
insert into organization_members(organization_id,user_id,role) select ('00000000-0000-4000-b000-' || lpad(g::text,12,'0'))::uuid, ('00000000-0000-4000-a000-' || lpad(g::text,12,'0'))::uuid, 'owner' from generate_series(1,300) g on conflict do nothing;
update subscriptions set plan_id = (select id from plans where code='pro_plus') where organization_id::text like '00000000-0000-4000-b000-%';
set session_replication_role = replica;
insert into products(id,organization_id,name,sku,stock,price,cost_price,reorder_point,category) select gen_random_uuid(), o.id, 'Product '||p, 'SKU'||p, 1000000, 500 + (p*37 % 4000), 300 + (p*29 % 3000), 10, 'General' from organizations o cross join generate_series(1,40) p where o.slug like 'load-biz-%';
insert into customers(id,organization_id,name,phone,email) select gen_random_uuid(), o.id, 'Customer '||c, '0803'||lpad(c::text,7,'0'), 'c'||c||'@load.test' from organizations o cross join generate_series(1,30) c where o.slug like 'load-biz-%';
insert into sales(id,organization_id,status,total,created_by,created_at,payment_method) select gen_random_uuid(), o.id, 'completed', 2000 + (s*53 % 9000), ('00000000-0000-4000-a000-' || lpad(substr(o.slug,10),12,'0'))::uuid, now() - (s*130 || ' minutes')::interval, 'cash' from organizations o cross join generate_series(1,400) s where o.slug like 'load-biz-%';
insert into sale_items(sale_id,product_id,quantity,unit_price,cost_price) select s.id, (select p.id from products p where p.organization_id = s.organization_id order by p.id offset ((abs(hashtext(s.id::text||k::text))) % 40) limit 1), 1 + (k % 3), 1000, 700 from sales s cross join generate_series(1,2) k where s.organization_id in (select id from organizations where slug like 'load-biz-%');
insert into notifications(organization_id,user_id,title,body) select ('00000000-0000-4000-b000-' || lpad(g::text,12,'0'))::uuid, ('00000000-0000-4000-a000-' || lpad(g::text,12,'0'))::uuid, 'Notice '||n, 'Body' from generate_series(1,300) g cross join generate_series(1,20) n;
reset session_replication_role;
analyze;
select (select count(*) from organizations where slug like 'load-biz-%') orgs, (select count(*) from products) products, (select count(*) from customers) customers, (select count(*) from sales) sales, (select count(*) from sale_items) sale_items, pg_size_pretty(pg_database_size(current_database())) db_size;
