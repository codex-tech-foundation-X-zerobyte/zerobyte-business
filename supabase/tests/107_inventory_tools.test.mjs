// Self-checking logic test for CSV product import, stock counts and product ranking, run on PGlite (Postgres compiled to
// WebAssembly) so no database server is needed:
//   npm i --no-save @electric-sql/pglite && node supabase/tests/107_inventory_tools.test.mjs
// It builds minimal copies of the tables these functions touch (including the "inventory changes need a stock movement"
// guard and the low-stock notification trigger), then prints ALL INVENTORY TOOL CHECKS PASSED or stops at the first failure.
import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'

const db = new PGlite()
const migration = fs
  .readFileSync(new URL('../migrations/20261119090000_csv_import_stock_count_product_ranking.sql', import.meta.url), 'utf8')
  .replace(/^grant .*$/gm, '')
  .replace(/^revoke .*$/gm, '')
  .replace(/^notify .*$/gm, '')
  .replace(/^alter table public\.stock_counts enable row level security;$/gm, '')
  .replace(/^alter table public\.stock_count_items enable row level security;$/gm, '')
  .replace(/^create policy[\s\S]*?;\n/gm, '')
  .replace(/^drop policy.*$/gm, '')

const OWNER = '00000000-0000-0000-0000-0000000000a1'
const OWNER2 = '00000000-0000-0000-0000-0000000000a2'
const ORG = '00000000-0000-0000-0000-00000000000a'
const ORG2 = '00000000-0000-0000-0000-00000000000b'
const BRANCH = '00000000-0000-0000-0000-0000000000b1'

await db.exec(`
  create schema auth; create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create table organizations (id uuid primary key, report_timezone text not null default 'Africa/Lagos');
  create table organization_members (organization_id uuid, user_id uuid, role text);
  create table branches (id uuid primary key, organization_id uuid);
  create function org_timezone(p uuid) returns text language sql as $$ select coalesce((select report_timezone from organizations where id = p), 'Africa/Lagos') $$;
  create function can_manage_inventory(o uuid) returns boolean language sql as $$ select exists (select 1 from organization_members where organization_id = o and user_id = auth.uid() and role in ('owner','admin')) $$;
  create function is_org_manager(o uuid) returns boolean language sql as $$ select can_manage_inventory(o) $$;
  create table products (
    id uuid primary key default gen_random_uuid(), organization_id uuid not null, branch_id uuid,
    name text not null, sku text not null, category text not null default 'Uncategorized',
    stock integer not null default 0 check (stock >= 0), price numeric(12,2) not null default 0 check (price >= 0),
    cost_price numeric(12,2) not null default 0, reorder_point integer not null default 5 check (reorder_point >= 0),
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (organization_id, sku));
  create table stock_movements (id uuid primary key default gen_random_uuid(), organization_id uuid not null, branch_id uuid,
    product_id uuid not null references products(id) on delete cascade, movement_type text not null, quantity integer not null check (quantity <> 0),
    cost_price numeric(12,2), selling_price numeric(12,2), actor_id uuid, reason text, created_at timestamptz not null default now());
  create table notifications (id uuid primary key default gen_random_uuid(), organization_id uuid not null, user_id uuid not null, title text not null, body text not null, created_at timestamptz default now());
  create table audit_logs (id uuid primary key default gen_random_uuid(), organization_id uuid not null, actor_id uuid, action text not null, entity_type text not null, entity_id uuid, metadata jsonb not null default '{}'::jsonb, created_at timestamptz default now());
  create type sale_status as enum ('completed','pending','refunded');
  create table sales (id uuid primary key default gen_random_uuid(), organization_id uuid not null, branch_id uuid, status sale_status not null default 'completed', total numeric not null, created_at timestamptz not null);
  create table sale_items (id uuid primary key default gen_random_uuid(), sale_id uuid not null references sales(id), product_id uuid not null references products(id), quantity integer not null, unit_price numeric not null, cost_price numeric);
  create function prevent_direct_inventory_mutation() returns trigger language plpgsql as $$ begin
    if (new.stock is distinct from old.stock or new.cost_price is distinct from old.cost_price) and current_setting('app.inventory_mutation', true) <> 'on' then
      raise exception 'INVENTORY_RPC_REQUIRED'; end if; return new; end $$;
  create trigger products_require_inventory_rpc before update on products for each row execute function prevent_direct_inventory_mutation();
`)
// The migration adds the low_stock column and replaces the low-stock trigger function; install the trigger it feeds.
await db.exec(migration)
await db.exec(`create trigger trg_notify_low_stock after insert or update of stock, reorder_point on products for each row execute function notify_low_stock()`)
await db.exec(`
  insert into organizations(id) values ('${ORG}'), ('${ORG2}');
  insert into organization_members values ('${ORG}','${OWNER}','owner'), ('${ORG}','${OWNER2}','admin'), ('${ORG}','00000000-0000-0000-0000-0000000000c1','worker'), ('${ORG2}','00000000-0000-0000-0000-0000000000d1','owner');
  insert into branches values ('${BRANCH}','${ORG}');
  insert into auth.users values ('${OWNER}'), ('${OWNER2}'), ('00000000-0000-0000-0000-0000000000c1'), ('00000000-0000-0000-0000-0000000000d1');
`)

const as = (uid) => db.exec(`select set_config('test.uid', '${uid}', false)`)
const q = async (text, params = []) => (await db.query(text, params)).rows
const fails = async (text, params, label, needle) => {
  let message = ''
  try { await q(text, params) } catch (error) { message = String(error.message) }
  if (!message || (needle && !message.includes(needle))) { console.error('FAIL', label, '\n got ', message || '(no error)'); process.exit(1) }
  console.log('ok  ', label)
}
// Objects are compared by content, not by the order Postgres happens to list their keys in.
const canon = (value) =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item,
  )
const eq = (got, want, label) => {
  const g = canon(got), w = canon(want)
  if (g !== w) { console.error('FAIL', label, '\n got ', g, '\n want', w); process.exit(1) }
  console.log('ok  ', label)
}
const imp = (items, mode = 'skip', branch = null) =>
  q(`select import_products($1::uuid, $2::jsonb, $3::uuid, $4) as r`, [ORG, JSON.stringify(items), branch, mode]).then((rows) => rows[0].r)

await as(OWNER)

// ---------- import ----------
await db.exec(`insert into products(organization_id,name,sku,stock,price,cost_price,reorder_point) values ('${ORG}','Existing rice','RICE-1',10,5000,4000,5), ('${ORG}','Old unnamed','ITEM-000007',3,100,50,5)`)
await db.exec(`delete from notifications; delete from audit_logs`)
const result = await imp([
  { name: 'Beans 5kg', sku: 'BEANS-5', category: 'Grains', cost_price: '3000', price: '3800.50', stock: '20', reorder_point: '4' },
  { name: 'Salt', price: '300', stock: '2' }, // no SKU, low (2 <= 5)
  { name: 'Spaghetti', price: '600' }, // no stock -> 0 <= 5 low
  { name: 'Rice again', sku: 'rice-1', price: '1' }, // exists (case-insensitive): skipped
  { name: 'Beans copy', sku: 'beans-5', price: '2' }, // duplicate inside the file: skipped
])
eq(result, { created: 3, updated: 0, skipped: 2, low_stock: 2 }, 'import: counts new, skipped existing and in-file duplicates, and low-stock products')
eq((await q(`select sku from products where organization_id='${ORG}' order by sku`)).map((r) => r.sku), ['BEANS-5','ITEM-000007','ITEM-000008','ITEM-000009','RICE-1'], 'import: blank SKUs continue after the highest ITEM number')
eq(await q(`select stock, cost_price::float, price::float from products where sku='BEANS-5'`), [{ stock: 20, cost_price: 3000, price: 3800.5 }], 'import: stock, cost and price saved')
eq(await q(`select movement_type, quantity, reason from stock_movements where product_id=(select id from products where sku='BEANS-5')`), [{ movement_type: 'INITIAL_STOCK', quantity: 20, reason: 'Opening stock (CSV import)' }], 'import: opening stock is explained by a movement')
eq((await q(`select count(*)::int c from stock_movements`))[0].c, 2, 'import: only products with stock get a movement (Beans, Salt)')
eq(await q(`select title from notifications where organization_id='${ORG}' order by user_id`), [{ title: 'Products imported' }, { title: 'Products imported' }], 'import: ONE summary notification per owner/admin, not one per low-stock product')
eq((await q(`select action from audit_logs`)).map((r) => r.action), ['products.import'], 'import: recorded in the audit log')

const upd = await imp([{ name: 'Rice 50kg (renamed)', sku: 'RICE-1', category: 'Grains', price: '5500', reorder_point: '8', stock: '999', cost_price: '1' }], 'update')
eq(upd, { created: 0, updated: 1, skipped: 0, low_stock: 0 }, 'import: update mode updates an existing product')
eq(await q(`select name, price::float, reorder_point, stock, cost_price::float from products where sku='RICE-1'`), [{ name: 'Rice 50kg (renamed)', price: 5500, reorder_point: 8, stock: 10, cost_price: 4000 }], 'import: update mode never changes stock or cost price')

const before = (await q(`select count(*)::int c from products`))[0].c
await fails(`select import_products($1::uuid, $2::jsonb)`, [ORG, JSON.stringify([{ name: 'Fine', price: '10' }, { name: 'Bad price', price: 'abc' }])], 'import: a bad row stops the whole import with its row number', 'Row 2')
eq((await q(`select count(*)::int c from products`))[0].c, before, 'import: nothing is saved when a row is invalid (all or nothing)')
await fails(`select import_products($1::uuid, $2::jsonb)`, [ORG, JSON.stringify([{ price: '10' }])], 'import: a product name is required', 'Row 1')
await fails(`select import_products($1::uuid, $2::jsonb)`, [ORG, JSON.stringify([{ name: 'x', price: '10', stock: '-3' }])], 'import: negative stock rejected', 'Row 1')
await fails(`select import_products($1::uuid, $2::jsonb)`, [ORG, JSON.stringify(Array.from({ length: 1001 }, (_, i) => ({ name: 'n' + i, price: '1' })))], 'import: more than 1,000 rows rejected', '1,000')
await fails(`select import_products($1::uuid, $2::jsonb)`, [ORG, '[]'], 'import: empty file rejected', 'no products')
await fails(`select import_products($1::uuid, $2::jsonb, null, 'merge')`, [ORG, JSON.stringify([{ name: 'x', price: '1' }])], 'import: unknown duplicate mode rejected', 'skip or update')
await fails(`select import_products($1::uuid, $2::jsonb, $3::uuid)`, [ORG, JSON.stringify([{ name: 'x', price: '1' }]), '00000000-0000-0000-0000-0000000000ff'], 'import: branch of another business rejected', 'branch')
await as('00000000-0000-0000-0000-0000000000c1')
await fails(`select import_products($1::uuid, $2::jsonb)`, [ORG, JSON.stringify([{ name: 'x', price: '1' }])], 'import: workers cannot import', 'owner or manager')
await as(OWNER)
await fails(`select import_products($1::uuid, $2::jsonb)`, [ORG2, JSON.stringify([{ name: 'x', price: '1' }])], 'import: another business is off limits', 'owner or manager')
await db.exec(`delete from notifications`)
await imp([{ name: 'Branch item', sku: 'BR-1', price: '10', stock: '1' }], 'skip', BRANCH)
eq((await q(`select branch_id from products where sku='BR-1'`))[0].branch_id, BRANCH, 'import: products can be added to a branch')

// ---------- stock count ----------
await db.exec(`delete from notifications; delete from stock_movements; delete from audit_logs`)
const id = async (sku) => (await q(`select id from products where sku=$1 and organization_id=$2`, [sku, ORG]))[0].id
const beans = await id('BEANS-5'), rice = await id('RICE-1'), salt = await id('ITEM-000008')
const count = (items, note = 'Monthly count', branch = null) =>
  q(`select apply_stock_count($1::uuid, $2::jsonb, $3, $4::uuid) as r`, [ORG, JSON.stringify(items), note, branch]).then((rows) => rows[0].r)
const summary = await count([{ product_id: beans, counted: 18 }, { product_id: rice, counted: 14 }, { product_id: salt, counted: 2 }])
eq([summary.items_counted, summary.items_changed, summary.units_over, summary.units_short, Number(summary.value_over), Number(summary.value_short)], [3, 2, 4, 2, 16000, 6000], 'count: totals (2 short beans, 4 extra rice) valued at cost')
eq(await q(`select sku, stock from products where sku in ('BEANS-5','RICE-1','ITEM-000008') order by sku`), [{ sku: 'BEANS-5', stock: 18 }, { sku: 'ITEM-000008', stock: 2 }, { sku: 'RICE-1', stock: 14 }], 'count: stock is set to what was counted')
eq(await q(`select movement_type, quantity, reason from stock_movements order by quantity`), [{ movement_type: 'ADJUSTMENT', quantity: -2, reason: 'Stock count: Monthly count' }, { movement_type: 'ADJUSTMENT', quantity: 4, reason: 'Stock count: Monthly count' }], 'count: only differences create ADJUSTMENT movements, with a reason')
eq(await q(`select product_name, expected, counted, difference from stock_count_items order by product_name`), [{ product_name: 'Beans 5kg', expected: 20, counted: 18, difference: -2 }, { product_name: 'Rice 50kg (renamed)', expected: 10, counted: 14, difference: 4 }, { product_name: 'Salt', expected: 2, counted: 2, difference: 0 }], 'count: every counted product is kept with expected, counted and difference')
eq((await q(`select title from notifications order by title`)).map((r) => r.title).includes('Low stock: Beans 5kg'), false, 'count: no low-stock alert while beans (18) are above their reorder level')
await count([{ product_id: beans, counted: 3 }], null)
eq((await q(`select title from notifications where title like 'Low stock%'`)).map((r) => r.title), ['Low stock: Beans 5kg', 'Low stock: Beans 5kg'], 'count: dropping below the reorder level raises the normal in-app low-stock alert for each owner/admin')
eq((await q(`select reason from stock_movements where quantity = -15`))[0].reason, 'Stock count', 'count: reason without a note')
await fails(`select apply_stock_count($1::uuid, $2::jsonb)`, [ORG, JSON.stringify([{ product_id: beans, counted: -1 }])], 'count: negative counted number rejected', 'whole number')
await fails(`select apply_stock_count($1::uuid, $2::jsonb)`, [ORG, JSON.stringify([{ product_id: beans, counted: 1 }, { product_id: beans, counted: 2 }])], 'count: same product twice rejected', 'twice')
const countsBefore = (await q(`select count(*)::int c from stock_counts`))[0].c
await fails(`select apply_stock_count($1::uuid, $2::jsonb)`, [ORG, JSON.stringify([{ product_id: beans, counted: 1 }, { product_id: '00000000-0000-0000-0000-000000000999', counted: 1 }])], 'count: a product from elsewhere rejected', 'does not belong')
eq([(await q(`select count(*)::int c from stock_counts`))[0].c, (await q(`select stock from products where id=$1`, [beans]))[0].stock], [countsBefore, 3], 'count: a failed count changes nothing (all or nothing)')
await fails(`select apply_stock_count($1::uuid, $2::jsonb, null, $3::uuid)`, [ORG, JSON.stringify([{ product_id: beans, counted: 1 }]), BRANCH], 'count: a product outside the counted branch rejected', 'not in the branch')
await fails(`select apply_stock_count($1::uuid, $2::jsonb)`, [ORG, '[]'], 'count: empty count rejected', 'at least one')
await as('00000000-0000-0000-0000-0000000000c1')
await fails(`select apply_stock_count($1::uuid, $2::jsonb)`, [ORG, JSON.stringify([{ product_id: beans, counted: 1 }])], 'count: workers cannot count', 'owner or manager')
await as(OWNER)

// ---------- product ranking ----------
await db.exec(`delete from sale_items; delete from sales`)
const sale = async (status, at, items, branch = null) => {
  const s = (await q(`insert into sales(organization_id, branch_id, status, total, created_at) values ($1,$2,$3,0,$4) returning id`, [ORG, branch, status, at]))[0].id
  for (const [pid, qty, price, cost] of items) await q(`insert into sale_items(sale_id,product_id,quantity,unit_price,cost_price) values ($1,$2,$3,$4,$5)`, [s, pid, qty, price, cost])
}
await db.exec(`insert into products(organization_id,name,sku,stock,price,cost_price) values
  ('${ORG}','Dusty lamp','LAMP-1',5,2000,1000), ('${ORG}','Old tin','TIN-1',2,300,100)`)
const pid = async (sku) => (await q(`select id from products where sku=$1 and organization_id=$2`, [sku, ORG]))[0].id
const [pBeans, pRice, pSalt, pOld, pTin, pBr] = await Promise.all(['BEANS-5', 'RICE-1', 'ITEM-000008', 'ITEM-000007', 'TIN-1', 'BR-1'].map(pid))
await sale('completed', '2026-11-10T12:00:00Z', [[pBeans, 5, 3800.5, 3000], [pSalt, 3, 300, 200]])
await sale('completed', '2026-11-10T23:30:00Z', [[pBeans, 2, 3800.5, 3000], [pRice, 1, 5500, 4000]]) // 00:30 on the 11th in Lagos
await sale('refunded', '2026-11-12T10:00:00Z', [[pRice, 50, 5500, 4000]]) // refunded: not counted
await sale('completed', '2026-10-31T23:30:00Z', [[pOld, 9, 100, 50]]) // 00:30 on 1 Nov in Lagos: INSIDE November
await sale('completed', '2026-11-30T23:30:00Z', [[pSalt, 100, 300, 200]]) // 00:30 on 1 Dec in Lagos: outside November
await sale('completed', '2026-10-15T10:00:00Z', [[pTin, 1, 300, 100]]) // only sold in October
await sale('completed', '2026-11-05T10:00:00Z', [[pBr, 1, 10, 5]], BRANCH)
const perf = (from, to, branch = null, rows = 10) => q(`select * from get_product_performance($1::uuid,$2::date,$3::date,$4::uuid,$5)`, [ORG, from, to, branch, rows])
const all = await perf('2026-11-01', '2026-11-30')
eq(all.filter((r) => r.kind === 'best').map((r) => r.name), ['Old unnamed', 'Beans 5kg', 'Salt', 'Rice 50kg (renamed)', 'Branch item'], 'ranking: best sellers by units; Lagos days decide the window; refunded sales ignored')
eq(all.filter((r) => r.kind === 'best').slice(0, 3).map((r) => [Number(r.units), Number(r.revenue), Number(r.profit)]), [[9, 900, 450], [7, 26603.5, 5603.5], [3, 900, 300]], 'ranking: units, revenue and profit (revenue less cost)')
eq(all.filter((r) => r.kind === 'slow').map((r) => [r.name, r.stock, r.last_sold ? new Date(r.last_sold).toISOString().slice(0, 10) : null]), [['Dusty lamp', 5, null], ['Old tin', 2, '2026-10-15']], 'ranking: slow movers have stock but no sales in the period, biggest tied-up cost first, with their last sale')
eq((await perf('2026-11-01', '2026-11-30', BRANCH)).map((r) => [r.kind, r.name]), [['best', 'Branch item']], 'ranking: branch filter')
eq((await perf('2026-11-01', '2026-11-30', null, 2)).map((r) => r.kind), ['best', 'best', 'slow', 'slow'], 'ranking: row cap applies to each list')
await as('00000000-0000-0000-0000-0000000000c1')
await fails(`select * from get_product_performance($1::uuid,'2026-11-01','2026-11-30')`, [ORG], 'ranking: workers cannot read it', 'UNAUTHORIZED')
await as(OWNER)
console.log('ALL INVENTORY TOOL CHECKS PASSED')
