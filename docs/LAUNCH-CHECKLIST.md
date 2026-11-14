# Zerøbyte Business: complete first-time launch checklist

Follow the phases **in order**. Each phase ends with a **Done when** line: do not move on until it is true. Tick the boxes
as you go (`- [ ]` becomes `- [x]`). Every name, command and setting below comes from this project's real files.

**Golden rules**
- Secrets (`sk_live_…`, the Supabase `service_role` key, `TURNSTILE_SECRET_KEY`) never go in the repo, in a `VITE_` variable, or in a chat.
- Variables starting `VITE_` are baked into the website **at build time**: change one, then **redeploy**.
- Do the Supabase **CAPTCHA switch last** (Phase 7) or nobody can sign in.
- Do the **data reset** (Phase 14) after testing and before announcing, never after real customers join.

---

## Phase 0: decisions and accounts (before you touch anything)

**Decisions**
- [ ] **Hosting plan.** Vercel's Hobby plan is for non-commercial use; your own readiness notes (`docs/PRODUCTION-READINESS.md`, `docs/SCALING.md`) say to move to Vercel Pro or Cloudflare Pages **before charging customers**. Decide now. Check Vercel's current terms.
- [ ] **Supabase plan.** The free plan has no automatic backups, can pause a project after a period of inactivity, and limits emails (2 per hour for sign-in emails). Before taking real money, consider Pro (backups, no pausing). Check supabase.com/pricing for current limits.
- [ ] **Confirm email: OFF** (your decision, because of the 2-emails-per-hour limit). Understand the trade-off: nobody proves they own their email. Your protection instead is Turnstile CAPTCHA, the disposable-email block and the per-person free trial. Revisit once you have an SMTP sender.
- [ ] **Public address.** Launch on `https://zerobyte-business.vercel.app` or buy a domain first. (Moving later is possible: Appendix D.)
- [ ] **Legal name** that operates the service (it appears as "Operated by" and in the © line). If the registered name is still Codex Tech Foundation, decide the exact wording, for example "Sephry Tech (formerly Codex Tech Foundation)".

**Accounts you need**
- [ ] Supabase (the project's database, login and functions)
- [ ] Vercel **or** Cloudflare Pages, and GitHub (the code)
- [ ] Paystack (start in **test mode**; live keys need Paystack's business verification, which can take days: start it now)
- [ ] Cloudflare (free, for Turnstile CAPTCHA)
- [ ] Google Search Console and Bing Webmaster Tools
- [ ] Optional: Google Analytics 4, an uptime monitor (for example UptimeRobot), Sentry or another error collector
- [ ] A WhatsApp number for support (international digits, e.g. `2348031234567`) and a mailbox you really read (`VITE_SUPPORT_EMAIL`)

**Done when:** every decision above is written down and every account exists.

---

## Phase 1: your computer

- [ ] Node 22 or newer installed (`node -v`; the project requires `>=22`, `.nvmrc` says 22)
- [ ] Supabase CLI available (`npx supabase --version`), then `npx supabase login`
- [ ] Code in a **private** GitHub repository; `.env.local` is in `.gitignore` (it is)
- [ ] `npm ci` completes
- [ ] `npm run check` passes (lint, types, build) and `npm test` passes (56 tests)
- [ ] `npm audit --omit=dev` shows no high or critical findings

**Done when:** all of the above run clean on your machine.

---

## Phase 2: create the Supabase project

- [ ] New project. Pick the **region closest to your customers** (it cannot be changed later). Save the **database password** in a password manager.
- [ ] Note the **project reference** (the `abcdxyz` in `https://abcdxyz.supabase.co`).
- [ ] Copy the **anon / publishable key** (safe for the browser) from Project Settings → API. Do **not** copy the `service_role` key anywhere except where a step says so.
- [ ] Link your folder: `npx supabase link --project-ref <ref>` (it asks for the database password)
- [ ] Recommended: make a second, throwaway **staging** project and run Phases 3 to 5 on it first. The free plan allows more than one project.

**Done when:** `npx supabase projects list` shows the project linked.

---

## Phase 3: database (order matters)

**3a. Enable the timer FIRST.** Three migrations install scheduled jobs **only if `pg_cron` is already on**.
- [ ] Dashboard → Database → Extensions (or Integrations → Cron): enable **pg_cron**.

**3b. Apply every migration.**
- [ ] `npm run supabase:push` (applies all files in `supabase/migrations`, 82 at the time of writing)
- [ ] It finishes with no error. If it printed a notice saying pg_cron was not scheduled, do 3c.

**3c. Check the three timed jobs exist** (SQL Editor):
```sql
select jobname, schedule, active from cron.job order by jobname;
```
- [ ] You see all three: `expire-lapsed-subscriptions` (hourly), `prune-analytics` (daily), `zb-scheduled-reports` (every 5 minutes). If any is missing, run the ones needed:
```sql
select cron.schedule('expire-lapsed-subscriptions','7 * * * *','select public.expire_lapsed_subscriptions()');
select cron.schedule('prune-analytics','17 3 * * *','select public.prune_analytics()');
select cron.schedule('zb-scheduled-reports','*/5 * * * *','select public.run_scheduled_reports()');
```

**3d. Security checks** (SQL Editor):
```sql
select tablename from pg_tables where schemaname='public' and not rowsecurity;   -- must return 0 rows
select count(*) from public.plans;                                               -- 5 plans: free, basic, pro, pro_plus, enterprise
select id, public from storage.buckets;                                          -- business-logos exists
```
- [ ] Zero tables without row security
- [ ] Plans present, and **prices and limits are what you intend** (check in Admin → Plans later, Phase 8)
- [ ] The `business-logos` bucket exists
- [ ] From a terminal, an anonymous request gets no data (an error or an empty list, never rows):
  `curl "https://<ref>.supabase.co/rest/v1/sales?select=*" -H "apikey: <anon key>"`

**3e. Database tests** (on staging, optional but recommended): follow `supabase/tests/README.md`; every test file prints its PASSED line.

**Done when:** all migrations applied, 3 jobs listed, 0 unprotected tables.

---

## Phase 4: Supabase Auth settings (do not enable CAPTCHA yet)

Dashboard → Authentication. Menu names vary by dashboard version; use the search box if you cannot find one.
- [ ] **URL Configuration:** *Site URL* = your public address (no trailing slash). *Redirect URLs* = `https://<your-address>/auth` only. No wildcards. Remove old addresses.
- [ ] **Sign-in / Email provider:** **Confirm email OFF** (Phase 0 decision). Minimum password length **8 or more**.
- [ ] **Leaked-password protection** ON if your plan offers it.
- [ ] **OTP / link expiry:** raise to `86400` (24 hours) so WhatsApp setup links still work hours later.
- [ ] **Anonymous sign-ins: OFF** (they let bots create sessions).
- [ ] **Multi-factor (TOTP): enabled** (the admin console's authenticator needs it).
- [ ] Unused sign-in providers are off.
- [ ] Review the default **rate limits**; leave defaults if unsure.
- [ ] Do **not** turn on CAPTCHA yet.

**Done when:** you can read back each setting in the dashboard.

---

## Phase 5: Edge Functions and their secrets

**5a. Set the secrets** (VS Code terminal; no quotes inside the value; `SUPABASE_URL`, anon and service keys are supplied to functions automatically):
```bash
supabase secrets set SITE_URL="https://<your-address>"
supabase secrets set PAYSTACK_SECRET_KEY="sk_test_..."        # TEST key for now
supabase secrets set TURNSTILE_SECRET_KEY="..."               # from Phase 7; you can set it now or then
```
- [ ] `SITE_URL` equals the address people visit (it is where password-setup links point and is allowed as a CORS origin)
- [ ] `ALLOWED_ORIGINS` set only if you need extra addresses (comma-separated). Add `http://localhost:5173` **only while testing locally**, and remove it afterwards.
- [ ] `PAYSTACK_SECRET_KEY` is the **test** key
- [ ] Optional: `GITHUB_REPOSITORY` (and read-only `GITHUB_TOKEN`) for the admin deployments panel
- [ ] Optional, only if you use Codex Workspace: `CODEX_FUNCTIONS_URL`, `MONITOR_KEY`, `SUPPORT_KEY`, `SUPPORT_CALLBACK_SECRET`, `CODEX_HEARTBEAT_SECRET`
- [ ] `supabase secrets list` shows the names you expect

**5b. Deploy all 18 functions**
- [ ] `npm run supabase:functions:deploy`
- [ ] Dashboard → Edge Functions lists 18, including `paystack-webhook`, `submit-promoter-application` and `resolve-worker-login`
- [ ] They were deployed with `--no-verify-jwt` (the scripts do it). That is **by design**: Paystack and signed-out visitors have no Supabase login, and every function checks the caller itself.
- [ ] The old `create-sale` function, if present, is deleted

**Done when:** 18 functions listed and `supabase secrets list` shows your names.

---

## Phase 6: the website (hosting)

**6a. Connect the host**
- [ ] Import the GitHub repository. Framework **Vite**, build command `npm run build`, output folder `dist`
- [ ] Node version 22 (Vercel: Project Settings → General; Cloudflare Pages reads `.nvmrc`)

**6b. Set environment variables** (host dashboard → Environment Variables, **Production**; see Appendix A for the full list)
- [ ] `VITE_SUPABASE_URL` = `https://<ref>.supabase.co` and `VITE_SUPABASE_ANON_KEY` = the **anon** key (never `service_role`)
- [ ] `VITE_SITE_URL` = your public address (needed for the sitemap and canonical links)
- [ ] `VITE_TURNSTILE_SITE_KEY` (Phase 7), `VITE_COMPANY_NAME`, `VITE_COMPANY_ADDRESS`, `VITE_SUPPORT_EMAIL`
- [ ] Recommended: `VITE_SUPPORT_WHATSAPP`, `VITE_ERROR_REPORT_ENDPOINT`
- [ ] Optional: `VITE_WHATSAPP_CHANNEL_URL`, `VITE_GOOGLE_SITE_VERIFICATION`, `VITE_BING_SITE_VERIFICATION`, `VITE_BUILDER_URL`, `VITE_BUILDER_SAME_AS`, `VITE_GA_MEASUREMENT_ID`

**6c. Deploy and check**
- [ ] Build succeeds; the build log does not warn about missing company details
- [ ] The home page, `/privacy`, `/terms`, `/about`, `/guide`, `/support`, `/promoters` all load
- [ ] `/admin` opens the admin sign-in page
- [ ] Response headers are present (browser dev tools → Network → the page → Headers): `Content-Security-Policy`, `X-Frame-Options`, `Strict-Transport-Security`
- [ ] `/robots.txt` blocks `/admin`; `/sitemap.xml` lists 7 pages; `/llms.txt` loads

**Done when:** the live site loads and the pages above work.

---

## Phase 7: Cloudflare Turnstile (CAPTCHA), then the Supabase switch

- [ ] Cloudflare → Turnstile → **Add widget**. Hostnames, one at a time, typed as plain hostnames (no `https://`, no `/`): your site address, `localhost`, and your Cloudflare Pages address if used. Mode **Managed**.
- [ ] Copy the **Site key** (public) and the **Secret key** (shown once; save it safely)
- [ ] Host env var `VITE_TURNSTILE_SITE_KEY` = site key, then **redeploy**
- [ ] `supabase secrets set TURNSTILE_SECRET_KEY="<secret>"`, then `npm run supabase:functions:deploy`
- [ ] Open the site in a private window: the "Verify you are human" box appears on sign-up, sign-in, the promoter form and `/admin`
- [ ] The promoter form submits successfully (it **fails closed**: with no secret it refuses on purpose)
- [ ] **Only now:** Supabase → Authentication → Bot and Abuse Protection (or Attack Protection) → enable CAPTCHA → provider **Turnstile** → paste the secret → Save
- [ ] Immediately re-test sign-up, sign-in, worker login and admin login. If anyone is locked out, switch the toggle off and fix the site key.

**Done when:** all four login forms work with the human check on.

---

## Phase 8: the first super admin

There is no sign-up path for admins. You create the account, then grant the role in SQL.
- [ ] On the **live site**, sign up with the real super admin email and a long unique password
- [ ] SQL Editor:
```sql
insert into public.platform_admin_access (user_id, role, status)
select id, 'SUPER_ADMIN', 'active' from auth.users where lower(email) = lower('YOU@EXAMPLE.COM');
select u.email, a.role, a.status from public.platform_admin_access a join auth.users u on u.id = a.user_id;
```
- [ ] The second query shows exactly one row for you
- [ ] Sign in at `/admin`; every section is visible
- [ ] **Admin → Settings → Two-factor sign-in → Set up authenticator app.** Scan with an authenticator app. Save the setup key offline as a recovery copy
- [ ] Sign out and back in: it asks for the 6-digit code
- [ ] **Admin → Plans:** the prices and limits are exactly what you intend to charge
- [ ] Recommended: create a **second super admin** (another real person, their own authenticator) so one lost phone cannot lock you out
- [ ] When **every** admin has an authenticator, press **Make compulsory for all admins** (the system refuses if anyone is not ready)
- [ ] Keep other admin roles to the minimum people (support, finance, platform, moderation)

**Done when:** you sign in to `/admin` only with password plus code.

---

## Phase 9: Paystack (test first, then live)

**Test mode**
- [ ] Paystack dashboard → Settings → API Keys & Webhooks: set the **Test webhook URL** to `https://<ref>.supabase.co/functions/v1/paystack-webhook`
- [ ] `PAYSTACK_SECRET_KEY` is the matching **test** key (Phase 5)
- [ ] As a test business owner on a Free plan: Settings → Billing → Pay with Paystack → use a Paystack **test card**
- [ ] You return to the app and see "Payment confirmed. Your plan is now active." and "Paid through <date>"
- [ ] SQL: `select reference, status, amount_kobo from payments order by created_at desc limit 5;` shows `success`; `select * from payment_events order by created_at desc limit 5;` shows `activated`
- [ ] Open the return link again: still confirmed, and the paid-through date does **not** move
- [ ] Edge Functions → `paystack-webhook` → Logs show webhook lines (no lines at all means the webhook URL is wrong or the test and live modes are mixed)

**Live mode (only after Paystack verifies your business)**
- [ ] `supabase secrets set PAYSTACK_SECRET_KEY="sk_live_..."`, then redeploy the functions
- [ ] Set the **Live** webhook URL (a separate field from Test) to the same function address
- [ ] Make one **real small payment**, confirm it activates, and that the money shows in Paystack
- [ ] Know how to refund from the Paystack dashboard
- [ ] Your refund and cancellation wording in the Terms matches how you will actually behave

**Done when:** a real payment activates a plan end to end.

---

## Phase 10: legal and company details

- [ ] `VITE_COMPANY_NAME`, `VITE_COMPANY_ADDRESS` (the address on your CAC registration) and `VITE_SUPPORT_EMAIL` are set, and the **Terms / Privacy / Cookies** pages show them
- [ ] The © line and "Operated by" show the right name
- [ ] A Nigerian lawyer has reviewed `src/features/public/policies.json` (data protection under the NDPA 2023, refunds, liability). Ask them whether you must register with the data protection regulator
- [ ] The cookie banner appears; **analytics stay off until a visitor accepts**
- [ ] The "Built by Sephry Tech (formerly Codex Tech Foundation)" wording is correct everywhere (`src/lib/brand.json`)

---

## Phase 11: being found online

- [ ] `VITE_SITE_URL` is set and the site was redeployed
- [ ] **Google Search Console:** add property → URL prefix → HTML tag → copy only the `content` value into `VITE_GOOGLE_SITE_VERIFICATION` → redeploy → Verify → Sitemaps → submit `sitemap.xml`
- [ ] **Bing Webmaster Tools:** import from Google Search Console, or HTML meta tag into `VITE_BING_SITE_VERIFICATION` → Verify → submit the sitemap
- [ ] Request indexing for `/` and `/about` in both tools
- [ ] Optional: `VITE_BUILDER_URL` and `VITE_BUILDER_SAME_AS` (your LinkedIn, X, Facebook) set
- [ ] The same wording ("Sephry Tech (formerly Codex Tech Foundation)") is on your LinkedIn, X and Facebook profiles
- [ ] A link to the site pasted in WhatsApp and X shows a proper preview image and title

---

## Phase 12: monitoring, backups and support readiness

**Monitoring**
- [ ] An uptime monitor (for example UptimeRobot) checks the home page every 5 minutes and alerts you
- [ ] `VITE_ERROR_REPORT_ENDPOINT` (or Sentry) is set so you hear about crashes first
- [ ] You know where to look when something breaks: Supabase → Edge Functions → Logs, Authentication → Logs, Database → Logs
- [ ] Reports timer is running: `select start_time, status from cron.job_run_details order by start_time desc limit 5;` shows recent `succeeded` runs
- [ ] Optional housekeeping: the table `platform_monitoring_measurements` is not cleaned automatically. Now and then run in the SQL Editor: `delete from public.platform_monitoring_measurements where checked_at < now() - interval '30 days';`

**Backups**
- [ ] Free plan: make your own. In the VS Code terminal, saving **outside the project folder** (they contain personal data):
  `npx supabase db dump --linked --data-only -f ../zerobyte-backup-public.sql`
- [ ] Schedule a reminder to repeat weekly (or upgrade to a plan with automatic backups)
- [ ] **Restore drill:** restore one backup into a scratch project once, so you know it works

**Support**
- [ ] The support WhatsApp number answers, and someone owns replying
- [ ] You know the password-reset routes (no email needed): owner → Admin → Users → **Reset link** (send on WhatsApp); worker → owner presses **Reset password** in User Accounts
- [ ] You know the promoter route: they apply with WhatsApp number → admin approves → **Send access on WhatsApp**
- [ ] The support mailbox in `VITE_SUPPORT_EMAIL` is real and monitored

---

## Phase 13: full smoke test (play every role on the live site)

Use a private window and a phone. Tick each one.

**Visitor**
- [ ] Landing page, About, Terms, Privacy, Cookies, Support, Guide, Promoters all open and look right on phone
- [ ] "Built by Sephry Tech" appears on the landing page and in footers

**New owner**
- [ ] Sign up (human check shows) → create a business → 7-day free trial shows
- [ ] Add a product, a customer, record a sale, open the receipt and invoice; download works
- [ ] Overview shows **Today** with the sale; Reports → Daily report shows the same number; **PDF**, **Spreadsheet** and **WhatsApp** buttons work
- [ ] Settings → Reports: change the send time, save
- [ ] Upload a logo (a PNG under 2 MB works; a larger or non-image file is refused)

**Trial protection**
- [ ] A **second** account on the same browser gets **no** free trial (starts locked)
- [ ] A disposable email address (for example mailinator) cannot sign up

**Team**
- [ ] Owner creates a worker; the worker signs in with `workspace:EMPLOYEE-ID` and the temporary password, is forced to choose a new one, and sees **no** revenue or profit
- [ ] Owner resets the worker's password: the old session is signed out

**Promoter**
- [ ] Apply on `/promoters` → admin approves → access sent on WhatsApp → promoter sets a password and reaches the dashboard
- [ ] A referral sign-up and payment creates a commission; a payout request follows the eligibility rules in the promoter terms

**Money**
- [ ] A paid plan payment activates (Phase 9). A trial that runs out (or a lapsed plan) turns the business read-only until it is paid
- [ ] The business owner's notification bell shows a report notification after the evening timer (you can wait for the next evening, or trust the test in Phase 12)

**Admin**
- [ ] Admin dashboard loads: users, businesses, analytics, revenue (super/finance only)
- [ ] A support admin **cannot** change prices or approve promoters
- [ ] A recovery link can be created for a user and works once
- [ ] The audit log records what you just did

**Devices**
- [ ] The app installs to a phone home screen; offline: record a sale, reconnect, it syncs
- [ ] Dark mode works

**Done when:** every box is ticked with no surprises.

---

## Phase 14: clean start (erase the test data, keep the super admin)

Do this **after** testing and **before** announcing. Full guide: `docs/RESET.md`.
- [ ] Confirm you are in the **production** project (name and address match the live site)
- [ ] Backup taken and saved (Phase 12)
- [ ] `supabase/reset/1_preview.sql`: your super admin is named as the account that survives
- [ ] `supabase/reset/2_wipe.sql` run; it returns **RESET COMPLETE**, `accounts_remaining` = 1
- [ ] Files erased: `npm run reset:storage` (preview) then `-- --yes`
- [ ] Sign in to `/admin` with password plus code
- [ ] Plans and prices still correct; a brand-new sign-up still gets its trial
- [ ] Testers sign out and clear the site's data on their devices

---

## Phase 15: go-live day

- [ ] Freeze changes. Nothing new is deployed after this checklist is ticked
- [ ] Final environment check against Appendix A (live Paystack key, `SITE_URL`, no `localhost` in `ALLOWED_ORIGINS`)
- [ ] `select jobname, active from cron.job;` shows 3 active jobs
- [ ] One more live payment succeeds (then refund it if you wish)
- [ ] Support phone and mailbox are staffed
- [ ] **Rollback plan written down:** website → redeploy the previous build from the host's Deployments list; functions → redeploy from the previous commit; database migrations only move forward, so a database problem is fixed with a **new** migration, never by editing an applied file
- [ ] Announce
- [ ] First 48 hours, check **twice a day**: Edge Function logs, Authentication logs, `select * from payments where status in ('failed','mismatch') order by created_at desc;`, new sign-ups, support messages

---

## Phase 16: the first week

- [ ] Read the audit log; look for anything odd
- [ ] Check refused trials: `select note from subscription_events where note like 'No free trial%' order by created_at desc limit 20;` A genuine customer refused by mistake can be given a trial by a super admin: `select admin_grant_trial('<organization id>', 'reason');`
- [ ] Check promoter applications and payouts are being handled
- [ ] Look at Search Console for crawl errors
- [ ] Take and test a fresh backup
- [ ] Decide on SMTP and email confirmation (Gmail App password for a small launch; Brevo's free tier; Resend after you have a domain)
- [ ] If you bought a domain, follow Appendix D
- [ ] Consider Supabase Pro and a paid host plan if you have not already
- [ ] Remove any key you pasted somewhere you should not have, and rotate it

---

## Appendix A: every variable and secret

**Website (host dashboard, build time)**

| Name | Required | What it is |
|---|---|---|
| `VITE_SUPABASE_URL` | Yes | `https://<ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Yes | The anon/publishable key (never `service_role`) |
| `VITE_SITE_URL` | Yes | Public address, https, no trailing slash (sitemap, canonical links) |
| `VITE_TURNSTILE_SITE_KEY` | Yes | Turnstile **site** key (public) |
| `VITE_COMPANY_NAME` / `VITE_COMPANY_ADDRESS` / `VITE_SUPPORT_EMAIL` | Yes | Shown on Terms, Privacy, Cookies |
| `VITE_SUPPORT_WHATSAPP` | Recommended | Support number, digits only |
| `VITE_ERROR_REPORT_ENDPOINT` | Recommended | HTTPS endpoint for crash reports |
| `VITE_WHATSAPP_CHANNEL_URL` | Optional | WhatsApp channel invitation |
| `VITE_GOOGLE_SITE_VERIFICATION` / `VITE_BING_SITE_VERIFICATION` | Optional | Search tool ownership codes (the `content` value only) |
| `VITE_BUILDER_URL` / `VITE_BUILDER_SAME_AS` | Optional | The builder's website and public profiles (https) |
| `VITE_GA_MEASUREMENT_ID` | Optional | Google Analytics 4 (loads only after consent) |
| `VITE_CODEX_FUNCTIONS_URL`, `VITE_MONITOR_KEY`, `VITE_APP_VERSION` | Optional | Codex Super Monitor. Never put the `ctfs_` support key in a `VITE_` variable |
| `VITE_VERCEL_PROJECT_URL` | Optional | Deployment URL shown in admin |
| `VITE_ADMIN_EMAILS` | No effect | Help text only; admin access comes from the database role, not this |

**Edge Function secrets (`supabase secrets set NAME="value"`)**

| Name | Required | What it is |
|---|---|---|
| `SITE_URL` | Yes | Same address as the website |
| `PAYSTACK_SECRET_KEY` | Yes | `sk_test_…` while testing, `sk_live_…` at launch |
| `TURNSTILE_SECRET_KEY` | Yes | Turnstile **secret** key (the promoter form refuses without it) |
| `ALLOWED_ORIGINS` | Optional | Extra allowed addresses, comma-separated |
| `GITHUB_REPOSITORY`, `GITHUB_TOKEN` | Optional | Admin deployments panel (read-only token) |
| `CODEX_FUNCTIONS_URL`, `MONITOR_KEY`, `SUPPORT_KEY`, `SUPPORT_CALLBACK_SECRET`, `CODEX_HEARTBEAT_SECRET` | Optional | Only with Codex Workspace |
| `PAYSTACK_API_URL` | No | Leave unset (defaults to Paystack) |
| `TURNSTILE_DISABLED` | **Never in production** | Local development only |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Automatic | Supplied by Supabase to functions |

---

## Appendix B: the ones people forget

1. Enabling **pg_cron before** the migrations (otherwise trials never expire and reports never run)
2. Setting `SITE_URL` **and** the Supabase Site URL/Redirect URL to the same address
3. Redeploying the **website** after changing any `VITE_` variable
4. Redeploying the **functions** after changing a secret
5. Turning the Supabase **CAPTCHA** on only after the site sends tokens
6. Remove `localhost` from `ALLOWED_ORIGINS` after testing
7. The Paystack **Live** webhook is a separate field from the Test one
8. Setting the **live** Paystack key and testing with one real payment
9. **Company details** so the legal pages are not blank
10. The first super admin needs the **SQL step**; and an **authenticator**
11. A **second** super admin as a safety net
12. A real **backup** and a restore drill
13. Vercel **Hobby** is non-commercial
14. Do the **reset** before announcing, and clear testers' devices
15. Never put the `service_role` key or `sk_live_` key in a `VITE_` variable, the repo or a chat

---

## Appendix C: quick diagnosis

| Symptom | Most likely cause |
|---|---|
| Nobody can sign in after enabling CAPTCHA | The site was not sending tokens. Turn the Supabase CAPTCHA toggle off, fix `VITE_TURNSTILE_SITE_KEY`, redeploy |
| "captcha verification process failed" | Hostname missing from the Turnstile widget, or site key and secret from different widgets |
| Promoter form: "Could not submit the application" | Migrations not pushed, or `submit-promoter-application` not deployed |
| Promoter form: "complete the human check" | `TURNSTILE_SECRET_KEY` not set, or functions not redeployed |
| Browser CORS errors calling functions | `SITE_URL` / `ALLOWED_ORIGINS` do not match the address in the address bar |
| Payment succeeded but plan not active | Check `payment_events.outcome`; no webhook log lines means a wrong webhook URL or test/live mismatch; HTTP 401 means the wrong `PAYSTACK_SECRET_KEY` |
| Daily reports and notifications never arrive | pg_cron not enabled or `zb-scheduled-reports` missing (Phase 3c) |
| Trials never expire | `expire-lapsed-subscriptions` job missing |
| Search tools cannot verify | Env var holds the whole tag instead of just the `content` value, or the site was not redeployed |
| Worker cannot sign in | Wrong format (`workspace:EMPLOYEE-ID`), 8 failed tries locked it for 15 minutes, or the CAPTCHA token expired (retry) |

---

## Appendix D: moving to your own domain later

- [ ] Buy the domain and point it at the host; wait for HTTPS to work
- [ ] Change `VITE_SITE_URL`, then redeploy the website
- [ ] `supabase secrets set SITE_URL="https://<new>"`; put the old address in `ALLOWED_ORIGINS` for the changeover; redeploy functions
- [ ] Supabase Auth: Site URL and Redirect URL = the new address
- [ ] Turnstile widget: add the new hostname
- [ ] Paystack: webhook URL is unchanged (it points at Supabase), but check your callback expectations
- [ ] Search Console and Bing: add the new site, redirect the old address to it, use Google's Change of address
- [ ] Update your social profiles, WhatsApp links and Terms/Privacy text
- [ ] Optional: add SMTP with your domain (Resend), then reconsider email confirmation
