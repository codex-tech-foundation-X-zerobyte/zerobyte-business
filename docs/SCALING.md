# Can it scale? (100 / 1,000 / 10,000 / 100,000 users)

Short answer: the **architecture** scales (static front end on a CDN, Supabase/Postgres behind it, all money logic on
the server). What limits you first is **plan tiers and a few unbounded screens**, not a design flaw. "Users" below means
registered accounts; roughly 5-10% are online at once. Sizing for 10k+ is an estimate, not a measurement.

| Registered users | Works as it is today? | What you need to do |
|---|---|---|
| **100** | Yes | Nothing technical. Move off Vercel Hobby before charging (see 1). |
| **1,000** | Yes, on a paid Supabase plan | Supabase **Pro**; apply the new indexes; watch the first businesses with 1,000+ products or customers (see 3). |
| **10,000** | Mostly | Everything above, plus pagination on the list screens, a larger Supabase compute size, and a plan for Realtime connections (see 4, 5). |
| **100,000** | Not without changes | Realtime -> Broadcast or polling, lazy broadcast delivery, pre-computed report tables, partitioning or archiving old sales, read replica. Roughly a quarter of focused work. |

## Load-tested (see docs/LOAD-TEST.md)
100 simultaneous active users: **0 errors**. One CPU core held about 250 very active users cleanly (0 errors, 95 ms slow tail); at 500 it saturates, at 1,000 about 3% of requests time out, and at 2,000 it sheds load without crashing or corrupting data (0 wrong stock after ~9,700 concurrent sales). Receipts is now paginated, which nearly doubled capacity.

## What was measured (PostgreSQL 16, this schema, 150,000 sales / 450,000 sale items)
* Finding the items of one receipt: **0.07 ms** with `idx_sale_items_sale`, **40 ms** without it (before this audit
  `sale_items` had no index on `sale_id`). The slow version gets worse as the table grows, and every receipt, report and
  cost-of-goods calculation depends on it.
* An admin broadcast is one `INSERT ... SELECT`: **10,000 recipients = 0.14 s, 100,000 = 1.5 s** in the database. The
  database is not the problem; Realtime delivering those rows is (see 5).

## What limits you, in the order you will meet it
1. **Hosting terms (now, not at scale).** Vercel's free **Hobby** plan is for personal, non-commercial use. You charge
   customers through Paystack, so use **Cloudflare Pages** (free tier, commercial use allowed; the repo already ships
   `public/_headers` and `public/_redirects` for it) or Vercel **Pro**. Both serve the static app from a CDN, so traffic
   is not the constraint. After moving: set `SITE_URL`, Supabase Auth redirect URLs, and the Paystack webhook to the new address.
2. **Supabase plan.** Free projects have small database and connection allowances and can be paused for inactivity, with
   no backups to rely on. Move to **Pro** before real customers, and turn on backups/point-in-time recovery.
3. **Unbounded lists (FIXED in V7).** Customers, Receipts, Inventory, Invoices, Expenses, Records, Purchase Orders and the dashboard now load a page at a time (50, or 25 for receipts), search in the database, and the Sales pickers read the catalogue in 1,000-row chunks so nothing is cut off. A 5,000-row business: customers page 73 ms -> 2 ms, products 82 ms -> 1 ms, receipts 62 ms -> 2 ms. Original problem:  Customers, Receipts, Records, Invoices, Expenses and the product /
   customer pickers on Sales load whole tables with no paging. Supabase's API returns at most 1,000 rows per request by
   default, so a single business with more than 1,000 customers or receipts would silently see only part of them, and
   counts that are derived from the list would be wrong. This depends on one business's size, not on total users.
   Fix: server-side pagination with `.range()` plus exact counts. This is the best next piece of work.
4. **Realtime connections.** The notification bell keeps one live connection per open tab. Plans cap concurrent Realtime
   connections (a few hundred on Pro). Past the cap the bell now falls back to a 45-second refresh, so nothing errors, it
   just stops being instant. For 10k+ use Realtime Broadcast or polling for everyone.
5. **Broadcast fan-out.** A broadcast writes one notification row per recipient, and `notifications` is in the Realtime
   publication, so 100k recipients means 100k change events for Realtime to filter. Fix: store a broadcast once and
   show it by joining at read time (O(1) write), and remove `notifications` from the publication.
6. **Row-level security cost.** Policies call `is_org_member(organization_id)` once per row. Fine up to thousands of rows
   per query; for very large tables switch to `organization_id in (select ...)`.
7. **Reports.** `get_dashboard_metrics` aggregates live tables. Fine to roughly a million sales per business. Beyond that
   keep daily roll-up tables.
8. **Housekeeping tables.** `backend_request_latency` and `payment_events` grow forever; add a monthly delete of old rows.

## Changed in this pass
`supabase/migrations/20261014120000_scaling_indexes.sql` (11 indexes, including `sale_items(sale_id)`), a polling fallback
for notifications, and the enforced Content-Security-Policy for Cloudflare as well as Vercel.
