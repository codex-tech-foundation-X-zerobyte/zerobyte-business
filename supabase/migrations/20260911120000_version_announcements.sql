create table if not exists public.app_version_announcements (
  id uuid primary key default gen_random_uuid(),
  version text not null check (char_length(trim(version)) between 1 and 40),
  message text not null check (char_length(trim(message)) between 1 and 2000),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_version_announcements_created_at
  on public.app_version_announcements(created_at desc);

alter table public.app_version_announcements enable row level security;
create policy "authenticated users can read version announcements"
  on public.app_version_announcements for select
  using (auth.uid() is not null);

drop policy if exists "users mark their notifications read" on public.notifications;
create policy "users mark their notifications read"
  on public.notifications for update
  using (user_id = auth.uid() and public.is_org_member(organization_id))
  with check (user_id = auth.uid() and public.is_org_member(organization_id));

create or replace function public.publish_version_announcement(
  announcement_version text,
  announcement_message text
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare announcement_id uuid;
begin
  if not public.is_platform_admin() then
    raise exception using message = '{"code":"ADMIN_ACCESS_DENIED","message":"Platform administrator access required"}';
  end if;
  if nullif(trim(announcement_version), '') is null or nullif(trim(announcement_message), '') is null then
    raise exception using message = '{"code":"VALIDATION_ERROR","message":"Version and message are required"}';
  end if;
  insert into public.app_version_announcements(version, message, created_by)
  values (trim(announcement_version), trim(announcement_message), auth.uid())
  returning id into announcement_id;
  insert into public.notifications(organization_id, user_id, title, body)
  select om.organization_id, om.user_id,
    'New version available · ' || trim(announcement_version),
    trim(announcement_message)
  from public.organization_members om;
  insert into public.admin_audit_logs(actor_id, action, target_type, target_id, metadata)
  values (auth.uid(), 'version.announced', 'app_version_announcement', announcement_id,
    jsonb_build_object('version', trim(announcement_version)));
  return announcement_id;
end;
$$;

grant execute on function public.publish_version_announcement(text, text) to authenticated;
revoke all on function public.publish_version_announcement(text, text) from public, anon;
