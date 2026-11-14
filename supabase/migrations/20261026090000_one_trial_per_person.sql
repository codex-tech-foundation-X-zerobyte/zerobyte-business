-- One free trial per PERSON, not per business.
--
-- Problem: nothing limits how many businesses one account can create, and each new business started its own
-- 7-day trial, so one person could get free access forever by creating a new business every week.
--
-- Fix: the first business a person creates gets the free trial. The person is remembered in trial_grants (it
-- survives deleting the business). Any further business they create starts locked, so it must be paid for.
-- Server-side work with no signed-in user (admin tools, migrations, tests) is not affected.

create table if not exists public.trial_grants (
  user_id uuid primary key,
  organization_id uuid,
  granted_at timestamptz not null default now()
);
alter table public.trial_grants enable row level security;
revoke all on public.trial_grants from anon, authenticated;
-- no policies on purpose: only server-side code (SECURITY DEFINER functions, service role) can read or write it

-- People who already own a business have already had their trial.
insert into public.trial_grants (user_id, organization_id)
select distinct on (m.user_id) m.user_id, m.organization_id
from public.organization_members m
where m.role = 'owner'
order by m.user_id, m.created_at
on conflict do nothing;

create or replace function public.create_default_subscription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  free_plan_id uuid;
  new_subscription_id uuid;
  trial_length integer := public.signup_trial_days();
  granted boolean := true;
begin
  select id into free_plan_id from public.plans where code = 'free' and active limit 1;
  if free_plan_id is null then return new; end if; -- plans not seeded yet in this environment

  if auth.uid() is not null then
    insert into public.trial_grants (user_id, organization_id) values (auth.uid(), new.id) on conflict (user_id) do nothing;
    granted := found;
  end if;

  if granted then
    insert into public.subscriptions (organization_id, plan_id, status, trial_start, trial_end, current_period_start, current_period_end)
      values (new.id, free_plan_id, 'trialing', now(), now() + make_interval(days => trial_length), now(), now() + make_interval(days => trial_length))
      returning id into new_subscription_id;
    insert into public.subscription_events (subscription_id, organization_id, event_type, to_plan_id, actor_id, note)
      values (new_subscription_id, new.id, 'trial_started', free_plan_id, auth.uid(), trial_length || '-day free trial started at signup');
  else
    -- This person already used their free trial on another business: this one starts locked until a plan is paid.
    insert into public.subscriptions (organization_id, plan_id, status, current_period_start, current_period_end)
      values (new.id, free_plan_id, 'expired', now(), now())
      returning id into new_subscription_id;
    insert into public.subscription_events (subscription_id, organization_id, event_type, to_plan_id, actor_id, note)
      values (new_subscription_id, new.id, 'created', free_plan_id, auth.uid(), 'Free trial already used on another business by this owner; plan must be paid');
  end if;
  return new;
end;
$$;
