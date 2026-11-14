-- Support chat rules:
--   * a chat lives for 24 hours: older messages are not readable and are deleted;
--   * customers waiting for a reply are in a queue, and see their place and a time estimate;
--   * only admin roles that include the Messages section can read or answer chats.

alter table public.support_conversations add column if not exists waiting_since timestamptz;
create index if not exists support_messages_created_idx on public.support_messages (created_at);
create index if not exists support_conversations_waiting_idx on public.support_conversations (waiting_since) where waiting_since is not null;

-- Who is waiting: a conversation whose newest message is from the customer.
update public.support_conversations c set waiting_since = l.created_at
  from (select distinct on (conversation_id) conversation_id, sender_role, created_at from public.support_messages
         order by conversation_id, created_at desc, id desc) l
 where l.conversation_id = c.id and l.sender_role = 'customer' and c.status = 'open';

-- Deletes chats older than 24 hours and closes conversations that have nothing left.
create or replace function public.purge_expired_support_messages()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.support_messages where created_at < now() - interval '24 hours';
  update public.support_conversations c set status = 'closed', waiting_since = null
   where c.status = 'open' and c.updated_at < now() - interval '24 hours'
     and not exists (select 1 from public.support_messages m where m.conversation_id = c.id);
end;
$$;
revoke all on function public.purge_expired_support_messages() from public, anon, authenticated;

create or replace function public.touch_support_conversation() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.support_conversations set
    updated_at = now(),
    waiting_since = case when new.sender_role = 'customer' then coalesce(waiting_since, now()) else null end
  where id = new.conversation_id;
  perform public.purge_expired_support_messages();
  return new;
end;
$$;

-- Closing a chat takes the customer out of the queue.
create or replace function public.clear_waiting_when_closed() returns trigger language plpgsql as $$
begin
  if new.status = 'closed' then new.waiting_since := null; end if;
  return new;
end;
$$;
drop trigger if exists support_conversation_clear_waiting on public.support_conversations;
create trigger support_conversation_clear_waiting before update of status on public.support_conversations
  for each row execute function public.clear_waiting_when_closed();

-- Access: only roles with the Messages section.
drop policy if exists "support participants read conversations" on public.support_conversations;
create policy "support participants read conversations" on public.support_conversations for select
  using (user_id = auth.uid() or public.admin_can_access('Messages'));
drop policy if exists "support admins update conversations" on public.support_conversations;
create policy "support admins update conversations" on public.support_conversations for update
  using (public.admin_can_access('Messages')) with check (public.admin_can_access('Messages'));
drop policy if exists "support participants read messages" on public.support_messages;
create policy "support participants read messages" on public.support_messages for select
  using (created_at > now() - interval '24 hours' and exists (
    select 1 from public.support_conversations c where c.id = conversation_id and (c.user_id = auth.uid() or public.admin_can_access('Messages'))));
drop policy if exists "support participants send messages" on public.support_messages;
create policy "support participants send messages" on public.support_messages for insert
  with check (sender_id = auth.uid() and exists (
    select 1 from public.support_conversations c where c.id = conversation_id
      and ((sender_role = 'customer' and c.user_id = auth.uid()) or (sender_role = 'admin' and public.admin_can_access('Messages')))));
drop policy if exists support_internal_notes_admin_only on public.support_internal_notes;
create policy support_internal_notes_admin_only on public.support_internal_notes
  for all using (public.admin_can_access('Messages')) with check (public.admin_can_access('Messages'));

create or replace function public.admin_update_conversation_meta(
  target_conversation uuid, new_priority text default null, new_stage text default null, new_assignee uuid default null, clear_assignee boolean default false
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_can_access('Messages') then raise exception 'UNAUTHORIZED: your admin role does not include Messages'; end if;
  if new_priority is not null and new_priority not in ('low', 'normal', 'high', 'urgent') then raise exception 'VALIDATION_ERROR: unrecognized priority'; end if;
  if new_stage is not null and new_stage not in ('new', 'pending', 'in_progress', 'waiting_for_user', 'escalated') then raise exception 'VALIDATION_ERROR: unrecognized stage'; end if;
  update public.support_conversations set
    priority = coalesce(new_priority, priority),
    admin_stage = coalesce(new_stage, admin_stage),
    assigned_to = case when clear_assignee then null else coalesce(new_assignee, assigned_to) end
  where id = target_conversation;
end;
$$;

create or replace function public.list_platform_admins()
returns table (user_id uuid, name text, role text)
language sql stable security definer set search_path = public as $$
  select a.user_id, coalesce(nullif(p.full_name, ''), split_part(u.email, '@', 1), 'Admin'), a.role::text
  from public.platform_admin_access a
  join auth.users u on u.id = a.user_id
  left join public.profiles p on p.id = a.user_id
  where a.status = 'active' and 'Messages' = any(public.admin_role_sections(a.role)) and public.admin_can_access('Messages')
  order by 2;
$$;
revoke all on function public.list_platform_admins() from public, anon;
grant execute on function public.list_platform_admins() to authenticated;

-- Place in the queue. Urgent and high priority chats are answered first, then oldest first.
create or replace function public.support_queue_rank(p_priority text) returns integer language sql immutable as $$
  select case p_priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end;
$$;

drop function if exists public.list_support_conversations();
create function public.list_support_conversations()
returns table (
  id uuid, organization_id uuid, organization_name text, user_id uuid, user_name text, user_email text, status text,
  updated_at timestamptz, latest_body text, latest_sender_role text, latest_created_at timestamptz, unread boolean,
  priority text, admin_stage text, assigned_to uuid, assigned_to_name text, waiting_since timestamptz, queue_position integer
)
language sql security definer set search_path = public as $$
  with waiting as (
    select c.id, row_number() over (order by public.support_queue_rank(c.priority), c.waiting_since, c.id)::integer as pos
    from public.support_conversations c where c.status = 'open' and c.waiting_since is not null
  )
  select c.id, c.organization_id, o.name, c.user_id, coalesce(nullif(p.full_name, ''), split_part(u.email, '@', 1), 'Customer'),
    u.email, c.status, c.updated_at, latest.body, latest.sender_role, latest.created_at,
    (latest.sender_role = 'customer' and (c.admin_read_at is null or latest.created_at > c.admin_read_at)),
    c.priority, c.admin_stage, c.assigned_to, coalesce(nullif(ap.full_name, ''), split_part(au.email, '@', 1)),
    c.waiting_since, w.pos
  from public.support_conversations c
  join public.organizations o on o.id = c.organization_id
  join auth.users u on u.id = c.user_id
  left join public.profiles p on p.id = c.user_id
  left join auth.users au on au.id = c.assigned_to
  left join public.profiles ap on ap.id = c.assigned_to
  left join waiting w on w.id = c.id
  join lateral (
    select m.body, m.sender_role, m.created_at from public.support_messages m
    where m.conversation_id = c.id and m.created_at > now() - interval '24 hours'
    order by m.created_at desc, m.id desc limit 1
  ) latest on true
  where public.admin_can_access('Messages')
  order by (w.pos is null), w.pos, latest.created_at desc;
$$;
revoke all on function public.list_support_conversations() from public, anon;
grant execute on function public.list_support_conversations() to authenticated;

-- What the customer sees: how many are ahead of them and roughly when to expect a reply.
create or replace function public.get_my_support_queue(p_conversation uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  mine public.support_conversations%rowtype;
  pos integer; total integer; avg_min numeric; agents integer; estimate integer;
begin
  select * into mine from public.support_conversations where id = p_conversation and user_id = auth.uid();
  if not found then raise exception 'NOT_FOUND'; end if;
  select count(*)::integer into total from public.support_conversations where status = 'open' and waiting_since is not null;
  if mine.status <> 'open' or mine.waiting_since is null then
    return jsonb_build_object('waiting', false, 'total_waiting', total);
  end if;
  select count(*)::integer + 1 into pos from public.support_conversations o
   where o.status = 'open' and o.waiting_since is not null and o.id <> mine.id
     and (public.support_queue_rank(o.priority), o.waiting_since, o.id) < (public.support_queue_rank(mine.priority), mine.waiting_since, mine.id);

  -- Average time an answer has taken in the last 24 hours (kept between 2 and 30 minutes; 5 when there is no data yet).
  with m as (
    select conversation_id, sender_role, created_at,
           lag(sender_role) over (partition by conversation_id order by created_at) as prev
    from public.support_messages where created_at > now() - interval '24 hours'
  ), starts as (
    select conversation_id, created_at from m where sender_role = 'customer' and prev is distinct from 'customer'
  ), waits as (
    select extract(epoch from (select min(a.created_at) from public.support_messages a
             where a.conversation_id = s.conversation_id and a.sender_role = 'admin' and a.created_at > s.created_at) - s.created_at) / 60 as minutes
    from starts s
  )
  select avg(minutes) into avg_min from waits where minutes is not null;
  avg_min := least(greatest(coalesce(avg_min, 5), 2), 30);

  -- Agents who answered in the last 30 minutes (at least one).
  select greatest(count(distinct sender_id), 1)::integer into agents from public.support_messages
   where sender_role = 'admin' and created_at > now() - interval '30 minutes';
  estimate := greatest(ceil(pos * avg_min / agents)::integer, 1);
  return jsonb_build_object('waiting', true, 'position', pos, 'ahead', pos - 1, 'total_waiting', total,
                            'estimated_minutes', estimate, 'average_minutes', round(avg_min));
end;
$$;
revoke all on function public.get_my_support_queue(uuid) from public, anon;
grant execute on function public.get_my_support_queue(uuid) to authenticated;

notify pgrst, 'reload schema';
