-- Adds optional referral-code capture to signup, completing the promoter
-- referral loop this repo's earlier promoter-program migration
-- (20260926091000_promoter_program.sql) set up the review/approval side
-- of. A new organization created with a valid, active promoter's referral
-- code gets a `referrals` row at status 'registered' -- qualification to
-- 'commissionable' still only happens once a real paid subscription
-- exists, which is out of scope until the payment provider is connected.
--
-- The `referral_code` parameter is appended with a default, so the
-- existing single-argument call site (WorkspaceSetup calling
-- create_workspace(workspace_name)) keeps working unchanged.
create or replace function public.create_workspace(workspace_name text, referral_code text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org_id uuid;
  workspace_slug text;
  matched_promoter_id uuid;
begin
  if auth.uid() is null then
    raise exception using message = '{"code":"AUTH_REQUIRED","message":"You must be signed in"}';
  end if;
  if exists (select 1 from public.employee_profiles where user_id = auth.uid()) then
    raise exception using message = '{"code":"WORKER_ACCESS_DENIED","message":"Worker accounts cannot create organizations"}';
  end if;
  if length(trim(workspace_name)) < 2 then
    raise exception using message = '{"code":"VALIDATION_ERROR","message":"Business name must be at least 2 characters"}';
  end if;
  workspace_slug := regexp_replace(lower(trim(workspace_name)), '[^a-z0-9]+', '-', 'g')
    || '-' || substr(replace(auth.uid()::text, '-', ''), 1, 8);
  insert into public.organizations (name, slug)
  values (trim(workspace_name), workspace_slug)
  returning id into new_org_id;
  insert into public.organization_members (organization_id, user_id, role)
  values (new_org_id, auth.uid(), 'owner');
  insert into public.entitlements (organization_id, plan, features)
  values (new_org_id, 'starter', '{"inventory":true,"sales":true,"receipts":true,"invoices":true,"expenses":true,"reports":true}'::jsonb);

  if referral_code is not null and trim(referral_code) <> '' then
    select id into matched_promoter_id from public.promoters
      where referral_code = upper(trim(referral_code)) and status = 'active';
    -- An unrecognized or inactive code is silently ignored rather than
    -- blocking signup -- a mistyped or stale referral link must never be
    -- able to stop someone from creating their workspace.
    if matched_promoter_id is not null then
      insert into public.referrals (promoter_id, organization_id, referral_code, status)
      values (matched_promoter_id, new_org_id, upper(trim(referral_code)), 'registered');
    end if;
  end if;

  return new_org_id;
end;
$$;

grant execute on function public.create_workspace(text, text) to authenticated;
revoke all on function public.create_workspace(text, text) from public, anon;
