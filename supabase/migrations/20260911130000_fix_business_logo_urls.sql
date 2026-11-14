update public.organizations
set logo_url = replace(
  logo_url,
  '/storage/v1/object/business-logos/',
  '/storage/v1/object/public/business-logos/'
)
where logo_url like '%/storage/v1/object/business-logos/%';

update public.organizations
set logo_url = null
where logo_url like '%/storage/v1/object/public/business-logos/%'
  and not exists (
    select 1
    from storage.objects
    where bucket_id = 'business-logos'
      and name = split_part(
        logo_url,
        '/storage/v1/object/public/business-logos/',
        2
      )
  );
