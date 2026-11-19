-- Promoter program: access without email, referral management, abuse guards
--
-- * WhatsApp number is now required when applying (admins deliver access by WhatsApp: there is no email sender).
-- * link_promoter_account() no longer binds a promoter to whichever account registers their email first.
--   Binding happens when an admin provisions access (edge function provision-promoter-access), so an
--   attacker cannot pre-register an applicant's email and take over the promoter record and commissions.
-- * Referral lifecycle can finally be managed: admin_list_referrals / admin_set_referral_status.
-- * Promoters get their own referral list (business names masked) and admins see WhatsApp / account status.
-- * create_workspace ignores a promoter's code when the new workspace is created by that same promoter.
-- * BUG FIX: create_workspace(name, referral_code) failed with 'column reference "referral_code" is ambiguous'
--   whenever a code was supplied (parameter vs. column of the same name), so no referral signup could ever
--   complete. The names are now qualified.

CREATE OR REPLACE FUNCTION public.submit_promoter_application(applicant_name text, applicant_email text, applicant_phone text DEFAULT NULL::text, applicant_location text DEFAULT NULL::text, applicant_social text DEFAULT NULL::text, applicant_experience text DEFAULT NULL::text, applicant_reason text DEFAULT NULL::text, terms_agreed boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  new_id uuid;
  headers_json json;
  client_ip text;
  client_key text;
begin
  -- Field validation (length caps stop storage abuse)
  if nullif(trim(applicant_name), '') is null then raise exception 'VALIDATION_ERROR: name is required'; end if;
  if applicant_phone is null or regexp_replace(applicant_phone, '[^0-9]', '', 'g') !~ '^[0-9]{10,15}$' then
    raise exception 'VALIDATION_ERROR: a valid WhatsApp number is required';
  end if;
  if char_length(applicant_name) > 200 then raise exception 'VALIDATION_ERROR: name is too long'; end if;
  if applicant_email is null or char_length(applicant_email) > 254
     or applicant_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'VALIDATION_ERROR: a valid email is required';
  end if;
  if nullif(trim(coalesce(applicant_reason, '')), '') is null then raise exception 'VALIDATION_ERROR: tell us why you want to join'; end if;
  if char_length(applicant_reason) > 2000 then raise exception 'VALIDATION_ERROR: reason is too long'; end if;
  if char_length(coalesce(applicant_phone, '')) > 40 then raise exception 'VALIDATION_ERROR: phone is too long'; end if;
  if char_length(coalesce(applicant_location, '')) > 120 then raise exception 'VALIDATION_ERROR: location is too long'; end if;
  if char_length(coalesce(applicant_social, '')) > 300 then raise exception 'VALIDATION_ERROR: social profile is too long'; end if;
  if char_length(coalesce(applicant_experience, '')) > 2000 then raise exception 'VALIDATION_ERROR: experience is too long'; end if;
  if not terms_agreed then raise exception 'VALIDATION_ERROR: you must agree to the promoter terms'; end if;

  -- Throttle: 5 attempts / hour per client, 100 / hour overall (circuit breaker)
  begin
    headers_json := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    headers_json := null;
  end;
  client_ip := split_part(coalesce(headers_json ->> 'x-forwarded-for', 'unknown'), ',', 1);
  client_key := md5(trim(client_ip));

  if (select count(*) from public.promoter_application_attempts
        where client_hash = client_key and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'RATE_LIMITED: too many applications from this connection, try again later';
  end if;
  if (select count(*) from public.promoter_application_attempts
        where created_at > now() - interval '1 hour') >= 100 then
    raise exception 'RATE_LIMITED: applications are temporarily unavailable, try again later';
  end if;
  insert into public.promoter_application_attempts (client_hash) values (client_key);
  delete from public.promoter_application_attempts where created_at < now() - interval '2 days';

  if exists (select 1 from public.promoter_applications
              where lower(email) = lower(applicant_email) and status in ('applied', 'under_review')) then
    raise exception 'DUPLICATE_APPLICATION: an application from this email is already pending review';
  end if;

  insert into public.promoter_applications
    (full_name, email, phone, location, social_profile, marketing_experience, reason, agreed_to_terms)
  values
    (trim(applicant_name), lower(trim(applicant_email)), trim(applicant_phone), trim(applicant_location),
     trim(applicant_social), trim(applicant_experience), trim(applicant_reason), true)
  returning id into new_id;
  return new_id;
end;
$function$;

-- 3. No more claim-by-email
create or replace function public.link_promoter_account()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.promoters where user_id = auth.uid() limit 1;
$$;

-- 4. Admin list: WhatsApp number (from the application) and whether the promoter can sign in yet
drop function if exists public.admin_list_promoters();
create or replace function public.admin_list_promoters()
returns table(promoter_id uuid, full_name text, email text, whatsapp text, referral_code text, status text,
              created_at timestamptz, total_referrals bigint, has_account boolean)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name, p.email, a.phone, p.referral_code, p.status, p.created_at, count(r.id), p.user_id is not null
  from public.promoters p
  left join public.promoter_applications a on a.id = p.application_id
  left join public.referrals r on r.promoter_id = p.id
  where public.is_platform_admin()
  group by p.id, a.phone
  order by p.created_at desc;
$$;

-- 5. Referral management (admin)
create or replace function public.admin_list_referrals()
returns table(referral_id uuid, promoter_id uuid, promoter_name text, referral_code text, business_name text,
              status text, signed_up_at timestamptz, qualified_at timestamptz, notes text)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.promoter_id, p.full_name, r.referral_code, o.name, r.status, r.signed_up_at, r.qualified_at, r.notes
  from public.referrals r
  join public.promoters p on p.id = r.promoter_id
  left join public.organizations o on o.id = r.organization_id
  where public.is_platform_admin()
  order by r.signed_up_at desc
  limit 500;
$$;

create or replace function public.admin_set_referral_status(target_referral uuid, new_status text, note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then raise exception 'UNAUTHORIZED: platform admin access required'; end if;
  if new_status not in ('registered', 'verified', 'active', 'qualified', 'commissionable', 'paid', 'expired') then
    raise exception 'VALIDATION_ERROR: unrecognized referral status';
  end if;
  if char_length(coalesce(note, '')) > 1000 then raise exception 'VALIDATION_ERROR: note is too long'; end if;
  update public.referrals
     set status = new_status,
         qualified_at = case when new_status in ('qualified', 'commissionable', 'paid') then coalesce(qualified_at, now()) else qualified_at end,
         notes = coalesce(nullif(trim(note), ''), notes)
   where id = target_referral;
  if not found then raise exception 'REFERRAL_NOT_FOUND'; end if;
  insert into public.admin_audit_logs (actor_id, action, target_type, target_id, metadata)
  values (auth.uid(), 'referral.status_changed', 'referral', target_referral, jsonb_build_object('status', new_status));
end;
$$;

-- 6. What a promoter may see of their own referrals: a masked business label, status and dates only.
create or replace function public.get_promoter_referrals()
returns table(business_label text, status text, signed_up_at timestamptz, qualified_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select case when o.name is null then 'A business'
              else left(o.name, 2) || repeat('•', least(greatest(char_length(o.name) - 2, 0), 6)) end,
         r.status, r.signed_up_at, r.qualified_at
  from public.referrals r
  join public.promoters p on p.id = r.promoter_id
  left join public.organizations o on o.id = r.organization_id
  where p.user_id = auth.uid()
  order by r.signed_up_at desc
  limit 200;
$$;

revoke all on function public.link_promoter_account() from public, anon;
revoke all on function public.admin_list_promoters() from public, anon;
revoke all on function public.admin_list_referrals() from public, anon;
revoke all on function public.admin_set_referral_status(uuid, text, text) from public, anon;
revoke all on function public.get_promoter_referrals() from public, anon;
grant execute on function public.link_promoter_account() to authenticated;
grant execute on function public.admin_list_promoters() to authenticated;
grant execute on function public.admin_list_referrals() to authenticated;
grant execute on function public.admin_set_referral_status(uuid, text, text) to authenticated;
grant execute on function public.get_promoter_referrals() to authenticated;

-- 7. Self-referral guard
CREATE OR REPLACE FUNCTION public.create_workspace(workspace_name text, referral_code text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      where promoters.referral_code = upper(trim(create_workspace.referral_code)) and promoters.status = 'active';
    -- An unrecognized or inactive code is silently ignored rather than
    -- blocking signup -- a mistyped or stale referral link must never be
    -- able to stop someone from creating their workspace.
    if matched_promoter_id is not null
       and not exists (select 1 from public.promoters own where own.id = matched_promoter_id and own.user_id = auth.uid()) then
      insert into public.referrals (promoter_id, organization_id, referral_code, status)
      values (matched_promoter_id, new_org_id, upper(trim(create_workspace.referral_code)), 'registered');
    end if;
  end if;

  return new_org_id;
end;
$function$;
