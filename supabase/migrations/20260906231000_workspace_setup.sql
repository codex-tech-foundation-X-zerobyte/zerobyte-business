create or replace function public.create_workspace(workspace_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org_id uuid;
  workspace_slug text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;
  if length(trim(workspace_name)) < 2 then
    raise exception 'Business name must be at least 2 characters';
  end if;

  workspace_slug := regexp_replace(lower(trim(workspace_name)), '[^a-z0-9]+', '-', 'g')
    || '-' || substr(replace(auth.uid()::text, '-', ''), 1, 8);

  insert into public.organizations (name, slug)
  values (trim(workspace_name), workspace_slug)
  returning id into new_org_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (new_org_id, auth.uid(), 'owner');

  insert into public.entitlements (organization_id, plan, features)
  values (new_org_id, 'starter', '{"inventory":true,"sales":true,"receipts":true,"invoices":true,"expenses":true,"reports":true}'::jsonb);

  return new_org_id;
end;
$$;

grant execute on function public.create_workspace(text) to authenticated;
