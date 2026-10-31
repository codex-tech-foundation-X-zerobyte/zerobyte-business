\pset pager off
\set ON_ERROR_STOP off
truncate public.promoter_applications, public.promoter_application_attempts cascade;
begin; set local role anon; set local request.headers = '{"x-forwarded-for":"41.58.1.9, 10.0.0.1"}';
\echo '--- valid application'
select public.submit_promoter_application('Ada Obi','ada1@t.test','0803 123 4567','Lagos','https://x.com/ada','exp','I love it',true) is not null as ok;
commit;
\echo '--- oversize reason (3000 chars)'
begin; set local role anon; set local request.headers = '{"x-forwarded-for":"41.58.1.9"}';
select public.submit_promoter_application('Ada','ada2@t.test','0803 123 4567',null,null,null,repeat('x',3000),true);
commit;
\echo '--- oversize social (500 chars)'
begin; set local role anon; set local request.headers = '{"x-forwarded-for":"41.58.1.9"}';
select public.submit_promoter_application('Ada','ada3@t.test','0803 123 4567',null,repeat('h',500),null,'why',true);
commit;
\echo '--- attempts 2..6 from same IP, different emails (5/hour cap)'
do $$ declare i int; begin
  for i in 2..7 loop
    begin
      perform set_config('request.headers','{"x-forwarded-for":"41.58.1.9"}',true);
      set local role anon;
      perform public.submit_promoter_application('Bot '||i,'bot'||i||'@t.test','0803 123 4567',null,null,null,'spam',true);
      raise notice 'attempt % accepted', i;
    exception when others then raise notice 'attempt % -> %', i, sqlerrm; end;
  end loop; end $$;
\echo '--- different IP still allowed'
begin; set local role anon; set local request.headers = '{"x-forwarded-for":"102.89.3.3"}';
select public.submit_promoter_application('Chidi','chidi@t.test','0803 123 4567',null,null,null,'why',true) is not null as ok;
commit;
