# Database tests

Plain-SQL regression tests for the security and sales fixes. They print results; read them against the
expectations in the comments and `\echo` lines.

Run against a **local or staging** database only (they truncate and insert test rows).

## On a plain PostgreSQL 16 server
`00_supabase_stub.sql` fakes the Supabase pieces the migrations rely on (roles, `auth.users`, `auth.uid()`).

```bash
createdb zb && psql -d zb -v ON_ERROR_STOP=1 -f supabase/tests/00_supabase_stub.sql
for f in supabase/migrations/*.sql; do psql -d zb -v ON_ERROR_STOP=1 -1 -f "$f"; done
psql -d zb -f supabase/tests/10_admin_escalation.sql
psql -d zb -f supabase/tests/20_sale_idempotency_discount.sql
psql -d zb -f supabase/tests/30_promoter_throttle.sql
```

## On the Supabase CLI local stack
Skip the stub (the real roles and `auth` schema already exist): `supabase start`, then run the three test files
with `psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" -f <file>`.

## What they prove
| File | Expectation |
|---|---|
| `10_admin_escalation.sql` | A SUPPORT_ADMIN cannot insert/update their own SUPER_ADMIN row or edit plans; FINANCE_ADMIN still can edit plans; SUPER_ADMIN can grant via RPC; anon cannot call plan helpers; managers cannot write `employee_profiles` directly |
| `20_sale_idempotency_discount.sql` | The same operation id sent 3x creates ONE sale and decrements stock once; discount is stored; an over-large discount is rejected |
| `30_promoter_throttle.sql` | Oversized fields are rejected; the 6th application per hour from one IP is rate-limited; another IP is unaffected |

| `70_billing_integrity.sql` | A customer cannot self-activate a paid plan, farm trials, overwrite a paid plan, write payments, or call the settle function; wrong amount/currency never activates; replays are harmless; an ended trial gets Free limits. Run on a fresh database. |

| `102_trial_anti_farming.sql` | One trial per person: a second business, a new account on the same device, email aliases (dots, +tag, googlemail), a missing device token, a burst from one address and a catch-all domain are all refused; disposable emails cannot register; only a super admin can rescue a refused customer. Self-checking. |
| `103_admin_role_gates.sql` | Support / moderation / platform admins cannot change plan prices or deactivate plans; support cannot approve promoters or list their contact details; only finance and super admin can reprice; announcements are super-admin only. Self-checking; **fails on the pre-fix schema**. |
| `104_admin_mfa.sql` | The two-factor switch starts off; cannot be turned on without a verified session or while any admin is not enrolled; once on, a password-only session is not an admin session anywhere; audited. Self-checking. |

| `105_business_reports.sql` | Daily/weekly reports: a Lagos-time day (00:30 sale belongs to the new day), totals/cost/profit/credit/owing exact and equal to the Overview, only owners and admins can read, no writes/internal functions for customers, scheduler timing/slots/finalising/no double notification, quiet/expired/disabled businesses skipped, no phone or email in a payload, input limits. Self-checking; mutation-tested. |

**Run each test file on a freshly migrated database.** Several tests change shared data (plans, subscriptions), so running them one after another in the same database can produce misleading errors. `80_analytics_and_pagination.sql` is self-checking: it prints ALL ANALYTICS AND PAGINATION CHECKS PASSED or stops at the first failed expectation.
