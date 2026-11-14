-- Free period = 7 days, then the business must pay. (Fixes: "the trial never stops".)
--
-- What was wrong
--   1. Every new business was created on the Free plan, status 'active', with NO end date. Free never expired, so
--      nobody was ever asked to pay. The 7-day trial only existed if the owner clicked "Start trial" by hand.
--   2. When a trial or paid month did end, the database only dropped the business to Free *limits*. The app kept
--      working, so there was still no reason to pay.
--   3. The stored status stayed "trialing" until an optional hourly job (pg_cron) ran, so the Billing screen could
--      show "Trial" with 0 days left forever.
--
-- What this does
--   * New business  -> 7-day trial starts automatically (length = plans.trial_days of the Free plan, default 7).
--   * subscription_state(org) -> 'trial' | 'active' | 'locked', computed live from the dates (never from a stale status).
--   * Locked business -> read-only. Every write to the core business tables is refused on the SERVER with
--     SUBSCRIPTION_REQUIRED, so it cannot be bypassed from the browser. Data is never deleted, and paying
--     unlocks everything instantly. Payments, support messages and sign-in keep working while locked.
--   * get_subscription_access(org) -> what the app needs to show the countdown / paywall; it also tidies the stored
--     status on the spot, so nothing depends on pg_cron.
--   * One free period per business: the signup trial counts as the trial, so the manual "Start trial" can no longer
--     be used to farm extra weeks.
--   * Existing businesses that were on Free forever and never paid get one fresh 7-day trial from the day this runs.

-- ---------------------------------------------------------------------------
-- 1. Trial length lives on the Free plan row (admin-editable in Plans & pricing).
-- ---------------------------------------------------------------------------
update public.plans set trial_days = 7 where code = 'free' and coalesce(trial_days, 0) <= 0;

create or replace function public.signup_trial_days()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(nullif((select trial_days from public.plans where code = 'free' and active limit 1), 0), 7);
$$;
revoke all on function public.signup_trial_days() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. New businesses start a trial instead of a permanent Free plan.
-- ---------------------------------------------------------------------------
create or replace function public.create_default_subscription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  free_plan_id uuid;
  new_subscription_id uuid;
  trial_length integer := public.signup_trial_days();
begin
  select id into free_plan_id from public.plans where code = 'free' and active limit 1;
  if free_plan_id is null then return new; end if; -- plans not seeded yet in this environment; skip rather than fail org creation
  insert into public.subscriptions (organization_id, plan_id, status, trial_start, trial_end, current_period_start, current_period_end)
    values (new.id, free_plan_id, 'trialing', now(), now() + make_interval(days => trial_length), now(), now() + make_interval(days => trial_length))
    returning id into new_subscription_id;
  insert into public.subscription_events (subscription_id, organization_id, event_type, to_plan_id, actor_id, note)
    values (new_subscription_id, new.id, 'trial_started', free_plan_id, auth.uid(), trial_length || '-day free trial started at signup');
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The one source of truth for "may this business use the app right now?"
--    Computed from the dates, so a stale stored status can never keep someone in.
--      trial  : status trialing and the trial end is still in the future
--      active : status active  and the paid period end is in the future (or an admin-granted paid plan with no end date)
--      locked : everything else (trial over, paid month over, canceled, suspended, past due, no subscription)
-- ---------------------------------------------------------------------------
create or replace function public.subscription_state(target_org uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case
      when s.status = 'trialing' and s.current_period_end is not null and s.current_period_end > now() then 'trial'
      when s.status = 'active' and s.current_period_end is not null and s.current_period_end > now() then 'active'
      when s.status = 'active' and s.current_period_end is null and p.code <> 'free' then 'active'
      else 'locked'
    end
    from public.subscriptions s
    left join public.plans p on p.id = s.plan_id
    where s.organization_id = target_org
    limit 1
  ), 'locked');
$$;
revoke all on function public.subscription_state(uuid) from public, anon;
grant execute on function public.subscription_state(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Hard lock. Refuses writes to the core business tables while a business is locked. Reads stay open so the owner
--    can still see and export their records, and so the Billing screen can load.
--    Server-side work (service role / migrations: auth.uid() is null) and platform admins are never blocked.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_active_subscription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid;
begin
  if auth.uid() is null or public.is_platform_admin() then
    return coalesce(new, old);
  end if;
  org := nullif(to_jsonb(coalesce(new, old)) ->> 'organization_id', '')::uuid;
  if org is not null and public.subscription_state(org) = 'locked' then
    raise exception 'SUBSCRIPTION_REQUIRED: your free trial or paid period has ended. Pay for a plan to continue.'
      using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function public.enforce_active_subscription() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'products', 'customers', 'sales', 'expenses', 'invoices', 'stock_movements', 'suppliers', 'purchase_orders',
    'branches', 'employee_profiles', 'customer_payments', 'attendance', 'work_schedules'
  ] loop
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = 'organization_id') then
      execute format('drop trigger if exists %I on public.%I', t || '_subscription_lock', t);
      execute format('create trigger %I before insert or update or delete on public.%I for each row execute function public.enforce_active_subscription()', t || '_subscription_lock', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. What the app asks on every load. Also tidies the stored status the moment a period is found to be over.
-- ---------------------------------------------------------------------------
create or replace function public.get_subscription_access(target_org uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  sub public.subscriptions%rowtype;
  plan_row public.plans%rowtype;
  free_plan uuid;
  current_state text;
  why text;
begin
  if auth.uid() is null or not (public.is_org_member(target_org) or public.is_platform_admin()) then
    raise exception 'UNAUTHORIZED';
  end if;
  select * into sub from public.subscriptions where organization_id = target_org;
  current_state := public.subscription_state(target_org);

  if current_state = 'locked' and sub.id is not null and sub.status in ('trialing', 'active')
     and sub.current_period_end is not null and sub.current_period_end <= now() then
    select id into free_plan from public.plans where code = 'free' and active limit 1;
    update public.subscriptions set status = 'expired', updated_at = now()
      where id = sub.id and status in ('trialing', 'active') and current_period_end <= now();
    if found then
      insert into public.subscription_events (subscription_id, organization_id, event_type, from_plan_id, to_plan_id, note)
        values (sub.id, target_org, case when sub.status = 'trialing' then 'trial_ended' else 'expired' end, sub.plan_id, free_plan,
                case when sub.status = 'trialing' then 'Free trial ended without payment; app is locked until a plan is paid' else 'Paid period ended; app is locked until a plan is paid' end);
    end if;
    sub.status := 'expired';
  end if;

  select * into plan_row from public.plans where id = sub.plan_id;
  why := case
    when current_state <> 'locked' then null
    when sub.id is null then 'no_subscription'
    when sub.status in ('canceled', 'suspended', 'past_due') then sub.status
    when sub.trial_start is null and not exists (select 1 from public.payments p where p.organization_id = target_org and p.status = 'success') then 'trial_used'
    when not exists (select 1 from public.payments p where p.organization_id = target_org and p.status = 'success') then 'trial_ended'
    else 'plan_ended'
  end;

  return jsonb_build_object(
    'state', current_state,
    'reason', why,
    'status', sub.status,
    'plan_code', plan_row.code,
    'plan_name', plan_row.name,
    'trial_end', sub.trial_end,
    'period_end', sub.current_period_end,
    'seconds_left', case when sub.current_period_end is null then null else greatest(0, floor(extract(epoch from (sub.current_period_end - now()))))::bigint end,
    'can_pay', public.is_org_owner(target_org)
  );
end;
$$;
revoke all on function public.get_subscription_access(uuid) from public, anon;
grant execute on function public.get_subscription_access(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Existing businesses that sit on Free forever and never paid: one fresh trial from today, so nobody is locked
--    out by surprise on the day this goes live. Anyone who has paid, or was granted a paid plan, is untouched.
-- ---------------------------------------------------------------------------
do $$
declare
  free_plan uuid;
  moved record;
  trial_length integer := public.signup_trial_days();
begin
  select id into free_plan from public.plans where code = 'free' and active limit 1;
  if free_plan is null then return; end if;
  for moved in
    select s.id, s.organization_id from public.subscriptions s
    where s.plan_id = free_plan
      and (s.status = 'active' or (s.status = 'trialing' and s.current_period_end is null))
      and s.current_period_end is null
      and not exists (select 1 from public.payments p where p.organization_id = s.organization_id and p.status = 'success')
    for update
  loop
    update public.subscriptions set
      status = 'trialing', trial_start = now(), trial_end = now() + make_interval(days => trial_length),
      current_period_start = now(), current_period_end = now() + make_interval(days => trial_length), updated_at = now()
      where id = moved.id;
    insert into public.subscription_events (subscription_id, organization_id, event_type, to_plan_id, note)
      values (moved.id, moved.organization_id, 'trial_started', free_plan, trial_length || '-day free trial started (Free plan no longer lasts forever)');
  end loop;
end $$;

-- Mark every trial or paid period that has already run out as expired right now.
select public.expire_lapsed_subscriptions();

-- ---------------------------------------------------------------------------
-- 7. The manual "Start trial" button is retired (the signup trial is the one free period). The function stays but
--    its message now says so; it can only ever refuse once a business has had its trial.
-- ---------------------------------------------------------------------------
create or replace function public.start_plan_trial(target_org uuid, target_plan uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_org_owner(target_org) then
    raise exception 'UNAUTHORIZED: only the organization owner can change plans';
  end if;
  raise exception 'TRIAL_USED: every business gets one free 7-day trial when it signs up. Pay for a plan to continue.';
end;
$$;
revoke all on function public.start_plan_trial(uuid, uuid) from public, anon;
grant execute on function public.start_plan_trial(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
