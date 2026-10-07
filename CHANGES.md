# Changes

## Update 2: receipts, customers, promoters, free-tier deployment

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
