-- Professional, organization-scoped receipt numbering and business details.

alter table public.organizations
  add column if not exists receipt_prefix text,
  add column if not exists next_receipt_number integer not null default 1,
  add column if not exists address text,
  add column if not exists phone text,
  add column if not exists email text,
  add column if not exists website text,
  add column if not exists logo_url text,
  add column if not exists currency text not null default 'NGN';

alter table public.sales
  add column if not exists receipt_number text;

update public.organizations
set receipt_prefix = upper(left(regexp_replace(name, '[^A-Za-z0-9]', '', 'g'), 3))
where nullif(trim(receipt_prefix), '') is null;

update public.organizations
set receipt_prefix = 'ZB'
where nullif(trim(receipt_prefix), '') is null;

alter table public.organizations
  drop constraint if exists organizations_receipt_prefix_check;

alter table public.organizations
  add constraint organizations_receipt_prefix_check
  check (receipt_prefix ~ '^[A-Z0-9]{2,8}$');

create unique index if not exists sales_org_receipt_number_key
  on public.sales (organization_id, receipt_number)
  where receipt_number is not null;

create or replace function public.assign_receipt_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  org_prefix text;
  sequence_value integer;
begin
  if new.receipt_number is not null then
    return new;
  end if;

  select upper(coalesce(nullif(trim(receipt_prefix), ''), 'ZB'))
    into org_prefix
  from public.organizations
  where id = new.organization_id
  for update;

  if org_prefix is null then
    raise exception 'Organization does not exist';
  end if;

  update public.organizations
  set next_receipt_number = next_receipt_number + 1
  where id = new.organization_id
  returning next_receipt_number - 1 into sequence_value;

  new.receipt_number := format('%s-%s', org_prefix, lpad(sequence_value::text, 3, '0'));
  return new;
end;
$$;

drop trigger if exists sales_assign_receipt_number on public.sales;
create trigger sales_assign_receipt_number
before insert on public.sales
for each row execute function public.assign_receipt_number();

revoke all on function public.assign_receipt_number() from public, anon, authenticated;
