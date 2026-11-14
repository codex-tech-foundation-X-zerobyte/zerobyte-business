-- Invoice status already had OVERDUE in its allowed set and a due_date
-- column, but nothing ever set an invoice to OVERDUE or told anyone it was.
-- notifications has no INSERT policy for regular users (only a platform-
-- admin one and self-service "mark read"), so reminders have to go through
-- a security-definer function, the same reason the low-stock trigger does.

create or replace function public.flag_overdue_invoices(target_org uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count integer;
begin
  if not public.is_org_member(target_org) then
    raise exception using message = '{"code":"NOT_A_MEMBER","message":"Not a member of this organization"}';
  end if;
  update public.invoices
  set status = 'OVERDUE'
  where organization_id = target_org
    and status = 'SENT'
    and due_date is not null
    and due_date < current_date;
  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

create or replace function public.send_invoice_reminder(target_org uuid, target_invoice uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  invoice_row public.invoices%rowtype;
  days_overdue integer;
begin
  if not public.is_org_member(target_org) then
    raise exception using message = '{"code":"NOT_A_MEMBER","message":"Not a member of this organization"}';
  end if;
  select * into invoice_row from public.invoices where id = target_invoice and organization_id = target_org;
  if not found then
    raise exception using message = '{"code":"INVOICE_NOT_FOUND","message":"Invoice does not belong to this organization"}';
  end if;
  if invoice_row.status not in ('SENT', 'OVERDUE') then
    raise exception using message = '{"code":"INVOICE_NOT_REMINDABLE","message":"Only a sent or overdue invoice can get a reminder"}';
  end if;

  days_overdue := case when invoice_row.due_date is not null then greatest(0, current_date - invoice_row.due_date) else 0 end;

  insert into public.notifications (organization_id, user_id, title, body)
  select
    target_org,
    om.user_id,
    'Invoice ' || invoice_row.invoice_number || (case when days_overdue > 0 then ' is overdue' else ' reminder' end),
    'Invoice ' || invoice_row.invoice_number || ' for ' || to_char(invoice_row.total, 'FM999,999,999,990.00') ||
      (case when days_overdue > 0 then ' is ' || days_overdue || ' day' || (case when days_overdue = 1 then '' else 's' end) || ' overdue.' else ' is awaiting payment.' end)
  from public.organization_members om
  where om.organization_id = target_org
    and om.role in ('owner', 'admin');

  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'invoice.reminder_sent', 'invoice', target_invoice, jsonb_build_object('days_overdue', days_overdue));
end;
$$;

grant execute on function public.flag_overdue_invoices(uuid) to authenticated;
grant execute on function public.send_invoice_reminder(uuid, uuid) to authenticated;
revoke all on function public.flag_overdue_invoices(uuid) from public, anon;
revoke all on function public.send_invoice_reminder(uuid, uuid) from public, anon;
