# Security audit and hardening, 9 Nov 2026

Scope: the V8 launch-ready handover. Method: the whole database was loaded into a throwaway PostgreSQL 16 and
attacked live as `anon`, as a logged-in stranger, as a business owner against another business, and as every admin
role; every edge function and the frontend were read line by line; dependencies were audited; races were run in
parallel. Nothing touched the live Supabase project.

## Findings and status

| # | Severity | Finding | Proof | Status |
|---|---|---|---|---|
| 1 | High | Any admin role (support, moderation) could set a plan price to NGN 100, change limits or deactivate plans; Paystack then charged that price | Live: price read back as 100.00 | **Fixed** (finance/super only). Test 103 fails on the old schema |
| 2 | High | A PLATFORM_ADMIN could take over the SUPER_ADMIN account: promoter application with the super admin's email (no ownership proof) -> approve -> "link existing account" returned a recovery link | DB steps live; link step read in code | **Fixed** (function refuses admin accounts; review needs Promoters section) |
| 3 | High | 12 admin RPCs only checked "is any admin" (promoter review/list with phone numbers, broadcast to all users, announcements, feedback, plans) | Live, per role | **Fixed**, test 103 |
| 4 | Medium | Email confirmation off => unlimited free trials with new accounts | Reasoned + trial test | **Fixed** (per person: email aliases, device, address burst, private domain; disposable emails refused; Turnstile) |
| 5 | Medium | Any admin with the Users section could suspend the super admin | Code | **Fixed** |
| 6 | Medium | Worker-login throttle bypass (spelling variants, parallel burst) and no CAPTCHA | Code | **Fixed** (normalised key, count-before-check, Turnstile passthrough) |
| 7 | Medium | Promoter form rate limit trusted forgeable X-Forwarded-For; the global breaker let one attacker block everyone | Live: spoofed headers now still throttled | **Fixed**; form now behind CAPTCHA edge function |
| 8 | Medium | Rejected anonymous calls caused database writes (cost/DoS amplification) | Code | **Fixed** |
| 9 | Medium | No two-factor on the admin console | Code | **Fixed** (TOTP, lock-out-proof switch; test 104) |
| 10 | Low | Worker creation leaked "already registered" (email enumeration) | Code | **Fixed** |
| 11 | Low | Old sessions survived password reset / suspension | Code | **Fixed** (`revoke_user_sessions`) |
| 12 | Low | Codex callback replayable with a new unsigned event-id header | Code | **Fixed** (key = hash of signed body) |
| 13 | Low | Owners got "permission denied" reading their payment history | Live | **Fixed** (grant) |
| 14 | Low | Unpinned `supabase-js@2`; GitHub Actions pinned by tag | Code | **Fixed** (pinned version / commit hashes) |
| 15 | Medium | Every spreadsheet export (`downloadCsv`) allowed CSV formula injection: a product or customer named `=HYPERLINK(...)` would run when the owner opened the file; no UTF-8 marker either | Code + unit tests | **Fixed** (`csvSafe`, byte-order mark), 10 Nov |

## What held up under attack
Row-level security on every table; zero cross-business reads, writes or deletes across all 33 business tables;
anonymous access limited to the public plan catalog; customers cannot write payments, settle payments, self-activate a
plan or edit their subscription; Paystack price is server-side with signature and re-verification; promoter payouts
lock and re-check; 20 parallel sales of the last unit made exactly 1 sale; no XSS sinks; no hardcoded live secrets;
production dependencies have 0 high/critical advisories; logo uploads are size/type limited.

## Not covered or needs you
- Edge functions were syntax-checked and their logic exercised in isolation, but not run end to end against a real
  Supabase project (no Deno runtime here). Run `supabase/tests/e2e-payments` after deploying.
- Supabase Auth settings (CAPTCHA, password length, confirm-email) live in the dashboard: see docs/DEPLOYMENT.md section 6.
- No load/DoS test, and deployed response headers were not inspected.
- CSP `connect-src` still allows `https://*.supabase.co`; tighten it to your exact project host when convenient.
- Residual trial risk: see the honest note in docs/DEPLOYMENT.md section 6.
