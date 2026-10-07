-- Keep provisioned worker branch assignments available to branch-scoped RLS
-- and RPCs. Existing workers are backfilled; new workers are linked by the
-- provisioning Edge Function.
insert into public.branch_members (branch_id, user_id)
select ep.branch_id, ep.user_id
from public.employee_profiles ep
join public.branches b on b.id = ep.branch_id
where ep.user_id is not null
  and ep.branch_id is not null
  and b.status = 'active'
on conflict (branch_id, user_id) do nothing;

create or replace function public.can_access_branch(target_org uuid, target_branch uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_org_member(target_org)
    and (
      (target_branch is null and public.is_org_manager(target_org))
      or (
        target_branch is not null
        and (
          (public.is_org_manager(target_org) and exists (
            select 1 from public.branches b
            where b.id = target_branch and b.organization_id = target_org
          ))
          or (public.valid_org_branch(target_org, target_branch) and exists (
            select 1 from public.branch_members bm
            where bm.branch_id = target_branch and bm.user_id = auth.uid()
          ))
        )
      )
    );
$$;
