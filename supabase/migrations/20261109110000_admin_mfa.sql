-- =====================================================================================================================
-- Two-factor authentication (TOTP) for the admin console, with a switch so nobody gets locked out during rollout.
--   * Supabase MFA (free) does the enrolment and code checking. This only decides whether an admin session must be
--     "aal2" (password + authenticator code) before it counts as an admin.
--   * The switch starts OFF. Enrol every admin first, then a super admin turns it ON with admin_set_mfa_requirement().
--     It refuses to turn on while any active admin has no verified authenticator, so it cannot lock the team out.
-- =====================================================================================================================
create table if not exists public.security_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.security_settings enable row level security;
revoke all on public.security_settings from anon, authenticated;
insert into public.security_settings (key, value) values ('admin_mfa_required', 'off') on conflict do nothing;

-- True when the switch is off, or this session proved a second factor (aal2).
create or replace function public.admin_session_ok()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select value from public.security_settings where key = 'admin_mfa_required'), 'off') <> 'on'
      or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal', nullif(current_setting('request.jwt.claim.aal', true), ''), '') = 'aal2';
$$;
grant execute on function public.admin_session_ok() to authenticated;

-- The login screen needs to know whether to ask for a code even though the session is not yet an admin session.
create or replace function public.admin_identity_check()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admin_access where user_id = auth.uid() and status = 'active');
$$;
grant execute on function public.admin_identity_check() to authenticated;

create or replace function public.admin_mfa_required()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select value from public.security_settings where key = 'admin_mfa_required'), 'off') = 'on';
$$;
grant execute on function public.admin_mfa_required() to authenticated;

create or replace function public.admin_set_mfa_requirement(p_required boolean)
returns void language plpgsql security definer set search_path = public as $$
declare missing integer := 0;
begin
  if not public.is_super_admin() then
    raise exception using message = '{"code":"ADMIN_ACCESS_DENIED","message":"Super admin access required"}';
  end if;
  if p_required then
    -- The super admin turning it on must be signed in with a second factor themselves, and so must every other admin
    -- be able to: refuse while anyone has no verified authenticator.
    if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal', '') <> 'aal2' then
      raise exception 'MFA_REQUIRED: sign in with your authenticator code before turning two-factor on';
    end if;
    if to_regclass('auth.mfa_factors') is not null then
      execute $q$ select count(*) from public.platform_admin_access a
                   where a.status = 'active'
                     and not exists (select 1 from auth.mfa_factors f where f.user_id = a.user_id and f.factor_type = 'totp' and f.status = 'verified') $q$
        into missing;
    end if;
    if missing > 0 then
      raise exception 'MFA_NOT_READY: % active admin(s) have not set up an authenticator yet', missing;
    end if;
  end if;
  update public.security_settings set value = case when p_required then 'on' else 'off' end, updated_at = now(), updated_by = auth.uid()
   where key = 'admin_mfa_required';
  insert into public.admin_audit_logs (actor_id, actor_role, action, target_type, target_id, metadata)
    values (auth.uid(), 'SUPER_ADMIN', case when p_required then 'security.mfa_required_on' else 'security.mfa_required_off' end, 'security_settings', null,
            jsonb_build_object('required', p_required));
end $$;
revoke all on function public.admin_set_mfa_requirement(boolean) from public, anon;
grant execute on function public.admin_set_mfa_requirement(boolean) to authenticated;

-- Hook the session check into the four core admin helpers (every admin RPC and policy uses these).
CREATE OR REPLACE FUNCTION public.is_platform_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.platform_admin_access
    where user_id = auth.uid()
      and status = 'active'
      and public.admin_session_ok()
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.platform_admin_access
    where user_id = auth.uid() and status = 'active' and role = 'SUPER_ADMIN'
      and public.admin_session_ok()
  );
$function$;

CREATE OR REPLACE FUNCTION public.can_view_financial_admin_data()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.platform_admin_access
    where user_id = auth.uid() and status = 'active' and role in ('SUPER_ADMIN', 'FINANCE_ADMIN')
      and public.admin_session_ok()
  );
$function$;

CREATE OR REPLACE FUNCTION public.get_my_admin_sections()
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((
    select public.admin_role_sections(a.role) from public.platform_admin_access a
     where a.user_id = auth.uid() and a.status = 'active' and public.admin_session_ok()
     order by case a.role::text when 'SUPER_ADMIN' then 0 else 1 end limit 1
  ), array[]::text[]);
$function$;

notify pgrst, 'reload schema';
