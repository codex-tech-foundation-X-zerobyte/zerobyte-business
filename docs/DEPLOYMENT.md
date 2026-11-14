# Deploying Zerøbyte Business (free tier) and running without an email provider

## 1. Supabase (once)

1. **Run the migrations** (`npm run supabase:push`) on a staging project first, then production. Run the SQL tests in
   `supabase/tests/` against staging (see its README).
2. **Deploy the edge functions:** `npm run supabase:functions:deploy`.
   Undeploy the old `create-sale` function in the dashboard if it exists (it was removed from the code).
3. **Set function secrets** (these must match the address people actually visit):
   ```bash
   supabase secrets set SITE_URL="https://your-app.vercel.app"        # or https://your-app.pages.dev
   supabase secrets set ALLOWED_ORIGINS="https://other-address.example"   # optional extras, comma separated
   ```
   `SITE_URL` is where password-setup links point and is automatically an allowed origin.
   When you buy a domain: change `SITE_URL`, put the old address in `ALLOWED_ORIGINS` while you switch, redeploy.
4. **Authentication → URL Configuration:** set *Site URL* to the same address (no trailing slash) and add
   `https://your-app.vercel.app/auth` to *Redirect URLs*. Remove old entries you no longer use (e.g. a previous
   GitHub Pages address) and avoid wildcards. The WhatsApp setup/reset links point straight at your app
   (`/auth?token_hash=...`) and do not depend on this list; it is still needed for the automatic
   "Forgot password" email once you add an email sender.
5. **Authentication → Emails → OTP expiry:** raise it to `86400` (24 hours). Setup links sent over WhatsApp are
   usually opened hours later, not minutes. Each link works once, and creating a new one for the same person
   cancels the previous one, so send only the newest.
6. **Authentication → Providers → Email:** minimum password length 8 or more. If you have **no email provider**,
   turn **Confirm email OFF** until you have one, otherwise new owners wait for a confirmation email that never comes.

## 2. Vercel

Import the repository. Framework: *Vite*. Build command `npm run build`, output `dist`. Add environment variables
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (and optionally `VITE_SUPPORT_WHATSAPP`, `VITE_ERROR_REPORT_ENDPOINT`).
Headers and routing come from `vercel.json`.

## 3. Cloudflare Pages

Connect the repository. Build command `npm run build`, output directory `dist`, same environment variables
(Node version comes from `.nvmrc`). Headers and routing come from `public/_headers` and `public/_redirects`.

## 4. No email provider: what works and what to do

Supabase's built-in email sender is only meant for trying things out: it allows very few messages per hour and,
on new projects, only delivers to your own team's addresses (check Supabase's current limits). Don't rely on it.

| Situation | How it works now (no email needed) |
|---|---|
| **New promoter** | Applies with their **WhatsApp number** → an admin approves → admin presses **Send access on WhatsApp** in *Admin → Promoters* → WhatsApp opens with the promoter ID and a one-time password-setup link → promoter chooses their **own** password. No password is ever created, shown or sent. |
| **Owner forgot password** | Owner messages support (button on the Forgot-password screen if `VITE_SUPPORT_WHATSAPP` is set) → admin presses **Reset link** next to the user in *Admin → Users* → sends it on WhatsApp. |
| **Worker forgot password** | Business owner presses **Reset password** in *User Accounts* → a new temporary password is shown once (and can be sent on WhatsApp); the worker must choose their own at next sign-in. |

Only SUPER_ADMIN and SUPPORT_ADMIN can generate recovery links, only a SUPER_ADMIN can do it for another admin, and
every link issued is written to the audit log.

**When you want automatic emails** (confirmations, "Forgot password" mail) you only need an SMTP sender, no domain
required to start: *Supabase → Authentication → Emails → SMTP Settings*.
- **Gmail** (free, about 500/day): host `smtp.gmail.com`, port `465`, user = your Gmail, password = a Google
  *App password* (needs 2-step verification on). Fine for a small launch.
- **Brevo** (free, about 300/day): verify one sender address; no domain needed to begin.
- **Resend** (free tier): only sends to other people once you have verified a domain, so it fits after you buy one.

## 5. Optional settings

| Variable | Where | Purpose |
|---|---|---|
| `VITE_SUPPORT_WHATSAPP` | host env | Support number (international digits, e.g. `2348031234567`). Adds chat buttons on Forgot-password and the promoter dashboard. |
| `VITE_ERROR_REPORT_ENDPOINT` | host env | HTTPS endpoint that receives client error reports. |
| `SITE_URL`, `ALLOWED_ORIGINS` | Supabase secrets | See step 3. |

## 6. Stopping fake accounts and free-trial farming (no email needed)

**You do not need email confirmation for this.** Supabase's "2 emails per hour" limit only applies to emails it
*sends*. A CAPTCHA sends nothing, so it works with email confirmation switched **OFF** and keeps sign-ups instant.
Keep **Confirm email = OFF** until you have your own SMTP sender.

Defence in layers (all server-side, none can be skipped by editing the website):

| Layer | What it stops |
|---|---|
| **Cloudflare Turnstile** human check on sign-up, sign-in, admin sign-in, worker sign-in and the promoter form | Bots creating accounts or guessing passwords in bulk |
| **Disposable email block** (`blocked_email_domains`, enforced when the account is created) | Throwaway mailboxes (mailinator, yopmail, ...) |
| **One trial per person**, not per account (`trial_claims`) | A new account that is the same *person*: same email spelled differently (`a.b+1@gmail.com`), same browser, 5+ sign-ups from one address in a day, 3+ sign-ups on one private domain |
| **App device token** required for a trial | Scripts that call the API directly |

A business refused a trial is created normally but starts **locked** until a plan is paid (the reason is stored on its
subscription event, e.g. `No free trial (device_reuse)`). If a genuine customer is refused by mistake (shared phone,
shared shop Wi-Fi), a **super admin** can give them their trial: `select admin_grant_trial('<organization id>', 'reason');`.

Be honest about the limit: without verifying something real-world (a phone number by SMS, or a card), a determined
person with many devices and many real mailboxes can still get several trials. These layers make that slow and
expensive, and the trial is already limited to 1 branch. If abuse continues, the next step is a refundable ₦50 card
check (Paystack gives each card a fixed signature we can allow once per trial).

### Set up Turnstile (free, ~5 minutes)
1. Cloudflare dashboard → **Turnstile** → **Add widget**. Hostnames: your Vercel address, your Cloudflare Pages
   address, and `localhost`. Mode: *Managed*. You get a **site key** (public) and a **secret key** (private).
2. **Supabase → Authentication → Attack Protection** (search the dashboard for "CAPTCHA" if the menu moved) →
   enable CAPTCHA protection → provider **Turnstile** → paste the **secret key**. This makes Supabase itself refuse
   sign-ups and sign-ins that carry no valid token, even if someone bypasses the website.
3. Put the **site key** in `VITE_TURNSTILE_SITE_KEY` on Vercel and Cloudflare Pages, then redeploy the website.
4. Give the edge functions the **secret key**: `supabase secrets set TURNSTILE_SECRET_KEY=...`
5. Deploy the functions: `npm run supabase:functions:deploy` (this now includes `submit-promoter-application`).

The promoter form now goes through that edge function. It **fails closed**: if `TURNSTILE_SECRET_KEY` is missing, the
form refuses submissions (so forgetting the setting can never silently switch the protection off). For local
development only, set `TURNSTILE_DISABLED=true` in the functions' local env, or use Cloudflare's always-pass test
keys (site `1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA`).

## 7. Admin two-factor sign-in (rollout without lock-out)

1. Every admin: **Admin → Settings → Two-factor sign-in → Set up authenticator app** (Google Authenticator,
   Microsoft Authenticator, Authy, 1Password). From then on they are asked for a code at each admin sign-in.
2. When *everyone* has done it, the **super admin** (signed in with their code) presses **Make compulsory for all
   admins**. The database refuses while any active admin has no authenticator, so nobody can be locked out.
3. Once compulsory, a password alone is not an admin session anywhere: admin screens, admin functions and the
   recovery-link tool all demand the code. To switch it off again, the super admin uses the same button.

Keep a second super admin account with its own authenticator as a safety net, and store each admin's authenticator
backup (screenshot of the key) somewhere safe.

## 8. Security hardening of 9 Nov 2026 (what changed and what you must do)

Run `npm run supabase:push` (adds `20261109090000_admin_role_gates`, `20261109100000_trial_anti_farming_and_hardening`,
`20261109110000_admin_mfa`), then redeploy **all** functions. Behaviour changes you should know about:
- Admin tools now check the admin's **role section**, not just "is any admin". A support admin can no longer change
  plan prices, approve promoters, see promoter contact details or publish version announcements.
- The Promoters tools can never reach an administrator's own account (`provision-promoter-access` refuses).
- Only a super admin can suspend another admin; suspending someone or resetting a worker's password now signs them
  out of every device at once.
- The promoter application form and the worker login no longer trust `X-Forwarded-For`; worker login attempts are
  counted before they are checked and every spelling of an ID shares one counter.
- Functions are pinned to `supabase-js@2.118.0`, and GitHub Actions are pinned to commit hashes.

## 9. Daily and weekly reports (10 Nov 2026)

What owners get: **Overview** opens on *Today* (with "up/down % on yesterday" and 7 / 30 day switches); **Reports** has
*Summary*, *Daily report* and *Weekly report* tabs; each report can be downloaded as a **PDF** or **spreadsheet (CSV)** or
sent as a **WhatsApp** message; and every evening the owner gets a notification with the day's headline numbers.
Settings has a new **Reports** tile (daily on/off, weekly on/off, send time, time zone).

1. `npm run supabase:push` (adds `20261110090000_daily_weekly_reports`). Redeploy the website. No new function is needed.
2. **Switch on the timer (once).** The migration installs a 5-minute job automatically if `pg_cron` is available. In
   Supabase open **Integrations -> Cron** (or **Database -> Extensions -> pg_cron**) and enable it. Then check:
   `select jobname, schedule, active from cron.job;` shows `zb-scheduled-reports`. If the push printed a notice that
   pg_cron could not be enabled, enable it, then run once:
   `select cron.schedule('zb-scheduled-reports', '*/5 * * * *', 'select public.run_scheduled_reports()');`
   Without the timer everything still works (the *Today live* / *This week live* reports are calculated on demand);
   you simply will not get the stored evening reports and notifications.
3. How it behaves: each business has its own 5-minute slot inside the hour (so thousands of businesses never compute at
   once). At the owner's send time (default 9pm) the day-so-far report is stored and the owners are notified; just after
   midnight the day is **closed silently** so late-night sales are included; on Sunday evening the week-so-far weekly report
   is sent and closed on Monday. Quiet days, switched-off businesses and businesses whose plan has lapsed get nothing.
   Daily reports are kept 400 days and weekly reports about 2 years.
4. **A "day" is now the business's own day (default Africa/Lagos), not UTC.** Before this, a sale at 12:30am Lagos time
   counted toward the previous day. Overview, Reports, branch revenue and the daily/weekly reports all use the same rule and
   the same numbers, so they always agree. Existing historical totals may shift slightly for sales made between midnight
   and 1am.

Security of the reports feature: only the owner and admins of a business can read its reports (team members, other
businesses and visitors get nothing); nobody can write, edit or delete a stored report from the app; the report builder and
the timer cannot be called by customers; reports contain names and totals only (never phone numbers or emails);
dates are limited to the last 400 days; downloads are made in the browser from data the person is already allowed to
read (no public file links); and exported spreadsheets neutralise formula injection. Test `105_business_reports.sql` covers
all of this and was proven against deliberately broken versions.

## 10. Getting found on Google and Bing

Your build already writes `robots.txt`, `sitemap.xml` (the 7 public pages), a canonical address and link-preview tags
for every public page, and marks the sign-in, promoter and admin screens `noindex`. You only have to prove ownership
and submit the sitemap.

1. **Set the address** in Vercel (Project -> Settings -> Environment Variables, Production): `VITE_SITE_URL` =
   `https://zerobyte-business.vercel.app` (no slash at the end). Without it there is no sitemap. Also set
   `VITE_COMPANY_NAME`, `VITE_COMPANY_ADDRESS` and `VITE_SUPPORT_EMAIL` so the Terms and Privacy pages are complete.
2. **Google Search Console** (search.google.com/search-console): *Add property* -> **URL prefix** -> your address ->
   *HTML tag* -> copy only the `content="..."` value into `VITE_GOOGLE_SITE_VERIFICATION` -> redeploy -> press *Verify*.
   (A *Domain* property needs DNS access, which you only have once you own a domain.) Then **Sitemaps** -> enter
   `sitemap.xml` -> Submit. Keep the tag in place: Google re-checks it.
3. **Bing Webmaster Tools** (bing.com/webmasters): easiest is *Import from Google Search Console* (it copies the
   verified site and its sitemap). Or *Add a site* -> *HTML Meta Tag* -> copy only the `content="..."` value into
   `VITE_BING_SITE_VERIFICATION` -> redeploy -> *Verify*. Then **Sitemaps** -> *Submit sitemap* -> `https://.../sitemap.xml`
   (skip this if the import already brought it in).
4. After the real domain is bought: add it as a new property in both tools, set `VITE_SITE_URL` to it, and redirect the
   vercel.app address to it so search engines follow the move. Use *Change of address* in Google for the old site.
5. Be patient: first indexing takes days to a few weeks. *URL Inspection* (Google) and *URL Submission* (Bing) can
   nudge the home page. Only public pages are indexed on purpose; the app itself needs a login.

## 11. "Built by Sephry Tech (formerly Codex Tech Foundation)": being found online

What is already in the product (one name source, `src/lib/brand.json`, used everywhere so it can never drift):
- Landing page: a "Built by Sephry Tech" section and a footer line. Terms, Privacy, Cookies, Support and the Promoters page: a
  built-by line, "Built by" in the Company details, and an About link in the footer.
- A new public **About** page (`/about`) that states who builds the product and that Sephry Tech was formerly Codex Tech
  Foundation. It is in the sitemap, has its own title and description, and is the page search engines should show for the name.
- Behind the scenes (works with no JavaScript, which is how crawlers read it): the sentence is in every page's raw HTML; an
  author tag; schema.org data that names Sephry Tech as the organisation **and lists Codex Tech Foundation as its alternate
  name**, links it to the product (author/publisher), and marks `/about` as an About page; and `llms.txt`, a plain summary for AI tools.

To change the name again, edit `src/lib/brand.json` and redeploy.

Do these to complete it:
1. In Vercel set `VITE_SITE_URL`, and optionally `VITE_BUILDER_URL` (Sephry Tech's website) and `VITE_BUILDER_SAME_AS` (its
   LinkedIn, X, Facebook, etc., comma separated). These tell search engines and AI tools that the website and those profiles
   are one organisation. Redeploy.
2. Set `VITE_COMPANY_NAME` to the name that really operates the service. The Terms, Privacy and the page footers read it
   ("Operated by", the (c) line). If the registered legal name is still Codex Tech Foundation, say so there, for example
   "Sephry Tech (formerly Codex Tech Foundation)". Have the person who owns your legal documents confirm the wording.
3. In Search Console use **URL Inspection -> Request indexing** for `/about` and `/`; in Bing use **URL Submission**.
4. Make the name consistent OFF your website too, because AI search and Google trust names that several independent places
   agree on: a company page on LinkedIn, X and Facebook profiles, and a GitHub or Crunchbase profile, all using the exact
   wording "Sephry Tech (formerly Codex Tech Foundation)" and linking to the site. If Codex Tech Foundation had its own
   website or pages, keep them online and add a notice and a link pointing to Sephry Tech (or redirect them) so the
   old name leads to the new one.
5. Be realistic: nobody can make Google, Bing or an AI assistant mention a company on demand. This makes the facts easy to
   read and consistent; being shown depends on those systems crawling the site, on other sites mentioning you, and on time.

## 12. Starting clean before launch

To erase all test users and data but keep your super admin, follow `docs/RESET.md` (backup, preview, erase, erase files, check).

## 13. The full first-time checklist

`docs/LAUNCH-CHECKLIST.md` puts every step from this guide, the reset guide and the security work in one ordered list.
