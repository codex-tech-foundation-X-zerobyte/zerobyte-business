create table if not exists public.support_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.support_conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  sender_role text not null check (sender_role in ('customer', 'admin')),
  body text not null check (char_length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists support_conversations_org_updated_idx on public.support_conversations (organization_id, updated_at desc);
create index if not exists support_messages_conversation_created_idx on public.support_messages (conversation_id, created_at);
alter table public.support_conversations enable row level security;
alter table public.support_messages enable row level security;

create or replace function public.touch_support_conversation() returns trigger language plpgsql security definer set search_path = public as $$
begin update public.support_conversations set updated_at = now() where id = new.conversation_id; return new; end;
$$;
drop trigger if exists support_message_touches_conversation on public.support_messages;
create trigger support_message_touches_conversation after insert on public.support_messages for each row execute function public.touch_support_conversation();

create policy "support participants read conversations" on public.support_conversations for select using (user_id = auth.uid() or public.is_platform_admin());
create policy "support users create conversations" on public.support_conversations for insert with check (user_id = auth.uid() and exists (select 1 from public.organization_members m where m.organization_id = support_conversations.organization_id and m.user_id = auth.uid()));
create policy "support admins update conversations" on public.support_conversations for update using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy "support participants read messages" on public.support_messages for select using (exists (select 1 from public.support_conversations c where c.id = conversation_id and (c.user_id = auth.uid() or public.is_platform_admin())));
create policy "support participants send messages" on public.support_messages for insert with check (sender_id = auth.uid() and exists (select 1 from public.support_conversations c where c.id = conversation_id and ((sender_role = 'customer' and c.user_id = auth.uid()) or (sender_role = 'admin' and public.is_platform_admin()))));

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'support_conversations') then alter publication supabase_realtime add table public.support_conversations; end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'support_messages') then alter publication supabase_realtime add table public.support_messages; end if;
end $$;
