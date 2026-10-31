# Production readiness (26 October 2026)

**Verdict: ready for a controlled public launch (real customers, test-sized traffic) once the "Must do before launch"
list below is finished. It is not yet ready for a large or unattended launch.** The application code and database are in
good shape; what remains is mostly configuration you control (hosting, Supabase plan, email, Paystack live keys) and a
few things only a human can verify.

## What was checked this session, and the result
| Area | Result |
|---|---|
| Row-level security | Every table in `public` has RLS on. 7 server-only tables have RLS and no policy on purpose. Only the plan catalogue is publicly readable. |
| Public functions | Every platform/admin function checks `is_platform_admin()` inside. The 4 public-by-design ones are `get_plan_catalog`, `get_public_promoter_terms`, `submit_promoter_application` (throttled) and `track_visit` (60 per visitor per day, 600 per minute overall, allow-listed paths). |
| SECURITY DEFINER functions | All pin `search_path`. No unpinned ones. |
| Edge Functions | All protected ones verify the caller's JWT; platform ones also check admin rights. The Paystack webhook verifies the HMAC-SHA512 signature (constant-time) and re-asks Paystack before acting. Worker login is throttled per account (8 per 15 min) and per IP (40 per 15 min). CORS is an exact-match allow-list. |
| Payments | The browser never sends or confirms an amount; price and activation are decided on the server. Test 70 proves wrong amounts, wrong currency and replays do not activate a plan. |
| Free trial / lock | 7 days at signup, once per person (`trial_grants`), then read-only until paid; enforced by database triggers, not the browser. Test 95. |
| Dependencies | `npm audit`: 0 vulnerabilities. Safe in-range updates applied. Major upgrades deliberately postponed. |
| Write overhead of the lock | 20,000 inserts: 320 ms with the lock trigger, 316 ms without. |
| Load | Documented in `docs/LOAD-TEST.md`: 100 simultaneous very active users with 0 errors; one core holds about 250 very active users. **Supabase Auth itself was not load-tested** (it is a managed service with its own per-project limits). |

## Must do before launch (cannot be done from the code)
1. **Hosting terms.** Vercel Hobby is non-commercial. Move to Cloudflare Pages or Vercel Pro before charging customers (`docs/SCALING.md` item 1).
2. **Supabase Pro** with backups / point-in-time recovery switched on. A paused free project would take the product down.
3. **Supabase Auth settings** (no `config.toml` is in the repo, so check the dashboard): email confirmation ON, minimum password length 8 or more, leaked-password protection ON, CAPTCHA ON for sign-up and sign-in (this is also what stops people farming free trials with many emails), sensible rate limits, correct redirect URLs and Site URL.
4. **Custom SMTP.** Supabase's built-in email sender allows only a handful of emails per hour. Sign-up confirmation and password-reset emails will fail under real signups without your own provider (Resend, Brevo, Zoho, etc.).
5. **Paystack live keys** and the webhook pointed at the production function; run `supabase/tests/e2e-payments/run.sh` against it with a real small payment.
6. **Company details**: set `VITE_COMPANY_NAME`, `VITE_COMPANY_ADDRESS`, `VITE_SUPPORT_EMAIL` (and `VITE_SITE_URL`) so the Terms and Privacy pages and sitemap look real. The build warns if any is missing.
7. **Legal review** of `src/features/public/policies.json` by a Nigerian lawyer (NDPA 2023 compliance, refund wording, liability cap).
8. **Run the migrations and redeploy** `provision-worker` and the other functions (`npm run supabase:push`, `npm run supabase:functions:deploy:worker`).
9. **Backups and restore drill**: restore a backup into a scratch project once, so you know it works.
10. **Error monitoring**: set `VITE_ERROR_REPORT_ENDPOINT` (or add Sentry) so you hear about crashes before customers tell you.

## Known limits and risks
* A determined person with many email addresses can still start many trials. CAPTCHA and email confirmation reduce this; they do not remove it.
* The worker-login throttle can be used to temporarily lock one named worker out (8 wrong tries). This is the usual trade-off against password guessing.
* Customer and monthly-sales plan limits appear not to be enforced in the database (only products, branches and employees are). Verify before selling plans that advertise them.
* Beyond roughly 10,000 registered users the items in `docs/SCALING.md` (Realtime, broadcast fan-out, reports) need work.
