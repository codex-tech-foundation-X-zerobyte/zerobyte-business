-- The paginated screens order by (date, id) so pages never repeat or skip a row when many rows share a timestamp
-- (for example after a bulk import). The earlier indexes did not include id, so the database had to read and sort every
-- row of a business to return one page of 50 (35 ms for 5,000 rows, growing with the table). These indexes match the
-- ordering exactly, so a page is read straight off the index.

create index if not exists idx_customers_page on public.customers (organization_id, created_at desc, id);
create index if not exists idx_products_page on public.products (organization_id, created_at desc, id);
create index if not exists idx_invoices_page on public.invoices (organization_id, created_at desc, id);
create index if not exists idx_sales_page on public.sales (organization_id, created_at desc, id);
create index if not exists idx_expenses_page on public.expenses (organization_id, expense_date desc, id);
create index if not exists idx_stock_movements_page on public.stock_movements (organization_id, created_at desc, id);
create index if not exists idx_purchase_orders_page on public.purchase_orders (organization_id, created_at desc, id);

-- superseded by the page indexes above
drop index if exists public.idx_products_org_created;
drop index if exists public.idx_customers_org_created;
drop index if exists public.idx_invoices_org_created;
drop index if exists public.idx_stock_movements_org_created;
