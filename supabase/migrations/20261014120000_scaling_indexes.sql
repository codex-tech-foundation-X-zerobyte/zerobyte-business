-- Indexes the audit found missing on hot paths. All are additive and safe to re-run.
--
-- sale_items had NO index on sale_id: every receipt, report and cost-of-goods calculation joins sales -> sale_items,
-- so each of those scanned the whole table. That is the single biggest scaling gap in the database.
-- (On a database that already holds millions of rows, create these with CREATE INDEX CONCURRENTLY from the SQL editor
-- instead, because CONCURRENTLY cannot run inside a migration transaction. At today's size this is instant.)

create index if not exists idx_sale_items_sale on public.sale_items (sale_id);
create index if not exists idx_sale_items_product on public.sale_items (product_id);
create index if not exists idx_sales_customer on public.sales (customer_id) where customer_id is not null;
create index if not exists idx_products_org_created on public.products (organization_id, created_at desc);
create index if not exists idx_customers_org_created on public.customers (organization_id, created_at desc);
create index if not exists idx_invoices_org_created on public.invoices (organization_id, created_at desc);
create index if not exists idx_invoices_customer on public.invoices (customer_id) where customer_id is not null;
create index if not exists idx_stock_movements_org_created on public.stock_movements (organization_id, created_at desc);
create index if not exists idx_stock_movements_product on public.stock_movements (product_id, created_at desc);
-- the bell's list query: where user_id = ? and organization_id = ? order by created_at desc limit 30
create index if not exists idx_notifications_user_org_created on public.notifications (user_id, organization_id, created_at desc);
-- the low-stock alert fan-out reads owners/admins of one organization
create index if not exists idx_members_org_role on public.organization_members (organization_id, role);

analyze public.sale_items;
