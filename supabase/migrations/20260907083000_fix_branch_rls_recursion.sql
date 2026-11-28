-- Avoid circular RLS evaluation between branches and branch_members.
create or replace function public.is_assigned_branch(target_branch uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.branch_members
    where branch_id = target_branch
      and user_id = auth.uid()
  );
$$;

create or replace function public.branch_belongs_to_org(target_branch uuid, target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.branches
    where id = target_branch
      and organization_id = target_org
  );
$$;

create or replace function public.branch_org_id(target_branch uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id
  from public.branches
  where id = target_branch;
$$;

drop policy if exists "members view assigned branches" on public.branches;
create policy "members view assigned branches" on public.branches
for select
using (
  public.is_org_member(organization_id)
  and (
    public.is_org_admin(organization_id)
    or public.is_assigned_branch(id)
  )
);

drop policy if exists "members view branch assignments" on public.branch_members;
create policy "members view branch assignments" on public.branch_members
for select
using (
  public.is_org_member(public.branch_org_id(branch_members.branch_id))
);

drop policy if exists "admins manage branch assignments" on public.branch_members;
create policy "admins manage branch assignments" on public.branch_members
for all
using (
  public.is_org_admin(public.branch_org_id(branch_members.branch_id))
)
with check (
  public.branch_belongs_to_org(
    branch_members.branch_id,
    public.branch_org_id(branch_members.branch_id)
  )
);
