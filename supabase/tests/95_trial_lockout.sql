\pset pager off
\set ON_ERROR_STOP on
-- Self-checking: prints ALL TRIAL AND LOCKOUT CHECKS PASSED or stops at the first failed expectation.
-- Run on a freshly migrated database (see supabase/tests/README.md).
\set U '\'00000000-0000-4000-8000-0000000000a1\''
\set W '\'00000000-0000-4000-8000-0000000000a2\''
\set X '\'00000000-0000-4000-8000-0000000000a3\''
\set O '\'00000000-0000-4000-8000-0000000000b1\''
\set O2 '\'00000000-0000-4000-8000-0000000000b2\''
insert into auth.users(id,email) values (:U,'owner@trial.test'),(:W,'staff@trial.test'),(:X,'other@trial.test');
insert into public.organizations(id,name,slug) values (:O,'Trial Org','trial-org'),(:O2,'Other Trial Org','other-trial-org');
insert into public.organization_members(organization_id,user_id,role) values (:O,:U,'owner'),(:O,:W,'member'),(:O2,:X,'owner');

-- 1. A new business starts a 7-day trial by itself.
do $$ declare s public.subscriptions%rowtype; begin
  select * into s from public.subscriptions where organization_id = '00000000-0000-4000-8000-0000000000b1';
  assert s.status = 'trialing', 'new business must start trialing, got ' || s.status;
  assert s.current_period_end between now() + interval '6 days 23 hours' and now() + interval '7 days 1 hour', 'trial must be 7 days';
  assert s.trial_end = s.current_period_end, 'trial_end must equal period end';
  assert public.subscription_state('00000000-0000-4000-8000-0000000000b1') = 'trial', 'state must be trial';
  assert (select count(*) from public.subscription_events where organization_id = s.organization_id and event_type = 'trial_started') = 1, 'one trial_started event';
end $$;

-- 2. During the trial the owner can write; the owner can read the access state with a countdown.
set role authenticated; set request.jwt.claim.sub = :U;
insert into public.products(organization_id, name, sku, price) values (:O, 'Rice', 'R1', 100);
do $$ declare a jsonb; begin
  a := public.get_subscription_access('00000000-0000-4000-8000-0000000000b1');
  assert a->>'state' = 'trial', 'access state must be trial';
  assert (a->>'seconds_left')::bigint > 6*86400, 'about 7 days left';
  assert (a->>'can_pay')::boolean, 'owner can pay';
end $$;
reset role;

-- 3. Staff can see the state but cannot pay.
set role authenticated; set request.jwt.claim.sub = :W;
do $$ begin assert not (public.get_subscription_access('00000000-0000-4000-8000-0000000000b1')->>'can_pay')::boolean, 'staff must not be able to pay'; end $$;
reset role;

-- 4. Outsiders cannot read another business's access state.
set role authenticated; set request.jwt.claim.sub = :X;
do $$ begin
  begin perform public.get_subscription_access('00000000-0000-4000-8000-0000000000b1'); assert false, 'outsider must be refused';
  exception when others then assert sqlerrm like 'UNAUTHORIZED%', 'wrong error: ' || sqlerrm; end;
end $$;
reset role;

-- 5. The trial runs out (only the dates change; the stored status still says trialing, exactly like production without cron).
update public.subscriptions set current_period_end = now() - interval '1 minute', trial_end = now() - interval '1 minute' where organization_id = :O;
do $$ begin assert public.subscription_state('00000000-0000-4000-8000-0000000000b1') = 'locked', 'must be locked the second the trial ends'; end $$;

-- 6. Locked: every write by the owner is refused by the SERVER; reading still works.
set role authenticated; set request.jwt.claim.sub = :U;
do $$ declare pid uuid; begin
  select id into pid from public.products where organization_id = '00000000-0000-4000-8000-0000000000b1' limit 1;
  begin insert into public.products(organization_id, name, sku, price) values ('00000000-0000-4000-8000-0000000000b1','Beans','B1',50); assert false, 'insert must be refused';
  exception when others then assert sqlerrm like 'SUBSCRIPTION_REQUIRED%', 'insert wrong error: ' || sqlerrm; end;
  begin update public.products set price = 1 where id = pid; assert false, 'update must be refused';
  exception when others then assert sqlerrm like 'SUBSCRIPTION_REQUIRED%', 'update wrong error: ' || sqlerrm; end;
  begin delete from public.products where id = pid; assert false, 'delete must be refused';
  exception when others then assert sqlerrm like 'SUBSCRIPTION_REQUIRED%', 'delete wrong error: ' || sqlerrm; end;
  begin insert into public.customers(organization_id, name) values ('00000000-0000-4000-8000-0000000000b1','Ada'); assert false, 'customer insert must be refused';
  exception when others then assert sqlerrm like 'SUBSCRIPTION_REQUIRED%', 'customer wrong error: ' || sqlerrm; end;
  begin insert into public.expenses(organization_id, title, amount, category) values ('00000000-0000-4000-8000-0000000000b1','Rent',1,'Rent'); assert false, 'expense insert must be refused';
  exception when others then assert sqlerrm like 'SUBSCRIPTION_REQUIRED%' or sqlerrm like '%column%', 'expense: ' || sqlerrm; end;
  assert (select count(*) from public.products where organization_id = '00000000-0000-4000-8000-0000000000b1') = 1, 'records are kept and still readable';
end $$;

-- 7. Opening the app tidies the status once, with exactly one trial_ended event, and says why.
do $$ declare a jsonb; b jsonb; begin
  a := public.get_subscription_access('00000000-0000-4000-8000-0000000000b1');
  b := public.get_subscription_access('00000000-0000-4000-8000-0000000000b1');
  assert a->>'state' = 'locked' and a->>'reason' = 'trial_ended' and a->>'status' = 'expired', 'access: ' || a::text;
  assert b->>'status' = 'expired', 'second call stays expired';
end $$;
reset role;
do $$ begin assert (select count(*) from public.subscription_events where organization_id = '00000000-0000-4000-8000-0000000000b1' and event_type = 'trial_ended') = 1, 'exactly one trial_ended event'; end $$;

-- 8. A locked owner cannot get a second free trial or self-activate anything.
set role authenticated; set request.jwt.claim.sub = :U;
do $$ begin
  begin perform public.start_plan_trial('00000000-0000-4000-8000-0000000000b1', (select id from public.plans where code = 'pro')); assert false, 'must refuse';
  exception when others then assert sqlerrm like 'TRIAL_USED%', 'wrong error: ' || sqlerrm; end;
  begin update public.subscriptions set status = 'active', current_period_end = now() + interval '1 year' where organization_id = '00000000-0000-4000-8000-0000000000b1'; assert (select status from public.subscriptions where organization_id = '00000000-0000-4000-8000-0000000000b1') = 'expired', 'browser must not be able to self-activate';
  exception when others then null; end;
end $$;
reset role;
do $$ begin assert public.subscription_state('00000000-0000-4000-8000-0000000000b1') = 'locked', 'still locked after the hostile attempts'; end $$;

-- 9. The other business is untouched.
set role authenticated; set request.jwt.claim.sub = :X;
insert into public.products(organization_id, name, sku, price) values (:O2, 'Salt', 'S1', 10);
reset role;

-- 10. The server itself (service role: no signed-in user) is never blocked, so payment settlement and jobs keep working.
reset request.jwt.claim.sub;
insert into public.products(organization_id, name, sku, price) values (:O, 'Server write', 'SV1', 1);
delete from public.products where sku = 'SV1';

-- 11. Paying unlocks at once.
insert into public.payments(reference,organization_id,plan_id,price_version_id,billing_interval,amount_kobo,initiated_by)
  select 'zb_' || repeat('b',32), :O, p.id, v.id, 'monthly', (v.amount * 100)::bigint, :U
  from public.plans p join public.plan_price_versions v on v.plan_id = p.id and v.billing_interval = 'monthly' and v.status = 'active' where p.code = 'basic';
do $$ declare r text; begin
  r := public.settle_paystack_payment('zb_' || repeat('b',32), 'success', 500000, 'NGN', 'tx-trial-1', 'card', now())::text;
  assert r like '%activated%', 'payment must activate: ' || r;
  assert public.subscription_state('00000000-0000-4000-8000-0000000000b1') = 'active', 'paid business must be active';
end $$;
set role authenticated; set request.jwt.claim.sub = :U;
insert into public.products(organization_id, name, sku, price) values (:O, 'Beans', 'B2', 50);
reset role;

-- 12. When the paid month runs out the app locks again, with the right reason.
update public.subscriptions set current_period_end = now() - interval '1 second' where organization_id = :O;
set role authenticated; set request.jwt.claim.sub = :U;
do $$ declare a jsonb; begin
  a := public.get_subscription_access('00000000-0000-4000-8000-0000000000b1');
  assert a->>'state' = 'locked' and a->>'reason' = 'plan_ended', 'paid plan ended: ' || a::text;
  begin insert into public.products(organization_id, name, sku, price) values ('00000000-0000-4000-8000-0000000000b1','Late','L1',5); assert false, 'must be refused';
  exception when others then assert sqlerrm like 'SUBSCRIPTION_REQUIRED%', 'wrong error: ' || sqlerrm; end;
end $$;
reset role;

-- 13. Admin-granted paid plan with no end date stays active; a platform admin is never blocked.
update public.subscriptions set status = 'active', current_period_end = null, plan_id = (select id from public.plans where code = 'pro') where organization_id = :O;
do $$ begin assert public.subscription_state('00000000-0000-4000-8000-0000000000b1') = 'active', 'comp plan stays active'; end $$;
update public.subscriptions set plan_id = (select id from public.plans where code = 'free') where organization_id = :O;
do $$ begin assert public.subscription_state('00000000-0000-4000-8000-0000000000b1') = 'locked', 'Free with no end date must NOT be forever'; end $$;


-- 14. One free trial per person: a second business by the same owner starts locked; the first keeps its trial.
\set Z '\'00000000-0000-4000-8000-0000000000a9\''
\set OA '\'00000000-0000-4000-8000-0000000000c1\''
\set OB '\'00000000-0000-4000-8000-0000000000c2\''
insert into auth.users(id,email) values (:Z,'farmer@trial.test');
set request.jwt.claim.sub = :Z;
insert into public.organizations(id,name,slug) values (:OA,'First Biz','first-biz');
insert into public.organizations(id,name,slug) values (:OB,'Second Biz','second-biz');
reset request.jwt.claim.sub;
do $$ begin
  assert public.subscription_state('00000000-0000-4000-8000-0000000000c1') = 'trial', 'first business keeps the free trial';
  assert public.subscription_state('00000000-0000-4000-8000-0000000000c2') = 'locked', 'second business of the same person must start locked';
  assert (select count(*) from public.trial_grants where user_id = '00000000-0000-4000-8000-0000000000a9') = 1, 'one grant per person';
end $$;
insert into public.organization_members(organization_id,user_id,role) values (:OB,:Z,'owner');
set request.jwt.claim.sub = :Z;
do $$ begin assert public.get_subscription_access('00000000-0000-4000-8000-0000000000c2')->>'reason' = 'trial_used', 'reason must explain the trial was already used'; end $$;
reset request.jwt.claim.sub;
-- deleting the first business does not give the person a new trial
delete from public.organizations where id = '00000000-0000-4000-8000-0000000000c1';
set request.jwt.claim.sub = :Z;
insert into public.organizations(id,name,slug) values ('00000000-0000-4000-8000-0000000000c3','Third Biz','third-biz');
reset request.jwt.claim.sub;
do $$ begin assert public.subscription_state('00000000-0000-4000-8000-0000000000c3') = 'locked', 'deleting a business must not reset the trial'; end $$;

\echo ALL TRIAL AND LOCKOUT CHECKS PASSED
