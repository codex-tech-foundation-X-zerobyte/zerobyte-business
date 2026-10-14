-- Extends the existing send_platform_broadcast (from
-- 20260911090000_production_hardening.sql) with the audience targeting the
-- spec asks for, now that plans/subscriptions exist to target against.
-- This supersedes the function definition via CREATE OR REPLACE rather than
-- editing the original migration file, so the original migration's history
-- stays intact for anyone who already applied it.
--
-- Supported audiences:
--   all_users          -- unchanged from before
--   business_owners    -- organization owners only, not workers
--   trial_users        -- organizations currently on a trial subscription
--   plan:<code>        -- organizations subscribed to a specific plan, e.g. plan:pro
create or replace function public.send_platform_broadcast(
  notification_title text,
  notification_message text,
  target_audience text default 'all_users'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  broadcast_id uuid;
  plan_code text;
begin
  if not public.is_platform_admin() then
    raise exception using message = '{"code":"ADMIN_ACCESS_DENIED","message":"Platform administrator access required"}';
  end if;
  if nullif(trim(notification_title), '') is null or nullif(trim(notification_message), '') is null then
    raise exception using message = '{"code":"VALIDATION_ERROR","message":"Title and message are required"}';
  end if;
  if target_audience <> 'all_users' and target_audience <> 'business_owners' and target_audience <> 'trial_users' and target_audience not like 'plan:%' then
    raise exception using message = '{"code":"VALIDATION_ERROR","message":"Unsupported audience"}';
  end if;

  insert into public.admin_notifications
    (created_by, title, message, audience, status, sent_at)
  values
    (auth.uid(), trim(notification_title), trim(notification_message), target_audience, 'sent', now())
  returning id into broadcast_id;

  if target_audience = 'all_users' then
    insert into public.notifications (organization_id, user_id, title, body)
    select om.organization_id, om.user_id, trim(notification_title), trim(notification_message)
    from public.organization_members om;
  elsif target_audience = 'business_owners' then
    insert into public.notifications (organization_id, user_id, title, body)
    select om.organization_id, om.user_id, trim(notification_title), trim(notification_message)
    from public.organization_members om
    where om.role = 'owner';
  elsif target_audience = 'trial_users' then
    insert into public.notifications (organization_id, user_id, title, body)
    select om.organization_id, om.user_id, trim(notification_title), trim(notification_message)
    from public.organization_members om
    join public.subscriptions s on s.organization_id = om.organization_id and s.status = 'trialing'
    where om.role = 'owner';
  elsif target_audience like 'plan:%' then
    plan_code := split_part(target_audience, ':', 2);
    if not exists (select 1 from public.plans where code = plan_code) then
      raise exception using message = '{"code":"VALIDATION_ERROR","message":"Unknown plan code"}';
    end if;
    insert into public.notifications (organization_id, user_id, title, body)
    select om.organization_id, om.user_id, trim(notification_title), trim(notification_message)
    from public.organization_members om
    join public.subscriptions s on s.organization_id = om.organization_id
    join public.plans p on p.id = s.plan_id and p.code = plan_code
    where om.role = 'owner';
  end if;

  insert into public.admin_audit_logs
    (actor_id, action, target_type, target_id, metadata)
  values
    (auth.uid(), 'broadcast.sent', 'admin_notification', broadcast_id,
     jsonb_build_object('audience', target_audience));
  return broadcast_id;
end;
$$;

grant execute on function public.send_platform_broadcast(text, text, text) to authenticated;
revoke all on function public.send_platform_broadcast(text, text, text) from public, anon;
