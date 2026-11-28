-- Read-only reports for the Telegram bot (/users and /business). Callable only with the server key, never from a browser.

create or replace function public.platform_bot_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  lagos_midnight timestamptz := (date_trunc('day', now() at time zone 'Africa/Lagos')) at time zone 'Africa/Lagos';
  accounts bigint; new_24h bigint; new_7d bigint; top_j jsonb;
begin
  begin
    select count(*), count(*) filter (where created_at >= now() - interval '24 hours'), count(*) filter (where created_at >= now() - interval '7 days')
      into accounts, new_24h, new_7d from auth.users;
  exception when others then accounts := null; new_24h := null; new_7d := null; end;

  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) into top_j from (
    select o.name as business, count(*)::int as sales, round(sum(s.total))::bigint as total
    from public.sales s join public.organizations o on o.id = s.organization_id
    where s.status = 'completed' and s.created_at >= lagos_midnight
    group by o.name order by sum(s.total) desc limit 5
  ) x;

  return jsonb_build_object(
    'registered_accounts', accounts,
    'new_accounts_24h', new_24h,
    'new_accounts_7d', new_7d,
    'businesses_total', (select count(*) from public.organizations),
    'new_businesses_24h', (select count(*) from public.organizations where created_at >= now() - interval '24 hours'),
    'new_businesses_7d', (select count(*) from public.organizations where created_at >= now() - interval '7 days'),
    'active_businesses_today', (select count(distinct organization_id) from public.user_activity_daily where day = (now() at time zone 'Africa/Lagos')::date),
    'sales_today', (select count(*) from public.sales where status = 'completed' and created_at >= lagos_midnight),
    'sales_today_total', (select coalesce(round(sum(total)), 0)::bigint from public.sales where status = 'completed' and created_at >= lagos_midnight),
    'top_businesses_today', top_j
  );
end;
$$;
revoke all on function public.platform_bot_stats() from public, anon, authenticated;
grant execute on function public.platform_bot_stats() to service_role;

create or replace function public.platform_bot_find_business(p_query text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
    select o.name as business,
           o.created_at,
           coalesce(pl.name, 'No plan') as plan,
           coalesce(s.status, 'none') as subscription_status,
           s.trial_end,
           (select max(sa.created_at) from public.sales sa where sa.organization_id = o.id) as last_sale_at,
           (select count(*) from public.products p where p.organization_id = o.id)::int as products,
           (select count(*) from public.sales sa where sa.organization_id = o.id and sa.status = 'completed' and sa.created_at >= now() - interval '30 days')::int as sales_30d,
           (select count(*) from public.organization_members m where m.organization_id = o.id)::int as members
    from public.organizations o
    left join public.subscriptions s on s.organization_id = o.id
    left join public.plans pl on pl.id = s.plan_id
    where length(trim(coalesce(p_query, ''))) >= 2
      and o.name ilike '%' || replace(replace(replace(trim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%'
    order by o.created_at desc
    limit 5
  ) x;
$$;
revoke all on function public.platform_bot_find_business(text) from public, anon, authenticated;
grant execute on function public.platform_bot_find_business(text) to service_role;

notify pgrst, 'reload schema';
