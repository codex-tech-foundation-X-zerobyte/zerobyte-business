alter table public.support_conversations
  add column if not exists customer_read_at timestamptz;

grant update (customer_read_at) on public.support_conversations to authenticated;
