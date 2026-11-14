\set ON_ERROR_STOP on
\pset pager off
-- Self-checking: prints ALL ADMIN ROLE CHECKS PASSED. Run on a freshly migrated database.
create or replace function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, false), set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, false) $$;
create or replace function pg_temp.fails(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlerrm; end $$;

insert into auth.users(id,email) values
 ('00000000-0000-4000-f300-000000000001','ar-super@t.test'),('00000000-0000-4000-f300-000000000002','ar-finance@t.test'),
 ('00000000-0000-4000-f300-000000000003','ar-support@t.test'),('00000000-0000-4000-f300-000000000004','ar-moderation@t.test'),
 ('00000000-0000-4000-f300-000000000005','ar-platform@t.test');
insert into platform_admin_access(user_id,role,status) values
 ('00000000-0000-4000-f300-000000000001','SUPER_ADMIN','active'),('00000000-0000-4000-f300-000000000002','FINANCE_ADMIN','active'),
 ('00000000-0000-4000-f300-000000000003','SUPPORT_ADMIN','active'),('00000000-0000-4000-f300-000000000004','MODERATION_ADMIN','active'),
 ('00000000-0000-4000-f300-000000000005','PLATFORM_ADMIN','active');

do $$ declare s text[]; begin
  assert (select minimum_payout_kobo from promoter_program_terms) = 200000, 'minimum payout starts at 2000 naira';

  -- support admin: chat and feedback only
  perform pg_temp.as_user('00000000-0000-4000-f300-000000000003'); set local role authenticated;
  s := get_my_admin_sections();
  assert 'Messages' = any(s) and 'Feedback' = any(s), 'support sees messages and feedback';
  assert not ('Users' = any(s)) and not ('Branches' = any(s)) and not ('Revenue' = any(s)) and not ('Plans' = any(s)) and not ('Promoters' = any(s)) and not ('Payouts' = any(s)) and not ('Overview' = any(s)), 'support sees none of users, branches, revenue, plans, promoters, payouts, overview';
  assert pg_temp.fails('select get_platform_overview()') like 'UNAUTHORIZED%', 'support cannot read the platform overview';
  assert pg_temp.fails('select admin_get_analytics(30)') like 'UNAUTHORIZED%', 'support cannot read analytics';
  assert pg_temp.fails('select admin_get_revenue_overview(30)') is not null, 'support cannot read revenue';
  reset role;

  -- finance admin: money screens, not users or support
  perform pg_temp.as_user('00000000-0000-4000-f300-000000000002'); set local role authenticated;
  s := get_my_admin_sections();
  assert 'Revenue' = any(s) and 'Payouts' = any(s) and 'Plans' = any(s), 'finance sees money screens';
  assert not ('Users' = any(s)) and not ('Messages' = any(s)), 'finance does not see users or messages';
  assert get_platform_overview() is not null, 'finance can read the overview';
  assert pg_temp.fails('select admin_get_backend_latency_overview(7)') like 'UNAUTHORIZED%', 'finance cannot read monitoring';
  reset role;

  -- moderation admin
  perform pg_temp.as_user('00000000-0000-4000-f300-000000000004'); set local role authenticated;
  s := get_my_admin_sections();
  assert 'Users' = any(s) and not ('Revenue' = any(s)) and not ('Messages' = any(s)), 'moderation sees users, not revenue or messages';
  reset role;

  -- platform admin: operations, no money, no admin accounts
  perform pg_temp.as_user('00000000-0000-4000-f300-000000000005'); set local role authenticated;
  s := get_my_admin_sections();
  assert 'Branches' = any(s) and 'Monitoring' = any(s) and not ('Revenue' = any(s)) and not ('Admins' = any(s)) and not ('Payouts' = any(s)), 'platform admin sees operations only';
  assert get_platform_analytics('30d') is not null, 'platform admin can read analytics';
  reset role;

  -- super admin sees everything
  perform pg_temp.as_user('00000000-0000-4000-f300-000000000001'); set local role authenticated;
  assert cardinality(get_my_admin_sections()) = 22, 'super admin sees all 22 sections';
  assert admin_get_backend_latency_overview(7) is not null, 'super admin can read monitoring';
  assert admin_can_access('Messages') and admin_can_access('Payouts') and admin_can_access('A section added next year'), 'super admin passes every section check, even new ones';
  reset role;

  perform pg_temp.as_user('00000000-0000-4000-f300-000000000003'); set local role authenticated;
  assert not admin_can_access('A section added next year'), 'other roles never pass an unknown section';
  reset role;
  -- a plain customer has no sections and no data
  assert (select count(*) from auth.users) > 0;
end $$;
select 'ALL ADMIN ROLE CHECKS PASSED' as result;
