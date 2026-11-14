\pset pager off
\set ON_ERROR_STOP on
-- Self-checking: prints ALL TRIAL ANTI-FARMING CHECKS PASSED or stops at the first failed expectation.
-- Run on a freshly migrated database (see README.md).
create or replace function pg_temp.mk(p_email text) returns uuid language sql as $$
  insert into auth.users(id,email,email_confirmed_at) values (gen_random_uuid(), p_email, now()) returning id $$;
create or replace function pg_temp.biz(p_user uuid, p_name text, p_device text, p_ip text) returns text language plpgsql as $$
declare org uuid; st text;
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.headers', case when p_ip is null then '{}' else json_build_object('cf-connecting-ip', p_ip)::text end, true);
  set local role authenticated;
  org := public.create_workspace(p_name::text, null::text, p_device::text);
  reset role;
  select s.status into st from public.subscriptions s where s.organization_id = org;
  return st;
end $$;

do $$ declare u1 uuid; u2 uuid; u3 uuid; u4 uuid; r text; i int; ids uuid[] := '{}'; begin
  -- honest user gets a trial; a second business of the same user does not
  u1 := pg_temp.mk('honest@gmail.com');
  assert pg_temp.biz(u1,'Honest One','device-honest-000001','10.1.1.1') = 'trialing', 'honest first business must get the trial';
  assert pg_temp.biz(u1,'Honest Two','device-honest-000001','10.1.1.1') = 'expired', 'second business of the same person must not';

  -- a new account on the SAME device
  u2 := pg_temp.mk('another@gmail.com');
  assert pg_temp.biz(u2,'Same Device','device-honest-000001','10.1.1.2') = 'expired', 'same device must not get a second trial';

  -- email aliases of the honest user (dots, +tag, googlemail)
  assert pg_temp.biz(pg_temp.mk('h.o.n.e.s.t@gmail.com'),'Alias 1','device-alias-0000001','10.1.1.3') = 'expired', 'dotted gmail alias';
  assert pg_temp.biz(pg_temp.mk('honest+shop@gmail.com'),'Alias 2','device-alias-0000002','10.1.1.4') = 'expired', 'plus alias';
  assert pg_temp.biz(pg_temp.mk('HONEST@googlemail.com'),'Alias 3','device-alias-0000003','10.1.1.5') = 'expired', 'googlemail alias';

  -- direct API caller without the app's device token
  assert pg_temp.biz(pg_temp.mk('script@gmail.com'),'No Device',null,'10.1.1.6') = 'expired', 'no device token => no trial';
  assert pg_temp.biz(pg_temp.mk('short@gmail.com'),'Short Device','abc','10.1.1.7') = 'expired', 'tiny device token => no trial';

  -- disposable email cannot register at all
  begin perform pg_temp.mk('x@mailinator.com'); assert false, 'disposable signup must be refused';
  exception when others then assert sqlerrm like 'EMAIL_DOMAIN_NOT_ALLOWED%', 'wrong error: ' || sqlerrm; end;

  -- burst from one address: 5 allowed, then refused
  for i in 1..7 loop
    r := pg_temp.biz(pg_temp.mk('burst'||i||'@gmail.com'),'Burst '||i,'device-burst-00000'||i,'203.0.113.9');
    assert (i <= 5 and r = 'trialing') or (i > 5 and r = 'expired'), 'burst #'||i||' got '||r;
  end loop;

  -- catch-all private domain: 3 allowed, then refused
  for i in 1..5 loop
    r := pg_temp.biz(pg_temp.mk('farm'||i||'@my-own-domain.ng'),'Farm '||i,'device-domain-00000'||i,'198.51.100.'||i);
    assert (i <= 3 and r = 'trialing') or (i > 3 and r = 'expired'), 'domain #'||i||' got '||r;
  end loop;

  -- the refusal reason is kept for support
  assert exists (select 1 from public.subscription_events where note like 'No free trial (device_reuse)%'), 'reason recorded';

  -- trial_claims is invisible to customers
  perform set_config('request.jwt.claim.sub', u1::text, true); set local role authenticated;
  begin perform 1 from public.trial_claims limit 1; assert false, 'trial_claims must not be readable';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;

-- a super admin can rescue a genuine customer who was refused by mistake; nobody else can
do $$ declare sa uuid := pg_temp.mk('boss@gmail.com'); sup uuid := pg_temp.mk('sup@gmail.com'); victim uuid := pg_temp.mk('victim@gmail.com'); org uuid; st text; begin
  insert into public.platform_admin_access(user_id,role,status) values (sa,'SUPER_ADMIN','active'),(sup,'SUPPORT_ADMIN','active');
  perform pg_temp.biz(victim,'Victim Biz',null,'10.9.9.9'); -- refused (no device)
  select organization_id into org from public.organization_members where user_id = victim;
  perform set_config('request.jwt.claim.sub', sup::text, true); set local role authenticated;
  begin perform public.admin_grant_trial(org,'x'); assert false, 'support admin must not grant trials';
  exception when others then assert sqlerrm like '%ADMIN_ACCESS_DENIED%', 'wrong error: ' || sqlerrm; end;
  reset role;
  perform set_config('request.jwt.claim.sub', sa::text, true); set local role authenticated;
  perform public.admin_grant_trial(org,'refused by mistake');
  reset role;
  select status into st from public.subscriptions where organization_id = org;
  assert st = 'trialing', 'super admin grant must start the trial, got ' || st;
end $$;
\echo ALL TRIAL ANTI-FARMING CHECKS PASSED
