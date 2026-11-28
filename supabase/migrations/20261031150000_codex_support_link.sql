-- Link between the in-app support chat and the Codex Customer Service desk.
-- A chat is sent to Codex as a ticket (external_ref "ZB-<conversation id>"). Codex then calls back (signed) with staff
-- replies and status changes; they are applied here and appear in the customer's chat.

alter table public.support_messages alter column sender_id drop not null;
alter table public.support_messages add column if not exists source text not null default 'zerobyte' check (source in ('zerobyte', 'codex'));
alter table public.support_messages drop constraint if exists support_messages_sender_known;
alter table public.support_messages add constraint support_messages_sender_known check (sender_id is not null or source = 'codex');

alter table public.support_conversations add column if not exists codex_ticket text;
alter table public.support_conversations add column if not exists codex_status text;
alter table public.support_conversations add column if not exists codex_status_sequence integer;

-- Every callback event id that was handled, so a repeat (Codex retries) is never applied twice. Old rows are not needed.
create table if not exists public.codex_callback_events (
  event_id text primary key,
  received_at timestamptz not null default now()
);
alter table public.codex_callback_events enable row level security;
revoke all on public.codex_callback_events from public, anon, authenticated;

create or replace function public.apply_codex_support_event(
  p_event_id text, p_event text, p_sequence integer, p_external_ref text, p_body text, p_status text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  conv public.support_conversations%rowtype;
  target uuid;
  inserted integer;
begin
  if p_event_id is null or char_length(p_event_id) not between 1 and 200 then return 'ignored'; end if;
  insert into public.codex_callback_events (event_id) values (p_event_id) on conflict do nothing;
  get diagnostics inserted = row_count;
  if inserted = 0 then return 'duplicate'; end if;
  delete from public.codex_callback_events where received_at < now() - interval '14 days';

  if p_external_ref is null or p_external_ref !~ '^ZB-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return 'unknown_ticket'; end if;
  select * into conv from public.support_conversations where id = substr(p_external_ref, 4)::uuid for update;
  if conv.id is null then return 'unknown_ticket'; end if;
  target := conv.id;

  -- A staff reply after the 24-hour chat has closed: reopen it, or use the customer's current open chat.
  if p_event in ('ticket.reply', 'ticket.status') and conv.status = 'closed' then
    begin
      update public.support_conversations set status = 'open' where id = conv.id;
    exception when unique_violation then
      select id into target from public.support_conversations where organization_id = conv.organization_id and user_id = conv.user_id and status = 'open' limit 1;
      target := coalesce(target, conv.id);
    end;
  end if;

  if p_event = 'ticket.reply' then
    if p_body is null or char_length(btrim(p_body)) = 0 then return 'ignored'; end if;
    insert into public.support_messages (conversation_id, sender_id, sender_role, body, source)
      values (target, null, 'admin', left(btrim(p_body), 4000), 'codex');
    return 'applied';
  elsif p_event = 'ticket.status' then
    if p_status is null or char_length(p_status) > 40 then return 'ignored'; end if;
    -- Messages can arrive out of order: an older status never overwrites a newer one.
    if p_sequence is not null and conv.codex_status_sequence is not null and p_sequence <= conv.codex_status_sequence then return 'stale'; end if;
    update public.support_conversations set codex_status = p_status, codex_status_sequence = coalesce(p_sequence, codex_status_sequence) where id = conv.id;
    if p_status = 'resolved' then
      insert into public.support_messages (conversation_id, sender_id, sender_role, body, source)
        values (target, null, 'admin', 'Technical support marked your ticket as resolved. If it is not fixed, reply here. You can also rate the help below.', 'codex');
    end if;
    return 'applied';
  end if;
  return 'ignored';
end;
$$;
revoke all on function public.apply_codex_support_event(text, text, integer, text, text, text) from public, anon, authenticated;

notify pgrst, 'reload schema';
