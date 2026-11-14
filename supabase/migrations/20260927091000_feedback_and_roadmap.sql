-- Customer feedback loop (Phase 74) and product roadmap (Phase 75).
-- Both are payment-independent and self-contained: no provider, no
-- external API, straightforward CRUD with RLS.

create table public.product_feedback (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  category text not null check (category in ('bug', 'ux', 'feature_request', 'performance', 'billing', 'security', 'documentation', 'integration')),
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high', 'critical')),
  message text not null check (char_length(trim(message)) between 1 and 4000),
  status text not null default 'new' check (status in ('new', 'reviewing', 'planned', 'resolved', 'declined')),
  admin_response text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index product_feedback_status_idx on public.product_feedback (status, created_at desc);
create index product_feedback_org_idx on public.product_feedback (organization_id, created_at desc);

alter table public.product_feedback enable row level security;
create policy product_feedback_member_read on public.product_feedback
  for select using (public.is_org_member(organization_id) or public.is_platform_admin());
create policy product_feedback_member_insert on public.product_feedback
  for insert with check (public.is_org_member(organization_id) and user_id = auth.uid());
create policy product_feedback_admin_update on public.product_feedback
  for update using (public.is_platform_admin()) with check (public.is_platform_admin());
grant select, insert on public.product_feedback to authenticated;
grant update (status, admin_response, updated_at) on public.product_feedback to authenticated;

create table public.roadmap_items (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 1 and 200),
  description text not null default '',
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  target_release text,
  status text not null default 'idea' check (status in ('idea', 'planned', 'in_progress', 'beta', 'released', 'deferred')),
  owner_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index roadmap_items_status_idx on public.roadmap_items (status, priority);

alter table public.roadmap_items enable row level security;
-- Admin-managed only for now -- no public roadmap page yet, so no public
-- read policy. Easy to add later (a `is_public boolean` column plus a
-- public-read policy) without touching this shape.
create policy roadmap_items_admin_all on public.roadmap_items
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());

create or replace function public.admin_update_feedback(target_feedback uuid, new_status text default null, response text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then raise exception 'UNAUTHORIZED: platform admin access required'; end if;
  if new_status is not null and new_status not in ('new', 'reviewing', 'planned', 'resolved', 'declined') then
    raise exception 'VALIDATION_ERROR: unrecognized status';
  end if;
  update public.product_feedback set
    status = coalesce(new_status, status),
    admin_response = coalesce(response, admin_response),
    updated_at = now()
  where id = target_feedback;
end;
$$;
revoke all on function public.admin_update_feedback(uuid, text, text) from public, anon;

-- Admin listing with the organization name attached, since the raw table
-- only has organization_id -- matches the pattern used for subscriptions.
create or replace function public.admin_list_feedback()
returns table (
  id uuid, organization_id uuid, organization_name text, user_id uuid, user_email text,
  category text, severity text, message text, status text, admin_response text, created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select f.id, f.organization_id, o.name, f.user_id, u.email,
    f.category, f.severity, f.message, f.status, f.admin_response, f.created_at
  from public.product_feedback f
  join public.organizations o on o.id = f.organization_id
  join auth.users u on u.id = f.user_id
  where public.is_platform_admin()
  order by
    case f.severity when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end,
    f.created_at desc;
$$;
revoke all on function public.admin_list_feedback() from public, anon;
