# Update 18 (Telegram commands, 26 Nov 2026)

- **Telegram bot commands** (read-only): /health /alerts /ping /users /payments /trials /errors /capacity /security /customers /business <name> /refresh /help. New function `telegram-bot`, protected by a webhook secret and an allow-list of chat ids; strangers get no reply. Setup in `docs/ADMIN-HEALTH.md`.
- New database update `20261126090000_telegram_bot_reports.sql` (`platform_bot_stats`, `platform_bot_find_business`, server-key only).
- Worker renamed to `app` in `wrangler.jsonc` (new address: `app.<your-subdomain>.workers.dev`).
- Tests: `supabase/functions/telegram-bot/commands.test.ts` (security rules and every command); test config now also covers `supabase/functions`.

# Update 17 (fewer database calls, 25 Nov 2026)

Builds on 16d (saved copies on the device, which make screens appear faster but still ask the server every time).

- **Health center snapshot** (`20261125090000_health_snapshot_cache.sql`): the heavy scan now runs at most once every 5 minutes and is saved in one row that every admin reads. Before, each open Health center ran about 40 queries every minute. Refresh forces a new scan (not more than once per 20 seconds). The alert sender reads the same snapshot. Optional `pg_cron` line in the migration keeps it warm.
- **Background tabs stop polling:** new `src/lib/visiblePoll.ts`; traffic, API traffic, support queue, Health center and the public status page now ask only while the tab is visible and catch up once when it comes back (the monitoring page and subscription check already did).
- **Saved copies are cleared on any sign-out**, including an expired session or a sign-out in another tab (`bootstrap.tsx`), not only the Sign out button.
- Tests: `src/lib/visiblePoll.test.ts`; snapshot behaviour in `tools/pglite-check/health-center.mjs`.

# Update 16d (faster screens: saved copies on the device, 25 Nov 2026)

- **New `src/lib/dataCache.ts`:** keeps the last good answer for a screen in memory and in localStorage (key prefix `zb.swr:`, one week at most, nothing over 250 KB). The screen shows it at once and replaces it with the fresh answer a moment later. The server stays the source of truth: every screen still fetches fresh data straight away.
- **Used by:** the Inventory product list (per business, branch and stock filter, via `usePagedList({ cacheKey })` in `src/lib/paging.ts`), Reports summary figures, and Best sellers / Slow movers. A failed refresh (for example no network) keeps the saved copy on screen instead of showing an error.
- **Never cached on purpose:** stock inside a sale, subscription state, payments, anything money-critical. After a change on the same screen the list keeps its current rows while it reloads, so an old copy never flashes back.
- **Privacy:** every key carries the business id, and `clearDataCache()` runs at sign-out in `Workspace.tsx`.
- Helpers for later: `readStale`, `writeCache`, `invalidateCache(prefix)`, `clearDataCache`. Tests: `src/lib/dataCache.test.ts`.
- Not changed: static-file headers (already one year, immutable) and the service worker (`zerobyte-shell-v7`; bump the name only if `sw.js` changes).

# Update 16c (banning a user, 25 Nov 2026)

- **Ban/Unban showed only "Edge Function returned a non-2xx status code".** The Users page now shows the server's real reason (for example "Only a super admin can suspend or restore another administrator", "Your admin role does not include Users", or that the function is not deployed) in its own message above the table, instead of the misleading "Deploy list-platform-users" line.
- `manage-platform-user` no longer refuses the ban when the courtesy notice to the user cannot be written; the failure is only logged.
- If the real reason is "Your admin role does not include Users" for a super admin, migrations are behind: run `npm run supabase:push` (it adds `admin_can_access` and `revoke_user_sessions`). Then redeploy: `npm run supabase:functions:deploy:admin` and `npm run supabase:functions:deploy:admin-users`.

# Update 16b (support chat layout fix, 25 Nov 2026)

- **Support chat on phones:** the panel floated in the middle of the screen, the round Support button sat on its corner, and the header, queue note, "Send this to technical support" row and input box left only about 240px for messages (two bubbles). On a phone the chat is now a sheet from the top of the screen down to the bottom tab bar (about 490px for messages on a 390x844 phone), the round button hides while it is open (the panel has its own close button), the header is compact, text is 14px and the input stays at the bottom. Long unbroken text (references, links) wraps inside the bubble. Desktop keeps the 380px floating panel but never taller than the window (`max-height`).
- **Newest message always in view:** the list now scrolls itself to the bottom (it used `scrollIntoView`, which could scroll the page and missed the last bubble once the conversation finished loading).
- Files: `src/features/support/SupportChat.tsx`, end of `src/pages.css`. Preview harness (`tools/preview-app/mock.ts`) now has sample chat data.

# Update 16 (Health center, quiet browser console, 25 Nov 2026)

- **Admin Health center** (Governance, Health center): payments (stuck, failed, paid-but-plan-not-active, confirmation errors), subscriptions (trials ending, past due, conversion, churn), per-function errors and speed, capacity (database vs plan limit, connections, storage, idle time), security (rate-limit hits, admins without 2-step, sensitive actions, bulk deletes), data checks (sale totals, stock vs movements, sync failures), customer health (quiet, never started, support waiting), browser errors, promoter checks. Money panels are for finance-capable admins only.
- **Alerts:** `platform-alerts` function pushes new problems to Telegram or a webhook (cooldown 6 h, "back to normal" notes). Setup in `docs/ADMIN-HEALTH.md`.
- **Browser errors:** crashes and failed offline syncs are recorded (personal details removed) and shown in the Health center (`record_client_error`).
- **Nothing technical in the browser:** no console output from production builds, errors filtered through `src/lib/safeErrors.ts`, neutral sign-in storage name (existing sign-ins are moved over), neutral request label and chunk name, backend and migration wording removed from visitor-facing text.
- **Edit fix:** Edit on Inventory and Customers opens the form every time, and closing it cancels the edit.
- Database changes: `20261124090000_admin_health_center.sql`. DB checks run without a server via `tools/pglite-check`.

# Update 15 (layout, theme, loading and guide polish, 24 Nov 2026)

- **Refresh bug:** reloading Inventory, Records, Expenses, Invoices, Reports or Settings sent an owner back to Overview (the worker role was assumed before the account loaded). Fixed in `Workspace.tsx`.
- **Phones:** Inventory tools are a tidy grid (Receive stock and Count stock side by side, Import from CSV full width); stock filters are one aligned row; the floating "Add" button no longer hides the last card's Edit and Delete; Delete and other danger links are red again; Sales discount field is full width and payment methods form a grid; a disabled "Complete sale" is neutral, not washed-out green; phone numbers in Customers stay on one line.
- **Theme:** new `src/lib/theme.ts` is the single source for light/dark, so the loading screen, page background and app always agree (a dark-mode phone with no saved choice no longer shows a dark loader followed by a light app). The in-app toggle now updates the page too.
- **Skeletons:** the Overview loader matches the real page on phone and desktop; record lists show card placeholders on phones; light screens always get light placeholders.
- **Landing / guide:** the header brand lockup and links are styled again on the home page; guide tips are readable in dark mode; all guide screenshots were regenerated from the current app, with new ones for Records and Import from CSV (`tools/preview-app/guide-shots.py`).
- **Dependencies:** `npm audit` clean (0 vulnerabilities): typescript-eslint, supabase-js, vite 6 and vitest updated; lint config now covers browser and Node scripts.

# Update 14 (service worker, traffic accuracy and edge-function speed, 17 Nov 2026)

- **Service worker (cache `zerobyte-shell-v7`)**: it could answer a page request with nothing ("Failed to convert value to 'Response'" and a network error on `/admin/users`) when the connection dropped and the page was not cached, and it stored redirected copies of `admin.html`/`index.html` that browsers refuse to use for page loads. It now always answers with a real page (cached shell, or a small offline page) and stores clean copies.
- **Traffic numbers**: the recorder (`_shared/latency.ts`) now uses `EdgeRuntime.waitUntil`, so a sample is no longer lost when the instance stops right after replying, and it reuses one client per warm instance. These numbers are written by the Edge Functions on the server; they count Edge Function calls only (not direct table reads).
- **Edge-function cold start**: all functions import supabase-js with `npm:` instead of `https://esm.sh/` (no download from a third-party host at boot). Redeploy all functions to get this.
- **All API traffic, counted by Supabase** (new function `get-api-traffic`, panel inside the Traffic card on Overview and Monitoring): requests per second, totals, server/client errors, response time, a chart and a per-service table (data API, Auth, Storage, Edge Functions, Realtime) read from Supabase's own API-gateway logs through the Management API. The access token is a server secret (`LOGS_ACCESS_TOKEN`), never sent to the browser; answers are cached 30 s per window (Supabase allows 30 log queries a minute) and the last good reading is shown if Supabase is busy. Without the secret the panel shows the setup step. The dashboard's own refresh calls are excluded. Setup: `docs/DEPLOYMENT.md` section 12. Tests: `src/admin/apiTraffic.test.ts`.
- **Run functions next to the database** (`VITE_FUNCTIONS_REGION`): by default Supabase runs an Edge Function near the caller, and the function then makes several round trips to a database in another region. Set `VITE_FUNCTIONS_REGION=eu-west-1` (the project's region) in the site's environment variables and redeploy: every Edge Function call (supabase-js and direct) then carries `?forceFunctionRegion=`, which needs no extra CORS header. Verify with the `x-sb-edge-region` response header. Empty = unchanged behaviour. Test: `src/lib/functionRegion.test.ts`.
- **Inventory: import products from a CSV file** (Inventory > Import from CSV). Download a template, fill it in Excel or Google Sheets, upload it. Any column order, common header names (name, product, price, selling price, qty, buying price, barcode as SKU ...), naira signs and thousands separators, Excel's semicolon files. Every row is checked in plain words with its row number; valid rows are imported together or not at all (up to 1,000 per file); blank SKUs are numbered ITEM-000001...; existing SKUs are skipped or updated (never their stock or cost). Opening stock is written as INITIAL_STOCK movements, and ONE summary notification is sent instead of one low-stock alert per product. Tests: `src/lib/csv.test.ts`, `supabase/tests/107_inventory_tools.test.mjs`.
- **Inventory: stock count** (Inventory > Count stock): type what is on the shelves (system stock hidden by default), review differences valued at cost, add a note, apply. Differences become ADJUSTMENT stock movements ("Stock count: note"); every count and its items are kept (Stock counts list with details). Unfinished counts are saved on the device. Owners and managers only. The existing in-app low-stock notifications keep working (alerts are not sent through WhatsApp). New filters **Needs restocking** and **Out of stock** above the product list.
- **Reports: Best sellers and Slow movers** for the chosen period (new `get_product_performance`): units, sales, profit, and products still in stock that did not sell, with what is tied up first.
- **Settings: Download all my data (ZIP)**: products, customers, customer payments, sales and their items, invoices, expenses, suppliers, purchase orders and their items, stock history, stock counts and branches as CSV files (opens in Excel) plus a README, built in the browser (no extra library), free on every plan. Verified with Python zipfile and unzip.
- **Public status page** (`/status`): checks sign-in and a small read of your records from the visitor's device, every minute, with response times and an honest note that a bad connection also shows red.
- **Receipts on roll printers**: Receipts > Print receipts for > A4 page / 80 mm / 58 mm. Roll receipts are one narrow, tall, black and white page in a fixed-width font (Download PDF and Share). Receipts are grouped under a heading for each day.
- **Dashboard**: the Revenue card now also compares today with the same weekday last week ("down 5% on last Tuesday").
- **Records, Receipts, Invoices follow the business's own time zone** (Settings > Reports, default Africa/Lagos) instead of a fixed Lagos clock (`20261119100000_record_totals_org_timezone.sql`). Tests extended (a business in another time zone gets its own days).
- **All public pages now match**: home, guide, support, status, promoters, about, privacy, terms and cookies use the same dark look, the same header (Promoters, Guide, Support, Sign in) and the same footer (Product and Legal columns, now with Status). Descriptions, landing copy, About, the user guide and the Support FAQ describe the new features; the guide has new sections for importing products, counting stock and Records. `PRODUCT.md` and `README.md` describe the product as it is today and list what is deliberately not built yet.
- **Records: day by day, monthly and yearly totals** (Sales records, Expenses and Stock intake). A new **Day by day | Monthly | Yearly** switch sits under the Period filter (the choice is remembered per tab).
  - *Day by day* (default) groups the list under a heading for each day, newest first, with that day's count and total (for sales also how many were refunded). Day totals are added up by the database for the whole day, not just the rows loaded on screen.
  - *Monthly* and *Yearly* show one row per month or year with the number of sales, total sold, average sale and refunded amount, a grand total row, and **Export totals (CSV)**. The Period filter chooses which months or years are included.
  - Totals count **completed** sales only (same as the Overview and the daily report); refunded sales are listed with a red badge and shown separately, never added into "Total sold". The header now says "Total sold".
  - Days are **Lagos days** (12:00 am to 11:59 pm Lagos time): a sale at 00:30 belongs to the new day. The Period/date filter and the header total used UTC days before and are now aligned.
  - Needs the new migration `20261118090000_record_period_totals.sql` (`supabase db push`). Tested: `src/lib/recordPeriods.test.ts`, and the SQL on PGlite with Lagos midnight, refunds, filters, row cap and access checks (`supabase/tests/106_record_period_totals.test.mjs`). Checked in a browser at desktop and phone width.
- **Expenses and Invoices pages** now also group their lists under a heading for each day (newest first). Expenses show each day's count and total (added up by the database for the whole day).
- **Login page tabs (Owner / Worker / Promoter) were unstyled**: while adding the functions-region option I left a stray `)` inside the tab bar's class name (`)auth-mode-switch`), so none of its styles applied. Removed; every other file I changed was compared line by line with the original zip.
- **Cloudflare deploy failed with "Invalid _redirects configuration, Line 7: Infinite loop detected" (error 100324)**: Cloudflare refuses any rule whose source ends in `/*` and whose destination is `/index` or `/index.html`, and one refused rule fails the whole deploy, so no new version went live (the old site kept answering refreshes with the 404 page). `public/_redirects` now sends `/app` and `/app/*` to `/` and `/admin/*` to `/admin` (all three accepted: "Parsed 3 valid redirect rules"). Added `wrangler.jsonc` (static assets from `dist`, real 404 page) so the Cloudflare Worker deploy no longer auto-generates its own settings (which switched on single-page mode and installed extra packages during the build). Tested on Cloudflare's local runtime: /app/user-accounts opens the app, /admin/users keeps its address and opens the admin console, /guide.html redirects to /guide, unknown addresses give the 404 page.
- **Refresh on /app/... and /admin/... no longer ends on "This page does not exist"**, even when the host does not apply the rewrite rules: `404.html` now loads `spa-fallback.js`, which remembers the address and opens the app; `src/lib/spaRestore.ts` puts the address back before the app starts (only `/app...` and `/admin...` paths, once per 15 s, root-path sites only). Unknown addresses still get the real 404. Checked in a browser against a test host with no rewrites at all. The proper fix is still the host rewrite in `vercel.json` (see docs/DEPLOYMENT.md section 14).
- Admin health card no longer probes `/rest/v1/` (answers 401 for the public key, a red console line); Traffic page retries once after a dropped connection.

# Update 13 (Cloudflare guide, 14 Nov 2026)

- New `docs/CLOUDFLARE.md`: how to deploy on Cloudflare Pages (or as a Worker with static assets) and a table of the usual failures. Verified: a clean `npm ci` + `npm run build` succeeds, and the built site serves correctly (pages, 404, admin, security headers) in both Cloudflare modes using Cloudflare's local emulator. Added `.node-version` (22).

# Update 12 (launch checklist, 13 Nov 2026)

- New `docs/LAUNCH-CHECKLIST.md`: the complete first-time deployment and launch checklist (16 phases, variables and secrets table, forgotten-items list, diagnosis table, domain move). It supersedes the older readiness notes where they differ (email confirmation is OFF by decision; the payment end-to-end test is local-only, so test with a real small payment).

# Update 11 (database reset, 12 Nov 2026)

- Safe full reset: erase every user and all data but keep one super admin. `supabase/reset/1_preview.sql` (read-only), `2_wipe.sql` (typed confirmation, one all-or-nothing transaction that checks its own result) and `scripts/reset-storage.mjs` (preview by default). Guide: `docs/RESET.md`.
- Tested on a demo-data copy with traps (`supabase/reset/test_reset.sh`): refusals, rollback on failure, super admin and shared settings kept, sign-up and trials work afterwards. Shared platform rows created by deleted admins are handed to the kept admin first (otherwise the delete is blocked).

# Update 10 (builder name, 12 Nov 2026)

- "Built by Sephry Tech (formerly Codex Tech Foundation)": new landing-page section and footer line; built-by line, Company details row and About link on Terms, Privacy, Cookies, Support and the Promoters page; a new public **About** page (`/about`).
- Search and AI visibility: the sentence is in every page's raw HTML, author tag, schema.org Organization (Sephry Tech, alternate name Codex Tech Foundation, linked to the product as author/publisher, About page marked), sitemap entry, and `llms.txt`. Optional `VITE_BUILDER_URL` and `VITE_BUILDER_SAME_AS`. The name lives in `src/lib/brand.json` (tests keep every place in step).
- Fixed the footer on the legal, support and promoter pages: it was squeezed into a narrow block against the left edge.
- Steps and honest limits: `docs/DEPLOYMENT.md` section 11.

# Update 9 (search engines, 11 Nov 2026)

- Bing Webmaster Tools verification: set `VITE_BING_SITE_VERIFICATION` (the `msvalidate.01` code) and the build adds the tag to every public page; only a plain code is accepted, so nothing pasted wrongly can break a page. Google was already supported. Setup steps for both are in `docs/DEPLOYMENT.md` section 10.

# Update 8 (daily and weekly reports, 10 Nov 2026)

- **Overview opens on Today** with "up/down % on yesterday" and 7 / 30 day switches. **Reports** gained Daily report and Weekly report tabs with past reports, PDF, spreadsheet and WhatsApp share. Settings gained a Reports tile (on/off, send time, time zone).
- Automatic evening report + notification to the owners, closed after midnight so late-night sales count; weekly report on Sunday evening (migration `20261110090000`, needs pg_cron: see docs/DEPLOYMENT.md section 9).
- **A business day is now the business's own day (default Africa/Lagos), not UTC**, for Overview, Reports, branch revenue and reports.
- Security: owners/admins only, read-only stored reports, internal builder and timer not callable by customers, no phones/emails in reports; **fixed CSV formula injection in every spreadsheet export** (`downloadCsv`) and added the UTF-8 marker so Excel shows names correctly.
- New test `105_business_reports.sql` (mutation-tested) and 18 new unit tests.

# Update 7 (security hardening, 9 Nov 2026)

- Full attack audit (database attacked live as anon and every admin role; edge functions and frontend reviewed). Fixed: any admin could reprice plans / approve promoters / broadcast; a promoter record could be used to take over an admin account; admins could suspend the super admin; worker-login throttle bypasses; forgeable `X-Forwarded-For` in the promoter form; anonymous callers causing database writes; codex callback replay; owners could not read their payment history.
- **Free trial is now per person, not per account**: email-alias, device, address-burst and private-domain checks, disposable emails refused at sign-up, and a super-admin rescue (`admin_grant_trial`).
- **Cloudflare Turnstile CAPTCHA** (free, no email) on sign-up, sign-in, admin sign-in, worker sign-in and the promoter form; new edge function `submit-promoter-application`.
- **Admin two-factor** (authenticator app) with a lock-out-proof rollout switch.
- Sessions are revoked on password reset and suspension; supabase-js and GitHub Actions pinned.
- New migrations `20261109090000`, `20261109100000`, `20261109110000`; new tests 102, 103, 104; tests 30, 50, 95 updated for the new rules. See `docs/DEPLOYMENT.md` sections 6 to 8 and `SECURITY-AUDIT-9NOV2026.md`.

# Update 6 (V8, work in progress: see CONTINUE.md)

- Payment fee-bearer fix, promoter commissions backend, cookie consent + consent-gated Google Analytics, rebuilt landing/policies/support pages, SEO files, CSP for GA, neutral black+green palette, smooth scroll + custom scrollbar, dependency updates (0 vulnerabilities), ESLint clean.

# Update 5 (V7)

- Pagination everywhere: Customers, Inventory, Invoices, Expenses, Records (complete CSV export kept), Purchase Orders, Receipts, Dashboard counts; searchable product picker; Sales pickers read the full catalogue in chunks. See docs/SCALING.md and docs/LOAD-TEST.md.
- Admin Analytics: visitors per day (no cookies, no IPs), sign-ups, active users, retention, businesses, sales, funnel, top pages/referrers/devices/promoter codes, top businesses, plans; revenue for super/finance admins; admin team and security for super admins. Overview gets a Today at a glance strip.
- New migrations 20261015090000 / 100000 / 110000. New test 80_analytics_and_pagination.sql.

# Update 4

- Load test (100 to 2,000 users) and Receipts pagination: docs/LOAD-TEST.md, supabase/tests/load.
- Payment return fix (verification now runs from the workspace), payment diagnostics (`payment_events`), 35-check end-to-end payment test in `supabase/tests/e2e-payments`. See docs/DEPLOY-CHECKLIST.md.
- Admin Revenue Tracking restored (role gating fix + real payment ledger).
- Promoter sign-in tab and `/promoter-setup` link route.
- Loading screens neutral and theme-aware; one radius scale; lighter light-mode buttons.
- Product tour for new accounts, closable WhatsApp channel prompt (`VITE_WHATSAPP_CHANNEL_URL`), public `/guide` with screenshots (also in Settings > Guide).
- Scaling report (docs/SCALING.md), scaling indexes, notification polling fallback.
- Theme: neutral light mode and a black + green dark mode; the sidebar now follows the same palette in both (less green overall).
- Security/billing audit: see docs/AUDIT.md (free-upgrade hole, trials/paid periods that never ended, legal text, CSP, upload limits). New migration 20261014090000 and test 70_billing_integrity.sql.
- Settings page redesigned: side menu, grouped cards (Brand, Contact, Receipts and tax), live receipt preview, logo upload/replace/remove, sticky save bar, cleaner Billing plan cards.
- Paystack subscription payments (server-priced, server-confirmed). See docs/PAYSTACK.md.
- Money figures fit their boxes at any size (shrink, then 48.2M short form); kobo shown only when present.
- Admin: dark mode toggle, live traffic panel (requests/second, peak, errors, p95, DB size/connections).
- Every button shows it worked: top progress bar, spinner on the pressed button, repeat clicks ignored until the server answers.
- Receipt logo: uploading now saves it to the business straight away; receipts show the business initial if the image cannot load.

# Changes

## Update 3: redesign, logo upload fix

### Logo upload (RLS)
The `business-logos` bucket had INSERT and UPDATE policies but **no SELECT policy**. Storage reads the new row back
when it saves an upload, and under row-level security a role can't read a row unless a SELECT policy allows it, so
every upload was refused. `20261006090000_storage_logo_policies.sql` adds SELECT (members of that business) and
DELETE (owners/admins) policies; the client no longer overwrites (`upsert: false`, the path already has a random id).
Reproduced and fixed against a real database (`supabase/tests/60_logo_upload_policy.sql`): the owner can upload, a plain
worker and another business cannot, and each business sees only its own files.

### New look (business app, admin console, promoters, sign-in)
Same green identity, rebuilt on one token system (`src/design.css`, loaded after `styles.css`). Light is now the
default (readable in daylight on a phone); dark mode is still one tap away and uses the same tokens.
- **Deep-green rail + paper workspace.** Group labels are plain words (Daily work / Records / Team) instead of tracked
  all-caps; the active item has a mint marker.
- **Plain page titles.** Slogans such as "Know what is in stock." are gone; every page opens with its name and one line.
- **Money is the signature.** Figures use Bricolage Grotesque with tabular numerals and a quiet ₦ sign (both fonts were
  checked for the naira glyph, which several popular fonts lack). The sale summary is a till slip with a torn edge.
- **Overview rebuilt:** one connected money strip, recent sales first, "Running low", and a first-run checklist that
  disappears once the business is set up. The big greeting banner is gone.
- **Lists lead.** "Add product / customer / expense / ..." forms moved behind a button (they used to push the list
  below the fold on seven screens).
- **Sales is a till:** products and cart on the left, the sale summary on the right; the developer-speak panel
  ("secure Supabase RPC... idempotent server operation") was removed.
- **Sign-in:** split screen, forest brand panel + paper form (stacks on phones).
- **Promoter pages and admin:** same system (forest rail/header band, white sheets, same buttons, tables and chips).
- **Contrast** of every text/background pair in both themes was computed and meets WCAG AA (4.5:1).
- Fonts are self-hosted (`@fontsource-variable/*`), so the existing Content-Security-Policy needs no change.
- To make dark the default again, change `=== 'dark'` in `Workspace.tsx` (theme state) back to `!== 'light'`.

---

Update 2: receipts, customers, promoters, free-tier deployment

Deploy using **docs/DEPLOYMENT.md** (Supabase secrets, redirect URL, Vercel/Cloudflare, working without email).
New migrations (apply in order, staging first): `20261005090000_receipt_customer_business_fields.sql`,
`20261005100000_promoter_program.sql`, `20261005110000_auth_throttle.sql`.

### Receipts and customers
- **Root cause of "Walk-in" on every receipt:** the receipts query asked PostgREST for `customers(...)` but the
  screen read `row.customer`, and an `as unknown as` cast hid the mismatch. The embed is now aliased
  (`customer:customers(...)`), the cast is replaced by a normalizer, and one function decides who a receipt is
  for so the preview and PDF can never disagree. Reproduced on the old build, fixed on the new one.
- Receipt shows the customer's name, phone, address and email (missing fields are simply left out). A sale with no
  customer shows "Walk-in customer"; a sale tied to a customer record the viewer can't read says "Registered
  customer" rather than pretending to be a walk-in.
- **Walk-in sales** can now actually be made (the Sales screen forced a customer). Credit sales require a
  registered customer, enforced in the UI and in the database.
- `customers.address` and `organizations.tagline` added; customers can be edited (owners/managers) so existing
  customers can get an address; Settings has an optional **Slogan** (nothing is printed when blank).
- The business's own name, logo, phone, email, address and slogan appear on receipts; the PDF can no longer be
  built from placeholder business details.
- **PDF colours:** the PDF is drawn with jsPDF primitives and never defined any green (black text, near-black
  header), so it was not a conversion bug. It now uses the preview's palette. Logos are rasterised first, so
  PNG/JPG/WEBP/SVG all work and keep their proportions. Accented characters no longer print as garbage.
- Fixed `.page` entrance animation keeping the page "transformed" forever, which made every modal (incl. the receipt
  preview) scroll with the page and sit off-screen/over nothing.
- Custom receipt colours/themes are intentionally **not** implemented yet.

### Promoters
- Application collects a required **WhatsApp number**; the success message no longer promises an email.
- **Access without email:** *Admin → Promoters → Send access on WhatsApp* creates the promoter's account (random
  unknown password), binds it to the promoter record and produces a one-time setup link with a ready-to-send
  WhatsApp message. No password is ever created, shown or sent.
- **Security:** promoter records used to be claimed by *whoever registered the applicant's email first* (account
  takeover of the promoter and their commissions). Binding is now done only by an admin. Self-referral (a promoter
  earning on their own business) is ignored.
- **Bug fixed:** signing up with a referral code always failed (`column reference "referral_code" is ambiguous`),
  so no referral could ever be recorded.
- New promoter dashboard: ID, referral link, copy/share on WhatsApp, counts, referral list with masked business
  names and humanised statuses, how-it-works, support chat, sign-out. Promoter-only accounts are routed to it.
- Admins can finally move referrals through Signed up → Qualified → Commission due → Paid (audited).

### Accounts without email
- **Setup/reset links survive WhatsApp.** Supabase's own verify link is single-use and WhatsApp opens links in the
  background to build a preview, which used the token up before the person tapped it (`otp_expired`). Links now
  open a small "Set up your account" page in the app that only spends the token when the person taps **Continue**.
  An expired/used link, wherever Supabase sends the person, now shows a clear message on the sign-in page.
- Admin **Reset link** (Users) for owners; owner **Reset password** for workers. See docs/DEPLOYMENT.md.
- Worker sign-in throttled (8 failures/15 min per account, 40 per address) with uniform failure timing.
- Admin user search now searches everyone (it only searched the visible page); data requests no longer time out at
  5 s on cold starts (monitoring keeps its 5 s budget).

### Hosting
- `public/_headers`, `public/_redirects` (Cloudflare Pages), `.nvmrc`, CI workflow separated from deployment,
  CORS origins configurable via `SITE_URL` / `ALLOWED_ORIGINS` (no hardcoded GitHub org).

### Still not done
- MFA for platform admins; separate origin for the admin console.
- Enforcing `employment_status = 'active'` inside RLS (banning does not revoke an already-issued session).
- Receipt customer details are read live from the customer record (editing a customer changes old receipts).
- Real-device testing (iOS Safari, installed PWA, offline sync) and the light theme.

---

## Update 1: audit fixes

## Deploy in this order

1. **Back up the database**, then apply the new migrations to a **staging** project first:
   `npm run supabase:push` (adds `20261004090000_security_hardening.sql` and `20261004100000_sale_operation_discount.sql`).
2. Run the SQL tests in `supabase/tests/` against staging (see its README).
3. Redeploy the edge functions: `npm run supabase:functions:deploy`.
   The unused `create-sale` function was deleted from the repo; **undeploy it in the Supabase dashboard**
   (Edge Functions → create-sale → Delete) so the public endpoint disappears.
4. Set the GitHub Actions secrets `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
   (the workflow now **fails** if they are missing instead of deploying a broken page).
5. Supabase dashboard → **Authentication → URL Configuration**: add `https://<your-site>/auth` to
   **Redirect URLs**. Without this the password-reset email link is rejected.
6. Supabase dashboard → **Authentication → Providers → Email**: set minimum password length to 8 or more,
   and enable leaked-password protection if your plan has it. Consider enabling CAPTCHA (Turnstile/hCaptcha).
7. Optional: set `VITE_ERROR_REPORT_ENDPOINT` to an HTTPS endpoint to receive client error reports.
8. Watch the browser console for `Content-Security-Policy-Report-Only` violations for a release or two,
   then rename that header to `Content-Security-Policy` in `vercel.json` to enforce it.

## Bugs found while testing the original migrations (fixed)

These were present in the SQL as shipped. If your live database was built from it, they affect you now.

- `create_sale_with_operation` and `create_customer_with_operation` failed on **every call**
  (`column reference "operation_id" is ambiguous`), so offline sales and customers could never sync.
- Every sale **with a discount** failed at commit (`Sale total must equal the sum of receipt line items`):
  the integrity check was never updated when totals became net of discount.
- Discounts were silently dropped from offline/retried sales.

## Security

- Any platform admin (even SUPPORT) could promote themselves to SUPER_ADMIN, edit plans/subscriptions and read
  payments by calling the REST API directly. Table policies now require the proper role; direct writes to
  `platform_admin_access` are revoked (changes go through the role-checked RPCs).
- Managers can no longer write `employee_profiles` directly (salary, user link, employment status).
- Plan helper functions are no longer callable by anonymous visitors.
- Promoter application form: field length caps, 5/hour per IP and 100/hour global throttle.
- jsPDF upgraded (critical advisory); production `npm audit` is clean. CI now audits production dependencies.
- Security headers added (`nosniff`, frame denial, referrer/permissions policy, HSTS, report-only CSP).
- Admin client no longer consumes sessions from the URL; referral codes are validated before storage.

## Sales and receipts

- "Complete sale" cannot be double-submitted; every attempt carries an idempotency key, so retries and the
  offline queue can never create a duplicate. Discount now flows through the offline path.
- Receipts show the real discount and gross subtotal, readable payment labels, and no longer print the
  platform slogan on every business's receipts.

## Accounts

- Password reset ("Forgot your password?" → email link → choose new password), generic response (no account
  enumeration), expired-link message. Workers are told to ask their owner.
- Sign-in/sign-up: autocomplete attributes, show/hide password, 8-character minimum on sign-up,
  terms/privacy notice, sign-in form first on phones, no more stuck "Please wait…" on a dropped connection,
  vendor name removed from user-facing errors.
- Admin console no longer flashes "Access denied" while the role check is loading.
- Fixed the service worker reloading the page on a visitor's **first** load (wiped half-typed forms and
  stripped email-link tokens from the URL).

## Reliability

- Error boundary + global error handlers + pluggable reporter; auto-recovery from stale JS chunks after deploys.
- Node 22 in CI (Node 20 reached end of life), lockfile regenerated so `npm ci` works.

## UI / mobile

- Global form-control baseline (white textareas/selects/checkbox/file input fixed), visible keyboard focus.
- Minimum text size 12px (145 declarations raised), 44px touch targets on touch/tablet, 16px inputs (no iOS zoom).
- Tablet (761–1100px) now uses the slide-in drawer: removes sideways scrolling on 13 of 14 screens.
- Phones: tables become labelled cards; compact support button; Settings closes the drawer;
  `100vh` → `100dvh`; safe-area insets; `viewport-fit=cover`.
- Styled previously unstyled elements (`.form-wide`, temporary password, grand total, chart legend).
- Removed an unhandled `window-controls-overlay` display mode from the manifests.

## Verified

TypeScript, ESLint (0 warnings), 21 unit tests, production build, `npm ci`, `npm audit --omit=dev` clean.
All 53 migrations replay on PostgreSQL 16; SQL tests pass. Browser audit of 14 authenticated screens at
360 / 768 / 1440px and the public pages at 320–1440px: no horizontal overflow, no text under 12px, no
unstyled form controls, no small touch targets on phones/tablets.

## Not done (recommended next)

- Rate limiting / CAPTCHA on `resolve-worker-login`, plus an owner-initiated **worker password reset**
  (workers currently depend on the owner re-provisioning them).
- MFA (TOTP) for platform admins; serve the admin console from its own origin.
- Enforce `employment_status = 'active'` inside RLS helper functions (banning does not revoke an existing JWT).
- `list-platform-users`: search runs after pagination; admin requests time out at 5s (too tight for cold starts).
- Remove hardcoded GitHub org defaults in `_shared/cors.ts` and `list-platform-audit`.
- Code-split `jspdf`/`html2canvas` (main bundle is ~598 kB).
- Real-device testing (iOS Safari, installed PWA, offline sync) and light-theme review.

## Trial and lockout session
- The 7-day free trial now starts at signup and ends for real: after it (or after a paid month) the business is read-only until it pays. Enforced in the database, not the browser.
- Fixed: a brand-new account was dropped into the Workers dashboard instead of the owner's Business dashboard.
- Admin console spacing, sidebar and phone header polished; stale "no payment provider" note removed.
- Billing tab shows what each plan includes; "Free forever" wording removed everywhere.
- Free trial is once per person; further businesses by the same owner start locked until paid.
- Removed the header search bar that only worked on three pages; those pages now have their own search under the title.
- Fixed the blank "Download as PDF" in the user guide; updated the guide, product tour, FAQ and Terms; legal pages now have a summary, contents and company details.

## V8 redesign, stage 1
- New app shell from the V8 design: compact sidebar with an Account group, breadcrumb top bar, phone bottom bar and "More" sheet.
- 4-up metrics, side-by-side list and form layout on desktop, floating add buttons and card lists on phones.
- Sales page rebuilt as a two-column page with a live summary; supplier adds now confirm and guard duplicates.
- Loading skeletons now mirror the real layouts. Inter replaces the old fonts. Code formatted for readability.
- Mobile pass: every page checked at 390 and 360px in light and dark; fixed the Sales summary overlap, tables as cards, one floating button per page, quick actions on Overview, forms closing after save, and a stale-cache bug that hid recent sales.
- Sign-in screens redesigned (light, two columns, Owner / Worker / Promoter tabs).
