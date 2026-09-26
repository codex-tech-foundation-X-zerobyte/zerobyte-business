-- Plans, pricing, subscriptions, trials, and plan-limit enforcement.
--
-- This is deliberately the PAYMENT-FREE half of the billing system. It
-- gives every organization a real plan, a real (server-enforced) set of
-- limits, and a real trial mechanism -- all without needing a payment
-- provider. Flutterwave/PayPal integration (checkout, webhooks, payment
-- records, reconciliation) is intentionally left out until provider
-- credentials are available; this migration only adds what those phases
-- will build on top of, matching the "provider abstraction first, wire the
-- provider in later" approach in the spec.
--
-- Design choices worth recording:
--   * Prices are versioned (plan_price_versions), never edited in place, so
--     an existing subscription's historical price is never silently
--     rewritten by an admin pricing change -- exactly what the spec's
--     "price change preview" phase requires.
--   * Limits (plan_limits) are per-plan; per-organization overrides
--     (organization_entitlement_overrides) exist only for Enterprise-style
--     custom deals, so "the plan" stays the single source of truth for the
--     overwhelming majority of organizations.
--   * Limits are enforced with BEFORE INSERT triggers on the resource
--     tables themselves (products, branches, employee_profiles), not just
--     a frontend helper -- a direct API call is checked exactly the same
--     as a UI action, per the spec's "frontend checks are only UX" rule.
--   * Sales-count-per-month limit enforcement is NOT added here. create_sale
--     is the single most business-critical, most-iterated function in this
--     codebase (8 prior migrations touch it) and there is no way to
--     exercise a test suite against it in this environment. Adding an
--     unverified check to it risks breaking checkout for every business on
--     the platform. That specific limit is flagged as a follow-up in
--     BILLING.md rather than guessed at blind.

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text not null default '',
  active boolean not null default true,
  sort_order integer not null default 0,
  trial_days integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.plan_price_versions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  currency text not null default 'NGN',
  amount numeric(12,2) not null check (amount >= 0),
  billing_interval text not null default 'monthly' check (billing_interval in ('monthly', 'yearly')),
  version integer not null,
  status text not null default 'active' check (status in ('active', 'superseded')),
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (plan_id, billing_interval, version)
);
-- Only one ACTIVE price per (plan, billing_interval) at a time -- this is
-- what "never more than one current price" actually means at the database
-- level, not just an admin-UI convention.
create unique index plan_price_versions_one_active
  on public.plan_price_versions (plan_id, billing_interval)
  where status = 'active';

create table public.plan_limits (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  resource text not null check (resource in ('products', 'customers', 'employees', 'branches', 'sales_per_month', 'storage_mb')),
  limit_value integer, -- null = unlimited (used for Enterprise)
  unique (plan_id, resource)
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade unique,
  plan_id uuid not null references public.plans(id),
  price_version_id uuid references public.plan_price_versions(id),
  status text not null default 'trialing' check (status in ('trialing', 'active', 'past_due', 'canceled', 'expired', 'suspended')),
  trial_start timestamptz,
  trial_end timestamptz,
  current_period_start timestamptz not null default now(),
  current_period_end timestamptz,
  canceled_at timestamptz,
  provider text, -- null until a payment provider phase actually activates it
  provider_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.subscription_events (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_type text not null check (event_type in ('created', 'trial_started', 'trial_ended', 'plan_changed', 'activated', 'canceled', 'reactivated', 'admin_override', 'expired')),
  from_plan_id uuid references public.plans(id),
  to_plan_id uuid references public.plans(id),
  actor_id uuid references auth.users(id),
  note text,
  created_at timestamptz not null default now()
);

create table public.organization_entitlement_overrides (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  resource text not null check (resource in ('products', 'customers', 'employees', 'branches', 'sales_per_month', 'storage_mb')),
  limit_value integer, -- null = unlimited
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (organization_id, resource)
);

create index subscriptions_status_idx on public.subscriptions (status);
create index subscriptions_plan_idx on public.subscriptions (plan_id);
create index subscription_events_org_idx on public.subscription_events (organization_id, created_at desc);
create index plan_price_versions_plan_idx on public.plan_price_versions (plan_id, billing_interval, status);

-- Resolve the effective limit for one organization + resource: an explicit
-- per-organization override wins if one exists, otherwise the org's current
-- plan's limit, otherwise "no limit configured" is treated as unlimited
-- (fails open on missing config rather than silently blocking every new
-- business whose plan row hasn't been fully configured yet -- a missing
-- limit is a configuration gap for an admin to fix, not something that
-- should look like a bug to the business owner).
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
    (select pl.limit_value from public.subscriptions s
      join public.plan_limits pl on pl.plan_id = s.plan_id and pl.resource = target_resource
      where s.organization_id = target_org)
  );
$$;

-- true = at or under the limit (still has room / unlimited). Counts the
-- resource live rather than trusting a cached counter, so there is no
-- separate piece of state that can drift from reality.
create or replace function public.check_plan_limit(target_org uuid, target_resource text, current_count integer)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.get_plan_limit(target_org, target_resource) is null then true
    else current_count < public.get_plan_limit(target_org, target_resource)
  end;
$$;

create or replace function public.enforce_product_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  existing integer;
begin
  select count(*) into existing from public.products where organization_id = new.organization_id;
  if not public.check_plan_limit(new.organization_id, 'products', existing) then
    raise exception 'PLAN_LIMIT_REACHED: product limit reached for this plan. Upgrade to add more products.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists products_plan_limit on public.products;
create trigger products_plan_limit before insert on public.products
  for each row execute function public.enforce_product_limit();

create or replace function public.enforce_branch_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  existing integer;
begin
  select count(*) into existing from public.branches where organization_id = new.organization_id;
  if not public.check_plan_limit(new.organization_id, 'branches', existing) then
    raise exception 'PLAN_LIMIT_REACHED: branch limit reached for this plan. Upgrade to add more branches.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists branches_plan_limit on public.branches;
create trigger branches_plan_limit before insert on public.branches
  for each row execute function public.enforce_branch_limit();

create or replace function public.enforce_employee_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  existing integer;
begin
  select count(*) into existing from public.employee_profiles where organization_id = new.organization_id;
  if not public.check_plan_limit(new.organization_id, 'employees', existing) then
    raise exception 'PLAN_LIMIT_REACHED: employee limit reached for this plan. Upgrade to add more workers.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists employee_profiles_plan_limit on public.employee_profiles;
create trigger employee_profiles_plan_limit before insert on public.employee_profiles
  for each row execute function public.enforce_employee_limit();

-- Every organization gets a real subscription row the moment it's created,
-- defaulting to the FREE plan and already ACTIVE (free has no trial concept
-- -- trialing is reserved for a paid plan someone has deliberately started).
create or replace function public.create_default_subscription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  free_plan_id uuid;
  new_subscription_id uuid;
begin
  select id into free_plan_id from public.plans where code = 'free' and active limit 1;
  if free_plan_id is null then return new; end if; -- plans not seeded yet in this environment; skip rather than fail org creation
  insert into public.subscriptions (organization_id, plan_id, status, current_period_start)
    values (new.id, free_plan_id, 'active', now())
    returning id into new_subscription_id;
  insert into public.subscription_events (subscription_id, organization_id, event_type, to_plan_id, actor_id, note)
    values (new_subscription_id, new.id, 'created', free_plan_id, auth.uid(), 'Default plan assigned at organization creation');
  return new;
end;
$$;
drop trigger if exists organizations_default_subscription on public.organizations;
create trigger organizations_default_subscription after insert on public.organizations
  for each row execute function public.create_default_subscription();

-- Self-serve trial start for a paid plan -- no payment collection, because
-- there is no provider wired in yet. This is what "paid plans receive a
-- 7-day trial" means before Phase 4's payment integration exists: the
-- trial period itself was never supposed to require a card, and gating it
-- behind having a payment provider ready would be a spec violation, not
-- caution.
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
  if not public.is_org_owner(target_org) then
    raise exception 'UNAUTHORIZED: only the organization owner can change plans';
  end if;
  select * into plan_row from public.plans where id = target_plan and active;
  if plan_row.id is null then raise exception 'PLAN_NOT_FOUND'; end if;
  select * into current_sub from public.subscriptions where organization_id = target_org for update;
  if current_sub.id is null then raise exception 'SUBSCRIPTION_NOT_FOUND'; end if;
  if current_sub.status = 'trialing' then raise exception 'TRIAL_ALREADY_ACTIVE: a trial is already running for this organization'; end if;
  select * into price_row from public.plan_price_versions
    where plan_id = target_plan and status = 'active' and billing_interval = 'monthly' limit 1;
  update public.subscriptions set
    plan_id = target_plan,
    price_version_id = price_row.id,
    status = case when plan_row.trial_days > 0 then 'trialing' else 'active' end,
    trial_start = case when plan_row.trial_days > 0 then now() else null end,
    trial_end = case when plan_row.trial_days > 0 then now() + make_interval(days => plan_row.trial_days) else null end,
    current_period_start = now(),
    current_period_end = case when plan_row.trial_days > 0 then now() + make_interval(days => plan_row.trial_days) else null end,
    canceled_at = null,
    updated_at = now()
    where organization_id = target_org;
  insert into public.subscription_events (subscription_id, organization_id, event_type, from_plan_id, to_plan_id, actor_id, note)
    values (current_sub.id, target_org, case when plan_row.trial_days > 0 then 'trial_started' else 'plan_changed' end, current_sub.plan_id, target_plan, auth.uid(), 'Self-serve trial start (no payment collected -- provider not yet configured)');
end;
$$;

-- Platform-admin override: change an organization's plan/status directly
-- (grace periods, manual comps, downgrades for policy reasons, etc.),
-- always audited via subscription_events.
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

-- Read-only catalog for both the owner-side billing UI and the admin
-- pricing editor: one row per plan with its live price and limits attached,
-- so the frontend never has to stitch plans/prices/limits together itself
-- (and never has a reason to hardcode a price).
create or replace function public.get_plan_catalog()
returns table (
  plan_id uuid,
  code text,
  name text,
  description text,
  sort_order integer,
  trial_days integer,
  monthly_amount numeric,
  currency text,
  limits jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.code,
    p.name,
    p.description,
    p.sort_order,
    p.trial_days,
    pv.amount,
    pv.currency,
    coalesce((select jsonb_object_agg(pl.resource, pl.limit_value) from public.plan_limits pl where pl.plan_id = p.id), '{}'::jsonb)
  from public.plans p
  left join public.plan_price_versions pv on pv.plan_id = p.id and pv.status = 'active' and pv.billing_interval = 'monthly'
  where p.active
  order by p.sort_order;
$$;

alter table public.plans enable row level security;
alter table public.plan_price_versions enable row level security;
alter table public.plan_limits enable row level security;
alter table public.subscriptions enable row level security;
alter table public.subscription_events enable row level security;
alter table public.organization_entitlement_overrides enable row level security;

-- Plan catalog is public-readable metadata (needed for the pricing page
-- before someone has even signed up) -- never anything sensitive.
create policy plans_public_read on public.plans for select using (true);
create policy plan_prices_public_read on public.plan_price_versions for select using (true);
create policy plan_limits_public_read on public.plan_limits for select using (true);

create policy plans_admin_write on public.plans for all using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy plan_prices_admin_write on public.plan_price_versions for all using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy plan_limits_admin_write on public.plan_limits for all using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy subscriptions_owner_read on public.subscriptions for select using (public.is_org_member(organization_id) or public.is_platform_admin());
create policy subscriptions_admin_write on public.subscriptions for all using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy subscription_events_owner_read on public.subscription_events for select using (public.is_org_member(organization_id) or public.is_platform_admin());
create policy subscription_events_admin_write on public.subscription_events for insert with check (public.is_platform_admin());

create policy entitlement_overrides_admin on public.organization_entitlement_overrides for all using (public.is_platform_admin()) with check (public.is_platform_admin());

grant select on public.plans, public.plan_price_versions, public.plan_limits to anon, authenticated;
grant select on public.subscriptions, public.subscription_events, public.organization_entitlement_overrides to authenticated;
grant insert, update, delete on public.plans, public.plan_price_versions, public.plan_limits, public.subscriptions, public.organization_entitlement_overrides to authenticated;
grant insert on public.subscription_events to authenticated;
revoke all on function public.admin_set_subscription(uuid, uuid, text, text) from public, anon;
revoke all on function public.create_default_subscription() from public, anon, authenticated;
revoke all on function public.enforce_product_limit() from public, anon, authenticated;
revoke all on function public.enforce_branch_limit() from public, anon, authenticated;
revoke all on function public.enforce_employee_limit() from public, anon, authenticated;

-- Seed the five plans from the spec as real, admin-editable rows -- never
-- hardcoded in the frontend. These are STARTING values; changing a price
-- here later must go through a new plan_price_versions row (superseding
-- the old one), never an update to an existing row, so historical
-- subscriptions are never silently repriced.
insert into public.plans (code, name, description, sort_order, trial_days) values
  ('free', 'Free', 'Get started with the essentials.', 0, 0),
  ('basic', 'Basic', 'For a single small shop finding its rhythm.', 1, 7),
  ('pro', 'Pro', 'For growing businesses with a few branches.', 2, 7),
  ('pro_plus', 'Pro Plus', 'For multi-branch operations that need more room.', 3, 7),
  ('enterprise', 'Enterprise', 'Custom limits and support for larger operations.', 4, 7)
on conflict (code) do nothing;

insert into public.plan_price_versions (plan_id, currency, amount, billing_interval, version, status)
  select id, 'NGN', 0, 'monthly', 1, 'active' from public.plans where code = 'free'
  union all select id, 'NGN', 5000, 'monthly', 1, 'active' from public.plans where code = 'basic'
  union all select id, 'NGN', 8000, 'monthly', 1, 'active' from public.plans where code = 'pro'
  union all select id, 'NGN', 12000, 'monthly', 1, 'active' from public.plans where code = 'pro_plus'
on conflict (plan_id, billing_interval, version) do nothing;
-- Enterprise is "custom pricing" by definition -- no default price row.

insert into public.plan_limits (plan_id, resource, limit_value)
  select id, 'products', 50 from public.plans where code = 'free'
  union all select id, 'customers', 100 from public.plans where code = 'free'
  union all select id, 'employees', 2 from public.plans where code = 'free'
  union all select id, 'branches', 1 from public.plans where code = 'free'
  union all select id, 'sales_per_month', 50 from public.plans where code = 'free'
  union all select id, 'storage_mb', 100 from public.plans where code = 'free'
  union all select id, 'products', 150 from public.plans where code = 'basic'
  union all select id, 'customers', 500 from public.plans where code = 'basic'
  union all select id, 'employees', 5 from public.plans where code = 'basic'
  union all select id, 'branches', 1 from public.plans where code = 'basic'
  union all select id, 'sales_per_month', 500 from public.plans where code = 'basic'
  union all select id, 'storage_mb', 500 from public.plans where code = 'basic'
  union all select id, 'products', 300 from public.plans where code = 'pro'
  union all select id, 'customers', 2000 from public.plans where code = 'pro'
  union all select id, 'employees', 15 from public.plans where code = 'pro'
  union all select id, 'branches', 3 from public.plans where code = 'pro'
  union all select id, 'sales_per_month', 2000 from public.plans where code = 'pro'
  union all select id, 'storage_mb', 1024 from public.plans where code = 'pro'
  union all select id, 'products', 500 from public.plans where code = 'pro_plus'
  union all select id, 'customers', 5000 from public.plans where code = 'pro_plus'
  union all select id, 'employees', 30 from public.plans where code = 'pro_plus'
  union all select id, 'branches', 5 from public.plans where code = 'pro_plus'
  union all select id, 'sales_per_month', 5000 from public.plans where code = 'pro_plus'
  union all select id, 'storage_mb', 2048 from public.plans where code = 'pro_plus'
on conflict (plan_id, resource) do nothing;
-- Enterprise intentionally gets no plan_limits rows -- get_plan_limit()
-- resolves a missing row as unlimited, which is exactly "custom limits,
-- configured per organization" for a plan whose whole premise is custom.

-- Backfill: any organization created before this migration has no
-- subscription row yet (the trigger only fires on new organizations).
-- Give every existing organization the same default the trigger would have
-- given it, so no business is left with an undefined plan.
insert into public.subscriptions (organization_id, plan_id, status, current_period_start)
  select o.id, (select id from public.plans where code = 'free'), 'active', now()
  from public.organizations o
  where not exists (select 1 from public.subscriptions s where s.organization_id = o.id);
