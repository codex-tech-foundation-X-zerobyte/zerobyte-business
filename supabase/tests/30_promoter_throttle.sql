\pset pager off
\set ON_ERROR_STOP off
truncate public.promoter_applications, public.promoter_application_attempts cascade;
begin; set local role service_role; set local request.headers = '{"cf-connecting-ip":"41.58.1.9, 10.0.0.1"}';
\echo '--- valid application'
select public.submit_promoter_application('Ada Obi','ada1@t.test','0803 123 4567','Lagos','https://x.com/ada','exp','I love it',true) is not null as ok;
commit;
\echo '--- oversize reason (3000 chars)'
begin; set local role service_role; set local request.headers = '{"cf-connecting-ip":"41.58.1.9"}';
select public.submit_promoter_application('Ada','ada2@t.test','0803 123 4567',null,null,null,repeat('x',3000),true);
commit;
\echo '--- oversize social (500 chars)'
begin; set local role service_role; set local request.headers = '{"cf-connecting-ip":"41.58.1.9"}';
select public.submit_promoter_application('Ada','ada3@t.test','0803 123 4567',null,repeat('h',500),null,'why',true);
commit;
\echo '--- attempts 2..6 from same IP, different emails (5/hour cap)'
do $$ declare i int; begin
  for i in 2..7 loop
    begin
      perform set_config('request.headers','{"cf-connecting-ip":"41.58.1.9"}',true);
      set local role service_role;
      perform public.submit_promoter_application('Bot '||i,'bot'||i||'@t.test','0803 123 4567',null,null,null,'spam',true);
      raise notice 'attempt % accepted', i;
    exception when others then raise notice 'attempt % -> %', i, sqlerrm; end;
  end loop; end $$;
\echo '--- different IP still allowed'
begin; set local role service_role; set local request.headers = '{"cf-connecting-ip":"102.89.3.3"}';
select public.submit_promoter_application('Chidi','chidi@t.test','0803 123 4567',null,null,null,'why',true) is not null as ok;
commit;

\echo '--- NEW: a browser (anon) can no longer call the function directly; only the CAPTCHA-checked edge function can'
begin; set local role anon;
select public.submit_promoter_application('Direct Bot','direct@t.test','0803 123 4567',null,null,null,'spam',true);
rollback;
\echo '--- NEW: a spoofed X-Forwarded-For is ignored; the trusted address decides (expect attempts 1-5 accepted, 6-7 throttled)'
truncate public.promoter_application_attempts;
do $$ declare i int; begin
  for i in 1..7 loop
    begin
      perform set_config('request.headers', json_build_object('x-forwarded-for','1.1.1.'||i,'cf-connecting-ip','77.77.77.7')::text, true);
      set local role service_role;
      perform public.submit_promoter_application('Spoof '||i,'spoof'||i||'@t.test','0803 123 4567',null,null,null,'spam',true);
      raise notice 'spoof attempt % accepted', i;
    exception when others then raise notice 'spoof attempt % -> %', i, sqlerrm; end;
  end loop; end $$;
reset role;
\echo '--- NEW: the edge function passes the real client address explicitly'
truncate public.promoter_application_attempts;
do $$ begin
  perform set_config('request.headers','{}',true);
  perform set_config('request.jwt.claim.role','service_role',true); -- what a service-role request carries in real Supabase
  set local role service_role;
  perform public.submit_promoter_application('Edge','edge@t.test','0803 123 4567',null,null,null,'ok',true,'88.88.88.8');
  raise notice 'edge override accepted';
end $$;
reset role;
select 'attempt rows keyed by the override address: '||count(*) from public.promoter_application_attempts where client_hash = md5('88.88.88.8');
