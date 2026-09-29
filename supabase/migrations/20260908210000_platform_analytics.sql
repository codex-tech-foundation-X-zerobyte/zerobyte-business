create or replace function public.get_platform_analytics(period_key text default '30d')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  bucket text;
  start_at timestamptz;
  step interval;
  points jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'Platform administrator access required';
  end if;

  bucket := case
    when period_key = '7d' then 'day'
    when period_key = '12m' then 'month'
    when period_key = '5y' then 'year'
    else 'day'
  end;
  start_at := case
    when period_key = '7d' then date_trunc('day', now()) - interval '6 days'
    when period_key = '12m' then date_trunc('month', now()) - interval '11 months'
    when period_key = '5y' then date_trunc('year', now()) - interval '4 years'
    else date_trunc('day', now()) - interval '29 days'
  end;
  step := case when bucket = 'month' then interval '1 month' when bucket = 'year' then interval '1 year' else interval '1 day' end;

  select coalesce(jsonb_agg(jsonb_build_object(
    'date', to_char(bucket_date, 'YYYY-MM-DD'),
    'label', case when bucket = 'year' then to_char(bucket_date, 'YYYY') when bucket = 'month' then to_char(bucket_date, 'Mon YY') else to_char(bucket_date, 'DD Mon') end,
    'users', (select count(*) from auth.users u where date_trunc(bucket, u.created_at) = bucket_date),
    'organizations', (select count(*) from public.organizations o where date_trunc(bucket, o.created_at) = bucket_date),
    'sales', (select count(*) from public.sales s where date_trunc(bucket, s.created_at) = bucket_date),
    'revenue', coalesce((select sum(s.total) from public.sales s where date_trunc(bucket, s.created_at) = bucket_date), 0),
    'expenses', coalesce((select sum(e.amount) from public.expenses e where date_trunc(bucket, e.created_at) = bucket_date), 0)
  ) order by bucket_date), '[]'::jsonb)
  into points
  from generate_series(start_at, date_trunc(bucket, now()), step) as series(bucket_date);

  return jsonb_build_object('period', period_key, 'bucket', bucket, 'points', points);
end;
$$;

grant execute on function public.get_platform_analytics(text) to authenticated;
