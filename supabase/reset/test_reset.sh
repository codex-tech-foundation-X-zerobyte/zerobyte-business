#!/bin/bash
# Proves the reset scripts on a throwaway database. Needs: Postgres running locally and a database named $TPL that already
# holds the full schema (all migrations applied, no data). Usage: TPL=tpl_rep bash supabase/reset/test_reset.sh
set -u
TPL=${TPL:-tpl_rep}; DB=rst_t; HERE=$(cd "$(dirname "$0")" && pwd); SEED=${SEED:-$HERE/../../tools/sim/seed.sql}
PSQL="su postgres -c"; fails=0
q(){ su postgres -c "psql -d $DB -At -c \"$1\"" 2>&1; }
ok(){ if [ "$2" = "1" ]; then echo "PASS  $1"; else echo "FAIL  $1"; fails=$((fails+1)); fi; }
mk(){ # mk <email> <confirm-phrase> -> a runnable copy of 2_wipe.sql
  sed -e "s/'CHANGE-ME@example.com'/'$1'/" -e "s/confirm    constant text := '';/confirm    constant text := '$2';/" $HERE/2_wipe.sql > /tmp/wipe_run.sql; chmod a+r /tmp/wipe_run.sql; }
run(){ su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f /tmp/wipe_run.sql" 2>&1; }
chmod a+r $SEED $HERE/*.sql 2>/dev/null
su postgres -c "dropdb --if-exists $DB; createdb -T $TPL $DB"
echo "== building demo data (the sim shop) plus traps"
su postgres -c "psql -d $DB -q -f $SEED" >/dev/null 2>&1
su postgres -c "psql -d $DB -q -v ON_ERROR_STOP=1" <<'EOF' >/tmp/fixture.log 2>&1 || { echo 'FIXTURE FAILED:'; cat /tmp/fixture.log; exit 1; }
drop table if exists auth.mfa_factors; create table auth.mfa_factors (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, factor_type text not null, status text not null); -- as in real Supabase: deleting an account removes its authenticators
insert into auth.users(id,email,email_confirmed_at) values
 ('aaaaaaaa-0000-4000-8000-000000000001','keeper@t.test',now()),
 ('aaaaaaaa-0000-4000-8000-000000000002','boss2@t.test',now()),
 ('aaaaaaaa-0000-4000-8000-000000000003','support@t.test',now());
insert into public.profiles(id,full_name) values ('aaaaaaaa-0000-4000-8000-000000000001','Keeper') on conflict do nothing;
insert into public.platform_admin_access(user_id,role,status,granted_by) values
 ('aaaaaaaa-0000-4000-8000-000000000001','SUPER_ADMIN','active','aaaaaaaa-0000-4000-8000-000000000002'),
 ('aaaaaaaa-0000-4000-8000-000000000002','SUPER_ADMIN','active',null),
 ('aaaaaaaa-0000-4000-8000-000000000003','SUPPORT_ADMIN','active',null);
insert into auth.mfa_factors(user_id,factor_type,status) values
 ('aaaaaaaa-0000-4000-8000-000000000001','totp','verified'),('aaaaaaaa-0000-4000-8000-000000000002','totp','verified');
-- shared rows written by an admin who will be deleted (the trap that blocks a naive reset)
update public.plan_price_versions set created_by='aaaaaaaa-0000-4000-8000-000000000002';
insert into public.app_version_announcements(version,message,created_by) values ('9.9','Hello','aaaaaaaa-0000-4000-8000-000000000002');
insert into public.roadmap_items(title,owner_id) values ('Test item','aaaaaaaa-0000-4000-8000-000000000002');
update public.promoter_program_terms set updated_by='aaaaaaaa-0000-4000-8000-000000000002';
EOF
echo "   accounts: $(q 'select count(*) from auth.users')  sales: $(q 'select count(*) from public.sales')  organizations: $(q 'select count(*) from public.organizations')  plans: $(q 'select count(*) from public.plans')  announcements: $(q 'select count(*) from public.app_version_announcements')"
SNAP="$(q "select (select count(*) from auth.users)||'/'||(select count(*) from public.sales)||'/'||(select count(*) from public.organizations)||'/'||(select count(*) from public.customers)||'/'||(select count(*) from public.plans)||'/'||(select count(*) from public.platform_admin_access)")"
echo "== PREVIEW (read-only)"
sed "s/'CHANGE-ME@example.com'/'keeper@t.test'/" $HERE/1_preview.sql > /tmp/preview_run.sql; chmod a+r /tmp/preview_run.sql
su postgres -c "psql -d $DB -At -F' | ' -f /tmp/preview_run.sql" > /tmp/preview_out.txt 2>&1
grep -E "^(1\.|2\.|4\.)" /tmp/preview_out.txt | sed 's/^/   /'
grep -c "^3. ERASE" /tmp/preview_out.txt | xargs -I{} echo "   tables to erase: {}"; grep "^3. KEEP" /tmp/preview_out.txt | sed 's/^/   /' | head -12
ok "preview names the account that survives" "$(grep -c '^1\. ACCOUNT THAT SURVIVES | keeper@t.test | super admin, 1 authenticator' /tmp/preview_out.txt)"
ok "preview changed nothing" "$([ "$(q "select (select count(*) from auth.users)||'/'||(select count(*) from public.sales)||'/'||(select count(*) from public.organizations)||'/'||(select count(*) from public.customers)||'/'||(select count(*) from public.plans)||'/'||(select count(*) from public.platform_admin_access)")" = "$SNAP" ] && echo 1 || echo 0)"
same(){ [ "$(q "select (select count(*) from auth.users)||'/'||(select count(*) from public.sales)||'/'||(select count(*) from public.organizations)||'/'||(select count(*) from public.customers)||'/'||(select count(*) from public.plans)||'/'||(select count(*) from public.platform_admin_access)")" = "$SNAP" ] && echo 1 || echo 0; }
echo "== SAFETY: each of these must refuse and change nothing"
mk keeper@t.test ""; out=$(run); ok "no confirmation typed -> refuses" "$(echo "$out" | grep -c 'NOT CONFIRMED')"; ok "   and nothing changed" "$(same)"
mk keeper@t.test "erase all data"; out=$(run); ok "wrong-case confirmation -> refuses" "$(echo "$out" | grep -c 'NOT CONFIRMED')"
mk nobody@t.test "ERASE ALL DATA"; out=$(run); ok "unknown email -> refuses" "$(echo "$out" | grep -c 'KEEP ACCOUNT NOT FOUND')"; ok "   and nothing changed" "$(same)"
mk support@t.test "ERASE ALL DATA"; out=$(run); ok "a support admin (not a super admin) cannot be the kept account" "$(echo "$out" | grep -c 'KEEP ACCOUNT NOT FOUND')"; ok "   and nothing changed" "$(same)"
mk 'KEEPER@T.TEST' "ERASE ALL DATA" >/dev/null
echo "== ATOMIC: a failure halfway must undo EVERYTHING (a trap blocks deleting one account)"
su postgres -c "psql -d $DB -q" <<'EOF' >/dev/null 2>&1
create or replace function public.zz_block_delete() returns trigger language plpgsql as $$ begin raise exception 'simulated failure at the last step'; end $$;
create trigger zz_block before delete on auth.users for each row when (old.email = 'boss2@t.test') execute function public.zz_block_delete();
EOF
mk keeper@t.test "ERASE ALL DATA"; out=$(run); ok "failure is reported" "$(echo "$out" | grep -c 'simulated failure')"; ok "   and NOTHING was erased (accounts, sales, businesses, customers, plans, admins all intact)" "$(same)"
ok "   and the shared-row authorship was not half-changed" "$([ "$(q "select count(*) from public.app_version_announcements where created_by='aaaaaaaa-0000-4000-8000-000000000002'")" = "1" ] && echo 1 || echo 0)"
su postgres -c "psql -d $DB -q -c 'drop trigger zz_block on auth.users; drop function public.zz_block_delete();'" >/dev/null 2>&1
echo "== THE REAL RESET"
SHARED_BEFORE="$(q "select (select count(*) from public.plans)||'/'||(select count(*) from public.plan_limits)||'/'||(select count(*) from public.plan_price_versions)||'/'||(select count(*) from public.security_settings)||'/'||(select count(*) from public.blocked_email_domains)||'/'||(select count(*) from public.promoter_program_terms)||'/'||(select count(*) from public.app_version_announcements)||'/'||(select count(*) from public.roadmap_items)")"
mk 'KEEPER@T.TEST' "ERASE ALL DATA"; out=$(run); echo "$out" | grep -E "RESET|ERROR|accounts_remaining|COMPLETE" | head -3 | sed 's/^/   /'
ok "reset completes" "$(echo "$out" | grep -c 'RESET COMPLETE')"
ok "exactly one account remains: the kept super admin" "$([ "$(q "select string_agg(email,',') from auth.users")" = "keeper@t.test" ] && echo 1 || echo 0)"
ok "their super admin role is intact" "$([ "$(q "select count(*) from public.platform_admin_access where user_id='aaaaaaaa-0000-4000-8000-000000000001' and role='SUPER_ADMIN' and status='active'")" = "1" ] && echo 1 || echo 0)"
ok "other admins are gone (including the second super admin)" "$([ "$(q "select count(*) from public.platform_admin_access")" = "1" ] && echo 1 || echo 0)"
ok "their profile survived, nobody else's" "$([ "$(q "select string_agg(id::text,',') from public.profiles")" = "aaaaaaaa-0000-4000-8000-000000000001" ] && echo 1 || echo 0)"
ok "their authenticator app survived (still 1), the others' did not" "$([ "$(q "select count(*)||'/'||(select count(*) from auth.mfa_factors where user_id<>'aaaaaaaa-0000-4000-8000-000000000001') from auth.mfa_factors where user_id='aaaaaaaa-0000-4000-8000-000000000001'")" = "1/0" ] && echo 1 || echo 0)"
SHARED_AFTER="$(q "select (select count(*) from public.plans)||'/'||(select count(*) from public.plan_limits)||'/'||(select count(*) from public.plan_price_versions)||'/'||(select count(*) from public.security_settings)||'/'||(select count(*) from public.blocked_email_domains)||'/'||(select count(*) from public.promoter_program_terms)||'/'||(select count(*) from public.app_version_announcements)||'/'||(select count(*) from public.roadmap_items)")"
ok "shared settings untouched (plans/limits/prices/security/blocked domains/terms/announcements/roadmap): $SHARED_AFTER" "$([ "$SHARED_BEFORE" = "$SHARED_AFTER" ] && echo 1 || echo 0)"
ok "shared rows now credit the kept admin, not the deleted one" "$([ "$(q "select count(*) from public.app_version_announcements where created_by='aaaaaaaa-0000-4000-8000-000000000001'")" = "1" ] && echo 1 || echo 0)"
ok "every other table is empty (0 non-empty tables outside the shared list)" "$([ "$(q "select count(*) from (select tablename t from pg_tables where schemaname='public' and tablename not in ('plans','plan_limits','plan_price_versions','security_settings','blocked_email_domains','promoter_program_terms','app_version_announcements','roadmap_items','platform_admin_access','profiles')) x where (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', t), false, true, '')))[1]::text::bigint > 0")" = "0" ] && echo 1 || echo 0)"
echo "== THE PRODUCT STILL WORKS AFTER THE RESET"
ok "the plan catalog still loads for visitors" "$([ "$(su postgres -c "psql -d $DB -At -c \"set role anon; select count(*) from public.get_plan_catalog()\"" 2>&1 | tail -1)" -ge 4 ] 2>/dev/null && echo 1 || echo 0)"
ok "the kept super admin is still recognised as a super admin" "$([ "$(su postgres -c "psql -d $DB -At -c \"begin; set local role authenticated; select set_config('request.jwt.claim.sub','aaaaaaaa-0000-4000-8000-000000000001',true); select public.is_super_admin(); rollback;\"" 2>&1 | grep -E '^(t|f)$' | head -1)" = "t" ] && echo 1 || echo 0)"
q "insert into auth.users(id,email,email_confirmed_at) values ('bbbbbbbb-0000-4000-8000-000000000001','newowner@gmail.com',now())" >/dev/null
r=$(su postgres -c "psql -d $DB -At" <<'EOF' 2>&1
begin; set local role authenticated; select set_config('request.jwt.claim.sub','bbbbbbbb-0000-4000-8000-000000000001',true);
select public.create_workspace('Fresh Start Store'::text, null::text, 'device-after-reset-0001'::text);
reset role; select status from public.subscriptions s join public.organization_members m on m.organization_id=s.organization_id where m.user_id='bbbbbbbb-0000-4000-8000-000000000001'; commit;
EOF
)
ok "a brand-new owner can sign up and gets a normal free trial (trial history was cleared)" "$(echo "$r" | grep -c '^trialing$')"
ok "a new profile was created for the new account" "$([ "$(q "select count(*) from public.profiles where id='bbbbbbbb-0000-4000-8000-000000000001'")" = "1" ] && echo 1 || echo 0)"
ok "counters restarted (a fresh trial claim gets id 1)" "$([ "$(q "select min(id) from public.trial_claims")" = "1" ] && echo 1 || echo 0)"
ok "the report scheduler runs cleanly on the fresh data" "$(su postgres -c "psql -d $DB -At -c \"select public.run_scheduled_reports()\"" 2>&1 | grep -c businesses_checked)"
echo "== RUNNING IT AGAIN IS SAFE"
mk keeper@t.test "ERASE ALL DATA"; out=$(run); ok "second reset (after new data) also completes" "$(echo "$out" | grep -c 'RESET COMPLETE')"
ok "only the kept account remains again" "$([ "$(q "select string_agg(email,',') from auth.users")" = "keeper@t.test" ] && echo 1 || echo 0)"
echo; [ $fails -eq 0 ] && echo "RESULT: ALL RESET CHECKS PASSED" || echo "RESULT: $fails CHECK(S) FAILED"
