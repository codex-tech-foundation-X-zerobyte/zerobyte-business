\set ON_ERROR_STOP on
\pset pager off
-- Self-checking: prints ALL PROMOTER PAYOUT CHECKS PASSED. Run on a freshly migrated database.
create or replace function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, false), set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, false) $$;
create or replace function pg_temp.fails(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlerrm; end $$;

insert into auth.users(id,email) values
 ('00000000-0000-4000-f100-000000000001','po-super@t.test'),('00000000-0000-4000-f100-000000000002','po-finance@t.test'),('00000000-0000-4000-f100-000000000003','po-support@t.test'),
 ('00000000-0000-4000-f100-000000000004','po-promoter@t.test'),('00000000-0000-4000-f100-000000000005','po-owner1@t.test'),('00000000-0000-4000-f100-000000000006','po-promoter2@t.test'),
 ('00000000-0000-4000-f100-000000000007','po-owner3@t.test'),('00000000-0000-4000-f100-000000000008','po-owner4@t.test');
insert into platform_admin_access(user_id,role,status) values
 ('00000000-0000-4000-f100-000000000001','SUPER_ADMIN','active'),('00000000-0000-4000-f100-000000000002','FINANCE_ADMIN','active'),('00000000-0000-4000-f100-000000000003','SUPPORT_ADMIN','active');
insert into organizations(id,name,slug) values
 ('00000000-0000-4000-f200-000000000001','Honest Biz','po-honest'),('00000000-0000-4000-f200-000000000002','Own Biz (promoter owns it)','po-self'),
 ('00000000-0000-4000-f200-000000000003','Lapsing Biz','po-lapsing'),('00000000-0000-4000-f200-000000000004','Second Honest Biz','po-honest-2');
insert into organization_members(organization_id,user_id,role) values
 ('00000000-0000-4000-f200-000000000001','00000000-0000-4000-f100-000000000005','owner'),
 ('00000000-0000-4000-f200-000000000002','00000000-0000-4000-f100-000000000004','owner'),  -- the promoter's own business: self-referral
 ('00000000-0000-4000-f200-000000000003','00000000-0000-4000-f100-000000000007','owner'),
 ('00000000-0000-4000-f200-000000000004','00000000-0000-4000-f100-000000000008','owner');
insert into promoters(id,user_id,full_name,email,referral_code,status) values
 ('00000000-0000-4000-a200-000000000001','00000000-0000-4000-f100-000000000004','Pat Promoter','pat@po.test','ZB-POPAT','active'),
 ('00000000-0000-4000-a200-000000000002','00000000-0000-4000-f100-000000000006','Quinn Promoter','quinn@po.test','ZB-POQUINN','active');
insert into referrals(id,promoter_id,organization_id,referral_code,status) values
 ('00000000-0000-4000-b200-000000000001','00000000-0000-4000-a200-000000000001','00000000-0000-4000-f200-000000000001','ZB-POPAT','registered'),
 ('00000000-0000-4000-b200-000000000002','00000000-0000-4000-a200-000000000001','00000000-0000-4000-f200-000000000002','ZB-POPAT','registered'),
 ('00000000-0000-4000-b200-000000000003','00000000-0000-4000-a200-000000000001','00000000-0000-4000-f200-000000000003','ZB-POPAT','registered'),
 ('00000000-0000-4000-b200-000000000004','00000000-0000-4000-a200-000000000001','00000000-0000-4000-f200-000000000004','ZB-POPAT','registered');

-- Pay an organization's plan through the real settlement function (the same path Paystack uses).
create or replace function pg_temp.pay(org uuid, ref text, plan_code text default 'pro_plus') returns text language plpgsql as $$
declare v record;
begin
  select p.id plan_id, pv.id price_id, (pv.amount * 100)::bigint kobo into v from plans p join plan_price_versions pv on pv.plan_id = p.id and pv.billing_interval = 'monthly' and pv.status = 'active' where p.code = plan_code;
  insert into payments(reference, organization_id, plan_id, price_version_id, billing_interval, amount_kobo, initiated_by) values (ref, org, v.plan_id, v.price_id, 'monthly', v.kobo, '00000000-0000-4000-f100-000000000005');
  return settle_paystack_payment(ref, 'success', v.kobo, 'NGN', 'tx-' || ref, 'card', now());
end $$;

-- 1. Who may set the minimum payout (lowered so one plan payment reaches it in this test).
do $$ begin
  perform pg_temp.as_user('00000000-0000-4000-f100-000000000003'); set local role authenticated;
  assert pg_temp.fails('select admin_set_minimum_payout(100000)') like 'UNAUTHORIZED%', 'support admin cannot change the minimum';
  reset role; perform pg_temp.as_user('00000000-0000-4000-f100-000000000002'); set local role authenticated;
  assert pg_temp.fails('select admin_set_minimum_payout(100000)') like 'UNAUTHORIZED%', 'finance admin cannot change the minimum (super admin only)';
  reset role; perform pg_temp.as_user('00000000-0000-4000-f100-000000000001'); set local role authenticated;
  assert pg_temp.fails('select admin_set_minimum_payout(5)') like 'VALIDATION_ERROR%', 'a tiny minimum is refused';
  perform admin_set_minimum_payout(100000); reset role;
  assert (select minimum_payout_kobo from promoter_program_terms) = 100000, 'super admin set the minimum';
end $$;

-- 2. Earn commissions through real payments.
do $$ begin
  assert pg_temp.pay('00000000-0000-4000-f200-000000000001', 'zb_' || repeat('a', 32)) = 'activated';
  assert pg_temp.pay('00000000-0000-4000-f200-000000000002', 'zb_' || repeat('b', 32)) = 'activated';
  assert pg_temp.pay('00000000-0000-4000-f200-000000000003', 'zb_' || repeat('c', 32)) = 'activated';
  assert (select count(*) from promoter_commissions where status = 'pending') = 3, 'three pending commissions earned';
end $$;
-- the third customer stops paying (period ended)
update subscriptions set current_period_end = now() - interval '1 day' where organization_id = '00000000-0000-4000-f200-000000000003';

-- 3. The verification: honest customer counts, the self-referral and the lapsed customer are held back.
do $$ declare o jsonb; begin
  perform pg_temp.as_user('00000000-0000-4000-f100-000000000004'); set local role authenticated;
  o := get_promoter_payout_overview();
  assert (o ->> 'eligible_kobo')::bigint = 120000, 'only the honest customer counts (10% of ₦12,000): ' || o::text;
  assert (o ->> 'waiting_kobo')::bigint = 240000, 'the other two are held back';
  assert (select count(*) from jsonb_array_elements(o -> 'held') h where h ->> 'reason' = 'self_referral') = 1, 'self-referral detected';
  assert (select count(*) from jsonb_array_elements(o -> 'held') h where h ->> 'reason' = 'customer_not_active') = 1, 'lapsed customer detected';
  assert jsonb_array_length(o -> 'warnings') = 1, 'self-referral raised as a warning';
  assert (o ->> 'can_request')::boolean, 'the promoter can request';
  reset role;
end $$;

-- 4. Who may and may not request.
do $$ begin
  perform pg_temp.as_user('00000000-0000-4000-f100-000000000005'); set local role authenticated;
  assert pg_temp.fails('select request_promoter_payout()') like 'UNAUTHORIZED%', 'a business owner cannot request a payout';
  reset role; perform pg_temp.as_user('00000000-0000-4000-f100-000000000006'); set local role authenticated;
  assert pg_temp.fails('select request_promoter_payout()') like 'PAYOUT_NOT_ELIGIBLE: below_minimum%', 'a promoter with nothing earned cannot request';
  assert pg_temp.fails('select * from promoter_payout_requests') like 'permission denied%', 'the requests table is not readable directly';
  reset role;
end $$;

-- 5. The request locks exactly the eligible commissions and cannot be repeated.
do $$ declare rid uuid; begin
  perform pg_temp.as_user('00000000-0000-4000-f100-000000000004'); set local role authenticated;
  rid := request_promoter_payout(); reset role;
  assert (select amount_kobo from promoter_payout_requests where id = rid) = 120000, 'request is for the verified amount only';
  assert (select count(*) from promoter_commissions where status = 'requested') = 1 and (select count(*) from promoter_commissions where status = 'pending') = 2, 'only the verified commission is locked';
  perform pg_temp.as_user('00000000-0000-4000-f100-000000000004'); set local role authenticated;
  assert pg_temp.fails('select request_promoter_payout()') like 'PAYOUT_NOT_ELIGIBLE: request_already_open%', 'a second request is refused while one is open';
  reset role;
end $$;

-- 6. The review queue: only super and finance admins see it and decide.
do $$ declare rid uuid; q jsonb; begin
  select id into rid from promoter_payout_requests;
  perform pg_temp.as_user('00000000-0000-4000-f100-000000000003'); set local role authenticated;
  assert pg_temp.fails('select admin_list_payout_requests()') like 'UNAUTHORIZED%', 'support admin cannot see payout requests';
  assert admin_payout_queue_count() = 0, 'support admin sees no queue';
  assert pg_temp.fails(format('select admin_decide_payout(%L, ''approve'')', rid)) like 'UNAUTHORIZED%', 'support admin cannot decide';
  reset role; perform pg_temp.as_user('00000000-0000-4000-f100-000000000002'); set local role authenticated;
  assert admin_payout_queue_count() = 1, 'finance admin sees one request waiting';
  q := admin_list_payout_requests('review');
  assert jsonb_array_length(q) = 1 and (q -> 0 -> 'promoter' ->> 'name') = 'Pat Promoter', 'queue shows the request with the promoter';
  assert (q -> 0 -> 'items' -> 0 ->> 'still_ok')::boolean, 'item is still verified';
  assert pg_temp.fails(format('select admin_decide_payout(%L, ''mark_paid'', null, ''BANK-REF-1'')', rid)) like 'VALIDATION_ERROR%', 'cannot pay before approving';
  perform admin_decide_payout(rid, 'approve', 'Looks right');
  assert pg_temp.fails(format('select admin_decide_payout(%L, ''mark_paid'', null, ''x'')', rid)) like 'VALIDATION_ERROR%', 'a bank reference is required';
  reset role;
  assert (select status from promoter_payout_requests where id = rid) = 'approved', 'approved';
end $$;

-- 7. The checks run AGAIN when paying: the honest customer stops paying after approval.
update subscriptions set current_period_end = now() - interval '1 hour' where organization_id = '00000000-0000-4000-f200-000000000001';
do $$ declare rid uuid; begin
  select id into rid from promoter_payout_requests;
  perform pg_temp.as_user('00000000-0000-4000-f100-000000000002'); set local role authenticated;
  assert pg_temp.fails(format('select admin_decide_payout(%L, ''mark_paid'', null, ''BANK-REF-1'')', rid)) like 'PAYOUT_RECHECK_FAILED%', 'payment is blocked when the customer is no longer active';
  reset role;
  assert (select status from promoter_payout_requests where id = rid) = 'approved' and (select status from promoter_commissions where status <> 'pending' limit 1) = 'requested', 'nothing was paid';
end $$;
update subscriptions set current_period_end = now() + interval '20 days' where organization_id = '00000000-0000-4000-f200-000000000001';

-- 8. Paying: the ledger moves to paid and the totals reconcile.
do $$ declare rid uuid; o jsonb; begin
  select id into rid from promoter_payout_requests;
  perform pg_temp.as_user('00000000-0000-4000-f100-000000000001'); set local role authenticated;
  perform admin_decide_payout(rid, 'mark_paid', null, 'BANK-REF-1'); reset role;
  assert (select status from promoter_payout_requests where id = rid) = 'paid' and (select payment_reference from promoter_payout_requests where id = rid) = 'BANK-REF-1', 'request paid with its reference';
  assert (select count(*) from promoter_commissions where status = 'paid' and paid_by is not null) = 1, 'the commission is paid and attributed';
  assert (select sum(commission_kobo) from promoter_commissions) = (select sum(commission_kobo) filter (where status = 'paid') + sum(commission_kobo) filter (where status = 'pending') from promoter_commissions), 'ledger: paid + pending = total earned';
  perform pg_temp.as_user('00000000-0000-4000-f100-000000000004'); set local role authenticated;
  o := get_promoter_payout_overview(); reset role;
  assert (o ->> 'paid_kobo')::bigint = 120000 and (o ->> 'requested_kobo')::bigint = 0, 'promoter overview matches the ledger';
  assert (o -> 'history' -> 0 ->> 'status') = 'paid', 'history shows the paid request';
  assert (select count(*) from admin_audit_logs where action in ('payout_approve', 'payout_mark_paid')) = 2, 'decisions are audit-logged';
end $$;

-- 9. Reject and cancel both release the commissions; a locked commission cannot be settled by hand.
do $$ declare rid uuid; cid uuid; begin
  assert pg_temp.pay('00000000-0000-4000-f200-000000000004', 'zb_' || repeat('d', 32)) = 'activated';
  perform pg_temp.as_user('00000000-0000-4000-f100-000000000004'); set local role authenticated;
  rid := request_promoter_payout(); reset role;
  select commission_id into cid from promoter_payout_items where request_id = rid;
  perform pg_temp.as_user('00000000-0000-4000-f100-000000000002'); set local role authenticated;
  assert pg_temp.fails(format('select admin_set_commission_status(%L, ''paid'')', cid)) like 'USE_PAYOUT_FLOW%', 'a locked commission cannot be marked paid by hand';
  assert pg_temp.fails(format('select admin_decide_payout(%L, ''reject'', ''no'')', rid)) like 'VALIDATION_ERROR%', 'a rejection needs a real reason';
  perform admin_decide_payout(rid, 'reject', 'Customer payment under investigation'); reset role;
  assert (select count(*) from promoter_commissions where status = 'requested') = 0, 'rejecting releases the commissions';
  perform pg_temp.as_user('00000000-0000-4000-f100-000000000004'); set local role authenticated;
  assert (get_promoter_payout_overview() -> 'history' -> 0 ->> 'decision_note') like 'Customer payment%', 'the promoter sees the reason';
  rid := request_promoter_payout();
  perform cancel_promoter_payout(rid); reset role;
  assert (select status from promoter_payout_requests where id = rid) = 'canceled' and (select count(*) from promoter_commissions where status = 'requested') = 0, 'the promoter can cancel a request still in review';
end $$;

-- 10. A suspended promoter cannot request.
update promoters set status = 'suspended' where id = '00000000-0000-4000-a200-000000000001';
do $$ begin
  perform pg_temp.as_user('00000000-0000-4000-f100-000000000004'); set local role authenticated;
  assert pg_temp.fails('select request_promoter_payout()') like 'PAYOUT_NOT_ELIGIBLE: promoter_not_active%', 'a suspended promoter cannot request';
  reset role;
end $$;
-- Settings function: financial admins can read the minimum, others cannot; only the super admin may change it.
do $$ declare s jsonb; expected bigint; begin
  expected := (select minimum_payout_kobo from promoter_program_terms);
  perform pg_temp.as_user('00000000-0000-4000-f100-000000000002'); set local role authenticated;
  s := admin_get_payout_settings();
  assert (s->>'minimum_payout_kobo')::bigint = expected, 'finance admin reads the minimum';
  assert (s->>'can_change')::boolean = false, 'finance admin cannot change it';
  reset role; perform pg_temp.as_user('00000000-0000-4000-f100-000000000001'); set local role authenticated;
  assert ((admin_get_payout_settings())->>'can_change')::boolean = true, 'super admin can change it';
  reset role; perform pg_temp.as_user('00000000-0000-4000-f100-000000000003'); set local role authenticated;
  assert pg_temp.fails('select admin_get_payout_settings()') like 'UNAUTHORIZED%', 'support admin cannot read it';
  reset role;
end $$;


\echo ALL PROMOTER PAYOUT CHECKS PASSED

