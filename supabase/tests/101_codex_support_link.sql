\set ON_ERROR_STOP on
\pset pager off
-- Self-checking: prints ALL CODEX SUPPORT LINK CHECKS PASSED. Run on a freshly migrated database.
create or replace function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, false), set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, false) $$;
insert into auth.users(id,email) values ('00000000-0000-4000-fc00-000000000001','cx-a@t.test');
insert into organizations(id,name,slug) values ('00000000-0000-4000-fd00-000000000001','Codex Shop','cx-shop');
insert into organization_members(organization_id,user_id,role) values ('00000000-0000-4000-fd00-000000000001','00000000-0000-4000-fc00-000000000001','owner');
insert into support_conversations(id,organization_id,user_id) values ('00000000-0000-4000-fe00-000000000001','00000000-0000-4000-fd00-000000000001','00000000-0000-4000-fc00-000000000001');
insert into support_messages(conversation_id,sender_id,sender_role,body) values ('00000000-0000-4000-fe00-000000000001','00000000-0000-4000-fc00-000000000001','customer','Cannot log in');

do $$ declare r text; n int; begin
  assert (select waiting_since from support_conversations where id='00000000-0000-4000-fe00-000000000001') is not null, 'the customer is waiting';
  r := apply_codex_support_event('evt-1','ticket.reply',1,'ZB-00000000-0000-4000-fe00-000000000001','Please clear the cache and try again.',null);
  assert r = 'applied', 'a staff reply is applied';
  assert (select body||'|'||sender_role||'|'||source from support_messages where source='codex') = 'Please clear the cache and try again.|admin|codex', 'the reply is in the chat as technical support';
  assert (select waiting_since from support_conversations where id='00000000-0000-4000-fe00-000000000001') is null, 'a staff reply takes the customer out of the queue';
  assert apply_codex_support_event('evt-1','ticket.reply',1,'ZB-00000000-0000-4000-fe00-000000000001','Please clear the cache and try again.',null) = 'duplicate', 'a repeated event is not applied twice';
  select count(*) into n from support_messages where source='codex'; assert n = 1, 'only one message exists';

  assert apply_codex_support_event('evt-2','ticket.status',5,'ZB-00000000-0000-4000-fe00-000000000001',null,'in_progress') = 'applied', 'a status change is applied';
  assert apply_codex_support_event('evt-3','ticket.status',4,'ZB-00000000-0000-4000-fe00-000000000001',null,'open') = 'stale', 'an older status never overwrites a newer one';
  assert (select codex_status from support_conversations where id='00000000-0000-4000-fe00-000000000001') = 'in_progress', 'status stays at the newest';
  assert apply_codex_support_event('evt-4','ticket.status',6,'ZB-00000000-0000-4000-fe00-000000000001',null,'resolved') = 'applied', 'resolved is applied';
  select count(*) into n from support_messages where source='codex'; assert n = 2, 'resolved adds one note to the chat';

  assert apply_codex_support_event('evt-5','ticket.reply',1,'ZB-00000000-0000-4000-fe00-00000000FFFF','hello',null) = 'unknown_ticket', 'an unknown ticket is ignored';
  assert apply_codex_support_event('evt-6','ticket.reply',1,'ORD-77','hello',null) = 'unknown_ticket', 'a foreign reference is ignored';
  assert apply_codex_support_event('evt-7','ticket.acknowledged',1,'ZB-00000000-0000-4000-fe00-000000000001',null,null) = 'ignored', 'acknowledged is noted but adds nothing';
  assert apply_codex_support_event('evt-8','ticket.reply',1,'ZB-00000000-0000-4000-fe00-000000000001','   ',null) = 'ignored', 'an empty reply is ignored';

  -- the 24-hour chat closed; a late staff reply reopens it
  update support_conversations set status='closed' where id='00000000-0000-4000-fe00-000000000001';
  assert apply_codex_support_event('evt-9','ticket.reply',1,'ZB-00000000-0000-4000-fe00-000000000001','One more thing',null) = 'applied', 'a late reply is applied';
  assert (select status from support_conversations where id='00000000-0000-4000-fe00-000000000001') = 'open', 'the chat is reopened for the customer';

  -- nobody can call it from a browser
  perform pg_temp.as_user('00000000-0000-4000-fc00-000000000001'); set local role authenticated;
  begin perform apply_codex_support_event('evt-x','ticket.reply',1,'ZB-00000000-0000-4000-fe00-000000000001','forged',null); raise exception 'should have been refused';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;
select 'ALL CODEX SUPPORT LINK CHECKS PASSED' as result;
