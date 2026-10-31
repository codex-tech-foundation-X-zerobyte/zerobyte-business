# CONTINUE.md: where work stopped (V8 work in progress)

Launch target: **1 November**. Code ready and tested by **Monday**. This file says exactly what is done, what is not,
and what to do next, in priority order. Nothing here has been deployed.

## State right now (checked just before zipping)
| Check | Result |
|---|---|
| `npx tsc -b` | passes |
| `npx eslint .` | 0 errors, 5 warnings (react-refresh warnings, all in `src/features/public/PromoterTerms.tsx`: move `usePromoterTerms`, `percentText`, `humanMonths`, `durationText`, `earningsExample` into `promoterTermsData.ts`) |
| `npx vitest run` | 34 of 34 pass |
| `npm run build` | passes (generates robots.txt, sitemap.xml, JSON-LD, 404.html when `VITE_SITE_URL` is set) |
| `npm audit` | 0 vulnerabilities (vitest 5.0.5 + in-range updates; React 19 / TS 7 / ESLint 10 / Vite 8 deliberately NOT upgraded) |
| Payment suite `supabase/tests/e2e-payments/run.sh` | 42 of 42 passed (before the commission migration was added to its setup; rerun it) |
| `supabase/tests/90_promoter_commissions.sql` | ALL CHECKS PASSED on a fresh DB |
| Tests 10 to 80 (SQL) | last run clean at V7; **rerun on fresh DBs after the two new migrations** |

## V8 UI REDESIGN (in progress). Source of truth: the design package `zerobyte-v8-ui-design.zip`
**Done and verified against the design (real database + Playwright screenshots, desktop 1280 and phone 390):**
- Fonts: Inter + DM Mono (self-hosted via @fontsource); Plus Jakarta / Bricolage removed. Light-theme tokens set to the design's exact values (`src/theme.css`).
- App shell rebuilt as small components: `workspace/navigation.ts` (menu config), `Sidebar.tsx`, `Topbar.tsx`, `OrganizationSwitcher.tsx`, `MobileNav.tsx` (bottom bar + "More" sheet), styled by `src/shell.css`. Breakpoint: phone = up to 819px; tablet and desktop keep the sidebar (the old drawer between 861 and 1100px is gone). The header search bar was removed; Inventory, Customers and Records have a search box under the title (`PageSearchContext`).
- `src/pages.css` = V8 page components (page header, 4-up metrics strip, cards, tables, chips, buttons, fields, side forms, sales layout, phone cards and floating buttons).
- `FormDisclosure` (ui.tsx) now has two modes: `side` (always-visible form card beside the list on desktop) and `toggle` (button, for long forms: Add product, Add worker). On a phone both become a floating "+ Add ..." button opening the form full-screen.
- Skeleton loaders rebuilt to mirror the real layouts (`WorkspaceSkeleton`, `TableSkeleton`, `MetricSkeleton`, `src/skeleton.css`).
- Trial strip, locked banner and locked screen restyled to the design (`features/billing/BillingGate.tsx`, `src/billing.css`). The locked screen offers "Renew with Paystack" and "View records" (records stay readable).
- Sales page rebuilt as the two-column page with a live summary and payment chips (logic unchanged: drafts, offline queue, idempotent operation id).
- Purchase Orders: supplier add now confirms, blocks duplicate names and lists suppliers.
- Whole codebase formatted with Prettier (`.prettierrc`, 120 cols, no semicolons); source went from ~2,100 dense lines to ~8,500 readable ones.

**Stage 2 (mobile audit + auth) done and verified:**
- Phone audit of all 14 pages at 390 and 360px, light and dark, with automatic checks (sideways scroll, off-screen elements, tap targets). Fixed: Sales summary overlaying the customer/product cards (an old sticky rule), stacked floating buttons (now one per page, others are normal buttons), tables turned into clean cards (title, label/value pairs, actions), Records tabs as scrolling chips, Overview quick-action tiles, business name in the top bar, Support bubble collisions.
- Forms close themselves after a successful save on phones (generic, in `FormDisclosure`); before, the full-screen form stayed open and blocked navigation.
- Race condition fixed: the saved offline copy could overwrite fresh data on fast connections (Overview showed "No sales yet" for a business with sales; same guard added to Sales).
- Settings rebuilt to the design (tab card, form, sticky receipt preview, Save bar that only floats while there are unsaved changes).
- Sign-in/sign-up/recovery/admin sign-in restyled to the light two-column design (`src/auth.css`); old dark auth CSS removed; copy now says "7-day free trial, no card needed".
- Legacy CSS removed so far (with `postcss`, only selectors that were fully replaced): metrics, settings tabs, auth, phone table rules, sale summary.

**NOT done yet (do next, in this order):**
1. Phone versions of: Overview quick-action tiles, Customers/Inventory compact cards (currently generic stacked cards), Settings as a list of rows, Sales review step.
2. Pages not yet restyled to their design: Settings tabs (desktop left list + content), Receipts/Records toolbars, Reports, Branches, Workforce, Promoter pages, receipt preview.
3. Landing page, legal/support pages, onboarding tour visuals (auth screens are done).
4. The whole admin console shell (still the old layout) and its pages.
5. Dead CSS: `styles.css`, `design.css`, `polish.css`, `theme.css`, `layout.css`, `scroll.css` still hold many rules overridden by `shell.css` / `pages.css`. Remove with browser CSS coverage after all pages are migrated (bundle CSS is 232 KB, 42 KB gzipped).
6. Earlier tasks still open: super-admin gift/discount for plans, promoter dashboard transparency upgrade, Cloudflare deployment fix (Vercel must stay intact), `docs/PRODUCTION-READINESS.md` manual items.

Testing method used: `/home/claude/simup.sh` style harness = local Postgres with all migrations + PostgREST (db-max-rows=1000 like Supabase) + Vite + Playwright with a minted JWT; seed data in `seed.sql`. It is not in the repo; rebuild it if needed (PostgREST release binary from GitHub).

## DONE in the trial/lockout session (V8, latest)
1. **Trial now really ends.** Migration `20261025090000_trial_lockout.sql`: a new business starts a 7-day trial at signup (length = `plans.trial_days` of the Free plan); `subscription_state(org)` is computed live from the dates (trial | active | locked); when locked, writes to the core business tables are refused by the SERVER (`SUBSCRIPTION_REQUIRED`, reads stay open, records are never deleted); `get_subscription_access(org)` feeds the app and also tidies a stale "trialing" status, so pg_cron is not needed; the manual "Start trial" is retired (`TRIAL_USED`); existing never-paid Free businesses get one fresh 7-day trial when the migration runs. Tests: `supabase/tests/95_trial_lockout.sql` (new) and `70_billing_integrity.sql` (updated).
2. `provision-worker` Edge Function now refuses a locked business (service-role path would otherwise bypass the lock). **Redeploy it.**
3. App: `src/features/billing/` (hook, TrialBanner, LockedScreen, LockedBanner), `src/billing.css`, Billing tab rewritten (no Free card, no trial buttons, plan cards list included products/workers/branches). Copy fixed in Landing, FAQ, guide, `policies.json` (lawyer should review the new Terms wording), admin Plans note.
4. **Bug fixed: new account landed on the Workers dashboard.** After creating a workspace the role stayed at its default `member`; `onCreated` in `Workspace.tsx` now sets role `owner`, adds the business to the switcher and remembers it.
5. **Admin UI polish** (`src/admin.css`, loaded last): cards no longer let search boxes, empty states, forms, filters and plan cards touch their edges; sidebar rows tighter with a visible scrollbar and fade cue (20 links never fit one screen); KPI tiles in tidy rows of four; phone header actions on one row.
6. Safe in-range updates applied: vite 6.4.5, typescript-eslint 8.72.0, supabase CLI 2.122.0. `npm audit`: 0 vulnerabilities. Still held back on purpose (major versions): React 19, Vite 8, TypeScript 7, ESLint 10, eslint-plugin-react-hooks 7, lucide-react 1.x, @vitejs/plugin-react 6.

7. **Second pass (same day):** free trial is now once per PERSON (`20261026090000_one_trial_per_person.sql`, table `trial_grants`; a second business by the same owner starts locked with reason `trial_used`); topbar search removed and replaced by a search field under the title on Inventory, Customers and Records only (`PageSearchContext`); guide PDF was blank because a global print rule hides everything except receipts, so it now prints from its own document (`printGuide.ts`); guide + product tour + FAQ + Terms updated, guide screenshots cleaned of the old search box and Billing re-shot; Terms/Privacy/Cookies got an "In short" box, contents list, numbered sections and a company-details card; `.env.example` and the build now flag missing `VITE_COMPANY_NAME / VITE_COMPANY_ADDRESS / VITE_SUPPORT_EMAIL`. Full security and readiness assessment: `docs/PRODUCTION-READINESS.md`.

### Deploy for this session
`npm run supabase:push`, then `npm run supabase:functions:deploy:worker`, then redeploy the frontend. Then rerun `supabase/tests/e2e-payments/run.sh` (not rerun this session).

### Known gaps found, not fixed
- Plan limits for `customers` and `sales_per_month` look unenforced (only products, branches and employees have triggers). Verify before launch.
- Admin Revenue page crashes if `admin_get_revenue_overview` returns an unexpected shape (seen only with a mock); consider defensive parsing.
- Admin Plans has no field to edit the signup trial length (it is `plans.trial_days` on the Free plan, default 7).

## DONE since V7
1. **Payment bug fixed** ("amount did not match", ref zb_8b961a3c). Cause: Paystack fee-bearer setting; verify reports price + fees in `amount`. Migration `20261016090000_paystack_fee_bearer.sql` + `paystack.ts` now pass `requested_amount` and `fees`. Underpayments, unexplained overpayments and tampered requested amounts are still rejected (tested). **Recovery for the stuck test payments:** after deploying, signed in as the owner open `/?payment=return&reference=<full zb_ reference from Paystack>`. To see the real numbers first: `select reference, failure_reason from payments where status = 'mismatch';`
2. **Money figures spacing** on Dashboard and Reports (cells wider, 4/2x2/1-column layouts, no curved dividers, figures fit to 94% of their box). Files: `src/theme.css` (end), `src/components/ui.tsx` (FitText).
3. **Promoter commissions backend** (`20261016100000_promoter_commissions.sql`): editable terms (default 10% first payment, 5% after, 18 months), snapshot per referral, automatic ledger on payment, promoter earnings RPC, admin list and mark-paid RPCs, audit log. Edit rights: Super + Finance admin only.
4. **Cookie consent**: `src/lib/consent.ts`, `src/components/CookieConsent.tsx` (banner, equal-weight Accept/Reject, Customize dialog, footer "Cookie settings"). Google Analytics (`src/lib/googleAnalytics.ts`) loads ONLY after Accept and only if `VITE_GA_MEASUREMENT_ID` is set. Our own cookie-less visit counter (`src/lib/analytics.ts`) stops and deletes its id on Reject. **Admin visitor counts come from this own counter, not Google Analytics.**
5. **Public pages rebuilt**: `Landing.tsx` (black + green, promoter programme section driven by live terms, honest "free to start" copy, footer links), `LegalPage.tsx` + `policies.json` (Terms, Privacy, Cookies: production text, no draft/"review by counsel" warnings; includes refunds, NDPA rights, promoter rules), `SupportPage.tsx` (`/support`, contact options + FAQ). Old `PublicPages.tsx` and the contradictory static `privacy.html`/`terms.html`/`cookies.html` removed (301 redirects added).
6. **SEO**: `scripts/prepare-pages.mjs` writes robots.txt, sitemap.xml, Search Console verification tag (`VITE_GOOGLE_SITE_VERIFICATION`), JSON-LD; `public/og-image.png`; meta tags in `index.html`; `usePageMeta` per public page. Old sitemap pointed at a GitHub Pages address; fixed.
7. **CSP updated** for Google Analytics (vercel.json and public/_headers); `upgrade-insecure-requests` added.
8. **Look**: legacy green tints converted to neutral grey (`styles.css`), landing is black + green; smooth scrolling, themed custom scrollbar, section reveal animation (`src/scroll.css`); `src/public.css` for the new public components.
9. **Maintenance**: ESLint now runs clean; Node test scripts renamed `.cjs` and linted; data/hooks/helpers split out of component files (`analyticsData.ts`, `chartUtils.ts`, `guideContent.ts`, `startTour.ts`); `siteConfig.ts` is the one place for company name, address, email, WhatsApp, GA id, site URL.

## NOT DONE (do in this order)
1. **Admin UI for the promoter terms and ledger** (backend is ready). In `src/admin/AdminPromoters.tsx` add: a "Commission terms" card (read for all admins, editable only when `profile.canViewFinancials`: three number inputs, calls `admin_set_promoter_terms(p_first, p_recurring, p_months)`, show that changes apply to NEW referrals only) and a "Commissions" table (`admin_list_commissions`, button to mark paid/void via `admin_set_commission_status`).
2. **Promoter pages**: in `src/features/promoter/PromoterPages.tsx` show `<PromoterTermsCard />` on the application page and dashboard, and an earnings card from `get_promoter_earnings()` (pending/paid totals + recent list; amounts are in kobo, divide by 100).
3. **Dependency monitoring in the admin** (requested, not started). Plan: table `dependency_reports(id, created_at, source, report jsonb)` (admin read only); Edge Function `ingest-dependency-report` (secret `DEPENDENCY_REPORT_TOKEN`, header `x-report-token`); script `scripts/dependency-report.mjs` running `npm audit --json` + `npm outdated --json` and posting; RPC `admin_get_dependency_report()` (any admin); admin section "Dependencies" showing counts (vulnerable, outdated, major behind), table, last checked, and a diff vs the previous report that flags **downgrades**. Add `npm run deps:report` and run it in CI/deploy.
4. **Dead button and layout audit** at 390 / 768 / 1024 / 1440 px: static scan for `<button>` without `onClick`/`type="submit"`; puppeteer sweep for horizontal overflow on every route; test sidebar open/close (mobile drawer: menu, close, overlay click, Esc, navigate-closes; desktop collapse; admin sidebar). Helper: `/home/claude/shot/with_dev.sh` pattern (start vite + run script in ONE command; background servers die between commands).
5. **Dead code removal**: delete `src/EntryFlow.tsx` (never imported); remove unused `hasPermission` (`src/lib/identity.ts`) and `getDataMode` (`src/lib/supabase.ts`); drop the unneeded `export` on internal-only symbols (ts-unused-exports list); ~150 CSS classes in `styles.css`/`design.css` are referenced nowhere (e.g. `demo-banner`): remove carefully (check dynamic class names first).
6. **20-point security checklist** (the image): write `docs/SECURITY-CHECKLIST.md` with evidence for each. Already true: no keys in repo/bundle, RLS on all tables, CORS fail-closed, CSP enforced + HSTS + security headers, no cookies set by us, uploads limited (2 MB, PNG/JPEG/WEBP), server-side price + signed webhooks, no `dangerouslySetInnerHTML`. **Still to verify or do:** (a) rate limits on every Edge Function (only worker login, promoter application, payment initiate have them) (b) `href={...}` built from user input must be http(s) only (grep) (c) dynamic SQL `format()`/`execute` uses %I/%L (grep migrations) (d) `build.sourcemap` is off and no `console.log` of sensitive data (e) all `admin_*` RPCs check `is_platform_admin()` (script it) (f) length limits (CHECK constraints) on user text columns (g) manual items for the owner: Supabase spend cap ON, MFA for admin accounts, password rules in Supabase Auth, backups/PITR, Auth redirect URLs, rotate the Paystack key that was pasted in chat.
7. **Refresh docs** `docs/DEPLOY-CHECKLIST.md`: add migrations `20261016090000`, `20261016100000`; env vars below; recovery steps; analytics notes. Update `CHANGES.md`, `docs/AUDIT.md`.
8. **Final regression** on fresh databases (each SQL test file on its own fresh DB), payment e2e suite, load smoke test, `npm test`, `npm run build`, screenshots of Landing, Legal, Support, Cookies pages (they have only been type-checked and viewed on landing/banner/dialog, not the policy and support pages).

## Environment variables to set (names only)
Frontend (Vercel/Cloudflare): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SITE_URL` (https, no trailing slash), `VITE_COMPANY_NAME`, `VITE_COMPANY_ADDRESS`, `VITE_SUPPORT_EMAIL`, `VITE_SUPPORT_WHATSAPP`, `VITE_GA_MEASUREMENT_ID` (G-...), `VITE_GOOGLE_SITE_VERIFICATION`, `VITE_WHATSAPP_CHANNEL_URL`.
Supabase secrets: `PAYSTACK_SECRET_KEY`, `SITE_URL`, `ALLOWED_ORIGINS`.

## Migrations to apply (all, in order; newest two are new in this batch)
...`20261015110000_pagination_indexes.sql`, `20261016090000_paystack_fee_bearer.sql`, `20261016100000_promoter_commissions.sql`. Then redeploy the Paystack functions (`npm run supabase:functions:deploy:paystack`).

## Decisions needed from the owner
* Real company name, address and support email for the policies (placeholders fall back to "Zerøbyte" and WhatsApp/in-app support if unset).
* Confirm the refund wording in the Terms (default: 14 days for wrong charges; otherwise no refund) and have a Nigerian lawyer review Terms, Privacy and Cookies. I cannot certify legal compliance.
* Commission rules wording: first payment 10%, later 5%, 18 months from the first payment, on plan price (not gateway fees). Confirm.
