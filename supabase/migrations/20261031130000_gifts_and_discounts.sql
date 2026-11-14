-- Gifts and discounts. Super admin only. Every action is written to the admin audit log.
--   * A GIFT adds 30 days on a paid plan to a business, for free.
--   * A DISCOUNT takes a percentage off that business's next online payment. The price is worked out on the server when the
--     payment is started (paystack-initialize), so the browser can never choose its own price.

create table if not exists public.subscription_discounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan_code text,                                   -- null = any paid plan
  percent integer not null check (percent between 1 and 99),
  uses_left integer not null default 1 check (uses_left >= 0),
  expires_at timestamptz,
  reason text not null check (char_length(btrim(reason)) between 5 and 300),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists subscription_discounts_org_idx on public.subscription_discounts (organization_id, created_at desc);
alter table public.subscription_discounts enable row level security;
-- No policies: nobody reads or writes this table directly. Admins use the functions below; the payment function uses the service role.
revoke all on public.subscription_discounts from public, anon, authenticated;

alter table public.payments add column if not exists discount_id uuid references public.subscription_discounts(id);
alter table public.payments add column if not exists discount_percent integer;
alter table public.payments add column if not exists list_amount_kobo bigint;

-- The best discount a business can use right now for a plan (called by paystack-initialize with the service role only).
create or replace function public.best_discount_for(p_org uuid, p_plan uuid)
returns table (id uuid, percent integer)
language sql
stable
security definer
set search_path = public
as $$
  select d.id, d.percent
  from public.subscription_discounts d
  where d.organization_id = p_org
    and d.revoked_at is null
    and d.uses_left > 0
    and (d.expires_at is null or d.expires_at > now())
    and (d.plan_code is null or d.plan_code = (select p.code from public.plans p where p.id = p_plan))
  order by d.percent desc, d.created_at
  limit 1;
$$;
revoke all on function public.best_discount_for(uuid, uuid) from public, anon, authenticated;

-- A discount is used up only when the payment that carries it succeeds.
create or replace function public.consume_discount_on_payment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'success' and old.status is distinct from 'success' and new.discount_id is not null then
    update public.subscription_discounts set uses_left = greatest(uses_left - 1, 0) where id = new.discount_id;
  end if;
  return new;
end;
$$;
drop trigger if exists payments_consume_discount on public.payments;
create trigger payments_consume_discount after update of status on public.payments
  for each row execute function public.consume_discount_on_payment();

-- Search for a business to gift or discount.
create or replace function public.admin_search_organizations(p_query text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_super_admin() then raise exception 'UNAUTHORIZED: super admin access required'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(r)) from (
      select o.id, o.name, pl.name as plan, s.status, s.current_period_end as period_end, s.provider
      from public.organizations o
      left join public.subscriptions s on s.organization_id = o.id
      left join public.plans pl on pl.id = s.plan_id
      where char_length(btrim(coalesce(p_query, ''))) >= 2 and o.name ilike '%' || replace(replace(btrim(p_query), '%', ''), '_', '') || '%'
      order by o.name limit 15
    ) r), '[]'::jsonb);
end;
$$;
revoke all on function public.admin_search_organizations(text) from public, anon;
grant execute on function public.admin_search_organizations(text) to authenticated;

-- 30 days on a paid plan, starting from the later of "now" and the end of the current paid period.
create or replace function public.admin_gift_plan(p_org uuid, p_plan_code text, p_reason text)
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  target_plan public.plans%rowtype;
  sub public.subscriptions%rowtype;
  start_from timestamptz;
  new_end timestamptz;
  price_id uuid;
begin
  if not public.is_super_admin() then raise exception 'UNAUTHORIZED: super admin access required'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'VALIDATION_ERROR: give a reason of at least 5 characters'; end if;
  select * into target_plan from public.plans where code = p_plan_code and active and code not in ('free', 'enterprise');
  if target_plan.id is null then raise exception 'VALIDATION_ERROR: choose a paid plan (basic, pro or pro_plus)'; end if;
  select * into sub from public.subscriptions where organization_id = p_org for update;
  if sub.id is null then raise exception 'NOT_FOUND: that business has no subscription record'; end if;
  if sub.status = 'active' and sub.provider = 'paystack' and sub.plan_id <> target_plan.id
     and sub.current_period_end is not null and sub.current_period_end > now() then
    raise exception 'VALIDATION_ERROR: this business has paid time on a different plan; gift the same plan or wait until it ends';
  end if;
  -- Time already granted (paid or gifted) is never lost: add after it. A trial or an ended plan simply starts now.
  start_from := case when sub.status = 'active' and sub.current_period_end is not null and sub.current_period_end > now() then sub.current_period_end else now() end;
  new_end := start_from + interval '30 days';
  select id into price_id from public.plan_price_versions where plan_id = target_plan.id and status = 'active' and billing_interval = 'monthly' limit 1;
  update public.subscriptions set
    plan_id = target_plan.id, price_version_id = coalesce(price_id, price_version_id), status = 'active', trial_end = null,
    current_period_start = case when sub.status = 'active' and sub.plan_id = target_plan.id and sub.current_period_end > now() then sub.current_period_start else now() end,
    current_period_end = new_end, canceled_at = null,
    provider = case when sub.provider = 'paystack' and sub.current_period_end > now() then sub.provider else 'gift' end,
    updated_at = now()
  where id = sub.id;
  insert into public.subscription_events (subscription_id, organization_id, event_type, from_plan_id, to_plan_id, actor_id, note)
    values (sub.id, p_org, 'admin_override', sub.plan_id, target_plan.id, auth.uid(), 'Gift of 30 days: ' || btrim(p_reason));
  insert into public.admin_audit_logs (actor_id, actor_role, action, target_type, target_id, organization_id, metadata)
    values (auth.uid(), 'SUPER_ADMIN', 'gift_plan', 'organization', p_org, p_org, jsonb_build_object('plan', p_plan_code, 'days', 30, 'reason', btrim(p_reason), 'until', new_end));
  return new_end;
end;
$$;
revoke all on function public.admin_gift_plan(uuid, text, text) from public, anon;
grant execute on function public.admin_gift_plan(uuid, text, text) to authenticated;

create or replace function public.admin_create_discount(p_org uuid, p_percent integer, p_plan_code text, p_uses integer, p_valid_days integer, p_reason text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  if not public.is_super_admin() then raise exception 'UNAUTHORIZED: super admin access required'; end if;
  if p_percent is null or p_percent < 1 or p_percent > 99 then raise exception 'VALIDATION_ERROR: the discount must be between 1 and 99 percent'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'VALIDATION_ERROR: give a reason of at least 5 characters'; end if;
  if coalesce(p_uses, 1) < 1 or coalesce(p_uses, 1) > 24 then raise exception 'VALIDATION_ERROR: uses must be between 1 and 24'; end if;
  if p_valid_days is not null and (p_valid_days < 1 or p_valid_days > 365) then raise exception 'VALIDATION_ERROR: validity must be between 1 and 365 days'; end if;
  if p_plan_code is not null and not exists (select 1 from public.plans where code = p_plan_code and code not in ('free', 'enterprise')) then
    raise exception 'VALIDATION_ERROR: unknown plan';
  end if;
  if not exists (select 1 from public.organizations where id = p_org) then raise exception 'NOT_FOUND: business not found'; end if;
  insert into public.subscription_discounts (organization_id, plan_code, percent, uses_left, expires_at, reason, created_by)
    values (p_org, nullif(p_plan_code, ''), p_percent, coalesce(p_uses, 1), case when p_valid_days is null then null else now() + make_interval(days => p_valid_days) end, btrim(p_reason), auth.uid())
    returning id into new_id;
  insert into public.admin_audit_logs (actor_id, actor_role, action, target_type, target_id, organization_id, metadata)
    values (auth.uid(), 'SUPER_ADMIN', 'create_discount', 'subscription_discount', new_id, p_org,
            jsonb_build_object('percent', p_percent, 'plan', p_plan_code, 'uses', coalesce(p_uses, 1), 'valid_days', p_valid_days, 'reason', btrim(p_reason)));
  return new_id;
end;
$$;
revoke all on function public.admin_create_discount(uuid, integer, text, integer, integer, text) from public, anon;
grant execute on function public.admin_create_discount(uuid, integer, text, integer, integer, text) to authenticated;

create or replace function public.admin_revoke_discount(p_discount uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare d public.subscription_discounts%rowtype;
begin
  if not public.is_super_admin() then raise exception 'UNAUTHORIZED: super admin access required'; end if;
  update public.subscription_discounts set revoked_at = now() where id = p_discount and revoked_at is null returning * into d;
  if d.id is null then raise exception 'NOT_FOUND: discount not found or already revoked'; end if;
  insert into public.admin_audit_logs (actor_id, actor_role, action, target_type, target_id, organization_id, metadata)
    values (auth.uid(), 'SUPER_ADMIN', 'revoke_discount', 'subscription_discount', d.id, d.organization_id, jsonb_build_object('percent', d.percent));
end;
$$;
revoke all on function public.admin_revoke_discount(uuid) from public, anon;
grant execute on function public.admin_revoke_discount(uuid) to authenticated;

create or replace function public.admin_list_discounts()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_super_admin() then raise exception 'UNAUTHORIZED: super admin access required'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(r) order by r.created_at desc) from (
      select d.id, d.organization_id, o.name as organization_name, d.plan_code, d.percent, d.uses_left, d.expires_at, d.reason, d.created_at, d.revoked_at,
             (d.revoked_at is null and d.uses_left > 0 and (d.expires_at is null or d.expires_at > now())) as usable
      from public.subscription_discounts d join public.organizations o on o.id = d.organization_id
      order by d.created_at desc limit 100
    ) r), '[]'::jsonb);
end;
$$;
revoke all on function public.admin_list_discounts() from public, anon;
grant execute on function public.admin_list_discounts() to authenticated;

-- Granting access by hand (any plan, any status) is a super admin power only. It has no screen; the gift function is the safe way.
create or replace function public.admin_set_subscription(target_org uuid, target_plan uuid, target_status text, note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  current_sub public.subscriptions%rowtype;
  price_row public.plan_price_versions%rowtype;
begin
  if not public.is_super_admin() then raise exception 'UNAUTHORIZED: super admin access required'; end if;
  if target_status not in ('trialing', 'active', 'past_due', 'canceled', 'expired', 'suspended') then
    raise exception 'VALIDATION_ERROR: unrecognized subscription status';
  end if;
  select * into current_sub from public.subscriptions where organization_id = target_org for update;
  if current_sub.id is null then raise exception 'SUBSCRIPTION_NOT_FOUND'; end if;
  select * into price_row from public.plan_price_versions where plan_id = target_plan and status = 'active' and billing_interval = 'monthly' limit 1;
  update public.subscriptions set plan_id = target_plan, price_version_id = coalesce(price_row.id, price_version_id), status = target_status,
    canceled_at = case when target_status = 'canceled' then now() else null end, updated_at = now() where organization_id = target_org;
  insert into public.subscription_events (subscription_id, organization_id, event_type, from_plan_id, to_plan_id, actor_id, note)
    values (current_sub.id, target_org, 'admin_override', current_sub.plan_id, target_plan, auth.uid(), coalesce(note, 'Admin-adjusted subscription'));
  insert into public.admin_audit_logs (actor_id, actor_role, action, target_type, target_id, organization_id, metadata)
    values (auth.uid(), 'SUPER_ADMIN', 'set_subscription', 'organization', target_org, target_org, jsonb_build_object('plan_id', target_plan, 'status', target_status, 'note', note));
end;
$$;

-- The Gifts section is for the super admin only.
create or replace function public.admin_role_sections(p_role public.platform_admin_role)
returns text[]
language sql
immutable
as $$
  select case p_role::text
    when 'SUPER_ADMIN' then array['Overview','Analytics','Users','Organizations','Subscriptions','Plans','Promoters','Payouts','Revenue','Gifts','Admins',
                                  'Branches','Inventory','Sales','Notifications','Messages','Feedback','Roadmap','Audit log','Monitoring','Profile','Settings']
    when 'PLATFORM_ADMIN' then array['Overview','Analytics','Users','Organizations','Subscriptions','Promoters',
                                     'Branches','Inventory','Sales','Notifications','Feedback','Roadmap','Audit log','Monitoring','Profile','Settings']
    when 'SUPPORT_ADMIN' then array['Messages','Feedback','Notifications','Profile','Settings']
    when 'FINANCE_ADMIN' then array['Overview','Subscriptions','Plans','Payouts','Revenue','Profile','Settings']
    when 'MODERATION_ADMIN' then array['Users','Organizations','Feedback','Audit log','Profile','Settings']
    else array[]::text[]
  end;
$$;

notify pgrst, 'reload schema';
