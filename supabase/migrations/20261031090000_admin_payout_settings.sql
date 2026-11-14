-- Lets the super admin and finance admin read the current minimum payout (the promoter-side function only works for promoters).
create or replace function public.admin_get_payout_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_view_financial_admin_data() then raise exception 'UNAUTHORIZED: super admin or finance admin access required'; end if;
  return jsonb_build_object(
    'minimum_payout_kobo', coalesce((select minimum_payout_kobo from public.promoter_program_terms limit 1), 1000000),
    'can_change', public.is_super_admin()
  );
end;
$$;
revoke all on function public.admin_get_payout_settings() from public, anon;
grant execute on function public.admin_get_payout_settings() to authenticated;

notify pgrst, 'reload schema';
