-- Security fix: admin RPCs must check the admin ROLE, not just "is any admin".
-- Found by the 9 Nov 2026 audit: a SUPPORT_ADMIN could change plan prices to NGN 100, approve promoter applications,
-- list promoter contact details and broadcast to every user.

CREATE OR REPLACE FUNCTION public.admin_update_plan_price(target_plan uuid, new_amount numeric, new_interval text DEFAULT 'monthly'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  next_version integer;
begin
  if not public.can_view_financial_admin_data() then raise exception 'UNAUTHORIZED: platform admin access required'; end if;
  if new_amount < 0 then raise exception 'VALIDATION_ERROR: price cannot be negative'; end if;
  if new_interval not in ('monthly', 'yearly') then raise exception 'VALIDATION_ERROR: unrecognized billing interval'; end if;
  select coalesce(max(version), 0) + 1 into next_version from public.plan_price_versions where plan_id = target_plan and billing_interval = new_interval;
  update public.plan_price_versions set status = 'superseded', effective_to = now()
    where plan_id = target_plan and billing_interval = new_interval and status = 'active';
  insert into public.plan_price_versions (plan_id, currency, amount, billing_interval, version, status, created_by)
    values (target_plan, 'NGN', new_amount, new_interval, next_version, 'active', auth.uid());
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_plan_limit(target_plan uuid, target_resource text, new_limit integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.can_view_financial_admin_data() then raise exception 'UNAUTHORIZED: platform admin access required'; end if;
  if target_resource not in ('products', 'customers', 'employees', 'branches', 'sales_per_month', 'storage_mb') then
    raise exception 'VALIDATION_ERROR: unrecognized resource';
  end if;
  insert into public.plan_limits (plan_id, resource, limit_value) values (target_plan, target_resource, new_limit)
    on conflict (plan_id, resource) do update set limit_value = excluded.limit_value;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_plan_active(target_plan uuid, make_active boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.can_view_financial_admin_data() then raise exception 'UNAUTHORIZED: platform admin access required'; end if;
  update public.plans set active = make_active, updated_at = now() where id = target_plan;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_review_promoter_application(target_application uuid, new_status text, note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  application public.promoter_applications%rowtype;
  generated_code text;
  new_promoter_id uuid;
begin
  if not public.admin_can_access('Promoters') then raise exception 'UNAUTHORIZED: platform admin access required'; end if;
  if new_status not in ('under_review', 'approved', 'rejected') then raise exception 'VALIDATION_ERROR: unrecognized decision'; end if;
  select * into application from public.promoter_applications where id = target_application for update;
  if application.id is null then raise exception 'APPLICATION_NOT_FOUND'; end if;
  update public.promoter_applications set
    status = new_status, reviewed_by = auth.uid(), reviewed_at = now(), review_note = note
    where id = target_application;
  if new_status = 'approved' then
    loop
      generated_code := 'ZB-' || upper(substr(md5(random()::text), 1, 5));
      exit when not exists (select 1 from public.promoters where referral_code = generated_code);
    end loop;
    insert into public.promoters (application_id, full_name, email, referral_code)
      values (application.id, application.full_name, application.email, generated_code)
      returning id into new_promoter_id;
  end if;
  return new_promoter_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_promoter_status(target_promoter uuid, new_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.admin_can_access('Promoters') then raise exception 'UNAUTHORIZED: platform admin access required'; end if;
  if new_status not in ('active', 'suspended') then raise exception 'VALIDATION_ERROR: unrecognized status'; end if;
  update public.promoters set status = new_status, updated_at = now() where id = target_promoter;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_list_promoters()
 RETURNS TABLE(promoter_id uuid, full_name text, email text, whatsapp text, referral_code text, status text, created_at timestamp with time zone, total_referrals bigint, has_account boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.id, p.full_name, p.email, a.phone, p.referral_code, p.status, p.created_at, count(r.id), p.user_id is not null
  from public.promoters p
  left join public.promoter_applications a on a.id = p.application_id
  left join public.referrals r on r.promoter_id = p.id
  where public.admin_can_access('Promoters')
  group by p.id, a.phone
  order by p.created_at desc;
$function$;

CREATE OR REPLACE FUNCTION public.admin_list_referrals()
 RETURNS TABLE(referral_id uuid, promoter_id uuid, promoter_name text, referral_code text, business_name text, status text, signed_up_at timestamp with time zone, qualified_at timestamp with time zone, notes text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select r.id, r.promoter_id, p.full_name, r.referral_code, o.name, r.status, r.signed_up_at, r.qualified_at, r.notes
  from public.referrals r
  join public.promoters p on p.id = r.promoter_id
  left join public.organizations o on o.id = r.organization_id
  where public.admin_can_access('Promoters')
  order by r.signed_up_at desc
  limit 500;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_referral_status(target_referral uuid, new_status text, note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.admin_can_access('Promoters') then raise exception 'UNAUTHORIZED: platform admin access required'; end if;
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
$function$;

CREATE OR REPLACE FUNCTION public.admin_list_feedback()
 RETURNS TABLE(id uuid, organization_id uuid, organization_name text, user_id uuid, user_email text, category text, severity text, message text, status text, admin_response text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select f.id, f.organization_id, o.name, f.user_id, u.email,
    f.category, f.severity, f.message, f.status, f.admin_response, f.created_at
  from public.product_feedback f
  join public.organizations o on o.id = f.organization_id
  join auth.users u on u.id = f.user_id
  where public.admin_can_access('Feedback')
  order by
    case f.severity when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end,
    f.created_at desc;
$function$;

CREATE OR REPLACE FUNCTION public.admin_update_feedback(target_feedback uuid, new_status text DEFAULT NULL::text, response text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.admin_can_access('Feedback') then raise exception 'UNAUTHORIZED: platform admin access required'; end if;
  if new_status is not null and new_status not in ('new', 'reviewing', 'planned', 'resolved', 'declined') then
    raise exception 'VALIDATION_ERROR: unrecognized status';
  end if;
  update public.product_feedback set
    status = coalesce(new_status, status),
    admin_response = coalesce(response, admin_response),
    updated_at = now()
  where id = target_feedback;
end;
$function$;

CREATE OR REPLACE FUNCTION public.send_platform_broadcast(notification_title text, notification_message text, target_audience text DEFAULT 'all_users'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  broadcast_id uuid;
  plan_code text;
begin
  if not public.admin_can_access('Notifications') then
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
$function$;

CREATE OR REPLACE FUNCTION public.publish_version_announcement(announcement_version text, announcement_message text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare announcement_id uuid;
begin
  if not public.is_super_admin() then
    raise exception using message = '{"code":"ADMIN_ACCESS_DENIED","message":"Platform administrator access required"}';
  end if;
  if nullif(trim(announcement_version), '') is null or nullif(trim(announcement_message), '') is null then
    raise exception using message = '{"code":"VALIDATION_ERROR","message":"Version and message are required"}';
  end if;
  insert into public.app_version_announcements(version, message, created_by)
  values (trim(announcement_version), trim(announcement_message), auth.uid())
  returning id into announcement_id;
  insert into public.notifications(organization_id, user_id, title, body)
  select om.organization_id, om.user_id,
    'New version available · ' || trim(announcement_version),
    trim(announcement_message)
  from public.organization_members om;
  insert into public.admin_audit_logs(actor_id, action, target_type, target_id, metadata)
  values (auth.uid(), 'version.announced', 'app_version_announcement', announcement_id,
    jsonb_build_object('version', trim(announcement_version)));
  return announcement_id;
end;
$function$;

notify pgrst, 'reload schema';