alter table public.support_conversations
  add column if not exists admin_read_at timestamptz;

grant update (admin_read_at) on public.support_conversations to authenticated;

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
  unread boolean
)
language sql
security definer
set search_path = public
as $$
  select c.id, c.organization_id, o.name,
    c.user_id, coalesce(nullif(p.full_name, ''), split_part(u.email, '@', 1), 'Customer'),
    u.email, c.status, c.updated_at, latest.body, latest.sender_role, latest.created_at,
    (latest.sender_role = 'customer' and (c.admin_read_at is null or latest.created_at > c.admin_read_at))
  from public.support_conversations c
  join public.organizations o on o.id = c.organization_id
  join auth.users u on u.id = c.user_id
  left join public.profiles p on p.id = c.user_id
  left join lateral (
    select m.body, m.sender_role, m.created_at
    from public.support_messages m
    where m.conversation_id = c.id
    order by m.created_at desc, m.id desc
    limit 1
  ) latest on true
  where public.is_platform_admin()
  order by c.updated_at desc;
$$;

revoke execute on function public.list_support_conversations() from public, anon, authenticated;
grant execute on function public.list_support_conversations() to authenticated;
