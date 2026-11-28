-- Promoter payout requests.
--
-- A promoter taps "Request payout". The SERVER (never the browser) then verifies, commission by commission, that the
-- money is legitimate right now:
--   * the payment behind it was verified as a successful Paystack payment,
--   * the referred business is not controlled by the promoter (no self-referral),
--   * the referred business is still paying and active (not lapsed, not a gifted plan),
-- and that the total of the legitimate commissions has reached the minimum payout. Only then is a request created: the
-- commissions are locked to it (status "requested") and it lands in the super admin / finance admin review queue.
-- An admin approves, and later marks it paid with the bank transfer reference, or rejects it with a reason. The checks
-- run again at the moment of payment, so a customer who stopped paying in between cannot be paid out.

-- ---------------------------------------------------------------------------
-- 1. Minimum payout (editable by the super admin) and the "requested" commission state.
-- ---------------------------------------------------------------------------
alter table public.promoter_program_terms
  add column if not exists minimum_payout_kobo bigint not null default 1000000 check (minimum_payout_kobo >= 100000);

do $$
declare
  existing text;
begin
  select conname into existing from pg_constraint
   where conrelid = 'public.promoter_commissions'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%pending%';
  if existing is not null then execute format('alter table public.promoter_commissions drop constraint %I', existing); end if;
  alter table public.promoter_commissions
    add constraint promoter_commissions_status_check check (status in ('pending', 'requested', 'paid', 'void'));
end $$;

create or replace function public.admin_set_minimum_payout(p_kobo bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then raise exception 'UNAUTHORIZED: only the super admin can change the minimum payout'; end if;
  if p_kobo is null or p_kobo < 100000 or p_kobo > 100000000000 then
    raise exception 'VALIDATION_ERROR: the minimum payout must be between ₦1,000 and ₦1,000,000,000';
  end if;
  update public.promoter_program_terms set minimum_payout_kobo = p_kobo, updated_by = auth.uid(), updated_at = now();
  insert into public.admin_audit_logs (actor_id, action, target_type, metadata)
    values (auth.uid(), 'set_minimum_payout', 'promoter_program_terms', jsonb_build_object('minimum_payout_kobo', p_kobo));
end;
$$;
revoke all on function public.admin_set_minimum_payout(bigint) from public, anon;
grant execute on function public.admin_set_minimum_payout(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Requests and the commissions locked to them.
-- ---------------------------------------------------------------------------
create table if not exists public.promoter_payout_requests (
  id uuid primary key default gen_random_uuid(),
  promoter_id uuid not null references public.promoters(id),
  amount_kobo bigint not null check (amount_kobo > 0),
  commission_count integer not null check (commission_count > 0),
  status text not null default 'review' check (status in ('review', 'approved', 'paid', 'rejected', 'canceled')),
  verification jsonb not null default '{}'::jsonb,
  requested_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 500),
  paid_by uuid,
  paid_at timestamptz,
  payment_reference text check (payment_reference is null or char_length(payment_reference) between 4 and 120)
);
create unique index if not exists promoter_one_open_payout on public.promoter_payout_requests (promoter_id) where status in ('review', 'approved');
create index if not exists promoter_payout_status_idx on public.promoter_payout_requests (status, requested_at desc);

create table if not exists public.promoter_payout_items (
  request_id uuid not null references public.promoter_payout_requests(id) on delete cascade,
  commission_id uuid not null references public.promoter_commissions(id),
  released_at timestamptz, -- set when a rejected or canceled request lets the commission go; kept for the audit trail
  primary key (request_id, commission_id)
);
-- A commission can sit in only one request that is still alive.
create unique index if not exists promoter_payout_items_one_live on public.promoter_payout_items (commission_id) where released_at is null;
create index if not exists promoter_payout_items_request_idx on public.promoter_payout_items (request_id);

alter table public.promoter_payout_requests enable row level security;
alter table public.promoter_payout_items enable row level security;
revoke all on public.promoter_payout_requests, public.promoter_payout_items from anon, authenticated;
-- Everything goes through the functions below; there are deliberately no direct table policies.

-- ---------------------------------------------------------------------------
-- 3. The legitimacy test for one commission, used both when requesting and again when paying.
--    Returns NULL when the commission is fine, otherwise a short reason code.
-- ---------------------------------------------------------------------------
create or replace function public.promoter_commission_block_reason(p_commission uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (
      select 1 from public.organization_members m join public.promoters pr on pr.user_id = m.user_id
       where pr.id = c.promoter_id and m.organization_id = c.organization_id
    ) then 'self_referral'
    when not exists (
      select 1 from public.payments p
       where p.id = c.payment_id and p.status = 'success' and p.provider = 'paystack' and coalesce(p.paid_amount_kobo, 0) > 0
    ) then 'payment_not_verified'
    when public.subscription_state(c.organization_id) <> 'active'
      or exists (select 1 from public.subscriptions s where s.organization_id = c.organization_id and s.provider = 'gift')
    then 'customer_not_active'
    else null
  end
  from public.promoter_commissions c where c.id = p_commission;
$$;
revoke all on function public.promoter_commission_block_reason(uuid) from public, anon, authenticated;

create or replace function public.promoter_payout_check(p_promoter uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  prom public.promoters%rowtype;
  minimum bigint;
  eligible_ids uuid[] := '{}';
  eligible_kobo bigint := 0;
  waiting_kobo bigint := 0;
  held jsonb := '[]'::jsonb;
  warnings jsonb := '[]'::jsonb;
  reasons jsonb := '[]'::jsonb;
  c record;
  why text;
  open_request boolean;
begin
  select * into prom from public.promoters where id = p_promoter;
  select minimum_payout_kobo into minimum from public.promoter_program_terms limit 1;
  minimum := coalesce(minimum, 1000000);

  for c in
    select pc.id, pc.commission_kobo, pc.kind, o.name as business
      from public.promoter_commissions pc join public.organizations o on o.id = pc.organization_id
     where pc.promoter_id = p_promoter and pc.status = 'pending'
     order by pc.created_at
  loop
    why := public.promoter_commission_block_reason(c.id);
    if why is null then
      eligible_ids := eligible_ids || c.id;
      eligible_kobo := eligible_kobo + c.commission_kobo;
    else
      waiting_kobo := waiting_kobo + c.commission_kobo;
      held := held || jsonb_build_object('commission_id', c.id, 'business', c.business, 'kind', c.kind, 'commission_kobo', c.commission_kobo, 'reason', why);
      if why = 'self_referral' then
        warnings := warnings || jsonb_build_object('code', 'self_referral', 'business', c.business);
      end if;
    end if;
  end loop;

  select exists (select 1 from public.promoter_payout_requests r where r.promoter_id = p_promoter and r.status in ('review', 'approved'))
    into open_request;

  if prom.id is null or prom.status <> 'active' then reasons := reasons || to_jsonb('promoter_not_active'::text); end if;
  if open_request then reasons := reasons || to_jsonb('request_already_open'::text); end if;
  if eligible_kobo < minimum then reasons := reasons || to_jsonb('below_minimum'::text); end if;

  return jsonb_build_object(
    'minimum_kobo', minimum,
    'eligible_kobo', eligible_kobo,
    'eligible_count', cardinality(eligible_ids),
    'waiting_kobo', waiting_kobo,
    'held', held,
    'warnings', warnings,
    'reasons', reasons,
    'can_request', jsonb_array_length(reasons) = 0,
    'eligible_commission_ids', to_jsonb(eligible_ids)
  );
end;
$$;
revoke all on function public.promoter_payout_check(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. What the promoter sees, and the request itself.
-- ---------------------------------------------------------------------------
create or replace function public.get_promoter_payout_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  pid uuid;
begin
  select id into pid from public.promoters where user_id = auth.uid() limit 1;
  if pid is null then raise exception 'UNAUTHORIZED: promoter account required'; end if;
  return (public.promoter_payout_check(pid) - 'eligible_commission_ids') || jsonb_build_object(
    'requested_kobo', coalesce((select sum(commission_kobo) from public.promoter_commissions where promoter_id = pid and status = 'requested'), 0),
    'paid_kobo', coalesce((select sum(commission_kobo) from public.promoter_commissions where promoter_id = pid and status = 'paid'), 0),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'amount_kobo', r.amount_kobo, 'commission_count', r.commission_count, 'status', r.status,
        'requested_at', r.requested_at, 'decided_at', r.decided_at, 'paid_at', r.paid_at,
        'payment_reference', r.payment_reference,
        'decision_note', case when r.status = 'rejected' then r.decision_note else null end
      ) order by r.requested_at desc)
      from (select * from public.promoter_payout_requests where promoter_id = pid order by requested_at desc limit 20) r
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.get_promoter_payout_overview() from public, anon;
grant execute on function public.get_promoter_payout_overview() to authenticated;

create or replace function public.request_promoter_payout()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  prom public.promoters%rowtype;
  chk jsonb;
  ids uuid[];
  rid uuid;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  select * into prom from public.promoters where user_id = auth.uid() for update;
  if not found then raise exception 'UNAUTHORIZED: promoter account required'; end if;

  chk := public.promoter_payout_check(prom.id);
  if not (chk ->> 'can_request')::boolean then
    raise exception 'PAYOUT_NOT_ELIGIBLE: %', chk -> 'reasons' ->> 0;
  end if;

  select coalesce(array_agg(x::uuid), '{}') into ids from jsonb_array_elements_text(chk -> 'eligible_commission_ids') x;
  insert into public.promoter_payout_requests (promoter_id, amount_kobo, commission_count, verification)
    values (prom.id, (chk ->> 'eligible_kobo')::bigint, cardinality(ids), chk - 'eligible_commission_ids')
    returning id into rid;
  insert into public.promoter_payout_items (request_id, commission_id) select rid, unnest(ids);
  update public.promoter_commissions set status = 'requested' where id = any (ids) and status = 'pending';
  return rid;
end;
$$;
revoke all on function public.request_promoter_payout() from public, anon;
grant execute on function public.request_promoter_payout() to authenticated;

create or replace function public.cancel_promoter_payout(p_request uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  req public.promoter_payout_requests%rowtype;
begin
  select r.* into req from public.promoter_payout_requests r join public.promoters p on p.id = r.promoter_id
   where r.id = p_request and p.user_id = auth.uid() for update of r;
  if not found then raise exception 'NOT_FOUND'; end if;
  if req.status <> 'review' then raise exception 'VALIDATION_ERROR: only a request that is still waiting for review can be canceled'; end if;
  update public.promoter_payout_requests set status = 'canceled', decided_at = now() where id = p_request;
  update public.promoter_payout_items set released_at = now() where request_id = p_request and released_at is null;
  update public.promoter_commissions set status = 'pending'
   where id in (select commission_id from public.promoter_payout_items where request_id = p_request) and status = 'requested';
end;
$$;
revoke all on function public.cancel_promoter_payout(uuid) from public, anon;
grant execute on function public.cancel_promoter_payout(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. The review queue for the super admin and finance admins.
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_payout_requests(p_status text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_view_financial_admin_data() then raise exception 'UNAUTHORIZED: super admin or finance admin access required'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'status', r.status, 'amount_kobo', r.amount_kobo, 'commission_count', r.commission_count,
      'requested_at', r.requested_at, 'decided_at', r.decided_at, 'decision_note', r.decision_note,
      'paid_at', r.paid_at, 'payment_reference', r.payment_reference,
      'promoter', jsonb_build_object('id', p.id, 'name', p.full_name, 'email', p.email, 'code', p.referral_code, 'status', p.status),
      'verification', r.verification,
      'items', coalesce((
        select jsonb_agg(jsonb_build_object('business', o.name, 'kind', c.kind, 'percent', c.percent, 'commission_kobo', c.commission_kobo, 'payment_kobo', c.payment_amount_kobo, 'earned_at', c.created_at,
                 'still_ok', public.promoter_commission_block_reason(c.id) is null) order by c.created_at)
        from public.promoter_payout_items i join public.promoter_commissions c on c.id = i.commission_id join public.organizations o on o.id = c.organization_id
        where i.request_id = r.id
      ), '[]'::jsonb)
    ) order by case r.status when 'review' then 0 when 'approved' then 1 else 2 end, r.requested_at desc)
    from public.promoter_payout_requests r join public.promoters p on p.id = r.promoter_id
    where p_status is null or r.status = p_status
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.admin_list_payout_requests(text) from public, anon;
grant execute on function public.admin_list_payout_requests(text) to authenticated;

create or replace function public.admin_payout_queue_count()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case when public.can_view_financial_admin_data()
    then (select count(*)::integer from public.promoter_payout_requests where status in ('review', 'approved')) else 0 end;
$$;
revoke all on function public.admin_payout_queue_count() from public, anon;
grant execute on function public.admin_payout_queue_count() to authenticated;

create or replace function public.admin_decide_payout(p_request uuid, p_decision text, p_note text default null, p_reference text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  req public.promoter_payout_requests%rowtype;
  item record;
  why text;
  actor_role text;
begin
  if not public.can_view_financial_admin_data() then raise exception 'UNAUTHORIZED: super admin or finance admin access required'; end if;
  select * into req from public.promoter_payout_requests where id = p_request for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select a.role::text into actor_role from public.platform_admin_access a
   where a.user_id = auth.uid() and a.status = 'active' order by case a.role::text when 'SUPER_ADMIN' then 0 when 'FINANCE_ADMIN' then 1 else 2 end limit 1;

  if p_decision = 'approve' then
    if req.status <> 'review' then raise exception 'VALIDATION_ERROR: only a request waiting for review can be approved'; end if;
    update public.promoter_payout_requests set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = left(p_note, 500) where id = p_request;

  elsif p_decision = 'reject' then
    if req.status not in ('review', 'approved') then raise exception 'VALIDATION_ERROR: this request can no longer be rejected'; end if;
    if p_note is null or char_length(trim(p_note)) < 5 then raise exception 'VALIDATION_ERROR: give the promoter a reason (at least 5 characters)'; end if;
    update public.promoter_payout_requests set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = left(p_note, 500) where id = p_request;
    update public.promoter_payout_items set released_at = now() where request_id = p_request and released_at is null;
    update public.promoter_commissions set status = 'pending'
     where id in (select commission_id from public.promoter_payout_items where request_id = p_request) and status = 'requested';

  elsif p_decision = 'mark_paid' then
    if req.status <> 'approved' then raise exception 'VALIDATION_ERROR: approve the request before marking it paid'; end if;
    if p_reference is null or char_length(trim(p_reference)) < 4 then raise exception 'VALIDATION_ERROR: enter the bank transfer reference'; end if;
    -- Check everything again at the moment of payment: a customer who stopped paying since the request must not be paid out.
    for item in
      select c.id, o.name as business from public.promoter_payout_items i
        join public.promoter_commissions c on c.id = i.commission_id join public.organizations o on o.id = c.organization_id
       where i.request_id = p_request
    loop
      why := public.promoter_commission_block_reason(item.id);
      if why is not null then
        raise exception 'PAYOUT_RECHECK_FAILED: % is no longer eligible (%). Reject this request so the promoter can request again.', item.business, why;
      end if;
    end loop;
    update public.promoter_payout_requests set status = 'paid', paid_by = auth.uid(), paid_at = now(), payment_reference = trim(p_reference) where id = p_request;
    update public.promoter_commissions set status = 'paid', paid_at = now(), paid_by = auth.uid()
     where id in (select commission_id from public.promoter_payout_items where request_id = p_request) and status = 'requested';
  else
    raise exception 'VALIDATION_ERROR: decision must be approve, reject or mark_paid';
  end if;

  insert into public.admin_audit_logs (actor_id, action, target_type, target_id, metadata)
    values (auth.uid(), 'payout_' || p_decision, 'promoter_payout_request', p_request,
            jsonb_build_object('amount_kobo', req.amount_kobo, 'role', actor_role, 'note', left(p_note, 200), 'reference', p_reference));
end;
$$;
revoke all on function public.admin_decide_payout(uuid, text, text, text) from public, anon;
grant execute on function public.admin_decide_payout(uuid, text, text, text) to authenticated;

-- A commission that is locked to a payout request can only be settled through the payout flow.
create or replace function public.admin_set_commission_status(p_id uuid, p_status text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_view_financial_admin_data() then raise exception 'UNAUTHORIZED: super admin or finance admin access required'; end if;
  if p_status not in ('paid', 'void', 'pending') then raise exception 'VALIDATION_ERROR: status must be paid, void or pending'; end if;
  if exists (select 1 from public.promoter_commissions where id = p_id and status = 'requested') then
    raise exception 'USE_PAYOUT_FLOW: this commission is part of a payout request; approve, reject or pay the request instead';
  end if;
  update public.promoter_commissions set status = p_status, note = left(p_note, 500),
    paid_at = case when p_status = 'paid' then now() else null end, paid_by = case when p_status = 'paid' then auth.uid() else null end where id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  insert into public.admin_audit_logs (actor_id, actor_role, action, target_type, target_id, metadata)
    values (auth.uid(), (select a.role from public.platform_admin_access a where a.user_id = auth.uid() and a.status = 'active' order by case a.role when 'SUPER_ADMIN' then 0 when 'FINANCE_ADMIN' then 1 else 2 end limit 1), 'set_commission_status', 'promoter_commission', p_id, jsonb_build_object('status', p_status));
end;
$$;

-- The promoter's own earnings summary now includes the "requested" bucket.
create or replace function public.get_promoter_earnings()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare pid uuid; result jsonb;
begin
  select id into pid from public.promoters where user_id = auth.uid() limit 1;
  if pid is null then return jsonb_build_object('pending_kobo', 0, 'requested_kobo', 0, 'paid_kobo', 0, 'recent', '[]'::jsonb); end if;
  select jsonb_build_object(
    'pending_kobo', coalesce(sum(commission_kobo) filter (where status = 'pending'), 0),
    'requested_kobo', coalesce(sum(commission_kobo) filter (where status = 'requested'), 0),
    'paid_kobo', coalesce(sum(commission_kobo) filter (where status = 'paid'), 0),
    'recent', coalesce((select jsonb_agg(t order by t.created_at desc) from (select c.kind, c.percent, c.commission_kobo, c.status, c.created_at, o.name as business from public.promoter_commissions c join public.organizations o on o.id = c.organization_id where c.promoter_id = pid order by c.created_at desc limit 30) t), '[]'::jsonb))
  into result from public.promoter_commissions where promoter_id = pid;
  return result;
end;
$$;

notify pgrst, 'reload schema';
