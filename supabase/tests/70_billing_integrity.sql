\pset pager off
\set ON_ERROR_STOP off
-- Hostile-customer tests for billing. Every line marked EXPECT should print what it says.
\set U '\'00000000-0000-4000-8000-0000000000f1\''
\set V '\'00000000-0000-4000-8000-0000000000f2\''
\set O '\'00000000-0000-4000-8000-0000000000f3\''
\set O2 '\'00000000-0000-4000-8000-0000000000f4\''
insert into auth.users(id,email) values (:U,'owner@bill.test'),(:V,'other@bill.test') on conflict do nothing;
insert into public.organizations(id,name,slug) values (:O,'Bill Org','bill-org'),(:O2,'Other Org','other-org') on conflict do nothing;
insert into public.organization_members(organization_id,user_id,role) values (:O,:U,'owner'),(:O2,:V,'owner') on conflict do nothing;

\echo '--- A. EXPECT error PAYMENT_REQUIRED: a plan with no trial cannot be self-activated'
update public.plans set trial_days = 0 where code = 'pro_plus';
begin; set local role authenticated; set local request.jwt.claim.sub=:U;
select public.start_plan_trial(:O, (select id from public.plans where code='pro_plus'));
rollback;
update public.plans set trial_days = 7 where code = 'pro_plus';

\echo '--- B. EXPECT error CONTACT_SALES: enterprise is not self-serve'
begin; set local role authenticated; set local request.jwt.claim.sub=:U;
select public.start_plan_trial(:O, (select id from public.plans where code='enterprise'));
rollback;

\echo '--- C. EXPECT error UNAUTHORIZED: someone else cannot start a trial for my business'
begin; set local role authenticated; set local request.jwt.claim.sub=:V;
select public.start_plan_trial(:O, (select id from public.plans where code='pro'));
rollback;

\echo '--- D. EXPECT ok: owner starts ONE 7-day trial of pro'
begin; set local role authenticated; set local request.jwt.claim.sub=:U;
select public.start_plan_trial(:O, (select id from public.plans where code='pro'));
commit;
reset role;
select status as expect_trialing, (select code from plans where id=plan_id) as plan from public.subscriptions where organization_id=:O;

\echo '--- E. EXPECT error TRIAL_ALREADY_ACTIVE: no stacking trials'
begin; set local role authenticated; set local request.jwt.claim.sub=:U;
select public.start_plan_trial(:O, (select id from public.plans where code='pro_plus'));
rollback;

\echo '--- F. trial lapses: limits must fall back to Free (50 products) even though status still says trialing'
update public.subscriptions set current_period_end = now() - interval '1 hour', trial_end = now() - interval '1 hour' where organization_id=:O;
select public.get_plan_limit(:O,'products') as expect_50_free_limit;
\echo '--- G. EXPECT error TRIAL_USED: cannot farm a second trial after the first lapsed'
begin; set local role authenticated; set local request.jwt.claim.sub=:U;
select public.start_plan_trial(:O, (select id from public.plans where code='pro'));
rollback;
\echo '--- H. housekeeping marks it expired (expect 1)'
select public.expire_lapsed_subscriptions() as expect_1;
select status as expect_expired from public.subscriptions where organization_id=:O;

\echo '--- I. payments: browser cannot write or call the settle function'
begin; set local role authenticated; set local request.jwt.claim.sub=:U;
insert into public.payments(reference,organization_id,plan_id,price_version_id,billing_interval,amount_kobo,initiated_by)
  values ('zb_hack',:O,(select id from public.plans where code='pro'),(select id from public.plan_price_versions limit 1),'monthly',1,:U);
rollback;
begin; set local role authenticated; set local request.jwt.claim.sub=:U;
select public.settle_paystack_payment('zb_x','success',800000,'NGN','1','card',now());
rollback;
begin; set local role anon;
select public.settle_paystack_payment('zb_x','success',800000,'NGN','1','card',now());
rollback;

\echo '--- J. settlement (as the server): wrong amount must NOT activate'
insert into public.payments(reference,organization_id,plan_id,price_version_id,billing_interval,amount_kobo,initiated_by)
  select 'zb_' || repeat('a',32), :O, p.id, v.id, 'monthly', 800000, :U from plans p join plan_price_versions v on v.plan_id=p.id and v.billing_interval='monthly' and v.status='active' where p.code='pro';
select public.settle_paystack_payment('zb_' || repeat('a',32),'success',100,'NGN','tx1','card',now()) as expect_mismatch;
select status as expect_still_expired from public.subscriptions where organization_id=:O;
\echo '--- K. wrong currency must NOT activate (fresh reference)'
update public.payments set status='pending' where reference='zb_' || repeat('a',32);
select public.settle_paystack_payment('zb_' || repeat('a',32),'success',800000,'USD','tx1','card',now()) as expect_mismatch;
update public.payments set status='pending' where reference='zb_' || repeat('a',32);
\echo '--- L. exact amount activates once; replay is harmless'
select public.settle_paystack_payment('zb_' || repeat('a',32),'success',800000,'NGN','tx1','card',now()) as expect_activated;
select public.settle_paystack_payment('zb_' || repeat('a',32),'success',800000,'NGN','tx1','card',now()) as expect_already_settled;
select status as expect_active, provider as expect_paystack, current_period_end > now() + interval '29 days' as expect_true from public.subscriptions where organization_id=:O;
select count(*) as expect_1_activation_event from public.subscription_events where organization_id=:O and event_type='activated';
select public.get_plan_limit(:O,'products') as expect_pro_limit_not_50;
\echo '--- M. EXPECT error PLAN_ALREADY_PAID: cannot overwrite a plan I paid for with a trial of another'
begin; set local role authenticated; set local request.jwt.claim.sub=:U;
select public.start_plan_trial(:O, (select id from public.plans where code='pro_plus'));
rollback;
\echo '--- N. another business cannot read my payments'
begin; set local role authenticated; set local request.jwt.claim.sub=:V;
select count(*) as expect_0 from public.payments;
rollback;
begin; set local role authenticated; set local request.jwt.claim.sub=:U;
select count(*) as expect_1 from public.payments;
rollback;
\echo '--- O. logo bucket limits'
select file_size_limit as expect_2097152, allowed_mime_types as expect_no_svg from storage.buckets where id='business-logos';
