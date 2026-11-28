-- Security hardening (audit follow-up)
--
-- 1. platform_admin_access: any active admin (even SUPPORT) could INSERT/UPDATE
--    rows directly through PostgREST and promote themselves to SUPER_ADMIN.
--    Direct writes are removed; changes go through the role-checked
--    SECURITY DEFINER RPCs from 20260928090000_admin_roles.sql.
-- 2. Financial/admin tables were writable/readable by every admin role,
--    bypassing the "finance only" rule enforced in the RPC layer. Policies now
--    use can_view_financial_admin_data() (SUPER_ADMIN + FINANCE_ADMIN).
-- 3. employee_profiles: managers had full table write access (salary, user_id,
--    employment_status). The app only reads this table; all writes run in
--    SECURITY DEFINER functions or service-role edge functions.
-- 4. Helper functions were executable by anonymous visitors.
-- 5. Public promoter form had no per-field caps or abuse throttling.

-- ---------------------------------------------------------------------------
-- 1. platform_admin_access
-- ---------------------------------------------------------------------------
drop policy if exists "platform admins can read their access rows" on public.platform_admin_access;
drop policy if exists "platform admins can insert access rows" on public.platform_admin_access;
drop policy if exists "platform admins can update access rows" on public.platform_admin_access;
drop policy if exists platform_admin_access_read on public.platform_admin_access;

create policy platform_admin_access_read on public.platform_admin_access
  for select using (user_id = auth.uid() or public.is_super_admin());

revoke insert, update, delete on public.platform_admin_access from authenticated, anon;

-- ---------------------------------------------------------------------------
-- 2. Financial / plan tables
-- ---------------------------------------------------------------------------
drop policy if exists plans_admin_write on public.plans;
create policy plans_admin_write on public.plans
  for all using (public.can_view_financial_admin_data())
  with check (public.can_view_financial_admin_data());

drop policy if exists plan_prices_admin_write on public.plan_price_versions;
create policy plan_prices_admin_write on public.plan_price_versions
  for all using (public.can_view_financial_admin_data())
  with check (public.can_view_financial_admin_data());

drop policy if exists plan_limits_admin_write on public.plan_limits;
create policy plan_limits_admin_write on public.plan_limits
  for all using (public.can_view_financial_admin_data())
  with check (public.can_view_financial_admin_data());

drop policy if exists subscriptions_owner_read on public.subscriptions;
drop policy if exists subscriptions_admin_write on public.subscriptions;
create policy subscriptions_owner_read on public.subscriptions
  for select using (public.is_org_member(organization_id) or public.can_view_financial_admin_data());
create policy subscriptions_admin_write on public.subscriptions
  for all using (public.can_view_financial_admin_data())
  with check (public.can_view_financial_admin_data());

drop policy if exists subscription_events_owner_read on public.subscription_events;
drop policy if exists subscription_events_admin_write on public.subscription_events;
create policy subscription_events_owner_read on public.subscription_events
  for select using (public.is_org_member(organization_id) or public.can_view_financial_admin_data());
create policy subscription_events_admin_write on public.subscription_events
  for insert with check (public.can_view_financial_admin_data());

drop policy if exists subscription_payments_read on public.subscription_payments;
create policy subscription_payments_read on public.subscription_payments
  for select using (public.can_view_financial_admin_data() or public.is_org_owner(organization_id));

drop policy if exists entitlement_overrides_admin on public.organization_entitlement_overrides;
create policy entitlement_overrides_admin on public.organization_entitlement_overrides
  for all using (public.can_view_financial_admin_data())
  with check (public.can_view_financial_admin_data());

-- ---------------------------------------------------------------------------
-- 3. employee_profiles: read-only for signed-in users
-- ---------------------------------------------------------------------------
revoke insert, update, delete on public.employee_profiles from authenticated, anon;

-- ---------------------------------------------------------------------------
-- 4. Helper functions: signed-in users only (RLS/RPC callers are authenticated)
-- ---------------------------------------------------------------------------
revoke execute on function public.branch_belongs_to_org(uuid, uuid) from public, anon;
grant  execute on function public.branch_belongs_to_org(uuid, uuid) to authenticated;

revoke execute on function public.get_plan_limit(uuid, text) from public, anon;
grant  execute on function public.get_plan_limit(uuid, text) to authenticated;

revoke execute on function public.check_plan_limit(uuid, text, integer) from public, anon;
grant  execute on function public.check_plan_limit(uuid, text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Promoter application: field caps + throttling
-- ---------------------------------------------------------------------------
create table if not exists public.promoter_application_attempts (
  id bigint generated always as identity primary key,
  client_hash text not null,
  created_at timestamptz not null default now()
);
create index if not exists promoter_application_attempts_recent_idx
  on public.promoter_application_attempts (client_hash, created_at desc);
alter table public.promoter_application_attempts enable row level security;
-- No policies: only the SECURITY DEFINER function below touches this table.
revoke all on public.promoter_application_attempts from anon, authenticated;

create or replace function public.submit_promoter_application(
  applicant_name text,
  applicant_email text,
  applicant_phone text default null,
  applicant_location text default null,
  applicant_social text default null,
  applicant_experience text default null,
  applicant_reason text default null,
  terms_agreed boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  headers_json json;
  client_ip text;
  client_key text;
begin
  -- Field validation (length caps stop storage abuse)
  if nullif(trim(applicant_name), '') is null then raise exception 'VALIDATION_ERROR: name is required'; end if;
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
$$;

revoke execute on function public.submit_promoter_application(text, text, text, text, text, text, text, boolean) from public;
grant  execute on function public.submit_promoter_application(text, text, text, text, text, text, text, boolean) to anon, authenticated;
