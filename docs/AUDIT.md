# Production-readiness audit (adversarial)

Method: assume a hostile customer, competitor or lawyer is looking for the one flaw that costs you money or
liability. Everything below was checked against the code; database items were reproduced on a real PostgreSQL 16
with every migration applied (`supabase/tests/70_billing_integrity.sql`).

## Found and fixed

| # | Severity | Flaw | Fix |
|---|---|---|---|
| 1 | Critical | **Free upgrade to any paid plan.** `start_plan_trial()` was callable from the browser console. For a paid plan with `trial_days = 0` it set the plan to *active* with no end date: permanent, unpaid. | Rejects any plan without a real trial (`PAYMENT_REQUIRED`) and any plan without a price (`CONTACT_SALES`, e.g. enterprise). |
| 2 | Critical | **Trials and paid months never ended.** Nothing read `trial_end` / `current_period_end`, so a 7-day trial or a lapsed paid month kept paid limits forever. | `effective_plan_id()` now drives every limit: an ended trial/period is Free. `expire_lapsed_subscriptions()` tidies the status hourly (pg_cron if enabled). |
| 3 | High | **Unlimited free trials.** Each time a trial lapsed an owner could start another. | One trial per business, ever (`TRIAL_USED`). |
| 4 | High | **Paid plan could be overwritten.** A customer could start a trial of another plan over a month they had paid for, or pay for a different plan and silently lose the remaining days. | Both blocked (`PLAN_ALREADY_PAID`; the pay endpoint answers 409 with the date it ends). |
| 5 | High | **Your own legal pages said the opposite of what the product does.** Terms: "Payments are not implemented"; Privacy: "we do not implement payment processing". Anyone charged could quote them. | Rewritten: one-time payments, no auto-renew, Paystack as processor, what happens when a period ends, how to dispute a charge. |
| 6 | High | **Privacy policy lacked Nigeria Data Protection Act basics**: controller/processor roles, third parties (Supabase, Vercel, Paystack), cross-border processing, retention, breach notice, rights, right to complain to the NDPC. | Added. **Have a Nigerian lawyer review all three pages before launch** (I am not one). |
| 7 | Medium | **Logo bucket had no server-side limits and accepted SVG** (script can run when an SVG is opened directly). The 2 MB check was browser-only. | Bucket now enforces 2 MB and PNG/JPEG/WEBP only; the picker matches. |
| 8 | Medium | **Content-Security-Policy was report-only**, so it blocked nothing. | Now enforced. Open the browser console on first load after deploying and watch for CSP messages (if you add an error-reporting endpoint, add it to `connect-src` in `vercel.json`). |
| 9 | Medium | **Redirect to a payment page** trusted whatever address came back. | Server and browser both refuse anything that is not `https://*.paystack.com`. |

## Checked and found sound
No secrets in the repo or in `VITE_*` variables; no HTML-injection sinks; production dependencies report 0
vulnerabilities; every table has row-level security; all 93 SECURITY DEFINER functions pin `search_path`; sales
prices, stock, tax and branch scope are computed server-side and sales cannot be edited or deleted from the
browser; worker sign-in is throttled and does not reveal whether an account exists; payments can only be written
by the server and a replayed or doctored webhook cannot activate a plan.

## Found in the second pass
| # | Severity | Flaw | Fix |
|---|---|---|---|
| 10 | Critical | **Paid-but-not-activated.** Coming back from Paystack, the workspace reset itself to the Overview page, so the Settings page that ran the verification never loaded; `paystack-verify` was never called. Reproduced in a browser (0 calls). | Verification now runs at workspace level on any page, retries while Paystack is still processing, survives a reload, and shows an honest banner. |
| 11 | High | **Revenue Tracking hidden, and empty if shown.** Hidden for any admin who is not Super/Finance (no message), the profile lookup could pick an arbitrary role, and the page read a table nothing writes to. | Strongest role wins; a Super admin is guaranteed; revenue reads the real payment ledger; the sidebar now explains hidden pages. |
| 12 | Medium | Promoters had no sign-in path (the sign-in page had Owner and Worker only), and a dead setup link dropped them on the owner login. | Promoter tab, `/promoter-setup` route, clear "link can't be used" screen. |
| 13 | Medium | `sale_items(sale_id)` had no index (0.07 ms vs 40 ms per receipt lookup at 450k rows); CSP report-only in `_headers`. | Indexes migration; CSP enforced in both host configs. |

## Still on you (cannot be fixed in code)
1. **Rotate the Paystack secret key** you pasted into chat, and set the new one only with `supabase secrets set`.
2. **Apply the migrations** (`supabase db push`) and **deploy the functions**, then set the Paystack webhook URL.
3. **Look for businesses that got paid plans for free before this fix:**
   ```sql
   select o.name, p.code, s.status, s.provider, s.current_period_end
   from subscriptions s join plans p on p.id = s.plan_id join organizations o on o.id = s.organization_id
   where p.code <> 'free' and s.status = 'active' and s.provider is distinct from 'paystack' and s.current_period_end is null;
   ```
   Admin-granted plans will also appear; review each.
4. **Refunds**: a payment flagged `mismatch` (wrong amount) activates nothing and must be refunded by hand in the
   Paystack dashboard. Check `select * from payments where status = 'mismatch'` regularly.
5. **Legal**: register with the NDPC if your volume of personal data requires it, name a contact for data requests,
   and have counsel review Terms, Privacy and the cashier-refund/dispute wording.
6. **Backups**: confirm Point-in-Time Recovery is on for the Supabase project (plan dependent) and do one restore drill.
7. **Business-policy risk, not a bug**: any cashier can apply a discount up to 100% of a sale. If that worries you,
   add a per-role discount cap.
8. **Admin accounts**: turn on multi-factor sign-in in Supabase Auth for every platform admin.
