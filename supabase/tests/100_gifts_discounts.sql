\set ON_ERROR_STOP on
\pset pager off
-- Self-checking: prints ALL GIFT AND DISCOUNT CHECKS PASSED. Run on a freshly migrated database.
create or replace function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, false), set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, false) $$;
create or replace function pg_temp.fails(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlerrm; end $$;

insert into auth.users(id,email) values ('00000000-0000-4000-fa00-000000000001','gd-super@t.test'),('00000000-0000-4000-fa00-000000000002','gd-finance@t.test'),('00000000-0000-4000-fa00-000000000003','gd-owner@t.test');
insert into platform_admin_access(user_id,role,status) values ('00000000-0000-4000-fa00-000000000001','SUPER_ADMIN','active'),('00000000-0000-4000-fa00-000000000002','FINANCE_ADMIN','active');
insert into organizations(id,name,slug) values ('00000000-0000-4000-fb00-000000000001','Gift Shop','gd-shop'),('00000000-0000-4000-fb00-000000000002','Paid Shop','gd-paid');
insert into organization_members(organization_id,user_id,role) values ('00000000-0000-4000-fb00-000000000001','00000000-0000-4000-fa00-000000000003','owner'),('00000000-0000-4000-fb00-000000000002','00000000-0000-4000-fa00-000000000003','owner');
-- "Paid Shop" has paid Basic time left through Paystack.
update subscriptions set plan_id=(select id from plans where code='basic'), status='active', provider='paystack', current_period_start=now()-interval '20 days', current_period_end=now()+interval '10 days'
  where organization_id='00000000-0000-4000-fb00-000000000002';

do $$ declare until_a timestamptz; until_b timestamptz; paid_end timestamptz; did uuid; r record; n int; res text; pid uuid; begin
  -- only the super admin may use any of this
  perform pg_temp.as_user('00000000-0000-4000-fa00-000000000002'); set local role authenticated;
  assert pg_temp.fails($f$select admin_gift_plan('00000000-0000-4000-fb00-000000000001','pro','Because we like them')$f$) like 'UNAUTHORIZED%', 'finance admin cannot gift';
  assert pg_temp.fails($f$select admin_create_discount('00000000-0000-4000-fb00-000000000001',20,null,1,30,'Loyalty reward')$f$) like 'UNAUTHORIZED%', 'finance admin cannot create a discount';
  assert pg_temp.fails($f$select admin_list_discounts()$f$) like 'UNAUTHORIZED%', 'finance admin cannot list discounts';
  assert pg_temp.fails($f$select admin_search_organizations('Gift')$f$) like 'UNAUTHORIZED%', 'finance admin cannot search businesses here';
  assert pg_temp.fails($f$select admin_set_subscription('00000000-0000-4000-fb00-000000000001',(select id from plans where code='pro'),'active','x')$f$) like 'UNAUTHORIZED%', 'finance admin cannot grant access by hand';
  reset role;
  perform pg_temp.as_user('00000000-0000-4000-fa00-000000000003'); set local role authenticated;
  assert pg_temp.fails($f$select admin_gift_plan('00000000-0000-4000-fb00-000000000001','pro','I want free stuff')$f$) like 'UNAUTHORIZED%', 'a business owner cannot gift themselves';
  assert pg_temp.fails($f$select count(*) from subscription_discounts$f$) is not null, 'the discounts table is not readable from the browser';
  reset role;

  perform pg_temp.as_user('00000000-0000-4000-fa00-000000000001'); set local role authenticated;
  assert jsonb_array_length(admin_search_organizations('gift')) = 1, 'search finds the business';
  assert jsonb_array_length(admin_search_organizations('g')) = 0, 'search needs two letters';

  -- gift on a business that is not paying: starts now, 30 days, provider gift
  until_a := admin_gift_plan('00000000-0000-4000-fb00-000000000001','pro','Launch partner');
  assert until_a between now() + interval '29 days 23 hours' and now() + interval '30 days 1 hour', 'gift lasts 30 days from now';
  select s.status, s.provider, p.code into r from subscriptions s join plans p on p.id = s.plan_id where s.organization_id='00000000-0000-4000-fb00-000000000001';
  assert r.status = 'active' and r.provider = 'gift' and r.code = 'pro', 'gifted business is active on pro, provider gift';
  -- a second gift stacks after the first
  until_b := admin_gift_plan('00000000-0000-4000-fb00-000000000001','pro','Another month');
  assert until_b between until_a + interval '29 days 23 hours' and until_a + interval '30 days 1 hour', 'a second gift is added after the first';
  -- gifts on paid time: same plan extends from the end of the paid period, another plan is refused
  select current_period_end into paid_end from subscriptions where organization_id='00000000-0000-4000-fb00-000000000002';
  until_a := admin_gift_plan('00000000-0000-4000-fb00-000000000002','basic','Thank you');
  assert until_a between paid_end + interval '29 days 23 hours' and paid_end + interval '30 days 1 hour', 'gift extends paid time';
  assert (select provider from subscriptions where organization_id='00000000-0000-4000-fb00-000000000002') = 'paystack', 'paid provider is kept';
  assert pg_temp.fails($f$select admin_gift_plan('00000000-0000-4000-fb00-000000000002','pro','Switch plan')$f$) like 'VALIDATION_ERROR%', 'a gift cannot overwrite paid time on another plan';
  assert pg_temp.fails($f$select admin_gift_plan('00000000-0000-4000-fb00-000000000001','free','Nope')$f$) like 'VALIDATION_ERROR%', 'cannot gift the free plan';
  assert pg_temp.fails($f$select admin_gift_plan('00000000-0000-4000-fb00-000000000001','pro','no')$f$) like 'VALIDATION_ERROR%', 'a reason is required';

  -- discounts
  did := admin_create_discount('00000000-0000-4000-fb00-000000000001', 20, 'pro', 1, 30, 'Loyalty reward');
  assert pg_temp.fails($f$select admin_create_discount('00000000-0000-4000-fb00-000000000001',100,null,1,30,'Too much off')$f$) like 'VALIDATION_ERROR%', '100 percent is refused';
  assert pg_temp.fails($f$select admin_create_discount('00000000-0000-4000-fb00-000000000001',10,null,1,30,'no')$f$) like 'VALIDATION_ERROR%', 'a reason is required for a discount';
  reset role;

  -- the server-side price lookup (service role only)
  select * into r from best_discount_for('00000000-0000-4000-fb00-000000000001', (select id from plans where code='pro'));
  assert r.percent = 20 and r.id = did, 'the pro discount applies to pro';
  select count(*) into n from best_discount_for('00000000-0000-4000-fb00-000000000001', (select id from plans where code='basic'));
  assert n = 0, 'the pro discount does not apply to basic';
  select count(*) into n from best_discount_for('00000000-0000-4000-fb00-000000000002', (select id from plans where code='pro'));
  assert n = 0, 'another business does not get it';
  perform pg_temp.as_user('00000000-0000-4000-fa00-000000000003'); set local role authenticated;
  assert pg_temp.fails($f$select * from best_discount_for('00000000-0000-4000-fb00-000000000001', (select id from plans where code='pro'))$f$) is not null, 'a browser cannot call the price lookup';
  reset role;

  -- a successful payment uses the discount up
  insert into payments(reference, organization_id, plan_id, price_version_id, billing_interval, amount_kobo, currency, initiated_by, discount_id, discount_percent, list_amount_kobo)
    select 'zb_gd_test1', '00000000-0000-4000-fb00-000000000001', p.id, v.id, 'monthly', 800000, 'NGN', '00000000-0000-4000-fa00-000000000003', did, 20, 1000000
    from plans p join plan_price_versions v on v.plan_id = p.id and v.status='active' and v.billing_interval='monthly' where p.code='pro' limit 1;
  assert (select uses_left from subscription_discounts where id = did) = 1, 'a started payment does not use the discount yet';
  res := settle_paystack_payment('zb_gd_test1','success',800000,'NGN','tx_gd_1','card',now());
  assert res = 'activated', 'the discounted payment activates the plan';
  assert (select uses_left from subscription_discounts where id = did) = 0, 'the discount is used up by the successful payment';
  select count(*) into n from best_discount_for('00000000-0000-4000-fb00-000000000001', (select id from plans where code='pro'));
  assert n = 0, 'a used-up discount no longer applies';
  res := settle_paystack_payment('zb_gd_test1','success',800000,'NGN','tx_gd_1','card',now());
  assert (select uses_left from subscription_discounts where id = did) = 0 and res = 'already_settled', 'a repeated notice does not use it twice';

  -- expiry and revoking
  perform pg_temp.as_user('00000000-0000-4000-fa00-000000000001'); set local role authenticated;
  did := admin_create_discount('00000000-0000-4000-fb00-000000000001', 50, null, 3, 5, 'Short offer');
  perform admin_revoke_discount(did);
  assert pg_temp.fails(format('select admin_revoke_discount(%L)', did)) like 'NOT_FOUND%', 'revoking twice is refused';
  assert jsonb_array_length(admin_list_discounts()) = 2, 'the list shows both discounts';
  reset role;
  select count(*) into n from best_discount_for('00000000-0000-4000-fb00-000000000001', (select id from plans where code='pro'));
  assert n = 0, 'a revoked discount does not apply';
  insert into subscription_discounts(organization_id, percent, uses_left, expires_at, reason) values ('00000000-0000-4000-fb00-000000000001', 30, 1, now() - interval '1 hour', 'Already expired');
  select count(*) into n from best_discount_for('00000000-0000-4000-fb00-000000000001', (select id from plans where code='pro'));
  assert n = 0, 'an expired discount does not apply';

  -- everything was audited
  select count(*) into n from admin_audit_logs where action in ('gift_plan','create_discount','revoke_discount');
  assert n = 6, 'every gift and discount action is in the audit log (got ' || n || ')';
  perform pg_temp.as_user('00000000-0000-4000-fa00-000000000001'); set local role authenticated;
  perform admin_set_subscription('00000000-0000-4000-fb00-000000000001', (select id from plans where code='pro'), 'active', 'manual');
  reset role;
end $$;
select 'ALL GIFT AND DISCOUNT CHECKS PASSED' as result;
