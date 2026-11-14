create or replace function public.can_access_branch(target_org uuid, target_branch uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select target_branch is null
    or public.is_org_admin(target_org)
    or exists (
      select 1 from public.branch_members
      where branch_id = target_branch and user_id = auth.uid()
    );
$$;

drop policy if exists "members view products" on public.products;
create policy "members view assigned products" on public.products for select
  using (public.is_org_member(organization_id) and public.can_access_branch(organization_id, branch_id));

drop policy if exists "members view branches" on public.branches;
create policy "members view assigned branches" on public.branches for select
  using (public.is_org_member(organization_id) and (public.is_org_admin(organization_id) or exists (
    select 1 from public.branch_members where branch_id = branches.id and user_id = auth.uid()
  )));

drop policy if exists "members view expenses" on public.expenses;
create policy "members view assigned expenses" on public.expenses for select
  using (public.is_org_member(organization_id) and public.can_access_branch(organization_id, branch_id));

drop policy if exists "members view invoices" on public.invoices;
create policy "members view assigned invoices" on public.invoices for select
  using (public.is_org_member(organization_id) and public.can_access_branch(organization_id, branch_id));

drop policy if exists "members view stock movements" on public.stock_movements;
create policy "members view assigned stock movements" on public.stock_movements for select
  using (public.is_org_member(organization_id) and public.can_access_branch(organization_id, branch_id));
