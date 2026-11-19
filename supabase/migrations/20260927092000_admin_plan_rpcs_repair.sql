-- Repair: admin_get_plans returned 404 in production.
--
-- Root cause: admin_get_plans (and the other admin plan RPCs) were appended
-- to the END of 20260925090000_plans_subscriptions_entitlements.sql after
-- that file had already been created. Supabase records a migration as
-- applied by its version and never re-runs an edited file, so any project
-- that had applied the earlier version of that file never received them.
-- PostgREST then answers /rest/v1/rpc/admin_get_plans with 404 because the
-- function is not in its schema cache.
--
-- This migration recreates them idempotently (CREATE OR REPLACE), so it is
-- safe both on a project that is missing them and on a fresh deployment
-- where the earlier file already created them. Each function is gated by
-- is_platform_admin() inside its body -- the GRANT below only allows the
-- call to reach the function; it does not grant any data access.

create or replace function public.admin_update_plan_price(target_plan uuid, new_amount numeric, new_interval text default 'monthly')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  next_version integer;
begin
  if not public.is_platform_admin() then raise exception 'UNAUTHORIZED: platform admin access required'; end if;
  if new_amount < 0 then raise exception 'VALIDATION_ERROR: price cannot be negative'; end if;
  if new_interval not in ('monthly', 'yearly') then raise exception 'VALIDATION_ERROR: unrecognized billing interval'; end if;
  select coalesce(max(version), 0) + 1 into next_version from public.plan_price_versions where plan_id = target_plan and billing_interval = new_interval;
  update public.plan_price_versions set status = 'superseded', effective_to = now()
    where plan_id = target_plan and billing_interval = new_interval and status = 'active';
  insert into public.plan_price_versions (plan_id, currency, amount, billing_interval, version, status, created_by)
    values (target_plan, 'NGN', new_amount, new_interval, next_version, 'active', auth.uid());
end;
$$;

create or replace function public.admin_set_plan_limit(target_plan uuid, target_resource text, new_limit integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then raise exception 'UNAUTHORIZED: platform admin access required'; end if;
  if target_resource not in ('products', 'customers', 'employees', 'branches', 'sales_per_month', 'storage_mb') then
    raise exception 'VALIDATION_ERROR: unrecognized resource';
  end if;
  insert into public.plan_limits (plan_id, resource, limit_value) values (target_plan, target_resource, new_limit)
    on conflict (plan_id, resource) do update set limit_value = excluded.limit_value;
end;
$$;

create or replace function public.admin_set_plan_active(target_plan uuid, make_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then raise exception 'UNAUTHORIZED: platform admin access required'; end if;
  update public.plans set active = make_active, updated_at = now() where id = target_plan;
end;
$$;

-- Returns one row per plan (active AND inactive, so an admin can re-enable
-- one). Columns are exactly what AdminPlans.tsx reads: plan identity, live
-- monthly price, limits as a {resource: limit|null} object, subscriber count.
-- Returns zero rows (not an error) to a non-admin caller.
create or replace function public.admin_get_plans()
returns table (
  plan_id uuid,
  code text,
  name text,
  description text,
  active boolean,
  sort_order integer,
  trial_days integer,
  monthly_amount numeric,
  monthly_price_version_id uuid,
  currency text,
  limits jsonb,
  subscriber_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id, p.code, p.name, p.description, p.active, p.sort_order, p.trial_days,
    pv.amount, pv.id, coalesce(pv.currency, 'NGN'),
    coalesce((select jsonb_object_agg(pl.resource, pl.limit_value) from public.plan_limits pl where pl.plan_id = p.id), '{}'::jsonb),
    (select count(*) from public.subscriptions s where s.plan_id = p.id and s.status in ('trialing', 'active'))
  from public.plans p
  left join public.plan_price_versions pv on pv.plan_id = p.id and pv.status = 'active' and pv.billing_interval = 'monthly'
  where public.is_platform_admin()
  order by p.sort_order;
$$;

create or replace function public.admin_set_subscription(target_org uuid, target_plan uuid, target_status text, note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_sub public.subscriptions%rowtype;
  price_row public.plan_price_versions%rowtype;
begin
  if not public.is_platform_admin() then raise exception 'UNAUTHORIZED: platform admin access required'; end if;
  if target_status not in ('trialing', 'active', 'past_due', 'canceled', 'expired', 'suspended') then
    raise exception 'VALIDATION_ERROR: unrecognized subscription status';
  end if;
  select * into current_sub from public.subscriptions where organization_id = target_org for update;
  if current_sub.id is null then raise exception 'SUBSCRIPTION_NOT_FOUND'; end if;
  select * into price_row from public.plan_price_versions
    where plan_id = target_plan and status = 'active' and billing_interval = 'monthly' limit 1;
  update public.subscriptions set
    plan_id = target_plan,
    price_version_id = coalesce(price_row.id, price_version_id),
    status = target_status,
    canceled_at = case when target_status = 'canceled' then now() else null end,
    updated_at = now()
    where organization_id = target_org;
  insert into public.subscription_events (subscription_id, organization_id, event_type, from_plan_id, to_plan_id, actor_id, note)
    values (current_sub.id, target_org, 'admin_override', current_sub.plan_id, target_plan, auth.uid(), coalesce(note, 'Admin-adjusted subscription'));
end;
$$;

revoke all on function public.admin_update_plan_price(uuid, numeric, text) from public, anon;
revoke all on function public.admin_set_plan_limit(uuid, text, integer) from public, anon;
revoke all on function public.admin_set_plan_active(uuid, boolean) from public, anon;
revoke all on function public.admin_get_plans() from public, anon;
revoke all on function public.admin_set_subscription(uuid, uuid, text, text) from public, anon;
grant execute on function public.admin_update_plan_price(uuid, numeric, text) to authenticated;
grant execute on function public.admin_set_plan_limit(uuid, text, integer) to authenticated;
grant execute on function public.admin_set_plan_active(uuid, boolean) to authenticated;
grant execute on function public.admin_get_plans() to authenticated;
grant execute on function public.admin_set_subscription(uuid, uuid, text, text) to authenticated;

-- Ask PostgREST to reload its schema cache so the new functions are
-- reachable immediately instead of after the next automatic reload.
notify pgrst, 'reload schema';
