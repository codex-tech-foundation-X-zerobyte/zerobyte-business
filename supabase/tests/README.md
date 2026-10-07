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
