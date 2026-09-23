create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  category text not null default 'General',
  amount numeric(12,2) not null check (amount >= 0),
  expense_date date not null default current_date,
  payment_method text,
  description text,
  created_at timestamptz not null default now()
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  invoice_number text not null,
  status text not null default 'DRAFT' check (status in ('DRAFT','SENT','PAID','OVERDUE','CANCELED')),
  total numeric(12,2) not null default 0 check (total >= 0),
  due_date date,
  created_at timestamptz not null default now(),
  unique (organization_id, invoice_number)
);

alter table public.expenses enable row level security;
alter table public.invoices enable row level security;

create policy "members manage expenses" on public.expenses for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "members manage invoices" on public.invoices for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "members update organization" on public.organizations for update using (public.is_org_member(id)) with check (public.is_org_member(id));
