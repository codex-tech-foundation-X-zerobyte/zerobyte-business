# Deployment checklist (this release)

## 1. Database migrations (in this order; `supabase db push` applies them all)
| File | What it does |
|---|---|
| `20261013090000_paystack_payments.sql` | `payments` table, `settle_paystack_payment()` |
| `20261013091000_admin_traffic_snapshot.sql` | Live traffic numbers for the admin dashboard |
| `20261014090000_billing_integrity_and_logo_limits.sql` | Closes the free-upgrade hole, trial/period expiry, logo bucket limits |
| `20261014100000_payment_diagnostics.sql` | `payment_events` log; "abandoned" no longer marked failed |
| `20261014110000_admin_revenue_restore.sql` | Restores Revenue Tracking (strongest-role profile, super-admin guarantee, real payment ledger) |
| `20261014120000_scaling_indexes.sql` | Indexes including `sale_items(sale_id)` |
| `20261015090000_pagination_support.sql` | Low-stock, customer-balance and record-total functions for the paginated screens |
| `20261015100000_admin_analytics.sql` | Visitor tracking, daily activity, `admin_get_analytics()` for the admin dashboard |
| `20261015110000_pagination_indexes.sql` | Indexes matching the page ordering (page query 73 ms to 2 ms on 5,000 rows) |

## 2. Edge Functions to (re)deploy
```bash
npm run supabase:functions:deploy:paystack          # paystack-initialize, paystack-verify, paystack-webhook (all --no-verify-jwt)
supabase functions deploy provision-promoter-access --no-verify-jwt   # promoter links now point at /promoter-setup
```
The webhook MUST be deployed with `--no-verify-jwt`; Paystack has no Supabase login, so with JWT checking on, every webhook is rejected before it reaches the function and nothing appears in its logs.

## 3. Secrets (names only)
`PAYSTACK_SECRET_KEY` (test key now, live key at launch) · `SITE_URL` · `ALLOWED_ORIGINS` (add `http://localhost:5173` only for local testing).
Front-end (Vercel/Cloudflare project settings): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, optional `VITE_WHATSAPP_CHANNEL_URL`.

## 4. Paystack dashboard
Settings > API Keys & Webhooks: set the **Test** webhook URL to `https://<project-ref>.supabase.co/functions/v1/paystack-webhook`. Test and Live have separate webhook fields; set each.

## 5. Front end
Deploy the new build (Vercel or Cloudflare Pages). It contains the payment-return fix, new themes, guide and tour. If you move host, update `SITE_URL`, Supabase Auth redirect URLs and the Paystack webhook. Vercel Hobby is non-commercial: see `docs/SCALING.md`.

## 6. Recover the three payments that succeeded but did not activate
Signed in as the business owner, open this address once per payment (take each reference from the Paystack dashboard):
`https://zerobyte-business.vercel.app/?payment=return&reference=<REFERENCE>`
The app asks the server to verify with Paystack and settle it. Settlement is idempotent, so this is safe to repeat.
If a reference shows "could not find that payment", it was never recorded in `payments` (see the checks below).

## 7. Exact production checks if a payment still does not activate
Run in the Supabase SQL editor (replace the reference):
```sql
select reference, status, amount_kobo, currency, failure_reason, organization_id, created_at from payments order by created_at desc limit 10;
select created_at, source, paystack_status, amount_kobo, currency, outcome, error from payment_events where reference = 'zb_...' order by created_at;
select s.status, s.provider, s.current_period_end, p.code from subscriptions s join plans p on p.id = s.plan_id where s.organization_id = '<organization id>';
select * from payments where status in ('mismatch', 'failed') order by created_at desc;
```
How to read `payment_events.outcome`: `activated`/`already_settled` = done; `abandoned` = customer did not finish; `mismatch` = wrong amount/currency (refund in Paystack); `paystack_no_transaction` with `HTTP 401` = the `PAYSTACK_SECRET_KEY` is wrong or from the other mode; `settle_error` = a database error (the `error` column has it).
Also open Dashboard > Edge Functions > `paystack-verify` and `paystack-webhook` > Logs: each call logs one `evt` line. **No webhook lines at all** means Paystack is not reaching the function (wrong webhook URL, JWT checking left on, or test/live mismatch).

## 8. Verify a test payment end to end (no real money)
1. Sign in as a business owner on a Free plan, Settings > Billing, Pay with Paystack on a paid plan.
2. Pay with a Paystack **test card** (Paystack's docs list them).
3. You return to the app; a banner says "Confirming your payment…" then "Payment confirmed. Your plan is now active.", and Billing shows the plan and "Paid through <date>".
4. SQL: `payments.status = 'success'`, one `activated` row in `subscription_events`, `payment_events` shows a `return` row (and a `webhook` row if the webhook is configured).
5. Repeat the return address: banner says confirmed, and the paid-through date does not move.

## 9. Admin analytics: what to expect and check
* **First day:** Visitors and active users start at zero and fill in as people use the site; sales, sign-up and business figures are built from existing data straight away.
* **Visitor counting** uses no cookies and stores no IP address (see the "Counting visits" paragraph in the Privacy page). Browsers sending Do Not Track are not counted. Update the Privacy page wording if your lawyer asks for changes.
* **Check:** open the site in a private window, then Admin > Analytics: Visitors today should go up by one within a few seconds (press Refresh).
* **Housekeeping:** if `pg_cron` is available the migration schedules `prune_analytics()` daily (keeps 180 days). Otherwise run `select public.prune_analytics();` now and then.
* **Who sees what:** every admin sees visitors, users, businesses, sales and the funnel. Revenue appears only for Super and Finance admins; the Admin team and security panel only for Super admins.
