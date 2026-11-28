\pset pager off
\set ON_ERROR_STOP off
-- NOTE: these ids are unique to this file on purpose. The other suites reuse ..a1/..b1/..c1, so sharing them in one
-- database makes 'another business' secretly the owner of this one.
-- Storage saves an upload with INSERT ... RETURNING, which needs a SELECT policy as well as the INSERT policy.
grant usage on schema storage to authenticated; grant all on storage.objects to authenticated;
\set OWN '\'00000000-0000-4000-8000-0000000000f1\''
\set WRK '\'00000000-0000-4000-8000-0000000000f2\''
\set OTH '\'00000000-0000-4000-8000-0000000000f3\''
\set OA '\'00000000-0000-4000-8000-0000000000f4\''
\set OB '\'00000000-0000-4000-8000-0000000000f5\''
insert into auth.users(id,email) values (:OWN,'own@t.test'),(:WRK,'wrk@t.test'),(:OTH,'oth@t.test') on conflict do nothing;
insert into public.organizations(id,name,slug) values (:OA,'Logo A','logo-a'),(:OB,'Logo B','logo-b') on conflict (id) do nothing;
insert into public.organization_members(organization_id,user_id,role) values (:OA,:OWN,'owner'),(:OA,:WRK,'member'),(:OB,:OTH,'owner') on conflict do nothing;
delete from storage.objects where bucket_id='business-logos';
insert into storage.buckets(id,name,public) values ('business-logos','business-logos',true) on conflict (id) do nothing;

\echo '=== 1. Business A owner uploads their logo (INSERT ... RETURNING, exactly what Storage does)'
begin; set local role authenticated; set local request.jwt.claim.sub=:OWN;
insert into storage.objects(bucket_id,name,owner) values ('business-logos','00000000-0000-4000-8000-0000000000f4/logo-1.png',:OWN) returning id is not null as upload_accepted;
commit;
\echo '=== 2. A plain worker (role member) must NOT be able to upload for the business'
begin; set local role authenticated; set local request.jwt.claim.sub=:WRK;
insert into storage.objects(bucket_id,name,owner) values ('business-logos','00000000-0000-4000-8000-0000000000f4/worker.png',:WRK) returning id;
commit;
\echo '=== 3. Business B owner must NOT be able to upload into Business A''s folder'
begin; set local role authenticated; set local request.jwt.claim.sub=:OTH;
insert into storage.objects(bucket_id,name,owner) values ('business-logos','00000000-0000-4000-8000-0000000000f4/evil.png',:OTH) returning id;
commit;
\echo '=== 4. Visibility: A members see A files; B sees none of them'
begin; set local role authenticated; set local request.jwt.claim.sub=:WRK;
select count(*) as worker_of_A_sees from storage.objects where bucket_id='business-logos';
commit;
begin; set local role authenticated; set local request.jwt.claim.sub=:OTH;
select count(*) as owner_of_B_sees_expected_0 from storage.objects where bucket_id='business-logos';
commit;
\echo '=== 5. Owner of A can delete their old logo; B cannot delete A''s'
begin; set local role authenticated; set local request.jwt.claim.sub=:OTH;
delete from storage.objects where bucket_id='business-logos' returning name;
commit;
begin; set local role authenticated; set local request.jwt.claim.sub=:OWN;
delete from storage.objects where bucket_id='business-logos' returning name;
commit;
