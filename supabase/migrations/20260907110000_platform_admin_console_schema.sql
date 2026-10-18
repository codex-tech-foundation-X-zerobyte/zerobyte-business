create type public.platform_admin_role as enum ('SUPER_ADMIN', 'PLATFORM_ADMIN', 'SUPPORT_ADMIN', 'FINANCE_ADMIN', 'MODERATION_ADMIN');

create table if not exists public.platform_admin_access (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.platform_admin_role not null,
  status text not null default 'active' check (status in ('active', 'suspended', 'revoked')),
  granted_by uuid references auth.users(id),
  granted_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (user_id, role)
);

create index if not exists idx_platform_admin_access_user on public.platform_admin_access(user_id);
create index if not exists idx_platform_admin_access_role on public.platform_admin_access(role);

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id),
  actor_role public.platform_admin_role,
  action text not null,
  target_type text,
  target_id uuid,
  organization_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_admin_audit_logs_actor on public.admin_audit_logs(actor_id);
create index if not exists idx_admin_audit_logs_target on public.admin_audit_logs(target_type, target_id);
create index if not exists idx_admin_audit_logs_created_at on public.admin_audit_logs(created_at desc);

create table if not exists public.admin_notifications (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id),
  title text not null,
  message text not null,
  category text not null default 'platform',
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'critical')),
  audience text not null default 'all_users' check (audience in ('all_users', 'all_organizations', 'selected_users', 'selected_organizations', 'plan_based')),
  organization_id uuid,
  target_user_id uuid,
  plan_name text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'sent', 'failed')),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_admin_notifications_created_by on public.admin_notifications(created_by);
create index if not exists idx_admin_notifications_status on public.admin_notifications(status);

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.platform_admin_access
    where user_id = auth.uid()
      and status = 'active'
  );
$$;

create or replace function public.platform_admin_can_manage_org(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_platform_admin()
  and exists (
    select 1
    from public.organizations o
    where o.id = target_org
  );
$$;

alter table public.platform_admin_access enable row level security;
alter table public.admin_audit_logs enable row level security;
alter table public.admin_notifications enable row level security;

create policy "platform admins can read their access rows"
on public.platform_admin_access
for select using (public.is_platform_admin());

create policy "platform admins can read audit logs"
on public.admin_audit_logs
for select using (public.is_platform_admin());

create policy "platform admins can manage admin notifications"
on public.admin_notifications
for all using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy "platform admins can insert access rows"
on public.platform_admin_access
for insert with check (public.is_platform_admin());

create policy "platform admins can update access rows"
on public.platform_admin_access
for update using (public.is_platform_admin()) with check (public.is_platform_admin());

create or replace function public.get_platform_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Platform administrator access required';
  end if;

  return jsonb_build_object(
    'users', (select count(*) from auth.users),
    'organizations', (select count(*) from public.organizations),
    'branches', (select count(*) from public.branches),
    'employees', (select count(*) from public.employee_profiles),
    'products', (select count(*) from public.products),
    'customers', (select count(*) from public.customers),
    'sales', (select count(*) from public.sales),
    'invoices', (select count(*) from public.invoices),
    'expenses', (select count(*) from public.expenses)
  );
end;
$$;

grant execute on function public.get_platform_overview() to authenticated;
