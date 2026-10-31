\pset pager off
\set ON_ERROR_STOP off
\set ADM '\'00000000-0000-4000-8000-0000000000a1\''
\set PRO '\'00000000-0000-4000-8000-0000000000b1\''
\set HIJ '\'00000000-0000-4000-8000-0000000000b9\''
\set BIZ '\'00000000-0000-4000-8000-0000000000c1\''
truncate public.promoter_applications, public.promoters, public.referrals, public.platform_admin_access, public.promoter_application_attempts cascade;
delete from public.organizations where slug like 'zz-%' or name in ('Promoter Own Biz','Okafor Hardware Ltd');
insert into auth.users(id,email) values (:ADM,'admin@t.test'),(:PRO,'ada.real@promo.test'),(:HIJ,'ada@promo.test'),(:BIZ,'owner@biz.test') on conflict do nothing;  -- HIJ registered the applicant's email first
insert into public.platform_admin_access(user_id,role,status) values (:ADM,'SUPPORT_ADMIN','active');

\echo '=== 1. Application: WhatsApp number is required and validated'
begin; set local role anon; set local request.headers='{"x-forwarded-for":"9.9.9.1"}';
select public.submit_promoter_application('Ada Obi','ada@promo.test',null,'Lagos',null,null,'I will promote',true);
commit;
begin; set local role anon; set local request.headers='{"x-forwarded-for":"9.9.9.1"}';
select public.submit_promoter_application('Ada Obi','ada@promo.test','12345','Lagos',null,null,'I will promote',true);
commit;
begin; set local role anon; set local request.headers='{"x-forwarded-for":"9.9.9.1"}';
select public.submit_promoter_application('Ada Obi','ada@promo.test','0803 123 4567','Lagos',null,null,'I will promote',true) is not null as valid_whatsapp_accepted;
commit;

\echo '=== 2. A SUPPORT admin approves the application -> promoter row with ZB- code'
select id as app_id from public.promoter_applications limit 1 \gset
begin; set local role authenticated; set local request.jwt.claim.sub=:ADM;
select public.admin_review_promoter_application(:'app_id','approved','looks good') is not null as promoter_created;
commit;
select referral_code ~ '^ZB-[A-Z0-9]{5}$' as code_format_ok, user_id is null as no_account_yet from public.promoters;
select id as promo_id, referral_code as code from public.promoters limit 1 \gset

\echo '=== 3. HIJACK ATTEMPT: attacker registers the promoter''s email first and calls link_promoter_account'
begin; set local role authenticated; set local request.jwt.claim.sub=:HIJ;
select public.link_promoter_account() as returned_promoter_id_should_be_null;
commit;
select user_id is null as promoter_still_unclaimed from public.promoters;

\echo '=== 4. Admin provisioning binds the real account (edge function does this with the service role)'
update public.promoters set user_id=:PRO where id=:'promo_id';
begin; set local role authenticated; set local request.jwt.claim.sub=:PRO;
select public.link_promoter_account() = :'promo_id' as owner_resolves_own_promoter;
commit;

\echo '=== 5. Referrals: a real business signs up with the code; the promoter''s OWN business does not count'
begin; set local role authenticated; set local request.jwt.claim.sub=:BIZ;
select public.create_workspace('Okafor Hardware Ltd', :'code') is not null as business_created;
commit;
begin; set local role authenticated; set local request.jwt.claim.sub=:PRO;
select public.create_workspace('Promoter Own Biz', :'code') is not null as own_workspace_created;
commit;
select count(*) as referral_rows_expected_1, min(status) as status from public.referrals;

\echo '=== 6. Promoter sees only own referrals, business name masked; strangers see none'
begin; set local role authenticated; set local request.jwt.claim.sub=:PRO;
select * from public.get_promoter_referrals();
commit;
begin; set local role authenticated; set local request.jwt.claim.sub=:HIJ;
select count(*) as attacker_sees_expected_0 from public.get_promoter_referrals();
commit;

\echo '=== 7. Referral lifecycle: admin can advance it, non-admin cannot, bad status refused, audit written'
select id as ref_id from public.referrals limit 1 \gset
begin; set local role authenticated; set local request.jwt.claim.sub=:PRO;
select public.admin_set_referral_status(:'ref_id','paid','self-pay');
commit;
begin; set local role authenticated; set local request.jwt.claim.sub=:ADM;
select public.admin_set_referral_status(:'ref_id','banana');
commit;
begin; set local role authenticated; set local request.jwt.claim.sub=:ADM;
select public.admin_set_referral_status(:'ref_id','qualified','verified active for 30 days');
commit;
select status, qualified_at is not null as qualified_at_set, notes from public.referrals;
select action, actor_id = :ADM as by_admin from public.admin_audit_logs where action='referral.status_changed';

\echo '=== 8. Admin lists show WhatsApp + account state; non-admins get nothing'
begin; set local role authenticated; set local request.jwt.claim.sub=:ADM;
select full_name, whatsapp, has_account, total_referrals from public.admin_list_promoters();
select promoter_name, business_name, status from public.admin_list_referrals();
commit;
begin; set local role authenticated; set local request.jwt.claim.sub=:HIJ;
select (select count(*) from public.admin_list_promoters()) as promoters_visible_expected_0, (select count(*) from public.admin_list_referrals()) as referrals_visible_expected_0;
commit;
