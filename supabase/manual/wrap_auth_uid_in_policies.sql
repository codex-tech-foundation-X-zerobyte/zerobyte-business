-- OPTIONAL speed-up. Run by hand in the Supabase SQL editor; it is deliberately NOT in migrations/.
--
-- Why: a row-level-security policy that says  auth.uid() = user_id  calls auth.uid() once per row it checks.
-- Written as  (select auth.uid()) = user_id  Postgres evaluates it once per query instead. The meaning is the same;
-- it only gets faster as your tables grow. This rewrites every policy in the public schema that uses a bare
-- auth.uid() (about 28 of them in this project) and leaves any policy that already wraps it alone.
--
-- How to use:
--   1. Run it as it is. dry_run is true, so it only PRINTS the statements it would run (see the "Messages" tab).
--   2. Read them. If they look right, change  dry_run boolean := true  to  false  and run it again.
--   3. Check the app still loads data for an owner, a worker and an admin.
-- To undo a policy, re-run the migration that created it.

do $$
declare
  dry_run boolean := true;
  p record;
  new_using text;
  new_check text;
  stmt text;
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') ~ 'auth\.uid\(\)' or coalesce(with_check, '') ~ 'auth\.uid\(\)')
      and not (coalesce(qual, '') ~* 'select\s+auth\.uid\(\)' or coalesce(with_check, '') ~* 'select\s+auth\.uid\(\)')
  loop
    new_using := case when p.qual is null then null
      else regexp_replace(p.qual, 'auth\.uid\(\)', '(select auth.uid())', 'g') end;
    new_check := case when p.with_check is null then null
      else regexp_replace(p.with_check, 'auth\.uid\(\)', '(select auth.uid())', 'g') end;
    stmt := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename)
      || case when new_using is not null then format(' using (%s)', new_using) else '' end
      || case when new_check is not null then format(' with check (%s)', new_check) else '' end;
    if dry_run then
      raise notice '%', stmt;
    else
      execute stmt;
    end if;
  end loop;
end $$;
