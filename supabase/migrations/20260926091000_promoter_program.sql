-- Promoter program: application, admin review, and referral codes.
--
-- Scoped deliberately: this covers APPLY -> REVIEW -> APPROVE/REJECT/SUSPEND
-- and issuing a referral code, which needs no payment provider. Commission
-- calculation, the 50/20/20/10 allocation, and payouts all operate on real
-- money moving through a provider that isn't connected yet, so those stay
-- out until Flutterwave/PayPal credentials are available -- building them
-- now would mean guessing at amounts nobody has actually paid.
--
-- Anyone can apply (no account required yet, matching the spec's public
-- "Join Zerøbyte Promoters" page), but applying does not require or create
-- a Supabase Auth account by itself -- an approved promoter is invited to
-- create one so they have somewhere to eventually see their referrals.

create table public.promoter_applications (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (char_length(trim(full_name)) between 1 and 200),
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text,
  location text,
  social_profile text,
  marketing_experience text,
  reason text not null check (char_length(trim(reason)) between 1 and 2000),
  agreed_to_terms boolean not null default false,
  status text not null default 'applied' check (status in ('applied', 'under_review', 'approved', 'rejected')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now()
);
create index promoter_applications_status_idx on public.promoter_applications (status, created_at desc);
-- One pending/decided application per email at a time -- a rejected
-- applicant can still re-apply later (only one row stays 'applied' or
-- 'under_review' at once, not "forever blocked").
create unique index promoter_applications_open_email_idx on public.promoter_applications (lower(email)) where status in ('applied', 'under_review');

create table public.promoters (
  id uuid primary key default gen_random_uuid(),
  application_id uuid references public.promoter_applications(id),
  user_id uuid references auth.users(id),
  full_name text not null,
  email text not null,
  referral_code text not null unique,
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index promoters_user_idx on public.promoters (user_id) where user_id is not null;

create table public.referrals (
  id uuid primary key default gen_random_uuid(),
  promoter_id uuid not null references public.promoters(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  referral_code text not null,
  status text not null default 'registered' check (status in ('registered', 'verified', 'active', 'qualified', 'commissionable', 'paid', 'expired')),
  signed_up_at timestamptz not null default now(),
  qualified_at timestamptz,
  notes text
);
create index referrals_promoter_idx on public.referrals (promoter_id, signed_up_at desc);
create index referrals_org_idx on public.referrals (organization_id);

alter table public.promoter_applications enable row level security;
alter table public.promoters enable row level security;
alter table public.referrals enable row level security;

-- Applications are write-only from the public (submit_promoter_application
-- below), never directly readable/writable except by platform admins.
create policy promoter_applications_admin_all on public.promoter_applications
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy promoters_self_read on public.promoters
  for select using (user_id = auth.uid() or public.is_platform_admin());
create policy promoters_admin_write on public.promoters
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy referrals_promoter_read on public.referrals
  for select using (public.is_platform_admin() or exists (select 1 from public.promoters p where p.id = referrals.promoter_id and p.user_id = auth.uid()));
create policy referrals_admin_write on public.referrals
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());

-- Public submission entry point. No auth required (matches the spec's
-- public application page), rate-limited by the one-open-application-per-
-- email unique index above rather than an application-layer rate limiter.
create or replace function public.submit_promoter_application(
  applicant_name text,
  applicant_email text,
  applicant_phone text default null,
  applicant_location text default null,
  applicant_social text default null,
  applicant_experience text default null,
  applicant_reason text default null,
  terms_agreed boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  if nullif(trim(applicant_name), '') is null then raise exception 'VALIDATION_ERROR: name is required'; end if;
  if applicant_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'VALIDATION_ERROR: a valid email is required'; end if;
  if nullif(trim(coalesce(applicant_reason, '')), '') is null then raise exception 'VALIDATION_ERROR: tell us why you want to join'; end if;
  if not terms_agreed then raise exception 'VALIDATION_ERROR: you must agree to the promoter terms'; end if;
  if exists (select 1 from public.promoter_applications where lower(email) = lower(applicant_email) and status in ('applied', 'under_review')) then
    raise exception 'DUPLICATE_APPLICATION: an application from this email is already pending review';
  end if;
  insert into public.promoter_applications (full_name, email, phone, location, social_profile, marketing_experience, reason, agreed_to_terms)
    values (trim(applicant_name), lower(trim(applicant_email)), applicant_phone, applicant_location, applicant_social, applicant_experience, trim(applicant_reason), true)
    returning id into new_id;
  return new_id;
end;
$$;
grant execute on function public.submit_promoter_application(text, text, text, text, text, text, text, boolean) to anon, authenticated;

-- Approve an application: creates the promoter record with a generated
-- referral code (format ZB-XXXXX, matching the spec's example). Does NOT
-- create a Supabase Auth account -- the promoter signs in/up themselves
-- afterward and link_promoter_account (below) attaches their user_id.
create or replace function public.admin_review_promoter_application(
  target_application uuid,
  new_status text,
  note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  application public.promoter_applications%rowtype;
  generated_code text;
  new_promoter_id uuid;
begin
  if not public.is_platform_admin() then raise exception 'UNAUTHORIZED: platform admin access required'; end if;
  if new_status not in ('under_review', 'approved', 'rejected') then raise exception 'VALIDATION_ERROR: unrecognized decision'; end if;
  select * into application from public.promoter_applications where id = target_application for update;
  if application.id is null then raise exception 'APPLICATION_NOT_FOUND'; end if;
  update public.promoter_applications set
    status = new_status, reviewed_by = auth.uid(), reviewed_at = now(), review_note = note
    where id = target_application;
  if new_status = 'approved' then
    loop
      generated_code := 'ZB-' || upper(substr(md5(random()::text), 1, 5));
      exit when not exists (select 1 from public.promoters where referral_code = generated_code);
    end loop;
    insert into public.promoters (application_id, full_name, email, referral_code)
      values (application.id, application.full_name, application.email, generated_code)
      returning id into new_promoter_id;
  end if;
  return new_promoter_id;
end;
$$;
revoke all on function public.admin_review_promoter_application(uuid, text, text) from public, anon;

-- Links an approved promoter's record to the Supabase Auth account they
-- actually sign in with, once they create one. Matched by email so an
-- approved applicant can claim their promoter status themselves, without
-- an admin having to do it manually for every approval.
create or replace function public.link_promoter_account()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_email text;
  promoter_id uuid;
begin
  select email into caller_email from auth.users where id = auth.uid();
  if caller_email is null then raise exception 'UNAUTHORIZED'; end if;
  update public.promoters set user_id = auth.uid(), updated_at = now()
    where lower(email) = lower(caller_email) and user_id is null and status = 'active'
    returning id into promoter_id;
  if promoter_id is null then
    select id into promoter_id from public.promoters where user_id = auth.uid();
  end if;
  return promoter_id;
end;
$$;
grant execute on function public.link_promoter_account() to authenticated;

-- A promoter's own dashboard summary -- counts only, never another
-- promoter's or another business's private data.
create or replace function public.get_promoter_summary()
returns table (
  promoter_id uuid,
  referral_code text,
  status text,
  total_referrals bigint,
  qualified_referrals bigint,
  commissionable_referrals bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.referral_code, p.status,
    count(r.id),
    count(r.id) filter (where r.status in ('qualified', 'commissionable', 'paid')),
    count(r.id) filter (where r.status = 'commissionable')
  from public.promoters p
  left join public.referrals r on r.promoter_id = p.id
  where p.user_id = auth.uid()
  group by p.id;
$$;
grant execute on function public.get_promoter_summary() to authenticated;

create or replace function public.admin_set_promoter_status(target_promoter uuid, new_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then raise exception 'UNAUTHORIZED: platform admin access required'; end if;
  if new_status not in ('active', 'suspended') then raise exception 'VALIDATION_ERROR: unrecognized status'; end if;
  update public.promoters set status = new_status, updated_at = now() where id = target_promoter;
end;
$$;
revoke all on function public.admin_set_promoter_status(uuid, text) from public, anon;

create or replace function public.admin_list_promoters()
returns table (
  promoter_id uuid, full_name text, email text, referral_code text, status text,
  created_at timestamptz, total_referrals bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name, p.email, p.referral_code, p.status, p.created_at, count(r.id)
  from public.promoters p
  left join public.referrals r on r.promoter_id = p.id
  where public.is_platform_admin()
  group by p.id
  order by p.created_at desc;
$$;
revoke all on function public.admin_list_promoters() from public, anon;
