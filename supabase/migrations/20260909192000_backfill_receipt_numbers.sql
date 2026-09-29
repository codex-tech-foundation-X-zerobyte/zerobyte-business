-- Give historical completed sales stable customer-facing receipt numbers.
with numbered as (
  select
    s.id,
    row_number() over (partition by s.organization_id order by s.created_at, s.id) as sequence_number,
    o.receipt_prefix
  from public.sales s
  join public.organizations o on o.id = s.organization_id
  where s.receipt_number is null
)
update public.sales s
set receipt_number = format('%s-%s', upper(n.receipt_prefix), lpad(n.sequence_number::text, 3, '0'))
from numbered n
where s.id = n.id;

update public.organizations o
set next_receipt_number = greatest(
  o.next_receipt_number,
  coalesce((
    select count(*) + 1
    from public.sales s
    where s.organization_id = o.id
      and s.receipt_number is not null
  ), 1)
);
