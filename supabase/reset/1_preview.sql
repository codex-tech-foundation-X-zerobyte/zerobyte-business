-- =====================================================================================================================
-- STEP 1 OF 2: PREVIEW (changes nothing, it only reads).
--
-- Shows exactly what the reset in 2_wipe.sql would do: which account survives, which tables are kept or erased, and how
-- many rows each holds. Run it in the Supabase SQL Editor and read the result before going any further.
--
-- Change ONLY the email on the next line to the super admin you want to keep.
-- =====================================================================================================================
with params as (select 'CHANGE-ME@example.com'::text as keep_email),
keeper as (
  select u.id, u.email,
         (select count(*) from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified') as authenticators
    from auth.users u
    join public.platform_admin_access a on a.user_id = u.id and a.status = 'active' and a.role = 'SUPER_ADMIN'
    join params p on lower(u.email) = lower(p.keep_email)
),
shared_tables as (select unnest(array['plans','plan_limits','plan_price_versions','security_settings','blocked_email_domains',
                                      'promoter_program_terms','app_version_announcements','roadmap_items']) as t),
trimmed_tables as (select unnest(array['platform_admin_access','profiles']) as t),
tables as (
  select p.tablename as t,
         case when p.tablename in (select t from shared_tables) then 'KEEP (shared platform settings)'
              when p.tablename in (select t from trimmed_tables) then 'KEEP ONLY THE SUPER ADMIN''S ROW'
              else 'ERASE' end as action
    from pg_tables p where p.schemaname = 'public'
)
select '1. ACCOUNT THAT SURVIVES' as step,
       coalesce((select email from keeper), 'NOT FOUND: this email is not an active super admin. Fix the email before going on.') as what,
       coalesce((select 'super admin, ' || authenticators || ' authenticator(s) kept' from keeper), '') as detail,
       (select count(*) from keeper) as "rows"
union all
select '2. SIGN-INS ERASED', 'every other account (owners, workers, promoters, other admins)', '',
       (select count(*) from auth.users where id not in (select id from keeper))
union all
select '3. ' || action, t, '',
       (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', t), false, true, '')))[1]::text::bigint
  from tables
union all
select '4. FILES (erased by the storage script, not by SQL)', 'storage objects (business logos)', '',
       (select count(*) from storage.objects)
order by 1, 2;
