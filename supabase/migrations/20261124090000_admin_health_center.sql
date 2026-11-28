-- Admin Health center: payments, subscriptions, edge functions, capacity, security, data integrity, customer health,
-- browser errors and promoter abuse in one read, plus threshold alerts that can be pushed to Telegram or a webhook.
--
--   platform_health_signals()      every measurement as one jsonb (no access check; callable by service_role only)
--   platform_health_alerts(jsonb)  the alert rules applied to those measurements
--   admin_get_health_center()      what the console calls: signals + alerts, after the section permission check
--   platform_claim_alerts()        service_role: which alerts to push now (new, or unresolved past the cooldown)
--   record_client_error(...)       the browser reports a crash or failed sync (rate limited, no personal data kept)
-- Everything below is additive. Nothing existing is changed except the role-to-section list (adds 'Health center').

-- 1. Browser error log ------------------------------------------------------------------------------------------------
create table if not exists public.client_error_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('js', 'promise', 'render', 'sync', 'network')),
  message text not null,
  route text,
  app_version text,
  device text check (device in ('mobile', 'desktop')),
  fingerprint text not null,
  user_id uuid,
  organization_id uuid
);
create index if not exists client_error_events_created_idx on public.client_error_events (created_at desc);
create index if not exists client_error_events_fp_idx on public.client_error_events (fingerprint, created_at desc);
alter table public.client_error_events enable row level security;
revoke all on public.client_error_events from public, anon, authenticated;
grant select, insert, delete on public.client_error_events to service_role;

create or replace function public.record_client_error(
  p_kind text, p_message text, p_route text default null, p_version text default null,
  p_device text default null, p_fingerprint text default null, p_organization_id uuid default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  fp text := left(coalesce(nullif(trim(p_fingerprint), ''), md5(coalesce(p_message, ''))), 64);
begin
  if p_kind is null or p_kind not in ('js', 'promise', 'render', 'sync', 'network') then return; end if;
  if p_message is null or length(trim(p_message)) = 0 then return; end if;
  -- Flood guard: a broken page must not fill the table. Excess reports are dropped silently.
  if (select count(*) from public.client_error_events where created_at >= now() - interval '1 minute') >= 200 then return; end if;
  if (select count(*) from public.client_error_events where fingerprint = fp and created_at >= now() - interval '1 minute') >= 10 then return; end if;
  insert into public.client_error_events (kind, message, route, app_version, device, fingerprint, user_id, organization_id)
  values (p_kind, left(p_message, 300), left(p_route, 120), left(p_version, 24),
          case when p_device in ('mobile', 'desktop') then p_device end, fp, auth.uid(),
          case when p_organization_id is not null and exists (
            select 1 from public.organization_members m where m.organization_id = p_organization_id and m.user_id = auth.uid()
          ) then p_organization_id end);
  if random() < 0.02 then
    delete from public.client_error_events where created_at < now() - interval '30 days';
  end if;
end;
$$;
revoke all on function public.record_client_error(text, text, text, text, text, text, uuid) from public;
grant execute on function public.record_client_error(text, text, text, text, text, text, uuid) to anon, authenticated;

-- 2. Alert bookkeeping (so the same problem is not pushed every 15 minutes) -------------------------------------------
create table if not exists public.platform_alert_state (
  alert_key text primary key,
  severity text not null,
  first_seen_at timestamptz not null default now(),
  last_sent_at timestamptz not null default now()
);
alter table public.platform_alert_state enable row level security;
revoke all on public.platform_alert_state from public, anon, authenticated;
grant select, insert, update, delete on public.platform_alert_state to service_role;

-- 3. Every measurement ------------------------------------------------------------------------------------------------
create or replace function public.platform_health_signals()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  db_bytes bigint := pg_database_size(current_database());
  db_limit_bytes constant bigint := 524288000; -- Supabase Free plan: 500 MB. Raise this when the plan changes.
  conns int; max_conns int;
  storage_bytes bigint; auth_users bigint; idle_hours numeric;
  admins_no_mfa int; admin_no_mfa_list jsonb; mfa_required boolean;
  payments_j jsonb; webhooks_j jsonb; stuck_j jsonb; gaps_j jsonb;
  subs_j jsonb; trials_j jsonb; funcs_j jsonb; tables_j jsonb;
  sec_j jsonb; integ_j jsonb; cust_j jsonb; app_j jsonb; promo_j jsonb; throttle_j jsonb; bulk_j jsonb;
  neg_j jsonb; mismatch_j jsonb; totals_j jsonb; silent_j jsonb; noact_j jsonb; nosale_j jsonb;
begin
  -- Payments ------------------------------------------------------------------------------------------------------
  select jsonb_build_object(
    'success_24h',  count(*) filter (where status = 'success' and coalesce(paid_at, created_at) >= now() - interval '24 hours'),
    'failed_24h',   count(*) filter (where status = 'failed' and created_at >= now() - interval '24 hours'),
    'abandoned_24h', count(*) filter (where status = 'pending' and created_at < now() - interval '1 day' and created_at >= now() - interval '2 days'),
    'needs_review', count(*) filter (where status = 'mismatch'),
    'pending_stuck', count(*) filter (where status = 'pending' and created_at < now() - interval '30 minutes' and created_at >= now() - interval '1 day'),
    'revenue_24h_kobo', coalesce(sum(coalesce(paid_amount_kobo, amount_kobo)) filter (where status = 'success' and coalesce(paid_at, created_at) >= now() - interval '24 hours'), 0)
  ) into payments_j from public.payments;

  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) into stuck_j from (
    select p.reference, coalesce(o.name, 'Unknown business') as business, round(extract(epoch from (now() - p.created_at)) / 60)::int as minutes_pending
    from public.payments p left join public.organizations o on o.id = p.organization_id
    where p.status = 'pending' and p.created_at < now() - interval '30 minutes' and p.created_at >= now() - interval '1 day'
    order by p.created_at asc limit 8
  ) x;

  select jsonb_build_object(
    'total_24h', count(*),
    'errors_24h', count(*) filter (where error is not null or outcome in ('settle_error', 'paystack_no_transaction', 'mismatch', 'error')),
    'last_webhook_at', max(created_at) filter (where source = 'webhook')
  ) into webhooks_j from public.payment_events where created_at >= now() - interval '24 hours';
  webhooks_j := coalesce(webhooks_j, jsonb_build_object('total_24h', 0, 'errors_24h', 0, 'last_webhook_at', null));
  -- last_webhook_at above only looks at 24h; widen it so a quiet day does not look like a dead webhook
  webhooks_j := webhooks_j || jsonb_build_object('last_webhook_at', (select max(created_at) from public.payment_events where source = 'webhook'));

  -- Paid, but the business is not on the plan it paid for (latest successful payment per business, last 14 days)
  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) into gaps_j from (
    select coalesce(o.name, 'Unknown business') as business, p.reference, coalesce(pl.name, 'plan') as plan_name,
           coalesce(p.paid_at, p.created_at) as paid_at, s.status as subscription_status
    from (
      select distinct on (organization_id) * from public.payments
      where status = 'success' and coalesce(paid_at, created_at) >= now() - interval '14 days'
      order by organization_id, coalesce(paid_at, created_at) desc
    ) p
    left join public.organizations o on o.id = p.organization_id
    left join public.plans pl on pl.id = p.plan_id
    left join public.subscriptions s on s.organization_id = p.organization_id
    where not exists (
      select 1 from public.subscriptions s2
      where s2.organization_id = p.organization_id and s2.plan_id = p.plan_id and s2.status = 'active'
    )
    order by 4 desc limit 8
  ) x;

  payments_j := payments_j || jsonb_build_object('stuck', stuck_j, 'webhooks', webhooks_j,
    'activation_gaps', gaps_j, 'activation_gap_count', jsonb_array_length(gaps_j));

  -- Subscriptions -------------------------------------------------------------------------------------------------
  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) into trials_j from (
    select coalesce(o.name, 'Unknown business') as business, round(extract(epoch from (s.trial_end - now())) / 3600)::int as hours_left
    from public.subscriptions s left join public.organizations o on o.id = s.organization_id
    where s.status = 'trialing' and s.trial_end between now() and now() + interval '48 hours'
    order by s.trial_end asc limit 10
  ) x;

  select jsonb_build_object(
    'trialing', count(*) filter (where s.status = 'trialing' and (s.trial_end is null or s.trial_end > now())),
    'active_paid', count(*) filter (where s.status = 'active' and coalesce(pl.code, '') <> 'free'),
    'past_due', count(*) filter (where s.status = 'past_due'),
    'expired_7d', count(*) filter (where s.status = 'expired' and s.updated_at >= now() - interval '7 days'),
    'canceled_30d', count(*) filter (where s.canceled_at >= now() - interval '30 days'),
    'trials_ending_48h', jsonb_array_length(trials_j),
    'trials_ending_list', trials_j
  ) into subs_j from public.subscriptions s left join public.plans pl on pl.id = s.plan_id;

  subs_j := subs_j || (
    select jsonb_build_object(
      'cohort_trials_60d', count(*),
      'cohort_converted', count(*) filter (where exists (select 1 from public.payments p where p.organization_id = s.organization_id and p.status = 'success')),
      'conversion_rate', case when count(*) = 0 then null else round(100.0 * count(*) filter (where exists (select 1 from public.payments p where p.organization_id = s.organization_id and p.status = 'success')) / count(*), 1) end
    ) from public.subscriptions s where s.trial_start >= now() - interval '60 days'
  );
  subs_j := subs_j || jsonb_build_object('churn_30d_rate',
    case when (subs_j->>'active_paid')::int + (subs_j->>'canceled_30d')::int = 0 then null
         else round(100.0 * (subs_j->>'canceled_30d')::int / ((subs_j->>'active_paid')::int + (subs_j->>'canceled_30d')::int), 1) end);

  -- Edge functions ------------------------------------------------------------------------------------------------
  select coalesce(jsonb_agg(row_to_json(x) order by x.errors desc, x.p95_ms desc), '[]'::jsonb) into funcs_j from (
    select function_name, count(*)::int as requests,
           count(*) filter (where status_code >= 500)::int as errors,
           round(100.0 * count(*) filter (where status_code >= 500) / count(*), 1) as error_rate,
           round(avg(duration_ms))::int as avg_ms,
           round(percentile_cont(0.95) within group (order by duration_ms))::int as p95_ms
    from public.backend_request_latency
    where recorded_at >= now() - interval '24 hours'
    group by function_name order by 3 desc, 6 desc limit 14
  ) x;

  -- Capacity ------------------------------------------------------------------------------------------------------
  select count(*) into conns from pg_stat_activity where datname = current_database();
  max_conns := current_setting('max_connections')::int;
  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) into tables_j from (
    select c.relname as table_name, pg_total_relation_size(c.oid) as bytes
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by 2 desc limit 6
  ) x;
  begin select coalesce(sum((metadata->>'size')::bigint), 0) into storage_bytes from storage.objects; exception when others then storage_bytes := null; end;
  begin select count(*) into auth_users from auth.users; exception when others then auth_users := null; end;
  select extract(epoch from (now() - greatest(
      (select max(recorded_at) from public.backend_request_latency),
      (select max(created_at) from public.sales),
      (select max(day)::timestamptz from public.user_activity_daily)))) / 3600 into idle_hours;

  -- Security ------------------------------------------------------------------------------------------------------
  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) into throttle_j from (
    select bucket, count(*)::int as hits from public.auth_throttle where created_at >= now() - interval '24 hours' group by bucket order by 2 desc limit 6
  ) x;
  begin
    select count(*) into admins_no_mfa from public.platform_admin_access a
      where a.status = 'active' and not exists (select 1 from auth.mfa_factors f where f.user_id = a.user_id and f.status = 'verified');
    select coalesce(jsonb_agg(u.email), '[]'::jsonb) into admin_no_mfa_list from (
      select au.email from public.platform_admin_access a join auth.users au on au.id = a.user_id
      where a.status = 'active' and not exists (select 1 from auth.mfa_factors f where f.user_id = a.user_id and f.status = 'verified') limit 10) u;
  exception when others then admins_no_mfa := null; admin_no_mfa_list := '[]'::jsonb; end;
  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) into bulk_j from (
    select coalesce(o.name, 'Unknown business') as business, count(*)::int as deletes
    from public.audit_logs l left join public.organizations o on o.id = l.organization_id
    where l.created_at >= now() - interval '24 hours' and l.action ilike '%delete%'
    group by o.name having count(*) >= 15 order by 2 desc limit 5
  ) x;
  sec_j := jsonb_build_object(
    'throttle_total_24h', (select coalesce(sum((e->>'hits')::int), 0) from jsonb_array_elements(throttle_j) e),
    'throttle_buckets', throttle_j,
    'admins_without_mfa', admins_no_mfa,
    'admins_without_mfa_list', admin_no_mfa_list,
    'admin_actions_24h', (select count(*) from public.admin_audit_logs where created_at >= now() - interval '24 hours'),
    'admin_sensitive_24h', (select count(*) from public.admin_audit_logs where created_at >= now() - interval '24 hours'
        and (action ilike '%delete%' or action ilike '%revoke%' or action ilike '%grant%' or action ilike '%set_subscription%')),
    'bulk_delete_businesses', bulk_j
  );

  -- Data integrity ------------------------------------------------------------------------------------------------
  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) into neg_j from (
    select p.name as product, coalesce(o.name, 'Unknown business') as business, p.stock
    from public.products p left join public.organizations o on o.id = p.organization_id where p.stock < 0 order by p.stock asc limit 8
  ) x;
  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) into mismatch_j from (
    select p.name as product, coalesce(o.name, 'Unknown business') as business, p.stock as shown, m.moved as from_movements
    from public.products p
    join (select product_id, sum(quantity)::int as moved from public.stock_movements group by product_id) m on m.product_id = p.id
    left join public.organizations o on o.id = p.organization_id
    where p.stock <> m.moved order by abs(p.stock - m.moved) desc limit 8
  ) x;
  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) into totals_j from (
    select coalesce(o.name, 'Unknown business') as business, s.id::text as sale_id, s.total as recorded,
           (i.sub - coalesce(s.discount_amount, 0)) as from_items
    from public.sales s
    join (select sale_id, sum(quantity * unit_price) as sub from public.sale_items group by sale_id) i on i.sale_id = s.id
    left join public.organizations o on o.id = s.organization_id
    where s.status = 'completed' and s.created_at >= now() - interval '30 days'
      and abs(s.total - (i.sub - coalesce(s.discount_amount, 0))) > 1
    order by s.created_at desc limit 8
  ) x;
  integ_j := jsonb_build_object(
    'negative_stock_count', (select count(*) from public.products where stock < 0),
    'negative_stock', neg_j,
    'stock_mismatch_count', (select count(*) from public.products p join (select product_id, sum(quantity)::int as moved from public.stock_movements group by product_id) m on m.product_id = p.id where p.stock <> m.moved),
    'stock_mismatch', mismatch_j,
    'sale_total_mismatch_count', (select count(*) from public.sales s join (select sale_id, sum(quantity * unit_price) as sub from public.sale_items group by sale_id) i on i.sale_id = s.id
        where s.status = 'completed' and s.created_at >= now() - interval '30 days' and abs(s.total - (i.sub - coalesce(s.discount_amount, 0))) > 1),
    'sale_total_mismatch', totals_j,
    'sales_without_items', (select count(*) from public.sales s where s.status = 'completed' and s.created_at >= now() - interval '30 days'
        and not exists (select 1 from public.sale_items i where i.sale_id = s.id)),
    'sale_syncs_24h', (select count(*) from public.sale_sync_operations where created_at >= now() - interval '24 hours'),
    'customer_syncs_24h', (select count(*) from public.customer_sync_operations where created_at >= now() - interval '24 hours'),
    'sync_failures_24h', (select count(*) from public.client_error_events where kind = 'sync' and created_at >= now() - interval '24 hours')
  );

  -- Customer health -----------------------------------------------------------------------------------------------
  with last_seen as (
    select o.id, o.name, o.created_at, greatest(
      (select max(s.created_at) from public.sales s where s.organization_id = o.id),
      (select max(u.day)::timestamptz from public.user_activity_daily u where u.organization_id = o.id),
      o.created_at) as last_at
    from public.organizations o
  )
  select jsonb_build_object(
      'silent_7_13', count(*) filter (where last_at < now() - interval '7 days' and last_at >= now() - interval '14 days'),
      'silent_14_29', count(*) filter (where last_at < now() - interval '14 days' and last_at >= now() - interval '30 days'),
      'silent_30_plus', count(*) filter (where last_at < now() - interval '30 days'),
      'total_businesses', count(*)
    ),
    (select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
       select name as business, floor(extract(epoch from (now() - last_at)) / 86400)::int as days_silent
       from last_seen where last_at < now() - interval '7 days' and created_at < now() - interval '7 days' order by last_at desc limit 8) x)
  into cust_j, silent_j from last_seen;

  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) into noact_j from (
    select o.name as business, floor(extract(epoch from (now() - o.created_at)) / 86400)::int as days_since_signup
    from public.organizations o
    where o.created_at < now() - interval '2 days' and o.created_at >= now() - interval '30 days'
      and not exists (select 1 from public.products p where p.organization_id = o.id)
    order by o.created_at desc limit 8
  ) x;
  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) into nosale_j from (
    select o.name as business, floor(extract(epoch from (now() - o.created_at)) / 86400)::int as days_since_signup
    from public.organizations o
    where o.created_at < now() - interval '2 days' and o.created_at >= now() - interval '30 days'
      and exists (select 1 from public.products p where p.organization_id = o.id)
      and not exists (select 1 from public.sales s where s.organization_id = o.id and s.status = 'completed')
    order by o.created_at desc limit 8
  ) x;
  cust_j := cust_j || jsonb_build_object(
    'silent_list', silent_j,
    'no_products', noact_j, 'no_products_count', jsonb_array_length(noact_j),
    'no_sales', nosale_j, 'no_sales_count', jsonb_array_length(nosale_j),
    'support_open', (select count(*) from public.support_conversations where status = 'open'),
    'support_waiting_24h', (select count(*) from public.support_conversations where status = 'open' and waiting_since is not null and waiting_since < now() - interval '24 hours'),
    'support_oldest_wait_hours', (select round(extract(epoch from (now() - min(waiting_since))) / 3600) from public.support_conversations where status = 'open' and waiting_since is not null)
  );

  -- Browser errors ------------------------------------------------------------------------------------------------
  select jsonb_build_object(
    'errors_24h', count(*) filter (where created_at >= now() - interval '24 hours'),
    'errors_prev_24h', count(*) filter (where created_at < now() - interval '24 hours' and created_at >= now() - interval '48 hours'),
    'affected_users_24h', count(distinct user_id) filter (where created_at >= now() - interval '24 hours'),
    'mobile_share', case when count(*) filter (where created_at >= now() - interval '24 hours') = 0 then null
        else round(100.0 * count(*) filter (where created_at >= now() - interval '24 hours' and device = 'mobile') / count(*) filter (where created_at >= now() - interval '24 hours')) end
  ) into app_j from public.client_error_events where created_at >= now() - interval '48 hours';
  app_j := app_j || jsonb_build_object(
    'top', (select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
        select max(message) as message, kind, count(*)::int as count, max(created_at) as last_seen
        from public.client_error_events where created_at >= now() - interval '24 hours'
        group by fingerprint, kind order by 3 desc limit 6) x),
    'versions', (select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
        select coalesce(app_version, 'unknown') as version, count(*)::int as errors
        from public.client_error_events where created_at >= now() - interval '24 hours'
        group by 1 order by 2 desc limit 6) x)
  );

  -- Promoter abuse ------------------------------------------------------------------------------------------------
  promo_j := jsonb_build_object(
    'self_referrals', (select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
        select pr.full_name as promoter, coalesce(o.name, 'Unknown business') as business
        from public.referrals r
        join public.promoters pr on pr.id = r.promoter_id
        join public.organization_members m on m.organization_id = r.organization_id and m.user_id = pr.user_id
        left join public.organizations o on o.id = r.organization_id
        order by r.signed_up_at desc nulls last limit 8) x),
    'referral_spikes', (select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
        select pr.full_name as promoter, count(*)::int as referrals_24h
        from public.referrals r join public.promoters pr on pr.id = r.promoter_id
        where r.signed_up_at >= now() - interval '24 hours'
        group by pr.full_name having count(*) >= 10 order by 2 desc limit 8) x),
    'payouts_waiting_7d', (select count(*) from public.promoter_payout_requests where status = 'pending' and requested_at < now() - interval '7 days'),
    'payouts_over_earned', (select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
        select pr.full_name as promoter, (q.amount_kobo / 100.0) as requested,
               (coalesce((select sum(c.commission_kobo) from public.promoter_commissions c where c.promoter_id = q.promoter_id), 0) / 100.0) as ever_earned
        from public.promoter_payout_requests q join public.promoters pr on pr.id = q.promoter_id
        where q.status = 'pending'
          and q.amount_kobo > coalesce((select sum(c.commission_kobo) from public.promoter_commissions c where c.promoter_id = q.promoter_id), 0)
        limit 8) x),
    'duplicate_payout_references', (select count(*) from (
        select payment_reference from public.promoter_payout_requests where payment_reference is not null group by 1 having count(*) > 1) d)
  );

  return jsonb_build_object(
    'generated_at', now(),
    'payments', payments_j,
    'subscriptions', subs_j,
    'functions', funcs_j,
    'capacity', jsonb_build_object(
      'db_bytes', db_bytes, 'db_limit_bytes', db_limit_bytes,
      'db_used_percent', round(100.0 * db_bytes / db_limit_bytes, 1),
      'top_tables', tables_j, 'connections', conns, 'max_connections', max_conns,
      'storage_bytes', storage_bytes, 'auth_users', auth_users,
      'hours_since_activity', round(idle_hours, 1)
    ),
    'security', sec_j,
    'integrity', integ_j,
    'customers', cust_j,
    'app_errors', app_j,
    'promoters', promo_j
  );
end;
$$;
revoke all on function public.platform_health_signals() from public, anon, authenticated;
grant execute on function public.platform_health_signals() to service_role;

-- 4. Alert rules ------------------------------------------------------------------------------------------------------
create or replace function public.platform_health_alerts(s jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  a jsonb := '[]'::jsonb;
  f jsonb;
  used numeric := coalesce((s->'capacity'->>'db_used_percent')::numeric, 0);
  conns numeric := coalesce((s->'capacity'->>'connections')::numeric, 0);
  max_conns numeric := greatest(coalesce((s->'capacity'->>'max_connections')::numeric, 1), 1);
  idle numeric := coalesce((s->'capacity'->>'hours_since_activity')::numeric, 0);
  add_alert text;
begin
  if coalesce((s->'payments'->>'needs_review')::int, 0) > 0 then
    a := a || jsonb_build_array(jsonb_build_object('key', 'pay-review', 'severity', 'critical', 'title', 'Payments need review',
      'detail', (s->'payments'->>'needs_review') || ' payment(s) have a wrong amount or currency and were not activated.'));
  end if;
  if coalesce((s->'payments'->>'activation_gap_count')::int, 0) > 0 then
    a := a || jsonb_build_array(jsonb_build_object('key', 'pay-gap', 'severity', 'critical', 'title', 'Paid but plan not active',
      'detail', (s->'payments'->>'activation_gap_count') || ' business(es) paid in the last 14 days but are not on the plan they paid for.'));
  end if;
  if coalesce((s->'payments'->>'pending_stuck')::int, 0) >= 3 then
    a := a || jsonb_build_array(jsonb_build_object('key', 'pay-stuck', 'severity', 'warning', 'title', 'Payments stuck pending',
      'detail', (s->'payments'->>'pending_stuck') || ' payments have been pending for over 30 minutes.'));
  end if;
  if coalesce((s->'payments'->'webhooks'->>'errors_24h')::int, 0) >= 3 then
    a := a || jsonb_build_array(jsonb_build_object('key', 'pay-webhook', 'severity', 'critical', 'title', 'Payment confirmations failing',
      'detail', (s->'payments'->'webhooks'->>'errors_24h') || ' payment checks failed in the last 24 hours.'));
  end if;
  if coalesce((s->'subscriptions'->>'past_due')::int, 0) > 0 then
    a := a || jsonb_build_array(jsonb_build_object('key', 'subs-past-due', 'severity', 'warning', 'title', 'Past-due subscriptions',
      'detail', (s->'subscriptions'->>'past_due') || ' subscription(s) are past due.'));
  end if;
  for f in select * from jsonb_array_elements(coalesce(s->'functions', '[]'::jsonb)) loop
    if coalesce((f->>'requests')::int, 0) >= 10 and coalesce((f->>'error_rate')::numeric, 0) >= 20 then
      a := a || jsonb_build_array(jsonb_build_object('key', 'fn-' || (f->>'function_name'), 'severity', 'critical',
        'title', 'Function failing: ' || (f->>'function_name'),
        'detail', (f->>'error_rate') || '% of ' || (f->>'requests') || ' requests failed in the last 24 hours.'));
    end if;
  end loop;
  if used >= 85 then
    a := a || jsonb_build_array(jsonb_build_object('key', 'db-full', 'severity', 'critical', 'title', 'Database almost full', 'detail', used || '% of the plan limit is used.'));
  elsif used >= 70 then
    a := a || jsonb_build_array(jsonb_build_object('key', 'db-high', 'severity', 'warning', 'title', 'Database filling up', 'detail', used || '% of the plan limit is used.'));
  end if;
  if conns / max_conns >= 0.8 then
    a := a || jsonb_build_array(jsonb_build_object('key', 'db-conns', 'severity', 'warning', 'title', 'Database connections nearly exhausted',
      'detail', conns::int || ' of ' || max_conns::int || ' connections are in use.'));
  end if;
  if idle >= 120 then
    a := a || jsonb_build_array(jsonb_build_object('key', 'pause-risk', 'severity', 'warning', 'title', 'Project may be paused for inactivity',
      'detail', 'No activity for ' || round(idle)::int || ' hours. Free projects pause after about 7 days.'));
  end if;
  if coalesce((s->'security'->>'admins_without_mfa')::int, 0) > 0 then
    a := a || jsonb_build_array(jsonb_build_object('key', 'admin-mfa', 'severity', 'warning', 'title', 'Admins without two-step sign-in',
      'detail', (s->'security'->>'admins_without_mfa') || ' active admin(s) have no verified second factor.'));
  end if;
  if coalesce((s->'security'->>'throttle_total_24h')::int, 0) >= 200 then
    a := a || jsonb_build_array(jsonb_build_object('key', 'throttle-spike', 'severity', 'warning', 'title', 'Sign-in rate limit hit often',
      'detail', (s->'security'->>'throttle_total_24h') || ' throttled attempts in 24 hours.'));
  end if;
  if jsonb_array_length(coalesce(s->'security'->'bulk_delete_businesses', '[]'::jsonb)) > 0 then
    a := a || jsonb_build_array(jsonb_build_object('key', 'bulk-delete', 'severity', 'warning', 'title', 'Unusual number of deletions',
      'detail', 'A business deleted 15 or more records in 24 hours.'));
  end if;
  if coalesce((s->'integrity'->>'negative_stock_count')::int, 0) > 0 then
    a := a || jsonb_build_array(jsonb_build_object('key', 'neg-stock', 'severity', 'warning', 'title', 'Negative stock found',
      'detail', (s->'integrity'->>'negative_stock_count') || ' product(s) have stock below zero.'));
  end if;
  if coalesce((s->'integrity'->>'sale_total_mismatch_count')::int, 0) > 0 then
    a := a || jsonb_build_array(jsonb_build_object('key', 'sale-total', 'severity', 'critical', 'title', 'Sale totals do not match their items',
      'detail', (s->'integrity'->>'sale_total_mismatch_count') || ' sale(s) in the last 30 days.'));
  end if;
  if coalesce((s->'app_errors'->>'errors_24h')::int, 0) >= 50
     and coalesce((s->'app_errors'->>'errors_24h')::int, 0) >= 2 * coalesce((s->'app_errors'->>'errors_prev_24h')::int, 0) then
    a := a || jsonb_build_array(jsonb_build_object('key', 'app-errors', 'severity', 'warning', 'title', 'App errors rising',
      'detail', (s->'app_errors'->>'errors_24h') || ' browser errors in 24 hours (' || coalesce(s->'app_errors'->>'errors_prev_24h', '0') || ' the day before).'));
  end if;
  if jsonb_array_length(coalesce(s->'promoters'->'self_referrals', '[]'::jsonb)) > 0 then
    a := a || jsonb_build_array(jsonb_build_object('key', 'promo-self', 'severity', 'warning', 'title', 'Possible self-referral',
      'detail', 'A promoter appears to have referred a business they belong to.'));
  end if;
  if jsonb_array_length(coalesce(s->'promoters'->'payouts_over_earned', '[]'::jsonb)) > 0 then
    a := a || jsonb_build_array(jsonb_build_object('key', 'promo-overpay', 'severity', 'critical', 'title', 'Payout request above total earned',
      'detail', 'A pending payout asks for more than the promoter has ever earned.'));
  end if;
  return a;
end;
$$;
revoke all on function public.platform_health_alerts(jsonb) from public, anon, authenticated;
grant execute on function public.platform_health_alerts(jsonb) to service_role;

-- 5. What the console calls -------------------------------------------------------------------------------------------
create or replace function public.admin_get_health_center()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s jsonb;
  financial boolean := public.can_view_financial_admin_data();
begin
  if not public.admin_can_access('Health center') then
    raise exception 'UNAUTHORIZED: Health center access required';
  end if;
  s := public.platform_health_signals();
  -- Money panels are for finance-capable admins only; the matching alerts are hidden with them.
  if not financial then
    s := (s - 'payments' - 'subscriptions') || jsonb_build_object('financial_hidden', true);
  end if;
  return s || jsonb_build_object('alerts', public.platform_health_alerts(s), 'alert_cooldown_hours', 6);
end;
$$;
revoke all on function public.admin_get_health_center() from public, anon;
grant execute on function public.admin_get_health_center() to authenticated;

-- 6. What the scheduler calls (via the platform-alerts function) ------------------------------------------------------
create or replace function public.platform_claim_alerts(p_cooldown_hours integer default 6)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  active jsonb := public.platform_health_alerts(public.platform_health_signals());
  item jsonb; prior record;
  fire jsonb := '[]'::jsonb; resolved jsonb := '[]'::jsonb; gone record;
begin
  for item in select * from jsonb_array_elements(active) loop
    select * into prior from public.platform_alert_state where alert_key = item->>'key';
    if not found then
      insert into public.platform_alert_state (alert_key, severity) values (item->>'key', item->>'severity');
      fire := fire || jsonb_build_array(item);
    elsif prior.last_sent_at < now() - make_interval(hours => greatest(p_cooldown_hours, 1)) then
      update public.platform_alert_state set last_sent_at = now(), severity = item->>'severity' where alert_key = prior.alert_key;
      fire := fire || jsonb_build_array(item);
    end if;
  end loop;
  for gone in select alert_key from public.platform_alert_state
    where alert_key not in (select e->>'key' from jsonb_array_elements(active) e) loop
    resolved := resolved || jsonb_build_array(gone.alert_key);
    delete from public.platform_alert_state where alert_key = gone.alert_key;
  end loop;
  return jsonb_build_object('fire', fire, 'resolved', resolved, 'active_count', jsonb_array_length(active));
end;
$$;
revoke all on function public.platform_claim_alerts(integer) from public, anon, authenticated;
grant execute on function public.platform_claim_alerts(integer) to service_role;

-- 7. Permissions: the new section for SUPER, PLATFORM and FINANCE admins (financial panels stay finance-only above)
create or replace function public.admin_role_sections(p_role public.platform_admin_role)
returns text[]
language sql
immutable
as $$
  select case p_role::text
    when 'SUPER_ADMIN' then array['Overview','Analytics','Users','Organizations','Subscriptions','Plans','Promoters','Payouts','Revenue','Gifts','Admins',
                                  'Branches','Inventory','Sales','Notifications','Messages','Feedback','Roadmap','Audit log','Monitoring','Health center','Profile','Settings']
    when 'PLATFORM_ADMIN' then array['Overview','Analytics','Users','Organizations','Subscriptions','Promoters',
                                     'Branches','Inventory','Sales','Notifications','Feedback','Roadmap','Audit log','Monitoring','Health center','Profile','Settings']
    when 'SUPPORT_ADMIN' then array['Messages','Feedback','Notifications','Profile','Settings']
    when 'FINANCE_ADMIN' then array['Overview','Subscriptions','Plans','Payouts','Revenue','Health center','Profile','Settings']
    when 'MODERATION_ADMIN' then array['Users','Organizations','Feedback','Audit log','Profile','Settings']
    else array[]::text[]
  end;
$$;

notify pgrst, 'reload schema';
