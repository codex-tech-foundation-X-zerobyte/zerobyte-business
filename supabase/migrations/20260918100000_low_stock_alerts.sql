-- Turns the passive "X products need attention" dashboard count into an
-- actual notification.
--
-- Uses the existing `reorder_point` column (already present since the
-- initial schema and already read by get_dashboard_metrics' low_stock_count)
-- rather than adding a second, competing threshold column -- an earlier
-- draft of this migration mistakenly did that before this was caught in
-- review; a product's low-stock line would otherwise be governed by two
-- different numbers depending on which part of the app you looked at.

-- Fires once per crossing into low stock (not on every subsequent sale
-- while stock stays low), and on any INSERT that starts out low, so a
-- newly added product below its own threshold is flagged immediately too.
create or replace function public.notify_low_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  was_above_threshold boolean;
begin
  was_above_threshold := (TG_OP = 'INSERT') or (OLD.stock > OLD.reorder_point);
  if NEW.stock <= NEW.reorder_point and was_above_threshold then
    insert into public.notifications (organization_id, user_id, title, body)
    select
      NEW.organization_id,
      om.user_id,
      'Low stock: ' || NEW.name,
      NEW.name || ' (' || NEW.sku || ') is down to ' || NEW.stock ||
        ' unit' || (case when NEW.stock = 1 then '' else 's' end) ||
        ', at or below the reorder point of ' || NEW.reorder_point || '.'
    from public.organization_members om
    where om.organization_id = NEW.organization_id
      and om.role in ('owner', 'admin');
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_notify_low_stock on public.products;
create trigger trg_notify_low_stock
  after insert or update of stock, reorder_point on public.products
  for each row
  execute function public.notify_low_stock();
