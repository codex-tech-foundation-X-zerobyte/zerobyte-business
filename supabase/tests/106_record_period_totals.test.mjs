// Self-checking logic test for the Records day/month/year totals, run on PGlite (Postgres compiled to WebAssembly), so no
// database server is needed:  npm i --no-save @electric-sql/pglite && node supabase/tests/106_record_period_totals.test.mjs
// It builds minimal copies of the sales, expenses and stock_movements tables and checks Lagos-time days, refunds, filters,
// the row cap and the access check. Prints ALL RECORD PERIOD CHECKS PASSED or stops at the first failure.
import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'
const db = new PGlite()
const sql = fs.readFileSync(new URL('../migrations/20261118090000_record_period_totals.sql', import.meta.url), 'utf8')
  .replace(/^grant .*$/gm, '').replace(/^revoke .*$/gm, '').replace(/^notify .*$/gm, '')
await db.exec(`
  create type sale_status as enum ('completed','pending','refunded');
  create table sales (id serial, organization_id int, status sale_status, total numeric, created_at timestamptz);
  create table expenses (id serial, organization_id int, title text, amount numeric, expense_date date);
  create table stock_movements (id serial, organization_id int, quantity int, created_at timestamptz);
  create function is_org_manager(o int) returns boolean language sql as $$ select o = 1 $$;
`)
await db.exec(sql.replace(/uuid/g, 'int'))
const ins = (s) => db.exec(s)
// Lagos = UTC+1: 23:30 Lagos on 10 Nov is 22:30 UTC; 00:30 Lagos on 11 Nov is 23:30 UTC on 10 Nov (the case UTC got wrong)
await ins(`insert into sales(organization_id,status,total,created_at) values
 (1,'completed',1000,'2026-11-10T23:30:00+01:00'),
 (1,'completed',2000,'2026-11-11T00:30:00+01:00'),
 (1,'completed',1500,'2026-11-11T11:00:00+01:00'),
 (1,'refunded',700,'2026-11-11T12:00:00+01:00'),
 (1,'pending',50,'2026-11-11T13:00:00+01:00'),
 (1,'completed',3000,'2026-10-31T23:59:00+01:00'),
 (1,'completed',4000,'2025-12-31T23:59:00+01:00'),
 (2,'completed',99999,'2026-11-11T10:00:00+01:00')`)
await ins(`insert into expenses(organization_id,title,amount,expense_date) values (1,'Transport',250,'2026-11-11'),(1,'Rent',5000,'2026-10-01'),(2,'Other org',1,'2026-11-11')`)
await ins(`insert into stock_movements(organization_id,quantity,created_at) values (1,10,'2026-11-11T00:10:00+01:00'),(1,5,'2026-11-11T09:00:00+01:00'),(1,-3,'2026-11-11T09:30:00+01:00'),(1,7,'2026-10-20T09:00:00+01:00')`)
const q = async (text) => (await db.query(text)).rows
const eq = (got, want, label) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g !== w) { console.error('FAIL', label, '\n got ', g, '\n want', w); process.exit(1) } else console.log('ok  ', label) }
const norm = (rows) => rows.map(r => [String(r.period.toISOString?.().slice(0,10) ?? r.period), Number(r.row_count), Number(r.total), Number(r.refund_count), Number(r.refund_total)])

eq(norm(await q(`select * from get_record_period_totals(1,'sales','day')`)),
  [['2026-11-11',2,3500,1,700],['2026-11-10',1,1000,0,0],['2026-10-31',1,3000,0,0],['2025-12-31',1,4000,0,0]], 'sales by Lagos day: 00:30 sale belongs to the new day; refunded separate; pending ignored; other org excluded')
eq(norm(await q(`select * from get_record_period_totals(1,'sales','month')`)),
  [['2026-11-01',3,4500,1,700],['2026-10-01',1,3000,0,0],['2025-12-01',1,4000,0,0]], 'sales by month')
eq(norm(await q(`select * from get_record_period_totals(1,'sales','year')`)),
  [['2026-01-01',4,7500,1,700],['2025-01-01',1,4000,0,0]], 'sales by year')
eq(norm(await q(`select * from get_record_period_totals(1,'sales','day','2026-11-11','2026-11-11')`)),
  [['2026-11-11',2,3500,1,700]], 'date filter uses whole Lagos days (00:30 included, 23:59 on previous day excluded)')
eq(norm(await q(`select * from get_record_period_totals(1,'expenses','month')`)),
  [['2026-11-01',1,250,0,0],['2026-10-01',1,5000,0,0]], 'expenses by month')
eq(norm(await q(`select * from get_record_period_totals(1,'stock','day')`)),
  [['2026-11-11',2,15,0,0],['2026-10-20',1,7,0,0]], 'stock intake by day (negative movements ignored, 00:10 Lagos is the new day)')
eq(norm(await q(`select * from get_record_period_totals(1,'sales','day',null,null,2)`)).length, 2, 'row cap respected')
const t = await q(`select * from get_record_totals(1,'sales','2026-11-10','2026-11-11')`)
eq([Number(t[0].row_count), Number(t[0].total)], [5, 4500], 'header: 5 listed (incl. refunded + pending), total = completed only, Lagos days')
for (const [text, label] of [[`select * from get_record_period_totals(2,'sales','day')`,'other org'],[`select * from get_record_period_totals(1,'sales','week')`,'bad granularity'],[`select * from get_record_period_totals(1,'nope','day')`,'bad kind']]) {
  let failed = false; try { await q(text) } catch (e) { failed = true } ; eq(failed, true, `rejects: ${label}`)
}
console.log('ALL RECORD PERIOD CHECKS PASSED')
