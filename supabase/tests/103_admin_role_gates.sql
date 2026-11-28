\pset pager off
\set ON_ERROR_STOP on
-- Self-checking: prints ALL ADMIN ROLE GATE CHECKS PASSED or stops at the first failed expectation.
-- Guards the 9 Nov 2026 audit finding: admin RPCs must check the admin's ROLE, not merely "is any admin".
create or replace function pg_temp.admin(p_email text, p_role text) returns uuid language plpgsql as $$
declare id uuid;
begin
  insert into auth.users(id,email,email_confirmed_at) values (gen_random_uuid(), p_email, now()) returning auth.users.id into id;
  insert into public.platform_admin_access(user_id,role,status) values (id, p_role::public.platform_admin_role, 'active');
  return id;
end $$;
create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', p::text, true); end $$;

do $$ declare
  sup uuid := pg_temp.admin('support@t.test','SUPPORT_ADMIN');
  moder uuid := pg_temp.admin('moder@t.test','MODERATION_ADMIN');
  platf uuid := pg_temp.admin('platform@t.test','PLATFORM_ADMIN');
  fin uuid := pg_temp.admin('finance@t.test','FINANCE_ADMIN');
  boss uuid := pg_temp.admin('boss@t.test','SUPER_ADMIN');
  pro uuid := (select id from public.plans where code = 'pro');
  app uuid; price numeric; refused int := 0; r text;
begin
  -- plan price / limit / activation: only finance + super admin
  foreach r in array array['support','moder','platf'] loop
    perform pg_temp.as_user(case r when 'support' then sup when 'moder' then moder else platf end); set local role authenticated;
    begin perform public.admin_update_plan_price(pro, 100, 'monthly'); assert false, r||' must not change a plan price';
    exception when others then assert sqlerrm like 'UNAUTHORIZED%' or sqlerrm like '%ACCESS_DENIED%', r||' wrong error: '||sqlerrm; end;
    begin perform public.admin_set_plan_active(pro, false); assert false, r||' must not deactivate a plan';
    exception when others then assert sqlerrm like 'UNAUTHORIZED%' or sqlerrm like '%ACCESS_DENIED%', r||' wrong error: '||sqlerrm; end;
    reset role;
  end loop;
  select amount into price from public.plan_price_versions where plan_id = pro and status = 'active';
  assert price > 100, 'price must be untouched, is '||price;
  perform pg_temp.as_user(fin); set local role authenticated;
  perform public.admin_update_plan_price(pro, 8500, 'monthly');
  reset role;
  assert (select amount from public.plan_price_versions where plan_id = pro and status = 'active') = 8500, 'finance admin must be able to change the price';

  -- promoter review / list: only Promoters section (platform admin, super admin)
  insert into public.promoter_applications(full_name,email,phone,reason,agreed_to_terms,status) values ('A','a@t.test','+2348011111111','why',true,'applied') returning id into app;
  perform pg_temp.as_user(sup); set local role authenticated;
  begin perform public.admin_review_promoter_application(app,'approved','x'); assert false, 'support must not approve promoters';
  exception when others then assert sqlerrm like 'UNAUTHORIZED%' or sqlerrm like '%ACCESS_DENIED%', 'wrong error: '||sqlerrm; end;
  reset role;
  perform pg_temp.as_user(platf); set local role authenticated;
  perform public.admin_review_promoter_application(app,'approved','ok');
  assert (select count(*) from public.admin_list_promoters()) = 1, 'platform admin must see promoters';
  reset role;
  perform pg_temp.as_user(sup); set local role authenticated;
  assert (select count(*) from public.admin_list_promoters()) = 0, 'support admin must see NO promoter contact details';
  reset role;

  -- announcements: super admin only
  perform pg_temp.as_user(platf); set local role authenticated;
  begin perform public.publish_version_announcement('9.9','x'); assert false, 'platform admin must not publish announcements';
  exception when others then assert sqlerrm like '%ACCESS_DENIED%' or sqlerrm like 'UNAUTHORIZED%', 'wrong error: '||sqlerrm; end;
  reset role;
end $$;
\echo ALL ADMIN ROLE GATE CHECKS PASSED
