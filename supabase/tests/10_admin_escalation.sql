\set ON_ERROR_STOP off
\pset pager off
-- fixtures (as postgres)
truncate public.platform_admin_access, public.plans cascade;
delete from auth.users where email like '%@t.test';
insert into auth.users(id,email) values
 ('00000000-0000-4000-8000-0000000000a1','super@t.test'),
 ('00000000-0000-4000-8000-0000000000a2','support@t.test'),
 ('00000000-0000-4000-8000-0000000000a3','finance@t.test'),
 ('00000000-0000-4000-8000-0000000000a4','newadmin@t.test');
insert into public.platform_admin_access(user_id,role,status) values
 ('00000000-0000-4000-8000-0000000000a1','SUPER_ADMIN','active'),
 ('00000000-0000-4000-8000-0000000000a2','SUPPORT_ADMIN','active'),
 ('00000000-0000-4000-8000-0000000000a3','FINANCE_ADMIN','active');
insert into public.plans(code,name) values ('starter','Starter');

\echo '--- 1. SUPPORT admin inserts own SUPER_ADMIN row (escalation)'
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-4000-8000-0000000000a2';
insert into public.platform_admin_access(user_id,role,status) values ('00000000-0000-4000-8000-0000000000a2','SUPER_ADMIN','active') returning role;
commit;
reset role; delete from public.platform_admin_access where user_id='00000000-0000-4000-8000-0000000000a2' and role='SUPER_ADMIN';
\echo '--- 2. SUPPORT admin updates own row to SUPER_ADMIN (escalation)'
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-4000-8000-0000000000a2';
update public.platform_admin_access set role='SUPER_ADMIN' where user_id='00000000-0000-4000-8000-0000000000a2' and role='SUPPORT_ADMIN' returning role;
commit;
-- reset escalation side effects so later tests are independent
reset role; delete from public.platform_admin_access where user_id='00000000-0000-4000-8000-0000000000a2'; insert into public.platform_admin_access(user_id,role) values ('00000000-0000-4000-8000-0000000000a2','SUPPORT_ADMIN');

\echo '--- 3. SUPPORT admin edits plan pricing table directly'
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-4000-8000-0000000000a2';
update public.plans set name='HACKED' returning name;
commit;
reset role; update public.plans set name='Starter';
\echo '--- 4. FINANCE admin edits plans (must still work)'
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-4000-8000-0000000000a3';
update public.plans set name='Starter Plus' returning name;
commit;
reset role; update public.plans set name='Starter';
\echo '--- 5. SUPPORT admin lists all admin access rows (count; super sees 3)'
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-4000-8000-0000000000a2';
select count(*) as rows_visible from public.platform_admin_access;
commit;
\echo '--- 6. SUPER admin lists admin rows (count)'
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-4000-8000-0000000000a1';
select count(*) as rows_visible from public.platform_admin_access;
\echo '--- 7. SUPER admin grants role via RPC (must still work)'
select public.admin_grant_admin_access('newadmin@t.test','SUPPORT_ADMIN'::public.platform_admin_role) is not null as grant_via_rpc_ok;
commit;
\echo '--- 8. SUPPORT admin tries RPC grant (must be refused)'
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-4000-8000-0000000000a2';
select public.admin_grant_admin_access('newadmin@t.test','SUPER_ADMIN'::public.platform_admin_role);
commit;
\echo '--- 9. anon calls get_plan_limit'
begin; set local role anon; select public.get_plan_limit('00000000-0000-4000-8000-000000000001'::uuid,'products');
commit;
\echo '--- 10. authenticated direct write to employee_profiles'
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-4000-8000-0000000000a1';
update public.employee_profiles set monthly_salary = 1;
commit;
