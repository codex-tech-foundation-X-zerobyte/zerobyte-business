insert into storage.buckets (id, name, public)
values ('business-logos', 'business-logos', true)
on conflict (id) do update set public = excluded.public;

create policy "organization managers upload business logos"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'business-logos'
  and public.is_org_manager((storage.foldername(name))[1]::uuid)
);

create policy "organization managers update business logos"
on storage.objects for update
to authenticated
using (
  bucket_id = 'business-logos'
  and public.is_org_manager((storage.foldername(name))[1]::uuid)
)
with check (
  bucket_id = 'business-logos'
  and public.is_org_manager((storage.foldername(name))[1]::uuid)
);
