-- Logo upload failed with an RLS error.
--
-- The business-logos bucket had INSERT and UPDATE policies for owners/admins but no SELECT policy. Supabase
-- Storage reads the row back when it saves an upload (and `upsert` has to read the existing row), and with
-- row-level security a role cannot read a row unless a SELECT policy allows it, so every upload was refused.
-- Logos are public to view (public bucket); this only lets signed-in members of the business list their own
-- business's files, and lets owners/admins replace and remove them.
--
-- The folder check compares text instead of casting to uuid, so a stray object with a non-uuid folder name
-- can never make the policy itself raise an error.

drop policy if exists "organization members read business logos" on storage.objects;
create policy "organization members read business logos"
on storage.objects for select
to authenticated
using (
  bucket_id = 'business-logos'
  and exists (
    select 1 from public.organization_members m
    where m.user_id = auth.uid()
      and m.organization_id::text = (storage.foldername(name))[1]
  )
);

drop policy if exists "organization managers delete business logos" on storage.objects;
create policy "organization managers delete business logos"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'business-logos'
  and exists (
    select 1 from public.organization_members m
    where m.user_id = auth.uid()
      and m.role in ('owner', 'admin')
      and m.organization_id::text = (storage.foldername(name))[1]
  )
);
