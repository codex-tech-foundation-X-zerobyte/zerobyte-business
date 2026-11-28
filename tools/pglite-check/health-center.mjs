import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp'
import fs from 'node:fs'
const root = new URL('../../supabase/', import.meta.url).pathname
const db = new PGlite({ extensions: { pgcrypto, uuid_ossp } })
await db.exec(fs.readFileSync(root + 'tests/00_supabase_stub.sql', 'utf8'))
for (const f of fs.readdirSync(root + 'migrations').sort()) await db.exec(fs.readFileSync(root + 'migrations/' + f, 'utf8'))
const q = async (sql) => { try { return (await db.query(sql)).rows } catch (e) { console.log('SEED FAIL:', e.message.split('\n')[0], '\n  in:', sql.slice(0, 110)); return [] } }
const cols = async (t) => (await q(`select column_name, data_type, is_nullable, column_default from information_schema.columns where table_name='${t}' and table_schema='public' order by ordinal_position`))
for (const t of ['organizations','products','sales','sale_items','payments','subscriptions']) console.log(t, (await cols(t)).filter(c=>c.is_nullable==='NO'&&!c.column_default).map(c=>c.column_name).join(','))
await q(`set session_replication_role = replica`)
const u = (await q(`insert into auth.users (id, email) values (gen_random_uuid(), 'owner@x.ng') returning id`))[0]?.id
const org = (await q(`insert into public.organizations (name, slug) values ('Bad Shop', 'bad-shop') returning id`))[0]?.id
const plan = (await q(`select p.id as plan_id, v.id as vid from public.plans p join public.plan_price_versions v on v.plan_id = p.id where p.code <> 'free' limit 1`))[0]
console.log('seed ids', !!u, !!org, JSON.stringify(plan))
await q(`insert into public.organization_members (organization_id, user_id, role) values ('${org}','${u}','owner')`)
await q(`insert into public.subscriptions (organization_id, plan_id, status, trial_start, trial_end) values ('${org}','${plan.plan_id}','trialing', now() - interval '6 days', now() + interval '10 hours') on conflict (organization_id) do update set status='trialing', trial_start=now() - interval '6 days', trial_end=now() + interval '10 hours'`)
await q(`insert into public.products (organization_id, name, sku, stock) values ('${org}','Ghost Rice','R-1', 5)`)
const sale = (await q(`insert into public.sales (organization_id, total, created_by, status) values ('${org}', 5000, '${u}', 'completed') returning id`))[0]?.id
const prod = (await q(`select id from public.products where sku='R-1'`))[0]?.id
await q(`insert into public.stock_movements (organization_id, product_id, movement_type, quantity, previous_quantity, new_quantity) values ('${org}','${prod}','STOCK_RECEIVED', 9, 0, 9)`)
await q(`update public.organizations set created_at = now() - interval '5 days' where id='${org}'`)
await q(`insert into public.sale_items (sale_id, product_id, quantity, unit_price) values ('${sale}','${prod}', 2, 1000)`)
for (const [st, ago] of [['mismatch','1 hour'],['pending','3 hours'],['success','2 days']]) await q(`insert into public.payments (reference, organization_id, plan_id, price_version_id, billing_interval, amount_kobo, initiated_by, status, created_at, paid_at) values ('ref-${st}','${org}','${plan.plan_id}','${plan.vid}','monthly', 500000, '${u}', '${st}', now() - interval '${ago}', ${st==='success' ? `now() - interval '2 days'` : 'null'})`)
await q(`insert into public.backend_request_latency (function_name, status_code, duration_ms, recorded_at) select 'paystack-webhook', case when g <= 5 then 500 else 200 end, 300 + g * 20, now() from generate_series(1,12) g`)
await q(`insert into public.client_error_events (kind, message, fingerprint, device, app_version, user_id) select 'js', 'Cannot read properties of undefined', 'fp1', 'mobile', '7.0.0', '${u}' from generate_series(1,60)`)
const s = (await q(`select public.platform_health_signals() as s`))[0].s
console.log('payments:', JSON.stringify({ ...s.payments, stuck: s.payments.stuck.length, activation_gaps: s.payments.activation_gaps.length }))
console.log('subs:', JSON.stringify({ trials_ending_48h: s.subscriptions.trials_ending_48h, list: s.subscriptions.trials_ending_list }))
console.log('functions:', JSON.stringify(s.functions))
console.log('stockmismatch:', s.integrity.stock_mismatch_count, JSON.stringify(s.integrity.stock_mismatch))
console.log('integrity:', JSON.stringify({ neg: s.integrity.negative_stock_count, totalMismatch: s.integrity.sale_total_mismatch_count, sample: s.integrity.sale_total_mismatch, noItems: s.integrity.sales_without_items }))
console.log('customers:', JSON.stringify({ noProducts: s.customers.no_products_count, noSales: s.customers.no_sales_count, silent: s.customers.silent_30_plus }))
console.log('app:', JSON.stringify({ e: s.app_errors.errors_24h, users: s.app_errors.affected_users_24h, top: s.app_errors.top[0]?.count }))
const al = (await q(`select public.platform_health_alerts(public.platform_health_signals()) as a`))[0].a
console.log('ALERTS:', al.map(x => `${x.severity}:${x.key}`).join(' | '))
const c1 = (await q(`select public.platform_claim_alerts() as c`))[0].c; const c2 = (await q(`select public.platform_claim_alerts() as c`))[0].c
console.log('claim #1 fires', c1.fire.length, '| claim #2 (cooldown) fires', c2.fire.length)
await q(`delete from public.client_error_events`); const c3 = (await q(`select public.platform_claim_alerts() as c`))[0].c
console.log('after the browser errors stop, resolved:', JSON.stringify(c3.resolved))

// --- Snapshot cache -------------------------------------------------------------------------------------------------
await q(`delete from public.platform_health_snapshot`)
const g1 = (await q(`select public.platform_health_snapshot_get() as s`))[0].s
await q(`insert into public.client_error_events (kind, message, fingerprint) select 'js', 'later error', 'fp9' from generate_series(1,5)`)
const g2 = (await q(`select public.platform_health_snapshot_get() as s`))[0].s
console.log('snapshot reused within 5 min:', g1.generated_at === g2.generated_at, '| later errors not yet counted:', g2.app_errors.errors_24h === g1.app_errors.errors_24h)
const g3 = (await q(`select public.platform_health_snapshot_get(interval '5 minutes', true) as s`))[0].s
console.log('forced refresh blocked inside 20 s:', g3.generated_at === g1.generated_at)
await q(`update public.platform_health_snapshot set taken_at = now() - interval '10 minutes'`)
const g4 = (await q(`select public.platform_health_snapshot_get() as s`))[0].s
console.log('old snapshot recomputed:', g4.generated_at !== g1.generated_at, '| now counts later errors:', g4.app_errors.errors_24h === g1.app_errors.errors_24h + 5)
await q(`update public.platform_health_snapshot set taken_at = now() - interval '1 minute'`)
const g5 = (await q(`select public.platform_health_snapshot_get(interval '5 minutes', true) as s`))[0].s
console.log('forced refresh allowed after 20 s:', g5.generated_at !== g4.generated_at)

// --- Telegram bot reports -------------------------------------------------------------------------------------------
const st = (await q(`select public.platform_bot_stats() as s`))[0].s
console.log('bot stats:', JSON.stringify({ businesses: st.businesses_total, sales_today: st.sales_today, top: st.top_businesses_today.length, accounts: st.registered_accounts }))
const fb = (await q(`select public.platform_bot_find_business('bad sh') as s`))[0].s
console.log('find "bad sh":', JSON.stringify(fb.map(b => ({ business: b.business, plan: b.plan, status: b.subscription_status, products: b.products, members: b.members }))))
console.log('find with wildcard chars matches nothing:', JSON.stringify((await q(`select public.platform_bot_find_business('%%') as s`))[0].s), '| one letter blocked:', JSON.stringify((await q(`select public.platform_bot_find_business('b') as s`))[0].s))
