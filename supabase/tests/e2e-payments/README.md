# Payment end-to-end test (35 checks)

Runs the REAL `paystack-initialize`, `paystack-verify` and `paystack-webhook` Edge Functions (under Deno) against a
REAL PostgreSQL + PostgREST with every migration applied, and a fake Paystack. No money moves and no Supabase project
is touched. It covers: trial -> paid activation, repeat verification, webhook replay and bad signatures, abandoned /
failed / pending / mismatched amount / wrong currency payments, other people's references, plan-switch refusal,
database failure (must not report success), CORS, and the diagnostics log.

Needs on the PATH: `deno` (2.x), `postgrest` (12.x), PostgreSQL 16 and Node 20+.

```bash
createdb zbe && psql -d zbe -f supabase/tests/00_supabase_stub.sql
for f in supabase/migrations/*.sql; do psql -d zbe -v ON_ERROR_STOP=1 -1 -f "$f"; done
psql -d zbe -c "create role authenticator login password 'pw' noinherit; grant anon, authenticated, service_role to authenticator; grant usage on schema public to authenticator;"
supabase/tests/e2e-payments/run.sh
```
The `PAYSTACK_SECRET_KEY` it uses (`sk_test_local_fake_key`) is a made-up value that only the fake Paystack accepts.
