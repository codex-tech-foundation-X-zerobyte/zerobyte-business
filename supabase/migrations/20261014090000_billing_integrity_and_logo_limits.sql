-- Production-readiness audit fixes (billing integrity + file uploads).
--
-- 1. start_plan_trial() could be called straight from the browser console for ANY plan. For a paid plan whose
--    trial_days is 0 it set status = 'active' with no end date: a permanent free upgrade. It also let a customer
--    overwrite a plan they had already paid for, and start a fresh trial every time the last one lapsed.
-- 2. Nothing ever enforced trial_end / current_period_end, so a trial or a lapsed paid month kept paid limits
--    forever. Limits now follow the plan that is actually in force right now.
-- 3. The business-logos bucket had no size or type limit on the server (the 2 MB check lived in the browser) and
--    accepted SVG, which can carry script when opened directly.

-- ---------------------------------------------------------------------------
-- The plan that is genuinely in force right now. A trial or paid period that has ended falls back to Free.
-- Free and admin-granted plans have no end date and stay as they are.
-- ---------------------------------------------------------------------------
create or replace function public.effective_plan_id(target_org uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case
    when s.id is null then (select id from public.plans where code = 'free' and active limit 1)
    when s.status in ('trialing', 'active') and (s.current_period_end is null or s.current_period_end > now()) then s.plan_id
    else (select id from public.plans where code = 'free' and active limit 1)
  end
  from (select 1) as one
  left join public.subscriptions s on s.organization_id = target_org;
$$;
revoke all on function public.effective_plan_id(uuid) from public, anon;
grant execute on function public.effective_plan_id(uuid) to authenticated;

create or replace function public.get_plan_limit(target_org uuid, target_resource text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select o.limit_value from public.organization_entitlement_overrides o
      where o.organization_id = target_org and o.resource = target_resource),
    (select pl.limit_value from public.plan_limits pl
      where pl.plan_id = public.effective_plan_id(target_org) and pl.resource = target_resource)
  );
$$;

-- ---------------------------------------------------------------------------
-- Trials: only plans that actually offer one, once per business, never over a plan that is paid for.
-- Anything else must go through Paystack (server-priced, server-confirmed).
-- ---------------------------------------------------------------------------
create or replace function public.start_plan_trial(target_org uuid, target_plan uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_sub public.subscriptions%rowtype;
  plan_row public.plans%rowtype;
  price_row public.plan_price_versions%rowtype;
begin
  if auth.uid() is null or not public.is_org_owner(target_org) then
    raise exception 'UNAUTHORIZED: only the organization owner can change plans';
  end if;
  select * into plan_row from public.plans where id = target_plan and active;
  if plan_row.id is null then raise exception 'PLAN_NOT_FOUND'; end if;
  if coalesce(plan_row.trial_days, 0) <= 0 then
    raise exception 'PAYMENT_REQUIRED: this plan has no free trial. Pay for it to activate it.';
  end if;
  select * into current_sub from public.subscriptions where organization_id = target_org for update;
  if current_sub.id is null then raise exception 'SUBSCRIPTION_NOT_FOUND'; end if;
  if current_sub.status = 'trialing' and current_sub.current_period_end > now() then
    raise exception 'TRIAL_ALREADY_ACTIVE: a trial is already running for this organization';
  end if;
  if current_sub.status = 'active' and current_sub.provider = 'paystack' and current_sub.current_period_end > now() then
    raise exception 'PLAN_ALREADY_PAID: your current plan is paid until %. Start a trial after it ends.', to_char(current_sub.current_period_end, 'DD Mon YYYY');
  end if;
  if exists (select 1 from public.subscription_events e where e.organization_id = target_org and e.event_type = 'trial_started') then
    raise exception 'TRIAL_USED: this business has already used its free trial. Pay for a plan to continue.';
  end if;
  select * into price_row from public.plan_price_versions
    where plan_id = target_plan and status = 'active' and billing_interval = 'monthly' limit 1;
  if price_row.id is null or coalesce(price_row.amount, 0) <= 0 then
    raise exception 'CONTACT_SALES: this plan is arranged with our team, not self-serve';
  end if;
  update public.subscriptions set
    plan_id = target_plan,
    price_version_id = price_row.id,
    status = 'trialing',
    trial_start = now(),
    trial_end = now() + make_interval(days => plan_row.trial_days),
    current_period_start = now(),
    current_period_end = now() + make_interval(days => plan_row.trial_days),
    canceled_at = null,
    provider = null,
    provider_subscription_id = null,
    updated_at = now()
    where organization_id = target_org;
  insert into public.subscription_events (subscription_id, organization_id, event_type, from_plan_id, to_plan_id, actor_id, note)
    values (current_sub.id, target_org, 'trial_started', current_sub.plan_id, target_plan, auth.uid(), 'Self-serve trial');
end;
$$;
revoke all on function public.start_plan_trial(uuid, uuid) from public, anon;
grant execute on function public.start_plan_trial(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Tidy the stored status once a period is over (limits are already correct without this; this keeps the admin
-- dashboards, revenue numbers and the Billing screen honest). Runs hourly when pg_cron is available, and an
-- admin can run it by hand: select public.expire_lapsed_subscriptions();
-- ---------------------------------------------------------------------------
create or replace function public.expire_lapsed_subscriptions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  lapsed record;
  free_plan uuid;
  total integer := 0;
begin
  select id into free_plan from public.plans where code = 'free' and active limit 1;
  for lapsed in
    select id, organization_id, plan_id, status from public.subscriptions
    where status in ('trialing', 'active') and current_period_end is not null and current_period_end <= now()
    for update skip locked
  loop
    update public.subscriptions set status = 'expired', updated_at = now() where id = lapsed.id;
    insert into public.subscription_events (subscription_id, organization_id, event_type, from_plan_id, to_plan_id, note)
      values (lapsed.id, lapsed.organization_id, case when lapsed.status = 'trialing' then 'trial_ended' else 'expired' end, lapsed.plan_id, free_plan,
              case when lapsed.status = 'trialing' then 'Trial ended without payment; Free limits apply' else 'Paid period ended; Free limits apply' end);
    total := total + 1;
  end loop;
  return total;
end;
$$;
revoke all on function public.expire_lapsed_subscriptions() from public, anon, authenticated;
grant execute on function public.expire_lapsed_subscriptions() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'expire-lapsed-subscriptions';
    perform cron.schedule('expire-lapsed-subscriptions', '7 * * * *', 'select public.expire_lapsed_subscriptions()');
  end if;
exception when others then
  raise notice 'pg_cron not scheduled (%). Limits are still enforced live; run expire_lapsed_subscriptions() manually if you want statuses tidied.', sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
-- Logo uploads: enforce size and type on the server, and drop SVG.
-- ---------------------------------------------------------------------------
update storage.buckets
   set file_size_limit = 2097152,
       allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp']
 where id = 'business-logos';

notify pgrst, 'reload schema';
