-- =====================================================================================================================
-- 9 Nov 2026 security hardening, part 2.
--   1. Trial anti-farming that works even when someone makes a brand-new account (no email confirmation needed).
--   2. Disposable-email signups are refused.
--   3. Sessions can be revoked when a password is reset or an account is suspended.
--   4. The promoter application form can no longer be flooded by spoofing a header.
--   5. Billing: owners can read their own payment history again (missing grant).
-- =====================================================================================================================

-- ---------- 1a. helpers -------------------------------------------------------------------------------------------
create or replace function public.zb_hash(p_value text)
returns text language sql immutable as $$ select encode(sha256(convert_to(coalesce(p_value, ''), 'utf8')), 'hex') $$;

-- One real mailbox, however it is spelled: a+1@gmail.com, a.b@gmail.com and A.B@googlemail.com are one person.
create or replace function public.normalize_email_identity(p_email text)
returns text language plpgsql immutable as $$
declare e text := lower(btrim(coalesce(p_email, ''))); lp text; dom text;
begin
  if position('@' in e) = 0 then return e; end if;
  lp := split_part(e, '@', 1);
  dom := split_part(e, '@', 2);
  lp := split_part(lp, '+', 1);
  if dom in ('gmail.com', 'googlemail.com') then
    dom := 'gmail.com';
    lp := replace(lp, '.', '');
  end if;
  return lp || '@' || dom;
end $$;

create or replace function public.request_header(p_name text)
returns text language plpgsql stable as $$
declare j json;
begin
  begin
    j := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    return null;
  end;
  return nullif(btrim(j ->> lower(p_name)), '');
end $$;

-- ---------- 1b. disposable email domains ------------------------------------------------------------------------
create table if not exists public.blocked_email_domains (domain text primary key);
alter table public.blocked_email_domains enable row level security;
revoke all on public.blocked_email_domains from anon, authenticated;
insert into public.blocked_email_domains (domain) values
 ('mailinator.com'),('guerrillamail.com'),('guerrillamail.net'),('guerrillamail.org'),('guerrillamailblock.com'),('sharklasers.com'),
 ('grr.la'),('10minutemail.com'),('10minutemail.net'),('20minutemail.com'),('tempmail.com'),('temp-mail.org'),('temp-mail.io'),
 ('tempmail.net'),('tempmailo.com'),('tempail.com'),('tempr.email'),('yopmail.com'),('yopmail.net'),('yopmail.fr'),('trashmail.com'),
 ('trashmail.net'),('trashmail.de'),('getnada.com'),('nada.email'),('dispostable.com'),('maildrop.cc'),('throwawaymail.com'),
 ('fakeinbox.com'),('mohmal.com'),('emailondeck.com'),('moakt.com'),('mintemail.com'),('burnermail.io'),('mailnesia.com'),
 ('spamgourmet.com'),('inboxkitten.com'),('discard.email'),('fakemail.net'),('mytemp.email'),('1secmail.com'),('1secmail.net'),
 ('1secmail.org'),('emltmp.com'),('mailcatch.com'),('mailsac.com'),('mail.tm'),('tmpmail.org'),('tmpmail.net'),('tmail.ws'),
 ('dropmail.me'),('harakirimail.com'),('anonbox.net'),('byom.de'),('crazymailing.com'),('dayrep.com'),('einrot.com'),('fleckens.hu'),
 ('gustr.com'),('jourrapide.com'),('rhyta.com'),('superrito.com'),('teleworm.us'),('armyspy.com'),('cuvox.de'),('mailforspam.com'),
 ('spambox.us'),('spam4.me'),('tempinbox.com'),('throwam.com'),('wegwerfmail.de'),('zetmail.com'),('luxusmail.org'),('mailtemp.info')
on conflict do nothing;

create or replace function public.block_disposable_signup()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email is not null
     and exists (select 1 from public.blocked_email_domains where domain = lower(split_part(new.email, '@', 2))) then
    raise exception 'EMAIL_DOMAIN_NOT_ALLOWED: temporary email addresses cannot be used to register';
  end if;
  return new;
end $$;

drop trigger if exists zb_block_disposable_signup on auth.users;
create trigger zb_block_disposable_signup before insert on auth.users
  for each row execute function public.block_disposable_signup();

-- ---------- 1c. trial claims + eligibility ------------------------------------------------------------------------
create table if not exists public.trial_claims (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  organization_id uuid,
  kind text not null check (kind in ('email', 'device', 'ip', 'domain')),
  value_hash text not null,
  claimed_at timestamptz not null default now()
);
create index if not exists trial_claims_lookup on public.trial_claims (kind, value_hash, claimed_at desc);
alter table public.trial_claims enable row level security;
revoke all on public.trial_claims from anon, authenticated;
-- no policies on purpose: only SECURITY DEFINER code and the service role can touch it

-- Backfill: the people who already had a trial cannot get another one under a new email spelling.
insert into public.trial_claims (user_id, organization_id, kind, value_hash, claimed_at)
select g.user_id, g.organization_id, 'email', public.zb_hash(public.normalize_email_identity(u.email)), g.granted_at
from public.trial_grants g join auth.users u on u.id = g.user_id
where u.email is not null
on conflict do nothing;

-- Returns NULL when this person may have a free trial, otherwise the reason it is refused (kept for support).
create or replace function public.trial_eligibility(p_user uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_email text;
  v_norm text;
  v_domain text;
  v_device text := nullif(btrim(coalesce(current_setting('zb.device_id', true), '')), '');
  v_ip text := coalesce(public.request_header('cf-connecting-ip'), public.request_header('x-real-ip'));
  free_providers constant text[] := array['gmail.com','yahoo.com','yahoo.co.uk','ymail.com','outlook.com','hotmail.com','live.com',
    'msn.com','icloud.com','me.com','proton.me','protonmail.com','aol.com','zoho.com','gmx.com','mail.com'];
begin
  select email into v_email from auth.users where id = p_user;
  if v_email is null then return 'no_email'; end if;
  v_norm := public.normalize_email_identity(v_email);
  v_domain := split_part(v_norm, '@', 2);

  -- The real app always sends a device token. A caller that talks to the API directly gets no free trial.
  if v_device is null or char_length(v_device) < 16 then return 'no_device'; end if;

  if exists (select 1 from public.trial_claims where kind = 'email' and value_hash = public.zb_hash(v_norm) and user_id <> p_user)
    then return 'email_alias'; end if;

  if exists (select 1 from public.trial_claims where kind = 'device' and value_hash = public.zb_hash(v_device)
             and user_id <> p_user and claimed_at > now() - interval '365 days')
    then return 'device_reuse'; end if;

  -- Burst from one address (CGNAT-friendly: 5 different people in a day, not 2).
  if v_ip is not null and (select count(distinct user_id) from public.trial_claims
        where kind = 'ip' and value_hash = public.zb_hash(v_ip) and user_id <> p_user and claimed_at > now() - interval '24 hours') >= 5
    then return 'ip_burst'; end if;

  -- Catch-all farming: many "different" people on one private domain someone controls.
  if not (v_domain = any (free_providers)) and (select count(distinct user_id) from public.trial_claims
        where kind = 'domain' and value_hash = public.zb_hash(v_domain) and user_id <> p_user) >= 3
    then return 'domain_farm'; end if;

  return null;
end $$;
revoke all on function public.trial_eligibility(uuid) from public, anon, authenticated;

create or replace function public.record_trial_claims(p_user uuid, p_org uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_norm text := public.normalize_email_identity((select email from auth.users where id = p_user));
  v_device text := nullif(btrim(coalesce(current_setting('zb.device_id', true), '')), '');
  v_ip text := coalesce(public.request_header('cf-connecting-ip'), public.request_header('x-real-ip'));
  v_domain text := split_part(v_norm, '@', 2);
begin
  insert into public.trial_claims (user_id, organization_id, kind, value_hash) values (p_user, p_org, 'email', public.zb_hash(v_norm));
  if v_device is not null then
    insert into public.trial_claims (user_id, organization_id, kind, value_hash) values (p_user, p_org, 'device', public.zb_hash(v_device));
  end if;
  if v_ip is not null then
    insert into public.trial_claims (user_id, organization_id, kind, value_hash) values (p_user, p_org, 'ip', public.zb_hash(v_ip));
  end if;
  if v_domain <> '' then
    insert into public.trial_claims (user_id, organization_id, kind, value_hash) values (p_user, p_org, 'domain', public.zb_hash(v_domain));
  end if;
end $$;
revoke all on function public.record_trial_claims(uuid, uuid) from public, anon, authenticated;

create or replace function public.create_default_subscription()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  free_plan_id uuid;
  new_subscription_id uuid;
  trial_length integer := public.signup_trial_days();
  granted boolean := true;
  deny_reason text := null;
begin
  select id into free_plan_id from public.plans where code = 'free' and active limit 1;
  if free_plan_id is null then return new; end if; -- plans not seeded yet in this environment

  if auth.uid() is not null then
    if exists (select 1 from public.trial_grants where user_id = auth.uid()) then
      deny_reason := 'already_used';
    else
      deny_reason := public.trial_eligibility(auth.uid());
    end if;
    if deny_reason is null then
      insert into public.trial_grants (user_id, organization_id) values (auth.uid(), new.id) on conflict (user_id) do nothing;
      granted := found;
      if granted then perform public.record_trial_claims(auth.uid(), new.id); else deny_reason := 'already_used'; end if;
    else
      granted := false;
    end if;
  end if;

  if granted then
    insert into public.subscriptions (organization_id, plan_id, status, trial_start, trial_end, current_period_start, current_period_end)
      values (new.id, free_plan_id, 'trialing', now(), now() + make_interval(days => trial_length), now(), now() + make_interval(days => trial_length))
      returning id into new_subscription_id;
    insert into public.subscription_events (subscription_id, organization_id, event_type, to_plan_id, actor_id, note)
      values (new_subscription_id, new.id, 'trial_started', free_plan_id, auth.uid(), trial_length || '-day free trial started at signup');
  else
    insert into public.subscriptions (organization_id, plan_id, status, current_period_start, current_period_end)
      values (new.id, free_plan_id, 'expired', now(), now())
      returning id into new_subscription_id;
    insert into public.subscription_events (subscription_id, organization_id, event_type, to_plan_id, actor_id, note)
      values (new_subscription_id, new.id, 'created', free_plan_id, auth.uid(), 'No free trial (' || coalesce(deny_reason, 'not_eligible') || '); plan must be paid');
  end if;
  return new;
end $$;

-- A genuine customer who was refused by mistake (shared Wi-Fi, shared device) can be given their trial by a super admin.
create or replace function public.admin_grant_trial(p_organization uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  trial_length integer := public.signup_trial_days();
  sub record;
  owner_id uuid;
begin
  if not public.is_super_admin() then
    raise exception using message = '{"code":"ADMIN_ACCESS_DENIED","message":"Super admin access required"}';
  end if;
  select * into sub from public.subscriptions where organization_id = p_organization for update;
  if sub is null then raise exception 'NOT_FOUND: organization has no subscription'; end if;
  if sub.status not in ('expired', 'locked') then raise exception 'INVALID_STATE: only a business without an active plan can be given a trial'; end if;
  select user_id into owner_id from public.organization_members where organization_id = p_organization and role = 'owner' order by created_at limit 1;
  update public.subscriptions set status = 'trialing', trial_start = now(), trial_end = now() + make_interval(days => trial_length),
         current_period_start = now(), current_period_end = now() + make_interval(days => trial_length), updated_at = now()
   where id = sub.id;
  if owner_id is not null then
    insert into public.trial_grants (user_id, organization_id) values (owner_id, p_organization) on conflict (user_id) do nothing;
  end if;
  insert into public.subscription_events (subscription_id, organization_id, event_type, to_plan_id, actor_id, note)
    values (sub.id, p_organization, 'trial_started', sub.plan_id, auth.uid(), 'Trial granted by super admin' || coalesce(': ' || p_note, ''));
end $$;
revoke all on function public.admin_grant_trial(uuid, text) from public, anon;
grant execute on function public.admin_grant_trial(uuid, text) to authenticated;

-- ---------- 1d. workspace creation carries the device token (the trial trigger reads it) ----------
drop function if exists public.create_workspace(text, text);
CREATE OR REPLACE FUNCTION public.create_workspace(workspace_name text, referral_code text DEFAULT NULL::text, device_id text DEFAULT NULL::text)
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
  -- Read by the trial trigger for this transaction only; never stored on the business itself.
  perform set_config('zb.device_id', coalesce(left(btrim(create_workspace.device_id), 64), ''), true);
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
revoke all on function public.create_workspace(text, text, text) from public, anon;
grant execute on function public.create_workspace(text, text, text) to authenticated, service_role;

-- ---------- 3. session revocation ----------
create or replace function public.revoke_user_sessions(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- Signing out every device: a reset password or a suspension must not leave old sessions alive.
  if to_regclass('auth.sessions') is not null then
    execute 'delete from auth.sessions where user_id = $1' using p_user;
  end if;
  if to_regclass('auth.refresh_tokens') is not null then
    execute 'delete from auth.refresh_tokens where user_id::text = $1::text' using p_user;
  end if;
end $$;
revoke all on function public.revoke_user_sessions(uuid) from public, anon, authenticated;
grant execute on function public.revoke_user_sessions(uuid) to service_role;

-- ---------- 4. promoter application: trusted IP, and only reachable through the CAPTCHA-checked edge function ----------
drop function if exists public.submit_promoter_application(text, text, text, text, text, text, text, boolean);
CREATE OR REPLACE FUNCTION public.submit_promoter_application(applicant_name text, applicant_email text, applicant_phone text DEFAULT NULL::text, applicant_location text DEFAULT NULL::text, applicant_social text DEFAULT NULL::text, applicant_experience text DEFAULT NULL::text, applicant_reason text DEFAULT NULL::text, terms_agreed boolean DEFAULT false, client_ip_override text DEFAULT NULL::text)
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
  -- Never trust X-Forwarded-For: its first entry is whatever the caller typed. The edge function passes the address
  -- Cloudflare saw; direct callers fall back to Cloudflare's own header.
  client_ip := coalesce(
    case when auth.role() = 'service_role' then nullif(btrim(client_ip_override), '') end,
    nullif(btrim(headers_json ->> 'cf-connecting-ip'), ''),
    nullif(btrim(headers_json ->> 'x-real-ip'), ''),
    'unknown');
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
revoke all on function public.submit_promoter_application(text, text, text, text, text, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.submit_promoter_application(text, text, text, text, text, text, text, boolean, text) to service_role;

-- ---------- 5. billing: owners could not read their own payment history ----------
grant execute on function public.is_org_owner(uuid) to authenticated;
notify pgrst, 'reload schema';
