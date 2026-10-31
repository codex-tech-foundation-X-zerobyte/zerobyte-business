\set ON_ERROR_STOP on
\pset pager off
-- Self-checking. Run on a freshly migrated database.
create or replace function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, false), set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, false) $$;
insert into auth.users(id,email) values
 ('00000000-0000-4000-d100-000000000001','pc-super@t.test'),('00000000-0000-4000-d100-000000000002','pc-finance@t.test'),('00000000-0000-4000-d100-000000000003','pc-support@t.test'),
 ('00000000-0000-4000-d100-000000000004','pc-promoter@t.test'),('00000000-0000-4000-d100-000000000005','pc-owner@t.test'),('00000000-0000-4000-d100-000000000006','pc-promoter2@t.test'),('00000000-0000-4000-d100-000000000007','pc-owner2@t.test');
insert into platform_admin_access(user_id,role,status) values ('00000000-0000-4000-d100-000000000001','SUPER_ADMIN','active'),('00000000-0000-4000-d100-000000000002','FINANCE_ADMIN','active'),('00000000-0000-4000-d100-000000000003','SUPPORT_ADMIN','active');
insert into organizations(id,name,slug) values ('00000000-0000-4000-e100-000000000001','Referred Biz','pc-referred-biz'),('00000000-0000-4000-e100-000000000002','Referred Biz Two','pc-referred-biz-2');
insert into organization_members(organization_id,user_id,role) values ('00000000-0000-4000-e100-000000000001','00000000-0000-4000-d100-000000000005','owner'),('00000000-0000-4000-e100-000000000002','00000000-0000-4000-d100-000000000007','owner');
insert into promoters(id,user_id,full_name,email,referral_code,status) values ('00000000-0000-4000-a100-000000000001','00000000-0000-4000-d100-000000000004','Pat Promoter','pat@t.test','ZB-PATTEST','active'),('00000000-0000-4000-a100-000000000002','00000000-0000-4000-d100-000000000006','Sam Suspended','sam@t.test','ZB-SAMTEST','suspended');
insert into referrals(id,promoter_id,organization_id,referral_code,status) values ('00000000-0000-4000-b100-000000000001','00000000-0000-4000-a100-000000000001','00000000-0000-4000-e100-000000000001','ZB-PATTEST','registered');

-- helper: create and settle a payment for an organization at a given paid time; returns the settle outcome
create or replace function pg_temp.pay(org uuid, ref text, paid timestamptz, plan_code text default 'pro', amount_override bigint default null) returns text language plpgsql as $$
declare v record; amt bigint;
begin
  select p.id plan_id, pv.id price_id, (pv.amount * 100)::bigint kobo into v from plans p join plan_price_versions pv on pv.plan_id = p.id and pv.billing_interval = 'monthly' and pv.status = 'active' where p.code = plan_code;
  amt := coalesce(amount_override, v.kobo);
  insert into payments(reference, organization_id, plan_id, price_version_id, billing_interval, amount_kobo, initiated_by) values (ref, org, v.plan_id, v.price_id, 'monthly', v.kobo, '00000000-0000-4000-d100-000000000005');
  return settle_paystack_payment(ref, 'success', amt, 'NGN', 'tx-' || ref, 'card', paid);
end $$;

do $$ declare o text; kobo bigint; begin
  -- 1. first payment: 10%
  o := pg_temp.pay('00000000-0000-4000-e100-000000000001', 'zb_' || repeat('1', 32), now() - interval '40 days');
  assert o = 'activated', 'first payment activates the plan: ' || o;
  select (pv.amount * 100)::bigint into kobo from plans p join plan_price_versions pv on pv.plan_id = p.id and pv.billing_interval = 'monthly' and pv.status = 'active' where p.code = 'pro';
  assert (select kind from promoter_commissions where payment_id = (select id from payments where reference = 'zb_' || repeat('1', 32))) = 'first', 'first payment earns the first-payment rate';
  assert (select percent from promoter_commissions limit 1) = 10, 'first payment percentage is 10';
  assert (select commission_kobo from promoter_commissions limit 1) = floor(kobo * 10 / 100.0), 'commission is 10% of the plan price';
  assert (select status from referrals where id = '00000000-0000-4000-b100-000000000001') = 'commissionable', 'referral becomes commissionable';
  assert (select commission_months from referrals where id = '00000000-0000-4000-b100-000000000001') = 18, 'terms are snapshotted on the referral';
  -- 2. later monthly payment: 5%
  o := pg_temp.pay('00000000-0000-4000-e100-000000000001', 'zb_' || repeat('2', 32), now() - interval '10 days');
  assert (select percent from promoter_commissions where kind = 'recurring') = 5, 'later payments earn 5%';
  -- 3. replaying a settled payment adds nothing
  o := settle_paystack_payment('zb_' || repeat('2', 32), 'success', kobo, 'NGN', 'tx', 'card', now());
  assert o = 'already_settled' and (select count(*) from promoter_commissions) = 2, 'settlement replay does not duplicate commission';
  -- 4. outside the 18 month window: no commission
  update referrals set commission_ends_at = now() - interval '1 day' where id = '00000000-0000-4000-b100-000000000001';
  o := pg_temp.pay('00000000-0000-4000-e100-000000000001', 'zb_' || repeat('3', 32), now());
  assert o = 'activated' and (select count(*) from promoter_commissions) = 2, 'no commission after the window ends (plan still activates)';
  -- 5. mismatched and failed payments earn nothing
  o := pg_temp.pay('00000000-0000-4000-e100-000000000002', 'zb_' || repeat('4', 32), now(), 'pro', 1);
  assert o = 'mismatch' and (select count(*) from promoter_commissions) = 2, 'mismatched payment earns nothing';
end $$;

-- 6. who may change the terms
do $$ declare refused boolean; begin
  perform pg_temp.as_user('00000000-0000-4000-d100-000000000003'); set local role authenticated; refused := false;
  begin perform admin_set_promoter_terms(8, 4, 12); exception when others then refused := true; end; assert refused, 'support admin cannot edit terms';
  reset role; perform pg_temp.as_user('00000000-0000-4000-d100-000000000005'); set local role authenticated; refused := false;
  begin perform admin_set_promoter_terms(8, 4, 12); exception when others then refused := true; end; assert refused, 'business owner cannot edit terms';
  reset role; perform pg_temp.as_user('00000000-0000-4000-d100-000000000002'); set local role authenticated; refused := false;
  begin perform admin_set_promoter_terms(60, 4, 12); exception when others then refused := true; end; assert refused, 'a 60% rate is refused';
  refused := false; begin perform admin_set_promoter_terms(8, 4, 0); exception when others then refused := true; end; assert refused, 'a 0 month duration is refused';
  perform admin_set_promoter_terms(20, 10, 12);
  reset role;
  assert (select first_payment_percent from get_public_promoter_terms()) = 20, 'finance admin can edit the terms';
  assert (select count(*) from admin_audit_logs where action = 'update_promoter_terms') = 1, 'the change is audit-logged';
  set local role anon; assert (select duration_months from get_public_promoter_terms()) = 12, 'anyone can read the public terms'; reset role;
end $$;

-- 7. new referrals use the new terms; the old referral keeps its snapshot; suspended promoters earn nothing
insert into referrals(id,promoter_id,organization_id,referral_code,status) values ('00000000-0000-4000-b100-000000000002','00000000-0000-4000-a100-000000000001','00000000-0000-4000-e100-000000000002','ZB-PATTEST','registered');
do $$ declare o text; begin
  o := pg_temp.pay('00000000-0000-4000-e100-000000000002', 'zb_' || repeat('5', 32), now());
  assert o = 'activated' and (select percent from promoter_commissions where referral_id = '00000000-0000-4000-b100-000000000002') = 20, 'a new referral uses the edited terms (20%)';
  assert (select commission_first_percent from referrals where id = '00000000-0000-4000-b100-000000000001') = 10, 'the earlier referral keeps its original 10%';
  update promoters set status = 'suspended' where id = '00000000-0000-4000-a100-000000000001';
  o := pg_temp.pay('00000000-0000-4000-e100-000000000002', 'zb_' || repeat('6', 32), now() + interval '1 day');
  assert (select count(*) from promoter_commissions where referral_id = '00000000-0000-4000-b100-000000000002') = 1, 'a suspended promoter earns nothing on new payments';
  update promoters set status = 'active' where id = '00000000-0000-4000-a100-000000000001';
end $$;

-- 8. visibility: promoter sees own earnings, others do not; admins list and mark paid, support cannot
do $$ declare refused boolean := false; cid uuid; begin
  perform pg_temp.as_user('00000000-0000-4000-d100-000000000004'); set local role authenticated;
  assert (get_promoter_earnings()->>'pending_kobo')::bigint > 0, 'the promoter sees pending earnings';
  assert (select count(*) from promoter_commissions) = 3, 'the promoter can read only their own commission rows';
  reset role; perform pg_temp.as_user('00000000-0000-4000-d100-000000000005'); set local role authenticated;
  assert (get_promoter_earnings()->>'pending_kobo')::bigint = 0 and (select count(*) from promoter_commissions) = 0, 'someone else sees none of it';
  reset role; perform pg_temp.as_user('00000000-0000-4000-d100-000000000003'); set local role authenticated;
  begin perform * from admin_list_commissions(); exception when others then refused := true; end; assert refused, 'support admin cannot see the commission ledger';
  reset role; perform pg_temp.as_user('00000000-0000-4000-d100-000000000002'); set local role authenticated;
  assert (select count(*) from admin_list_commissions('pending')) = 3, 'finance admin sees the ledger';
  select id into cid from admin_list_commissions('pending') limit 1;
  perform admin_set_commission_status(cid, 'paid', 'Paid by transfer');
  reset role;
  assert (select status from promoter_commissions where id = cid) = 'paid' and (select paid_by from promoter_commissions where id = cid) is not null, 'marking paid records who and when';
end $$;
\echo 'ALL PROMOTER COMMISSION CHECKS PASSED'
