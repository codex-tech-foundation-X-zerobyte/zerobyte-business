\pset pager off
\set ON_ERROR_STOP on
-- Self-checking: prints ALL ADMIN MFA CHECKS PASSED or stops at the first failed expectation.
-- Run on a freshly migrated database (see README.md).
create table if not exists auth.mfa_factors (id uuid primary key default gen_random_uuid(), user_id uuid not null, factor_type text not null, status text not null); -- the real Supabase table, stubbed
create or replace function pg_temp.admin(p_email text, p_role text) returns uuid language plpgsql as $$
declare id uuid;
begin
  insert into auth.users(id,email,email_confirmed_at) values (gen_random_uuid(), p_email, now()) returning auth.users.id into id;
  insert into public.platform_admin_access(user_id,role,status) values (id, p_role::public.platform_admin_role, 'active');
  return id;
end $$;
create or replace function pg_temp.session(p uuid, p_aal text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'aal', p_aal)::text, true);
end $$;

do $$ declare
  boss uuid := pg_temp.admin('boss@t.test','SUPER_ADMIN');
  sup uuid := pg_temp.admin('support@t.test','SUPPORT_ADMIN');
  pro uuid := (select id from public.plans where code = 'pro');
begin
  -- 1. switch starts OFF: a password-only admin session works
  perform pg_temp.session(boss,'aal1'); set local role authenticated;
  assert public.is_platform_admin() and public.is_super_admin(), 'admins work with the switch off';
  assert not public.admin_mfa_required(), 'switch starts off';

  -- 2. cannot turn it on from a password-only session
  begin perform public.admin_set_mfa_requirement(true); assert false, 'must need aal2';
  exception when others then assert sqlerrm like 'MFA_REQUIRED%', 'wrong error: '||sqlerrm; end;

  -- 3. cannot turn it on while any admin has no authenticator (lockout protection)
  reset role; perform pg_temp.session(boss,'aal2'); set local role authenticated;
  begin perform public.admin_set_mfa_requirement(true); assert false, 'must refuse while admins are not enrolled';
  exception when others then assert sqlerrm like 'MFA_NOT_READY%', 'wrong error: '||sqlerrm; end;
  reset role;

  -- 4. a non-super admin cannot touch the switch
  insert into auth.mfa_factors(user_id,factor_type,status) values (boss,'totp','verified'),(sup,'totp','verified');
  perform pg_temp.session(sup,'aal2'); set local role authenticated;
  begin perform public.admin_set_mfa_requirement(true); assert false, 'support admin must not flip it';
  exception when others then assert sqlerrm like '%ACCESS_DENIED%', 'wrong error: '||sqlerrm; end;
  reset role;

  -- 5. everyone enrolled + super admin on aal2 -> it turns on (and is audited)
  perform pg_temp.session(boss,'aal2'); set local role authenticated;
  perform public.admin_set_mfa_requirement(true);
  reset role;
  assert (select value from public.security_settings where key = 'admin_mfa_required') = 'on', 'switch is on';
  assert exists (select 1 from public.admin_audit_logs where action = 'security.mfa_required_on'), 'change is audited';

  -- 6. now a password-only admin session is NOT an admin session anywhere
  perform pg_temp.session(boss,'aal1'); set local role authenticated;
  assert not public.is_platform_admin(), 'aal1 must not count as admin';
  assert not public.is_super_admin(), 'aal1 must not count as super admin';
  assert not public.admin_can_access('Users'), 'aal1 must not reach sections';
  assert not public.can_view_financial_admin_data(), 'aal1 must not see finance';
  assert public.admin_identity_check(), 'the login screen can still tell this person is an admin (to ask for the code)';
  begin perform public.admin_update_plan_price(pro, 9000, 'monthly'); assert false, 'aal1 must not change prices';
  exception when others then assert sqlerrm like 'UNAUTHORIZED%' or sqlerrm like '%ACCESS_DENIED%', 'wrong error: '||sqlerrm; end;
  reset role;

  -- 7. with the second factor the same person works again
  perform pg_temp.session(boss,'aal2'); set local role authenticated;
  assert public.is_platform_admin() and public.is_super_admin() and public.admin_can_access('Users'), 'aal2 works';
  perform public.admin_update_plan_price(pro, 9000, 'monthly');
  reset role;

  -- 8. a normal (non-admin) user is unaffected either way
  perform pg_temp.session(gen_random_uuid(),'aal1'); set local role authenticated;
  assert not public.admin_identity_check(), 'non-admins are never identified as admins';
  reset role;
end $$;
\echo ALL ADMIN MFA CHECKS PASSED
