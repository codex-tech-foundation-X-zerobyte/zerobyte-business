create or replace function public.get_platform_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Platform administrator access required';
  end if;

  return jsonb_build_object(
    'users', (select count(*) from auth.users),
    'organizations', (select count(*) from public.organizations),
    'branches', (select count(*) from public.branches),
    'employees', (select count(*) from public.employee_profiles),
    'products', (select count(*) from public.products),
    'customers', (select count(*) from public.customers),
    'sales', (select count(*) from public.sales),
    'invoices', (select count(*) from public.invoices),
    'expenses', (select count(*) from public.expenses)
  );
end;
$$;

grant execute on function public.get_platform_overview() to authenticated;
