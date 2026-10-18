-- Extends the existing support_conversations/support_messages system
-- (20260915164000_support_messaging.sql) with the priority, assignment,
-- and internal-notes fields the spec's Live Support phase asks for.
--
-- Deliberately does NOT touch the `status` column or its
-- support_one_open_conversation_per_user_org_idx unique index -- that
-- open/closed invariant is what the customer-facing "reopen if allowed"
-- flow depends on, and changing it risks breaking behavior I can't test
-- here. Instead, priority/assignment/the finer workflow stage
-- (PENDING/IN_PROGRESS/WAITING_FOR_USER/ESCALATED) are additive columns
-- layered on top, visible only to admins.

alter table public.support_conversations
  add column if not exists priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  add column if not exists assigned_to uuid references auth.users(id),
  add column if not exists admin_stage text not null default 'new' check (admin_stage in ('new', 'pending', 'in_progress', 'waiting_for_user', 'escalated'));

create index if not exists support_conversations_assigned_idx on public.support_conversations (assigned_to) where assigned_to is not null;
create index if not exists support_conversations_priority_idx on public.support_conversations (priority) where priority in ('high', 'urgent');

create table if not exists public.support_internal_notes (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.support_conversations(id) on delete cascade,
  author_id uuid not null references auth.users(id),
  body text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists support_internal_notes_conversation_idx on public.support_internal_notes (conversation_id, created_at);

alter table public.support_internal_notes enable row level security;
-- Internal notes are strictly an admin/agent tool -- never exposed to the
-- customer or the organization the conversation belongs to, regardless of
-- their role in that organization.
create policy support_internal_notes_admin_only on public.support_internal_notes
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());
grant select, insert on public.support_internal_notes to authenticated;

create or replace function public.admin_update_conversation_meta(
  target_conversation uuid,
  new_priority text default null,
  new_stage text default null,
  new_assignee uuid default null,
  clear_assignee boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then raise exception 'UNAUTHORIZED: platform admin access required'; end if;
  if new_priority is not null and new_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'VALIDATION_ERROR: unrecognized priority';
  end if;
  if new_stage is not null and new_stage not in ('new', 'pending', 'in_progress', 'waiting_for_user', 'escalated') then
    raise exception 'VALIDATION_ERROR: unrecognized stage';
  end if;
  update public.support_conversations set
    priority = coalesce(new_priority, priority),
    admin_stage = coalesce(new_stage, admin_stage),
    assigned_to = case when clear_assignee then null else coalesce(new_assignee, assigned_to) end,
    updated_at = now()
  where id = target_conversation;
end;
$$;
revoke all on function public.admin_update_conversation_meta(uuid, text, text, uuid, boolean) from public, anon;

-- Supersedes the earlier definition (20260915171000_support_identity.sql)
-- to add priority/admin_stage/assignee to what the admin console reads,
-- without changing any of its existing columns or behavior.
-- Postgres refuses CREATE OR REPLACE when the returned row type's columns
-- differ from the original (adding priority/admin_stage/assigned_to/
-- assigned_to_name counts as a different row type), so the old definition
-- has to be dropped first.
drop function if exists public.list_support_conversations();

create or replace function public.list_support_conversations()
returns table (
  id uuid,
  organization_id uuid,
  organization_name text,
  user_id uuid,
  user_name text,
  user_email text,
  status text,
  updated_at timestamptz,
  latest_body text,
  latest_sender_role text,
  latest_created_at timestamptz,
  unread boolean,
  priority text,
  admin_stage text,
  assigned_to uuid,
  assigned_to_name text
)
language sql
security definer
set search_path = public
as $$
  select c.id, c.organization_id, o.name,
    c.user_id, coalesce(nullif(p.full_name, ''), split_part(u.email, '@', 1), 'Customer'),
    u.email, c.status, c.updated_at, latest.body, latest.sender_role, latest.created_at,
    (latest.sender_role = 'customer' and (c.admin_read_at is null or latest.created_at > c.admin_read_at)),
    c.priority, c.admin_stage, c.assigned_to,
    coalesce(nullif(ap.full_name, ''), split_part(au.email, '@', 1))
  from public.support_conversations c
  join public.organizations o on o.id = c.organization_id
  join auth.users u on u.id = c.user_id
  left join public.profiles p on p.id = c.user_id
  left join auth.users au on au.id = c.assigned_to
  left join public.profiles ap on ap.id = c.assigned_to
  left join lateral (
    select m.body, m.sender_role, m.created_at
    from public.support_messages m
    where m.conversation_id = c.id
    order by m.created_at desc, m.id desc
    limit 1
  ) latest on true
  where public.is_platform_admin()
  order by
    case c.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end,
    c.updated_at desc;
$$;
revoke execute on function public.list_support_conversations() from public, anon, authenticated;
grant execute on function public.list_support_conversations() to authenticated;

-- List of admins/agents a conversation can be assigned to -- anyone with
-- active platform_admin_access, so the assignment dropdown never needs a
-- separate "agents" concept yet.
create or replace function public.list_platform_admins()
returns table (user_id uuid, name text, role text)
language sql
stable
security definer
set search_path = public
as $$
  select a.user_id, coalesce(nullif(p.full_name, ''), split_part(u.email, '@', 1), 'Admin'), a.role
  from public.platform_admin_access a
  join auth.users u on u.id = a.user_id
  left join public.profiles p on p.id = a.user_id
  where a.status = 'active' and public.is_platform_admin()
  order by 2;
$$;
revoke execute on function public.list_platform_admins() from public, anon;
grant execute on function public.list_platform_admins() to authenticated;
