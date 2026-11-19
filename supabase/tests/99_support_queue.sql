\set ON_ERROR_STOP on
\pset pager off
-- Self-checking: prints ALL SUPPORT QUEUE CHECKS PASSED. Run on a freshly migrated database.
create or replace function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, false), set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, false) $$;
create or replace function pg_temp.fails(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlerrm; end $$;

insert into auth.users(id,email) values
 ('00000000-0000-4000-f400-000000000001','sq-support@t.test'),('00000000-0000-4000-f400-000000000002','sq-platform@t.test'),
 ('00000000-0000-4000-f400-000000000011','sq-a@t.test'),('00000000-0000-4000-f400-000000000012','sq-b@t.test'),('00000000-0000-4000-f400-000000000013','sq-c@t.test');
insert into platform_admin_access(user_id,role,status) values
 ('00000000-0000-4000-f400-000000000001','SUPPORT_ADMIN','active'),('00000000-0000-4000-f400-000000000002','PLATFORM_ADMIN','active');
insert into organizations(id,name,slug) values
 ('00000000-0000-4000-f500-000000000001','Shop A','sq-a'),('00000000-0000-4000-f500-000000000002','Shop B','sq-b'),('00000000-0000-4000-f500-000000000003','Shop C','sq-c');
insert into organization_members(organization_id,user_id,role) values
 ('00000000-0000-4000-f500-000000000001','00000000-0000-4000-f400-000000000011','owner'),
 ('00000000-0000-4000-f500-000000000002','00000000-0000-4000-f400-000000000012','owner'),
 ('00000000-0000-4000-f500-000000000003','00000000-0000-4000-f400-000000000013','owner');
insert into support_conversations(id,organization_id,user_id) values
 ('00000000-0000-4000-f600-000000000001','00000000-0000-4000-f500-000000000001','00000000-0000-4000-f400-000000000011'),
 ('00000000-0000-4000-f600-000000000002','00000000-0000-4000-f500-000000000002','00000000-0000-4000-f400-000000000012'),
 ('00000000-0000-4000-f600-000000000003','00000000-0000-4000-f500-000000000003','00000000-0000-4000-f400-000000000013');

-- A writes first, then B (through the real customer path).
do $$ declare q jsonb; begin
  perform pg_temp.as_user('00000000-0000-4000-f400-000000000011'); set local role authenticated;
  insert into support_messages(conversation_id,sender_id,sender_role,body) values ('00000000-0000-4000-f600-000000000001','00000000-0000-4000-f400-000000000011','customer','Hello from A');
  reset role; perform pg_sleep(0.05);
  perform pg_temp.as_user('00000000-0000-4000-f400-000000000012'); set local role authenticated;
  insert into support_messages(conversation_id,sender_id,sender_role,body) values ('00000000-0000-4000-f600-000000000002','00000000-0000-4000-f400-000000000012','customer','Hello from B');
  q := get_my_support_queue('00000000-0000-4000-f600-000000000002');
  assert (q->>'waiting')::boolean and (q->>'position')::int = 2 and (q->>'ahead')::int = 1, 'B is second in line with one person ahead';
  assert (q->>'estimated_minutes')::int >= 1, 'B gets a time estimate';
  assert pg_temp.fails($f$select get_my_support_queue('00000000-0000-4000-f600-000000000001')$f$) like 'NOT_FOUND%', 'B cannot read A''s queue place';
  reset role;
  perform pg_temp.as_user('00000000-0000-4000-f400-000000000011'); set local role authenticated;
  assert (get_my_support_queue('00000000-0000-4000-f600-000000000001')->>'position')::int = 1, 'A is first in line';
  reset role;
end $$;

-- The support admin sees the queue in order and answers A; B moves up.
do $$ declare r record; n int; begin
  perform pg_temp.as_user('00000000-0000-4000-f400-000000000001'); set local role authenticated;
  select count(*) into n from list_support_conversations();
  assert n = 2, 'support admin sees both chats with messages';
  select * into r from list_support_conversations() limit 1;
  assert r.user_email = 'sq-a@t.test' and r.queue_position = 1, 'the oldest waiting chat is first';
  insert into support_messages(conversation_id,sender_id,sender_role,body) values ('00000000-0000-4000-f600-000000000001','00000000-0000-4000-f400-000000000001','admin','Hi A');
  reset role;
  assert (select waiting_since from support_conversations where id = '00000000-0000-4000-f600-000000000001') is null, 'answering takes A out of the queue';
  perform pg_temp.as_user('00000000-0000-4000-f400-000000000012'); set local role authenticated;
  assert (get_my_support_queue('00000000-0000-4000-f600-000000000002')->>'position')::int = 1, 'B moves up to first';
  assert not (get_my_support_queue('00000000-0000-4000-f600-000000000002')->>'ahead')::int > 0, 'nobody ahead of B';
  reset role;
end $$;

-- A platform admin (no Messages section) sees no chats and no messages.
do $$ declare n int; begin
  perform pg_temp.as_user('00000000-0000-4000-f400-000000000002'); set local role authenticated;
  select count(*) into n from list_support_conversations();
  assert n = 0, 'platform admin gets no chat list';
  select count(*) into n from support_messages;
  assert n = 0, 'platform admin cannot read chat messages';
  select count(*) into n from support_conversations;
  assert n = 0, 'platform admin cannot read conversations';
  assert pg_temp.fails($f$insert into support_messages(conversation_id,sender_id,sender_role,body) values ('00000000-0000-4000-f600-000000000002','00000000-0000-4000-f400-000000000002','admin','intruder')$f$) is not null, 'platform admin cannot send chat messages';
  reset role;
end $$;

-- 24 hours: old messages cannot be read, and are deleted by the next message.
do $$ declare n int; begin
  insert into support_messages(conversation_id,sender_id,sender_role,body,created_at) values
    ('00000000-0000-4000-f600-000000000003','00000000-0000-4000-f400-000000000013','customer','very old', now() - interval '25 hours');
  update support_conversations set updated_at = now() - interval '25 hours' where id = '00000000-0000-4000-f600-000000000003';
  perform pg_temp.as_user('00000000-0000-4000-f400-000000000013'); set local role authenticated;
  select count(*) into n from support_messages where conversation_id = '00000000-0000-4000-f600-000000000003';
  assert n = 0, 'a customer cannot read a message older than 24 hours';
  reset role;
  perform pg_temp.as_user('00000000-0000-4000-f400-000000000011'); set local role authenticated;
  insert into support_messages(conversation_id,sender_id,sender_role,body) values ('00000000-0000-4000-f600-000000000001','00000000-0000-4000-f400-000000000011','customer','back again');
  reset role;
  assert not exists (select 1 from support_messages where body = 'very old'), 'the old message was deleted';
  assert (select status from support_conversations where id = '00000000-0000-4000-f600-000000000003') = 'closed', 'a chat with nothing left is closed';
  assert (select waiting_since from support_conversations where id = '00000000-0000-4000-f600-000000000003') is null, 'a closed chat is not in the queue';
end $$;
select 'ALL SUPPORT QUEUE CHECKS PASSED' as result;
