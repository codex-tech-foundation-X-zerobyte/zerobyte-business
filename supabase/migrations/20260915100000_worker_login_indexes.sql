-- Keep workspace-scoped worker login lookups fast without making employee IDs
-- globally unique. The workspace slug is the explicit disambiguating context.
create index if not exists idx_employee_profiles_org_employee_active
  on public.employee_profiles(organization_id, employee_id)
  where employment_status = 'active' and user_id is not null;

create index if not exists idx_organizations_slug_lookup
  on public.organizations(slug);
