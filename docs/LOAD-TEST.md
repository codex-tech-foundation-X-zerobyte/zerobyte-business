# Load test results

**Question:** will it hold with 100 people active at once, and what happens at 250, 500, 1,000 and 2,000?
**Short answer:** 100 simultaneous active users ran with **zero errors** using about a third of one CPU core. One CPU
core held about 250 very active users cleanly; beyond that requests queue, and the system slows and sheds load
rather than crashing or corrupting data.

## How it was tested
* **Stack:** the real database schema (all migrations), real PostgreSQL 16, real PostgREST with row-level security on and
  a signed-in user per request, `max-rows 1000` and a connection pool of 15 (Supabase-like settings).
* **Data:** 300 businesses, 12,000 products, 9,000 customers, 120,000 sales, 240,000 sale items.
* **Each simulated user** loops: open the app (dashboard figures, recent sales, products, customers, notifications, all
  at once) -> wait 1.5-3.5 s -> 70% of visits record a sale (the real `create_sale_with_operation`) -> 25% browse receipts.
  That is far busier than a real shop worker, who acts every 15-30 s. Treat "N users" here as roughly 3-10x as many real people.
* **Machine:** 1 CPU core, 4 GB RAM, shared by the load generator, the API and the database. That makes the numbers
  pessimistic for raw speed but transferable as "cost per request".

## Results (final code: receipts paginated to 25)
| Active users | Requests/s | Errors | Typical (p50) | Slow tail (p95) | One core used |
|---|---|---|---|---|---|
| 100 (arrive all at once, 70 s) | 111 | **0** | 13 ms | 280 ms | 33% |
| 250 | 228 | **0** | 24 ms | 95 ms | 60% |
| 500 | 290 | 0.3% (timeouts) | 0.4 s | 5.5 s | 76% (saturated) |
| 1,000 | 270 | 3.4% (timeouts) | 4.8 s | 12 s | saturated |
| 2,000 | 308 | 61% (timeouts) | 15 s | 19 s | saturated |

Before the receipts fix, 250 users already failed: 111 req/s, p95 6.9 s, 30 timeouts, because the Receipts page read a
business's entire sales history (86 ms of database time vs 5 ms paginated) on every visit and used most of the CPU.

**Cost per request is 2.6-3.0 ms of CPU, so one core serves roughly 270-300 requests/s.** Capacity grows with cores
and compute size. Translating to real people (an estimate, because it depends on how busy they are): one core is
roughly 1,500-2,500 concurrent real users; a larger Supabase compute size multiplies that.

## Integrity under load
After about 9,700 concurrent sales (38,000 units) including the overloaded stages: **0 products with wrong stock, 0
negative stock, no server crash.** Overload produced timeouts (HTTP 504), never wrong data.

## What this does not cover
Network and TLS delay, Supabase's gateway and sign-in service, Realtime connection limits, Edge Function load, browsers
and the CDN. Before launch, repeat it against a staging Supabase project on the compute size you will buy.
## Large businesses (V7 pagination)
Measured on a business with 5,000 products, 5,000 customers and 20,000 sales (database time per request):

| Screen | Before | After |
|---|---|---|
| Receipts | 62 ms (up to 1,000 rows + items) | 1.9 ms (25 rows) |
| Customers page | 73 ms | 2.4 ms |
| Products page | 82 ms | 1.1 ms |
| Dashboard | downloaded 1,000 products + 1,000 customers | counts + 4 low-stock rows (a few ms) |
| Records totals | summed in the browser from loaded rows | 5 ms in the database for the whole range |

Loading page 40 of 5,000 customers still costs about 46 ms (row-level security is checked for the skipped rows); that is rare because most people never scroll that far. The small-shop results above are unchanged, because a 40-product shop was never the bottleneck.

## Run it yourself
Needs PostgreSQL 16, `postgrest` and Node 20+ (see `supabase/tests/e2e-payments/README.md` for database setup).
```bash
psql -d zbl -f supabase/tests/00_supabase_stub.sql   # then apply every migration, then:
psql -d zbl -f supabase/tests/load/seed.sql
RECEIPTS_LIMIT=25 supabase/tests/load/run.sh "100:35" "250:35" "500:35"    # users:seconds
```
