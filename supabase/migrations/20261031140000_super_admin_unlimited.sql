-- The super admin is never limited by section: every present and future section passes. Other roles keep their lists.
create or replace function public.admin_can_access(section text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin() or section = any(public.get_my_admin_sections());
$$;
revoke all on function public.admin_can_access(text) from public, anon;
grant execute on function public.admin_can_access(text) to authenticated;

notify pgrst, 'reload schema';
