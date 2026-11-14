-- =====================================================================================================================
-- STEP 2 OF 2: ERASE EVERYTHING EXCEPT THE SUPER ADMIN.            *** THIS CANNOT BE UNDONE ***
--
-- Before you run this:
--   1. You took a backup (see docs/RESET.md) and downloaded it.
--   2. You ran 1_preview.sql and the list looked right.
--   3. You are in the RIGHT Supabase project (check the project name at the top-left of the dashboard).
--
-- What it does, in one all-or-nothing transaction (if anything looks wrong, NOTHING is changed):
--   * keeps the super admin you name (their login, profile, admin role and authenticator app),
--   * keeps shared platform settings (plans, prices, limits, security switches, blocked email domains, promoter terms,
--     release notes, roadmap),
--   * erases every other account and every other row in the app, and resets the counters,
--   * then checks its own result and cancels itself if the checks fail.
-- Files (business logos) are erased afterwards with scripts/reset-storage.mjs: SQL is not allowed to delete them.
--
-- Fill in the TWO values below, then run the whole script.
-- =====================================================================================================================
do $reset$
declare
  keep_email constant text := 'CHANGE-ME@example.com';   -- the super admin to keep
  confirm    constant text := '';                         -- type exactly:  ERASE ALL DATA
  keep_tables constant text[] := array['plans','plan_limits','plan_price_versions','security_settings','blocked_email_domains',
                                       'promoter_program_terms','app_version_announcements','roadmap_items'];
  trim_tables constant text[] := array['platform_admin_access','profiles'];

  keeper uuid;
  wipe_tables text[];
  all_kept regclass[];
  before_counts jsonb := '{}'::jsonb;
  t text;
  n bigint;
  mfa_before bigint := 0;
  mfa_after bigint := 0;
  fk record;
begin
  -- ---- 1. refuse to run unless it is clearly intended --------------------------------------------------------------
  if confirm <> 'ERASE ALL DATA' then
    raise exception 'NOT CONFIRMED: type exactly ERASE ALL DATA in the confirm line. Nothing was changed.';
  end if;
  select u.id into keeper
    from auth.users u
    join public.platform_admin_access a on a.user_id = u.id and a.status = 'active' and a.role = 'SUPER_ADMIN'
   where lower(u.email) = lower(keep_email);
  if keeper is null then
    raise exception 'KEEP ACCOUNT NOT FOUND: % is not an active super admin. Nothing was changed.', keep_email;
  end if;

  -- ---- 2. work out what to erase: every table in public that is not a shared-settings or trimmed table --------------
  select array_agg(tablename order by tablename) into wipe_tables
    from pg_tables
   where schemaname = 'public' and tablename <> all (keep_tables || trim_tables);
  select array_agg(format('public.%I', x)::regclass) into all_kept from unnest(keep_tables || trim_tables) x;

  foreach t in array keep_tables loop
    execute format('select count(*) from public.%I', t) into n;
    before_counts := before_counts || jsonb_build_object(t, n);
  end loop;
  if to_regclass('auth.mfa_factors') is not null then
    execute 'select count(*) from auth.mfa_factors where user_id = $1' into mfa_before using keeper;
  end if;

  -- ---- 3. shared tables remember WHICH admin created a row. Hand those to the kept admin, otherwise deleting the other
  --         admins would be blocked (or would take the shared rows with them).
  for fk in
    select c.conrelid::regclass as tbl, a.attname as col
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f' and c.confrelid = 'auth.users'::regclass and cardinality(c.conkey) = 1 and c.conrelid = any (all_kept)
       -- Only "created by / updated by / owner" links (they BLOCK deleting that account). Links that say whose row this is
       -- (profiles.id, platform_admin_access.user_id) are removed together with the account and must never be rewritten.
       and c.confdeltype in ('a', 'r')
  loop
    execute format('update %s set %I = %L where %I is not null and %I <> %L', fk.tbl, fk.col, keeper, fk.col, fk.col, keeper);
  end loop;

  -- ---- 4. erase the app's data (one statement, so a foreign-key surprise cancels everything instead of half-erasing) ---
  execute 'truncate table ' || (select string_agg(format('public.%I', x), ', ') from unnest(wipe_tables) x) || ' restart identity';

  -- ---- 5. keep only the super admin's own rows in the trimmed tables, then delete every other account -------------------
  delete from public.platform_admin_access where user_id <> keeper;
  delete from public.profiles where id <> keeper;
  -- Files point at their uploader; let go of that link so deleting accounts is never blocked (the files themselves are
  -- erased with the storage script). Harmless if the columns do not exist in your version.
  begin update storage.objects set owner = null where owner is not null; exception when others then null; end;
  begin update storage.objects set owner_id = null where owner_id is not null; exception when others then null; end;
  delete from auth.users where id <> keeper;      -- also removes their identities, sessions and authenticators
  -- Sign-in history and short-lived tokens. Skipped quietly where your project does not allow or have them.
  begin delete from auth.audit_log_entries; exception when others then null; end;
  begin delete from auth.flow_state; exception when others then null; end;

  -- ---- 6. check the result; if ANYTHING is off, cancel it all --------------------------------------------------------
  select count(*) into n from auth.users;
  if n <> 1 then raise exception 'CHECK FAILED: % accounts remain, expected 1. Everything was cancelled.', n; end if;
  if not exists (select 1 from auth.users where id = keeper) then raise exception 'CHECK FAILED: the kept account is gone.'; end if;
  select count(*) into n from public.platform_admin_access;
  if n <> 1 or not exists (select 1 from public.platform_admin_access where user_id = keeper and role = 'SUPER_ADMIN' and status = 'active') then
    raise exception 'CHECK FAILED: the super admin role is not exactly as expected.';
  end if;
  if exists (select 1 from public.profiles where id <> keeper) then raise exception 'CHECK FAILED: another profile remains.'; end if;
  foreach t in array keep_tables loop
    execute format('select count(*) from public.%I', t) into n;
    if n <> (before_counts ->> t)::bigint then
      raise exception 'CHECK FAILED: shared table % changed from % to % rows.', t, before_counts ->> t, n;
    end if;
  end loop;
  foreach t in array wipe_tables loop
    execute format('select count(*) from public.%I', t) into n;
    if n <> 0 then raise exception 'CHECK FAILED: table % still has % rows.', t, n; end if;
  end loop;
  if to_regclass('auth.mfa_factors') is not null then
    execute 'select count(*) from auth.mfa_factors where user_id = $1' into mfa_after using keeper;
    if mfa_after <> mfa_before then raise exception 'CHECK FAILED: the super admin''s authenticator changed.'; end if;
  end if;

  raise notice 'RESET DONE. Kept: %. Erased % tables. Next: run scripts/reset-storage.mjs to erase the files.', keep_email, cardinality(wipe_tables);
end
$reset$;

-- If you can read this line in the results, the reset finished and passed its own checks.
select 'RESET COMPLETE' as result, (select count(*) from auth.users) as accounts_remaining,
       (select email from auth.users limit 1) as kept_account;
